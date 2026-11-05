// Uma conta local do Gemini CLI. Só confirma a pasta; nunca lê oauth_creds.json ou settings.json.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, win32 } from 'node:path';
import { ACCOUNT_COLORS, type DetectedAccount } from '../../accounts/detect';

/** O Docker lê metadados escritos no host: um caminho Windows continua absoluto no Linux. */
export const isGeminiAbsolute = (path: string): boolean => isAbsolute(path) || win32.isAbsolute(path);

export function discoverGeminiDir(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): string | undefined {
  const raw = env.HABBLAUD_GEMINI_DIR?.trim();
  const dir = resolve(raw ? (raw.startsWith('~') ? join(home, raw.slice(1)) : raw) : join(home, '.gemini'));
  try {
    return statSync(dir).isDirectory() && existsSync(join(dir, 'tmp')) ? dir : undefined;
  } catch {
    return undefined;
  }
}

export function detectGeminiAccount(dir: string, taken: readonly DetectedAccount[] = []): DetectedAccount {
  const id = basename(dir) || '.gemini';
  const shorts = new Set(taken.map((a) => a.short.toUpperCase()));
  const colors = new Set(taken.map((a) => a.color));
  const short = ['G', 'M', 'I'].find((s) => !shorts.has(s)) ?? 'G';
  return {
    id,
    provider: 'gemini',
    configDir: isAbsolute(dir) ? dir : resolve(dir),
    short,
    name: 'Gemini CLI',
    color: ACCOUNT_COLORS.find((c) => !colors.has(c)) ?? ACCOUNT_COLORS[0],
  };
}
