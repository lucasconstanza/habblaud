import { mkdirSync, writeFileSync } from 'node:fs';
import type { execFile } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../test/fixtures';
import { ClaudeUsageRefresher, claudeUsageCommand, claudeUsageEnv } from './refresh';
import { AccountsService } from './service';

const NOW = Date.parse('2026-11-04T23:00:00Z');
let temp: ReturnType<typeof tempDir>;
let first: string;
let second: string;
beforeEach(() => {
  temp = tempDir();
  first = join(temp.dir, '.claude');
  second = join(temp.dir, '.claude-conta2');
  mkdirSync(join(first, 'projects'), { recursive: true });
  mkdirSync(join(second, 'projects'), { recursive: true });
});
afterEach(() => temp.cleanup());

function service(): AccountsService {
  return new AccountsService({ dirs: [first, second], home: temp.dir, env: {}, onChange: () => {}, now: () => NOW });
}

function cache(dir: string, at = NOW): void {
  const file = dir === first ? join(temp.dir, '.claude.json') : join(dir, '.claude.json');
  writeFileSync(file, JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: at, utilization: { seven_day: { utilization: 42 } } } }));
}

describe('atualização do uso Claude por conta', () => {
  it('a conta padrão usa o perfil padrão; outra conta recebe apenas seu config dir', () => {
    const inherited = { CLAUDE_CONFIG_DIR: 'outra', CLAUDECODE: '1', AI_AGENT: '1', PATH: 'ok' };
    expect(claudeUsageEnv(first, temp.dir, inherited)).toEqual({ PATH: 'ok' });
    expect(claudeUsageEnv(second, temp.dir, inherited)).toEqual({ PATH: 'ok', CLAUDE_CONFIG_DIR: second });
  });

  it('fecha stdin da CLI imediatamente para /usage não aguardar até o timeout', async () => {
    const end = vi.fn();
    const launch = vi.fn((_bin: string, _args: string[], _opts: unknown, done: (err: Error | null) => void) => {
      queueMicrotask(() => done(null));
      return { stdin: { end } };
    });
    expect(await claudeUsageCommand('claude.exe', temp.dir, launch as unknown as typeof execFile)(first)).toBe(true);
    expect(end).toHaveBeenCalledOnce();
    expect(launch.mock.calls[0][1]).toEqual(['--print', '--no-session-persistence', '--output-format', 'json', '/usage']);
  });
  it('usa somente a pasta da conta conhecida e exige um cache novo', async () => {
    const accounts = service();
    const command = vi.fn(async (dir: string) => { cache(dir); return true; });
    const refresh = new ClaudeUsageRefresher(accounts, command, () => NOW);
    expect(await refresh.refresh('.claude-conta2')).toBe('ok');
    expect(command).toHaveBeenCalledExactlyOnceWith(second);
    expect(accounts.list(new Map())[1].usage?.sevenDay?.utilization).toBe(42);
    expect(accounts.list(new Map())[0].usage).toBeUndefined();
    expect(await refresh.refresh('.claude-conta2')).toBe('rate-limited');
    expect(await refresh.refresh('..\\outra-conta')).toBe('unknown-account');
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('recusa execução paralela e distingue falha da CLI de ausência de cache novo', async () => {
    const accounts = service();
    let release!: (ok: boolean) => void;
    const command = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const refresh = new ClaudeUsageRefresher(accounts, command, () => NOW);
    const pending = refresh.refresh('.claude');
    expect(await refresh.refresh('.claude')).toBe('busy');
    release(false);
    expect(await pending).toBe('cli-failed');
    expect(command).toHaveBeenCalledTimes(1);
    const noCache = new ClaudeUsageRefresher(accounts, async () => true, () => NOW);
    expect(await noCache.refresh('.claude')).toBe('no-new-usage');
  });
});
