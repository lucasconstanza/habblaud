import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { saveGeminiSettings, updateGeminiSettings } from '../../scripts/gemini-install';
import { tempDir } from './fixtures';

function expectPrivate(file: string): void {
  if (process.platform !== 'win32') {
    expect(statSync(file).mode & 0o777).toBe(0o600);
    return;
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::WriteLine([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)',
    '$acl = [System.IO.File]::GetAccessControl($env:HABBLAUD_PRIVATE_FILE)',
    '$acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { [Console]::WriteLine($_.IdentityReference.Value) }',
  ].join('; ');
  const powershell = join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const lines = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8', env: { ...process.env, HABBLAUD_PRIVATE_FILE: file }, windowsHide: true,
  }).trim().split(/\r?\n/);
  expect(lines).toEqual([lines[0], lines[0]]);
}

describe('instalador Gemini CLI', () => {
  it('preserva opções e hooks de terceiros, instala uma vez e remove só o próprio handler', () => {
    const original = { theme: 'custom', hooks: { BeforeTool: [{ matcher: 'shell', hooks: [{ type: 'command', command: 'outro' }] }], OtherEvent: [{ hooks: [{ command: 'terceiro' }] }] } };
    const installed = updateGeminiSettings(original, 'install', 'C:/Habblaud/mod/habblaud-gemini/hook.mjs');
    expect(installed.theme).toBe('custom');
    expect((installed.hooks as Record<string, unknown[]>).OtherEvent).toEqual(original.hooks.OtherEvent);
    expect((installed.hooks as Record<string, unknown[]>).BeforeTool).toHaveLength(2);
    expect(updateGeminiSettings(installed, 'install', 'C:/Habblaud/mod/habblaud-gemini/hook.mjs')).toEqual(installed);
    expect(updateGeminiSettings(installed, 'uninstall', 'C:/Habblaud/mod/habblaud-gemini/hook.mjs')).toEqual(original);
  });

  it('não remove outro handler acrescentado ao mesmo grupo', () => {
    const installed = updateGeminiSettings({}, 'install', 'C:/Habblaud/mod/habblaud-gemini/hook.mjs');
    const hooks = installed.hooks as Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;
    hooks.BeforeTool[0].hooks.push({ type: 'command', command: 'outro' });
    const removed = updateGeminiSettings(installed, 'uninstall') as { hooks: typeof hooks };
    expect(removed.hooks.BeforeTool[0].hooks).toEqual([{ type: 'command', command: 'outro' }]);
  });

  it.skipIf(process.platform !== 'win32')('comando instalado executa no PowerShell sem ParserError', () => {
    const installed = updateGeminiSettings({}, 'install');
    const hooks = installed.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    const command = hooks.SessionStart[0].hooks[0].command;
    expect(command).toMatch(/^& /);
    const powershell = join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const output = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      input: JSON.stringify({ session_id: 'check-1', cwd: process.cwd(), hook_event_name: 'SessionStart' }),
      encoding: 'utf8', windowsHide: true,
    });
    expect(output.trim()).toBe('{}');
  });

  it('salva configuração e backup privados mesmo em pasta com leitura herdada', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'settings.json');
      const original = '{"auth":"segredo-antigo"}\n';
      const output = '{"auth":"segredo-novo"}\n';
      writeFileSync(file, original, { mode: 0o644 });
      if (process.platform === 'win32') {
        const icacls = join(process.env.SystemRoot!, 'System32', 'icacls.exe');
        execFileSync(icacls, [tmp.dir, '/grant', '*S-1-1-0:(OI)(CI)R', '/Q']);
      } else chmodSync(file, 0o644);
      const backup = saveGeminiSettings(file, original, output);
      expect(backup).toBeDefined();
      expect(readFileSync(file, 'utf8')).toBe(output);
      expect(readFileSync(backup!, 'utf8')).toBe(original);
      expectPrivate(file);
      expectPrivate(backup!);
    } finally { tmp.cleanup(); }
  });

  it.skipIf(process.platform !== 'win32')('falha de ACL não deixa cópia ou temporário com segredos', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'settings.json');
      writeFileSync(file, '{"auth":"segredo-antigo"}');
      vi.stubEnv('SystemRoot', '');
      expect(() => saveGeminiSettings(file, 'segredo-antigo', 'segredo-novo')).toThrow();
      expect(readdirSync(tmp.dir)).toEqual(['settings.json']);
      expect(readFileSync(file, 'utf8')).not.toContain('segredo-novo');
    } finally {
      vi.unstubAllEnvs();
      tmp.cleanup();
    }
  });
});
