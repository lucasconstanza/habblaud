// Fonte do Gemini CLI: conta e histórico locais; presença só pelos hooks da própria CLI.
// Um arquivo de chat recente, por si só, não prova que a sessão continua aberta.
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { SourceInfo } from '../../../shared/types';
import type { AccountEntry, AccountsService } from '../../accounts/service';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import { detectGeminiAccount, isGeminiAbsolute } from './accounts';
import { GeminiHistory } from './history';
import { GeminiTerminalParser } from './terminal';
import { tr } from '../../../shared/i18n';
import { normalizeCwd } from '../../model/rooms';

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Hook perdido ou CLI encerrada sem SessionEnd: retire a presença, sem inventar sessão aberta. */
const PRESENCE_MS = 2 * 60_000;
const EVENTS = new Set(['SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'Notification']);

export interface GeminiHookEvent { sessionId: string; cwd: string; event: string; transcriptPath?: string; timestamp?: string; toolName?: string; notificationType?: string }
interface LiveSession { id: string; sessionId: string; cwd: string; transcriptPath?: string; startedAt: number; seenAt: number; lastFileCheckAt: number }
const liveKey = (sessionId: string, cwd: string): string => `${sessionId}\0${normalizeCwd(cwd)}`;
const transcriptKey = (base: string, transcriptPath: string): string => `${base}\0${normalizeCwd(transcriptPath)}`;

export function parseGeminiHook(raw: unknown): GeminiHookEvent | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.sessionId !== 'string' || !SESSION_ID.test(r.sessionId) || typeof r.cwd !== 'string' ||
      !isGeminiAbsolute(r.cwd) || r.cwd.length > 4_096 || typeof r.event !== 'string' || !EVENTS.has(r.event)) return undefined;
  return { sessionId: r.sessionId, cwd: r.cwd, event: r.event,
    transcriptPath: typeof r.transcriptPath === 'string' && isGeminiAbsolute(r.transcriptPath) && r.transcriptPath.length <= 4_096 ? r.transcriptPath : undefined,
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : undefined,
    toolName: typeof r.toolName === 'string' ? r.toolName.slice(0, 100) : undefined,
    notificationType: typeof r.notificationType === 'string' ? r.notificationType.slice(0, 100) : undefined };
}

export class GeminiSource implements AgentSource {
  readonly provider = 'gemini' as const;
  readonly history: GeminiHistory;
  private account: AccountEntry;
  private live = new Map<string, LiveSession>();
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly opts: { accounts: AccountsService; office: Office; dir: string; inDocker?: boolean; now?: () => number; pollMs?: number }) {
    this.now = opts.now ?? Date.now;
    const taken = opts.accounts.allEntries().map((a) => a.detected);
    this.account = opts.accounts.setProviderAccounts('gemini', [{ dir: opts.dir, detected: detectGeminiAccount(opts.dir, taken) }])[0];
    this.history = new GeminiHistory({ dir: opts.dir, inDocker: opts.inDocker, account: () => this.account.id,
      openAgentOf: (account, sessionId, project, path) => {
        if (account !== this.account.id) return undefined;
        for (const s of this.live.values()) {
          if (s.sessionId !== sessionId || normalizeCwd(s.cwd) !== normalizeCwd(project)) continue;
          if (this.history.pathForLive(sessionId, project, s.transcriptPath, s.startedAt) === path) return s.id;
        }
        return undefined;
      },
      now: this.now });
  }

  accountEntry(): AccountEntry { return this.account; }
  start(): void {
    this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? 1_000);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const s of this.live.values()) this.opts.office.closeMain(s.id);
    this.live.clear();
  }
  sources(): SourceInfo[] {
    return [{ label: this.account.id, provider: 'gemini', path: this.opts.dir, sessions: this.live.size, ok: true }];
  }
  transcriptPathOf(agentId: string): string | undefined {
    const s = [...this.live.values()].find((v) => v.id === agentId);
    if (!s) return undefined;
    return this.history.pathForLive(s.sessionId, s.cwd, s.transcriptPath, s.startedAt);
  }
  terminalParser(agentId: string): GeminiTerminalParser | undefined {
    return this.liveHasAgent(agentId) ? new GeminiTerminalParser() : undefined;
  }
  private liveHasAgent(agentId: string): boolean { return [...this.live.values()].some((v) => v.id === agentId); }

  applyHook(raw: unknown): boolean {
    const event = parseGeminiHook(raw);
    if (!event) return false;
    const base = liveKey(event.sessionId, event.cwd);
    const exact = event.transcriptPath ? transcriptKey(base, event.transcriptPath) : undefined;
    const matching = [...this.live.entries()].filter(([k]) => k === base || k.startsWith(`${base}\0`));
    const key = exact ?? (this.live.has(base) ? base : matching.length === 1 ? matching[0][0] : base);
    let old = this.live.get(key);
    if (event.event === 'SessionEnd') {
      // Dois processos com o mesmo id/cwd e sem transcript_path não podem ser distinguidos.
      if (!exact && matching.length > 1) return true;
      if (old) this.opts.office.closeMain(old.id);
      this.live.delete(key);
      return true;
    }
    if (!exact && matching.length > 1) return true;
    // A primeira chamada pode anteceder o arquivo: quando o caminho chega, substitui o agente genérico.
    if (exact && !old && this.live.has(base)) {
      const generic = this.live.get(base)!;
      this.opts.office.closeMain(generic.id);
      this.live.delete(base);
      old = undefined;
    }
    const id = old?.id ?? `${this.account.id}:${event.sessionId}:${createHash('sha1').update(normalizeCwd(event.cwd)).update('\0').update(exact ?? '').digest('hex').slice(0, 8)}`;
    const at = this.now();
    const status = event.event === 'BeforeAgent' || event.event === 'BeforeTool' || event.event === 'AfterTool'
      ? 'working' : event.event === 'Notification' && event.notificationType === 'ToolPermission' ? 'waiting' : 'idle';
    if (!old) {
      this.opts.office.addMain({ id, provider: 'gemini', account: this.account.id, sessionId: event.sessionId,
        cwd: event.cwd, role: tr('Agente principal (Gemini CLI)'), startedAt: Date.parse(event.timestamp ?? '') || at,
        status, waitingFor: status === 'waiting' ? tr('aprovar uma permissão no Gemini CLI') : undefined });
    } else this.opts.office.setStatus(id, status, status === 'waiting' ? tr('aprovar uma permissão no Gemini CLI') : undefined);
    this.live.set(key, { id, sessionId: event.sessionId, cwd: event.cwd, transcriptPath: event.transcriptPath ?? old?.transcriptPath, startedAt: old?.startedAt ?? at, seenAt: at, lastFileCheckAt: 0 });
    return true;
  }

  poll(): void {
    const now = this.now();
    for (const [key, s] of this.live) {
      if (now - s.lastFileCheckAt >= 30_000) {
        s.lastFileCheckAt = now;
        const path = this.history.pathForLive(s.sessionId, s.cwd, s.transcriptPath, s.startedAt);
        if (path) {
          try { s.seenAt = Math.max(s.seenAt, statSync(path).mtimeMs); } catch { /* removido */ }
        }
      }
      if (now - s.seenAt <= PRESENCE_MS) continue;
      this.opts.office.closeMain(s.id);
      this.live.delete(key);
    }
  }
}
