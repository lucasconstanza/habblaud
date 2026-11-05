// Configura os hooks observacionais do Gemini CLI no settings.json do usuário.
// Status e --dry-run não gravam; install/uninstall preservam as outras opções e criam backup.
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateTempFile, protectPrivateFile } from '../server/windows-acl';

const EVENTS = ['SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'Notification'] as const;
const MARK = /habblaud-gemini[\\/]hook\.mjs/;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'mod', 'habblaud-gemini', 'hook.mjs');
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined;
const ownCommand = (v: unknown): boolean => typeof obj(v)?.command === 'string' && MARK.test(obj(v)!.command as string);
const isOurs = (v: unknown): boolean => Array.isArray(obj(v)?.hooks) && (obj(v)!.hooks as unknown[]).some(ownCommand);
function withoutOurs(group: unknown): unknown | undefined {
  const g = obj(group);
  if (!g || !Array.isArray(g.hooks)) return group;
  const kept = g.hooks.filter((h) => !ownCommand(h));
  return kept.length ? { ...g, hooks: kept } : undefined;
}

export function updateGeminiSettings(original: unknown, action: 'install' | 'uninstall', script = SCRIPT): Obj {
  const settings = obj(original);
  if (!settings) throw new Error('settings.json deve ser um objeto JSON');
  const next: Obj = { ...settings };
  const hooks = obj(settings.hooks) ?? {};
  const updated: Obj = { ...hooks };
  // O Gemini CLI executa hooks pelo PowerShell no Windows: caminho entre aspas precisa do operador &.
  const command = `${process.platform === 'win32' ? '& ' : ''}"${process.execPath.replaceAll('"', '\\"')}" "${script.replaceAll('"', '\\"')}"`;
  for (const event of EVENTS) {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) throw new Error(`hooks.${event} deve ser uma lista`);
    const kept = (groups as unknown[] | undefined ?? []).map(withoutOurs).filter((group) => group !== undefined);
    if (action === 'install') kept.push({ hooks: [{ name: 'Habblaud Gemini', type: 'command', command, timeout: 5000 }] });
    if (kept.length) updated[event] = kept;
    else delete updated[event];
  }
  if (Object.keys(updated).length) next.hooks = updated;
  else delete next.hooks;
  return next;
}

/** Grava configuração e backup com permissões restritas antes de copiar qualquer dado sensível. */
export function saveGeminiSettings(path: string, original: string, output: string): string | undefined {
  const backup = existsSync(path) ? `${path}.habblaud-backup-${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined;
  let backupTmp: string | undefined;
  let configTmp: string | undefined;
  try {
    if (backup) {
      if (existsSync(backup)) throw new Error('backup do Gemini CLI já existe');
      backupTmp = createPrivateTempFile(backup);
      writeFileSync(backupTmp, original);
      renameSync(backupTmp, backup);
      backupTmp = undefined;
    }
    configTmp = createPrivateTempFile(path);
    writeFileSync(configTmp, output);
    renameSync(configTmp, path);
    configTmp = undefined;
    return backup;
  } finally {
    if (backupTmp) rmSync(backupTmp, { force: true });
    if (configTmp) rmSync(configTmp, { force: true });
  }
}

function main(): void {
  const [action, ...args] = process.argv.slice(2);
  if (!['install', 'uninstall', 'status'].includes(action ?? '') || args.some((x) => x !== '--dry-run')) {
    process.stderr.write('Uso: npm run gemini:<install|uninstall|status> -- [--dry-run]\n');
    process.exitCode = 2;
    return;
  }
  const home = process.env.HOME || homedir();
  const dir = resolve(process.env.HABBLAUD_GEMINI_DIR || join(home, '.gemini'));
  if (!existsSync(dir)) throw new Error('Pasta do Gemini CLI não encontrada');
  const path = join(dir, 'settings.json');
  if (action !== 'status' && !args.includes('--dry-run') && existsSync(path)) {
    protectPrivateFile(path);
    chmodSync(path, 0o600);
  }
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '{}';
  const settings = JSON.parse(raw) as unknown;
  const hooks = obj(obj(settings)?.hooks);
  const installed = EVENTS.filter((event) => Array.isArray(hooks?.[event]) && (hooks![event] as unknown[]).some(isOurs));
  if (action === 'status') {
    process.stdout.write(`Hooks do Habblaud: ${installed.length}/${EVENTS.length}; configuração: ${path}\n`);
    return;
  }
  const next = updateGeminiSettings(settings, action as 'install' | 'uninstall');
  const output = JSON.stringify(next, null, 2) + '\n';
  if (JSON.stringify(settings) === JSON.stringify(next)) {
    process.stdout.write('Nenhuma alteração necessária.\n');
    return;
  }
  if (args.includes('--dry-run')) {
    process.stdout.write(`${action === 'install' ? 'Instalaria' : 'Removeria'} os hooks do Habblaud em ${path}; outros hooks preservados.\n`);
    return;
  }
  const backup = saveGeminiSettings(path, raw, output);
  process.stdout.write(`Configuração atualizada: ${path}${backup ? `; backup: ${backup}` : ''}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
