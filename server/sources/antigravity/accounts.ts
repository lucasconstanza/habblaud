// Identidade local do Antigravity CLI. Autenticação e tokens nunca são lidos.
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { ACCOUNT_COLORS, type DetectedAccount } from '../../accounts/detect';

export function discoverAntigravityDir(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): string | undefined {
  if (env.HABBLAUD_ANTIGRAVITY === '0') return undefined;
  const raw = env.HABBLAUD_ANTIGRAVITY_DIR?.trim();
  const dir = resolve(raw ? (raw.startsWith('~') ? join(home, raw.slice(1)) : raw) : join(home, '.gemini', 'antigravity-cli'));
  try {
    return statSync(dir).isDirectory() && statSync(join(dir, 'brain')).isDirectory() ? dir : undefined;
  } catch { return undefined; }
}

export function detectAntigravityAccount(dir: string, taken: readonly DetectedAccount[] = []): DetectedAccount {
  const shorts = new Set(taken.map((a) => a.short.toUpperCase()));
  const colors = new Set(taken.map((a) => a.color));
  return {
    id: basename(dir) || 'antigravity-cli', provider: 'antigravity', configDir: isAbsolute(dir) ? dir : resolve(dir),
    short: ['G', 'A', 'Y'].find((s) => !shorts.has(s)) ?? 'G', name: 'Antigravity CLI',
    color: ACCOUNT_COLORS.find((c) => !colors.has(c)) ?? ACCOUNT_COLORS[0],
  };
}
