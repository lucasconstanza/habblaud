import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { protectPrivateDirectory, protectPrivateFile } from './windows-acl';

function privateAcl(path: string): boolean {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$target = $env:HABBLAUD_ACL_TARGET',
    '$acl = if ([System.IO.Directory]::Exists($target)) { [System.IO.Directory]::GetAccessControl($target) } else { [System.IO.File]::GetAccessControl($target) }',
    '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$rules = $acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier])',
    '$ids = @($rules | ForEach-Object { $_.IdentityReference.Value })',
    'Write-Output ($acl.AreAccessRulesProtected -and $ids.Count -eq 1 -and $ids[0] -eq $sid)',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', env: { ...process.env, HABBLAUD_ACL_TARGET: path }, windowsHide: true,
  });
  expect(r.status, r.stderr).toBe(0);
  expect(r.stderr).toBe('');
  expect(r.stdout.trim()).toBe('True');
  return true;
}

describe.skipIf(process.platform !== 'win32')('ACL privada no Windows', () => {
  it('protege pasta e arquivo com acesso somente da conta atual', () => {
    const local = join(process.cwd(), '.local');
    mkdirSync(local, { recursive: true });
    const dir = mkdtempSync(join(local, 'acl-test-'));
    try {
      protectPrivateDirectory(dir);
      const file = join(dir, 'chave.txt');
      writeFileSync(file, 'sintético');
      protectPrivateFile(file);
      expect(privateAcl(dir)).toBe(true);
      expect(privateAcl(file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
