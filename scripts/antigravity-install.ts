// Configura hooks globais e statusline do Antigravity CLI sem alterar grupos de outros produtos.
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrivateTempFile, protectPrivateFile } from '../server/windows-acl';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(ROOT, 'mod', 'habblaud-antigravity', 'hook.mjs');
const STATUSLINE = join(ROOT, 'mod', 'habblaud-antigravity', 'statusline.mjs');
const EVENTS = ['SessionStart', 'PreInvocation', 'Stop'] as const;
const GROUP = 'habblaud-antigravity';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined;
// O agy no Windows envia aspas como \" literais ao cmd /c. --import recebe URL sem espaços
// (inclusive quando o projeto contém espaços), e -e 0 evita passar qualquer aspas ao shell.
const scriptArg = (script: string): string => `--import=${pathToFileURL(script).href}`;
const hookCommand = (event: string, script: string): string => `node ${scriptArg(script)} -e 0 ${event}`;
const statusCommand = (script: string): string => `node ${scriptArg(script)} -e 0`;

export function updateAntigravityHooks(original: unknown, action: 'install' | 'uninstall', script = HOOK): Obj {
  const root = obj(original);
  if (!root) throw new Error('hooks.json deve ser objeto JSON');
  const next = { ...root };
  if (action === 'uninstall') { delete next[GROUP]; return next; }
  if (GROUP in next && !obj(next[GROUP])) throw new Error('grupo de hooks Habblaud inválido');
  next[GROUP] = Object.fromEntries(EVENTS.map((event) => [event,
    [{ type: 'command', command: hookCommand(event, script), timeout: 3 }]]));
  return next;
}

export function updateAntigravitySettings(original: unknown, action: 'install' | 'uninstall', script = STATUSLINE): Obj {
  const settings = obj(original);
  if (!settings) throw new Error('settings.json deve ser objeto JSON');
  const next = { ...settings };
  const existing = obj(settings.statusLine);
  const own = typeof existing?.command === 'string' && /habblaud-antigravity[\\/]statusline\.mjs/.test(existing.command);
  if (action === 'uninstall') { if (own) delete next.statusLine; return next; }
  if (settings.statusLine !== undefined && !own) throw new Error('statusLine de outro produto presente; escolha manualmente como combinar');
  next.statusLine = { type: 'command', command: statusCommand(script), stack_with_default: true };
  return next;
}

function savePrivate(path: string, raw: string, output: string): string | undefined {
  const backup = existsSync(path) ? `${path}.habblaud-backup-${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined;
  let tmp: string | undefined;
  try {
    if (existsSync(path)) { protectPrivateFile(path); chmodSync(path, 0o600); }
    if (backup) {
      tmp = createPrivateTempFile(backup); writeFileSync(tmp, raw); renameSync(tmp, backup); tmp = undefined;
    }
    tmp = createPrivateTempFile(path); writeFileSync(tmp, output); renameSync(tmp, path); tmp = undefined;
    return backup;
  } finally { if (tmp) rmSync(tmp, { force: true }); }
}

function restorePrivate(path: string, raw: string, existed: boolean): void {
  if (!existed) { rmSync(path, { force: true }); return; }
  let tmp: string | undefined;
  try {
    tmp = createPrivateTempFile(path); writeFileSync(tmp, raw); renameSync(tmp, path); tmp = undefined;
  } finally { if (tmp) rmSync(tmp, { force: true }); }
}

/** Duas configurações compõem uma instalação; se a segunda falhar, repõe a primeira. */
export function saveAntigravityChanges(changes: Array<{ path: string; raw: string; next: Obj }>): void {
  const written: Array<{ path: string; raw: string; existed: boolean }> = [];
  try {
    for (const x of changes) {
      const existed = existsSync(x.path);
      const backup = savePrivate(x.path, x.raw, JSON.stringify(x.next, null, 2) + '\n');
      written.push({ path: x.path, raw: x.raw, existed });
      process.stdout.write(`Configuração atualizada: ${x.path}${backup ? `; backup: ${backup}` : ''}\n`);
    }
  } catch (err) {
    for (const x of written.reverse()) restorePrivate(x.path, x.raw, x.existed);
    throw err;
  }
}

function main(): void {
  const [action, ...args] = process.argv.slice(2);
  if (!['install', 'uninstall', 'status'].includes(action ?? '') || args.some((a) => a !== '--dry-run')) {
    process.stderr.write('Uso: npm run antigravity:<install|uninstall|status> -- [--dry-run]\n');
    process.exitCode = 2; return;
  }
  const home = process.env.HOME || homedir();
  const base = resolve(process.env.HABBLAUD_GEMINI_DIR || join(home, '.gemini'));
  const hooksPath = join(base, 'config', 'hooks.json');
  const settingsPath = join(resolve(process.env.HABBLAUD_ANTIGRAVITY_DIR || join(base, 'antigravity-cli')), 'settings.json');
  if (!existsSync(dirname(hooksPath)) || !existsSync(dirname(settingsPath))) throw new Error('Pasta do Antigravity CLI não encontrada');
  const hooksRaw = existsSync(hooksPath) ? readFileSync(hooksPath, 'utf8') : '{}';
  const settingsRaw = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '{}';
  const hooks = JSON.parse(hooksRaw) as unknown;
  const settings = JSON.parse(settingsRaw) as unknown;
  if (action === 'status') {
    const group = obj(obj(hooks)?.[GROUP]);
    const line = obj(obj(settings)?.statusLine);
    process.stdout.write(`Hooks do Habblaud: ${EVENTS.filter((e) => Array.isArray(group?.[e]) &&
      (group[e] as unknown[]).some((h) => obj(h)?.command === hookCommand(e, HOOK))).length}/${EVENTS.length}; statusline: ${line?.command === statusCommand(STATUSLINE) ? 'instalado' : 'ausente'}\n`);
    return;
  }
  const nextHooks = updateAntigravityHooks(hooks, action as 'install' | 'uninstall');
  const nextSettings = updateAntigravitySettings(settings, action as 'install' | 'uninstall');
  const changes = [{ path: hooksPath, raw: hooksRaw, next: nextHooks }, { path: settingsPath, raw: settingsRaw, next: nextSettings }]
    .filter((x) => JSON.stringify(JSON.parse(x.raw)) !== JSON.stringify(x.next));
  if (!changes.length) { process.stdout.write('Nenhuma alteração necessária.\n'); return; }
  if (args.includes('--dry-run')) { process.stdout.write(`Alteraria ${changes.map((x) => x.path).join(' e ')}; configurações de outros produtos preservadas.\n`); return; }
  saveAntigravityChanges(changes);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
