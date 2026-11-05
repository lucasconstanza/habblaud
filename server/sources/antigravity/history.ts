// Histórico do Antigravity CLI em brain/<uuid>/.system_generated/logs/transcript.jsonl
// (ou transcript_full.jsonl quando só ele existe).
// Um transcript não prova que a sessão está aberta. Projeto só quando cache ou statusline o confirmam.
import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep, win32 } from 'node:path';
import type { RecentSession } from '../../../shared/types';
import { HISTORY_LIMIT, HISTORY_MAX_AGE_MS } from '../history';
import type { HistoryProvider, HistoryResolveResult } from '../source';
import { encodeCwd } from '../watcher';
import { tr } from '../../../shared/i18n';
import { AntigravityTerminalParser, firstAntigravityPrompt } from './terminal';

export const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 256 * 1024;
const absolute = (path: string): boolean => isAbsolute(path) || win32.isAbsolute(path);
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function head(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const b = Buffer.alloc(HEAD_BYTES);
    return b.subarray(0, readSync(fd, b, 0, b.length, 0)).toString('utf8');
  } finally { closeSync(fd); }
}

function safeTranscript(brain: string, id: string, cutoff = 0): { path: string; size: number; mtimeMs: number } | undefined {
  if (!CONVERSATION_ID.test(id)) return undefined;
  // A CLI atual mantém os dois; a versão resumida evita expor passos internos desnecessários.
  for (const filename of ['transcript.jsonl', 'transcript_full.jsonl']) {
    try {
      const path = realpathSync(join(brain, id, '.system_generated', 'logs', filename));
      if (!inside(brain, path)) continue;
      const st = statSync(path);
      if (st.isFile() && st.mtimeMs >= cutoff) return { path, size: st.size, mtimeMs: st.mtimeMs };
    } catch { /* usa o outro formato */ }
  }
  return undefined;
}

function cachedProjects(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const path = join(dir, 'cache', 'last_conversations.json');
    const root = realpathSync(dir);
    const real = realpathSync(path);
    if (!inside(root, real)) return out;
    const st = statSync(real);
    if (!st.isFile() || st.size > 1024 * 1024) return out;
    const j = JSON.parse(readFileSync(real, 'utf8')) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return out;
    for (const [project, id] of Object.entries(j)) {
      if (absolute(project) && project.length <= 4_096 && typeof id === 'string' && CONVERSATION_ID.test(id)) {
        out.set(id.toLowerCase(), project);
      }
    }
  } catch { /* cache opcional */ }
  return out;
}

interface Candidate { id: string; path: string; mtimeMs: number; size: number; title?: string; project?: string }

export class AntigravityHistory implements HistoryProvider {
  readonly provider = 'antigravity' as const;
  private byId = new Map<string, Candidate>();
  constructor(private readonly opts: { dir: string; account: () => string | undefined;
    projectOf: (id: string) => string | undefined; openAgentOf: (id: string) => string | undefined; now?: () => number }) {}

  hasAccount(account: string): boolean { return account === this.opts.account(); }

  private scan(includeOld = false): Candidate[] {
    let brain: string;
    try { brain = realpathSync(join(this.opts.dir, 'brain')); } catch { return []; }
    const out: Candidate[] = [];
    const cutoff = includeOld ? 0 : (this.opts.now?.() ?? Date.now()) - HISTORY_MAX_AGE_MS;
    const projects = cachedProjects(this.opts.dir);
    for (const entry of readdirSync(brain, { withFileTypes: true })) {
      if (!entry.isDirectory() || !CONVERSATION_ID.test(entry.name)) continue;
      try {
        const found = safeTranscript(brain, entry.name, cutoff);
        if (!found) continue;
        const id = entry.name.toLowerCase();
        const project = this.opts.projectOf(id) ?? projects.get(id);
        out.push({ id, path: found.path, size: found.size, mtimeMs: found.mtimeMs, title: firstAntigravityPrompt(head(found.path)),
          ...(project ? { project } : {}) });
      } catch { /* transcript ainda não criado */ }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!includeOld) this.byId = new Map(out.map((c) => [c.id, c]));
    return includeOld ? out : out.slice(0, HISTORY_LIMIT);
  }

  async list(): Promise<RecentSession[]> {
    const account = this.opts.account();
    if (!account) return [];
    return this.scan().map((c) => {
      const agentId = this.opts.openAgentOf(c.id);
      return { account, provider: 'antigravity', sessionId: c.id,
        ...(c.project ? { project: c.project } : {}), projectDir: c.project ? encodeCwd(c.project) : '',
        title: c.title, lastAt: c.mtimeMs, size: c.size, open: !!agentId, ...(agentId ? { agentId } : {}) };
    });
  }

  resolve(account: string, sessionId: string): HistoryResolveResult {
    if (!CONVERSATION_ID.test(sessionId)) return { status: 400, error: tr('id de sessão inválido') };
    if (!this.hasAccount(account)) return { status: 404, error: tr('conta desconhecida') };
    const c = this.byId.get(sessionId.toLowerCase()) ?? (this.scan(), this.byId.get(sessionId.toLowerCase()));
    if (!c) return { status: 404, error: tr('sessão não encontrada') };
    try {
      const brain = realpathSync(join(this.opts.dir, 'brain'));
      const found = safeTranscript(brain, sessionId);
      if (!found) throw new Error('transcript externo');
      return { path: found.path, createParser: () => new AntigravityTerminalParser() };
    } catch { return { status: 404, error: tr('sessão não encontrada') }; }
  }

  pathForLive(id: string): string | undefined {
    if (!CONVERSATION_ID.test(id)) return undefined;
    try {
      const brain = realpathSync(join(this.opts.dir, 'brain'));
      return safeTranscript(brain, id)?.path;
    } catch { return undefined; }
  }
  /** Cwd histórico só se houver mapeamento explícito, nunca inferido pelo texto do transcript. */
  projectFor(id: string): string | undefined { return this.opts.projectOf(id) ?? cachedProjects(this.opts.dir).get(id.toLowerCase()); }
}
