// Histórico real do Gemini CLI: ~/.gemini/tmp/<projeto>/chats/session-*.jsonl.
// .project_root associa a pasta codificada ao projeto; nunca inferimos um caminho pelo nome da pasta.
import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { RecentSession } from '../../../shared/types';
import { HISTORY_LIMIT, HISTORY_MAX_AGE_MS } from '../history';
import type { HistoryProvider, HistoryResolveResult } from '../source';
import { encodeCwd } from '../watcher';
import { firstGeminiPrompt, GeminiTerminalParser } from './terminal';
import { tr } from '../../../shared/i18n';
import { normalizeCwd } from '../../model/rooms';
import { isGeminiAbsolute } from './accounts';

// Gemini CLI também usa ids curtos (ex.: servidor A2A); a rota recebe uma chave opaca do nome do arquivo.
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HISTORY_KEY = /^g_[0-9a-f]{32}$/;
const HEAD_BYTES = 256 * 1024;
type Meta = { sessionId: string; kind?: string; startTime?: string; lastUpdated?: string };

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function head(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const b = Buffer.alloc(HEAD_BYTES);
    return b.subarray(0, readSync(fd, b, 0, b.length, 0)).toString('utf8');
  } finally { closeSync(fd); }
}

function metadata(raw: string): Meta | undefined {
  try {
    const j = JSON.parse(raw.slice(0, raw.indexOf('\n') >= 0 ? raw.indexOf('\n') : raw.length)) as Partial<Meta>;
    return typeof j.sessionId === 'string' && SESSION_ID.test(j.sessionId) ? j as Meta : undefined;
  } catch { return undefined; }
}

interface Candidate { key: string; path: string; project: string; slug: string; fileName: string; sessionId: string; size: number; mtimeMs: number; meta: Meta; title?: string }

export class GeminiHistory implements HistoryProvider {
  readonly provider = 'gemini' as const;
  private byId = new Map<string, Candidate>();
  constructor(private readonly opts: { dir: string; inDocker?: boolean; account: () => string | undefined; openAgentOf: (account: string, id: string, project: string, path: string) => string | undefined; now?: () => number }) {}

  hasAccount(account: string): boolean { return account === this.opts.account(); }

  private scan(includeOld = false): Candidate[] {
    const tmp = join(this.opts.dir, 'tmp');
    let root: string;
    try { root = realpathSync(tmp); } catch { return []; }
    const out: Candidate[] = [];
    const cutoff = includeOld ? 0 : (this.opts.now?.() ?? Date.now()) - HISTORY_MAX_AGE_MS;
    for (const projectDir of readdirSync(root, { withFileTypes: true })) {
      if (!projectDir.isDirectory()) continue;
      const folder = join(root, projectDir.name);
      let project: string;
      try {
        const marker = realpathSync(join(folder, '.project_root'));
        if (!inside(folder, marker)) continue;
        project = readFileSync(marker, 'utf8').trim();
        if (!isGeminiAbsolute(project) || project.length > 4_096) continue;
      } catch { continue; }
      const chats = join(folder, 'chats');
      let realChats: string;
      try { realChats = realpathSync(chats); if (!inside(folder, realChats)) continue; } catch { continue; }
      for (const file of readdirSync(realChats, { withFileTypes: true })) {
        if (!file.isFile() || !/^session-[\w.-]+\.jsonl$/i.test(file.name)) continue;
        const path = join(realChats, file.name);
        try {
          const real = realpathSync(path);
          if (!inside(realChats, real)) continue;
          const st = statSync(real);
          if (st.mtimeMs < cutoff || !st.isFile()) continue;
          const raw = head(real);
          const meta = metadata(raw);
          if (!meta || meta.kind === 'subagent') continue;
          // O id da sessão pode ser compartilhado (A2A); a chave da rota identifica o arquivo, sem expor caminho.
          const key = `g_${createHash('sha256').update(projectDir.name).update('\0').update(file.name).digest('hex').slice(0, 32)}`;
          out.push({ key, path: real, project, slug: projectDir.name, fileName: file.name, sessionId: meta.sessionId, size: st.size, mtimeMs: st.mtimeMs, meta, title: firstGeminiPrompt(raw) });
        } catch { /* arquivo apagado durante a varredura */ }
      }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!includeOld) this.byId = new Map(out.map((c) => [c.key, c]));
    return includeOld ? out : out.slice(0, HISTORY_LIMIT);
  }

  async list(): Promise<RecentSession[]> {
    const account = this.opts.account();
    if (!account) return [];
    const markedOpen = new Set<string>();
    return this.scan().map((c) => {
      const candidateAgent = this.opts.openAgentOf(account, c.sessionId, c.project, c.path);
      const agentId = candidateAgent && !markedOpen.has(candidateAgent) ? candidateAgent : undefined;
      if (agentId) markedOpen.add(agentId);
      const r: RecentSession = { account, provider: 'gemini', sessionId: c.key, project: c.project,
        projectDir: encodeCwd(c.project), title: c.title, firstAt: Date.parse(c.meta.startTime ?? '') || undefined,
        lastAt: Date.parse(c.meta.lastUpdated ?? '') || c.mtimeMs, size: c.size, open: !!agentId };
      if (agentId) r.agentId = agentId;
      return r;
    });
  }

  resolve(account: string, sessionId: string): HistoryResolveResult {
    if (!HISTORY_KEY.test(sessionId)) return { status: 400, error: tr('id de sessão inválido') };
    if (!this.hasAccount(account)) return { status: 404, error: tr('conta desconhecida') };
    const c = this.byId.get(sessionId) ?? (this.scan(), this.byId.get(sessionId));
    if (!c) return { status: 404, error: tr('sessão não encontrada') };
    try {
      const chats = realpathSync(join(this.opts.dir, 'tmp'));
      if (!inside(chats, realpathSync(c.path))) throw new Error('fora da pasta');
      return { path: c.path, createParser: () => new GeminiTerminalParser() };
    } catch { return { status: 404, error: tr('sessão não encontrada') }; }
  }

  pathForLive(sessionId: string, cwd: string, hintPath?: string, startedAt?: number): string | undefined {
    const matches = this.scan(true).filter((c) => c.sessionId === sessionId && normalizeCwd(c.project) === normalizeCwd(cwd));
    if (hintPath) {
      try {
        const real = realpathSync(hintPath);
        return matches.find((c) => c.path === real)?.path;
      } catch {
        // No Docker o hook envia um caminho do HOST. Só o sufixo tmp/<slug>/chats/<arquivo>
        // é associado a um arquivo já descoberto e validado dentro da montagem somente leitura.
        if (!this.opts.inDocker || !isGeminiAbsolute(hintPath)) return undefined;
        const suffix = /(?:^|\/)tmp\/([^/]+)\/chats\/(session-[\w.-]+\.jsonl)$/i.exec(hintPath.replace(/\\/g, '/'));
        if (!suffix) return undefined;
        const windows = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(hintPath);
        const equal = (a: string, b: string) => windows ? a.toLowerCase() === b.toLowerCase() : a === b;
        return matches.find((c) => equal(c.slug, suffix[1]) && equal(c.fileName, suffix[2]))?.path;
      }
    }
    // Sem o caminho exato, só associação recente evita ligar um novo processo A2A a um chat antigo com mesmo id.
    const cutoff = Math.max((this.opts.now?.() ?? Date.now()) - HISTORY_MAX_AGE_MS, startedAt ?? 0);
    return matches.find((c) => c.mtimeMs >= cutoff)?.path;
  }
}
