// Em NTFS, chmod(0600) não restringe a leitura por outras contas. Para arquivos com segredos,
// instala uma DACL sem herança que dá acesso só à conta do processo.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$file = $env:HABBLAUD_PRIVATE_FILE',
  '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
  '$acl = [System.Security.AccessControl.FileSecurity]::new()',
  '$acl.SetAccessRuleProtection($true, $false)',
  '$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)',
  '$acl.AddAccessRule($rule)',
  '[System.IO.File]::SetAccessControl($file, $acl)',
].join('; ');

/** Fecha a ACL de um arquivo existente. Falha sem ler ou escrever o conteúdo. */
export function protectPrivateFile(file: string): void {
  if (process.platform !== 'win32') return;
  const root = process.env.SystemRoot;
  if (!root || !isAbsolute(root)) throw new Error('SystemRoot ausente');
  const powershell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = Buffer.from(ACL_SCRIPT, 'utf16le').toString('base64');
  try {
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
      env: { ...process.env, HABBLAUD_PRIVATE_FILE: file },
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    });
  } catch {
    // Não repassar a linha de comando nem detalhes do sistema ao log.
    throw Object.assign(new Error('ACL não pôde ser restringida'), { code: 'EACCES' });
  }
}

/** Cria um temporário vazio e exclusivo, com ACL fechada antes de qualquer segredo ser gravado. */
export function createPrivateTempFile(file: string): string {
  const tmp = `${file}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    created = true;
    closeSync(fd);
    protectPrivateFile(tmp);
    return tmp;
  } catch (err) {
    if (created) rmSync(tmp, { force: true });
    throw err;
  }
}
