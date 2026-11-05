// Presença observada pelos hooks/statusline do Antigravity CLI; histórico e lock não estendem presença.
import { isAbsolute, win32 } from 'node:path';
import type { AccountInfo, SourceInfo } from '../../../shared/types';
import type { AccountEntry, AccountsService } from '../../accounts/service';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import { tr } from '../../../shared/i18n';
import { log } from '../../log';
import { detectAntigravityAccount } from './accounts';
import { AntigravityHistory, CONVERSATION_ID } from './history';
import { AntigravityTerminalParser } from './terminal';
import { AntigravityQuotaStore } from './quota-store';

const PRESENCE_MS = 2 * 60_000;
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined;
const absolute = (v: string): boolean => isAbsolute(v) || win32.isAbsolute(v);
const safePath = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && absolute(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && CONVERSATION_ID.test(v);

/** O caminho identifica só uma conversa CLI; nunca é usado diretamente para abrir um arquivo. */
export function cliTranscriptId(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 4096 || (!absolute(v) && !v.startsWith('~/'))) return undefined;
  const p = v.replace(/\\/g, '/');
  const m = /(?:^|\/)antigravity-cli\/brain\/([0-9a-f-]{36})\/\.system_generated\/logs\/transcript(?:_full)?\.jsonl$/i.exec(p);
  return m && CONVERSATION_ID.test(m[1]) ? m[1].toLowerCase() : undefined;
}

export interface AntigravityHookEvent { event: 'SessionStart' | 'PreInvocation' | 'Stop'; conversationId: string; cwd?: string; fullyIdle?: boolean }
export function parseAntigravityHook(raw: unknown): AntigravityHookEvent | undefined {
  const r = object(raw);
  if (!r || !uuid(r.conversationId) || cliTranscriptId(r.transcriptPath) !== r.conversationId.toLowerCase()) return undefined;
  if (r.event !== 'SessionStart' && r.event !== 'PreInvocation' && r.event !== 'Stop') return undefined;
  const paths = Array.isArray(r.workspacePaths) ? r.workspacePaths.filter(safePath) : [];
  return { event: r.event, conversationId: r.conversationId.toLowerCase(),
    cwd: paths.length === 1 && Array.isArray(r.workspacePaths) && r.workspacePaths.length === 1 ? paths[0] : undefined,
    fullyIdle: r.event === 'Stop' && r.fullyIdle === true };
}

interface StatuslineEvent { conversationId?: string; cwd?: string; state?: string; waiting: boolean; quota?: AccountInfo['antigravityQuota']; email?: string; plan?: string }
export function parseAntigravityStatusline(raw: unknown, now = Date.now()): StatuslineEvent | undefined {
  const r = object(raw);
  if (!r) return undefined;
  const conversationId = uuid(r.conversationId) && cliTranscriptId(r.transcriptPath) === r.conversationId.toLowerCase()
    ? r.conversationId.toLowerCase() : undefined;
  const workspace = object(r.workspace);
  const cwd = safePath(workspace?.projectDir) ? workspace.projectDir : safePath(r.cwd) ? r.cwd : undefined;
  const state = typeof r.agentState === 'string' && /^(idle|working|tool_use|reviewing|authenticating|initializing|error)$/.test(r.agentState)
    ? r.agentState : undefined;
  const q = object(r.quota);
  const buckets: NonNullable<AccountInfo['antigravityQuota']>['buckets'] = [];
  if (q) for (const [id, value] of Object.entries(q).slice(0, 24)) {
    if (!/^[\w.:-]{1,80}$/.test(id)) continue;
    const b = object(value);
    if (!b) continue;
    const f = b.remainingFraction;
    const resetAt = typeof b.resetTime === 'string' ? Date.parse(b.resetTime) : NaN;
    buckets.push({ id,
      ...(typeof f === 'number' && Number.isFinite(f) && f >= 0 && f <= 1 ? { remainingFraction: f } : {}),
      ...(Number.isFinite(resetAt) ? { resetAt } : {}),
      ...(typeof b.disabled === 'boolean' ? { disabled: b.disabled } : {}) });
  }
  return { conversationId, cwd, state, waiting: r.toolConfirmationPending === true,
    quota: q ? { fetchedAt: now, buckets } : undefined,
    email: typeof r.email === 'string' && /^[^\s@]{1,80}@[^\s@]{1,120}$/.test(r.email) ? r.email : undefined,
    plan: typeof r.planTier === 'string' && /^[\w .+-]{1,60}$/.test(r.planTier) ? r.planTier : undefined };
}

interface Live { id: string; conversationId: string; cwd: string; seenAt: number }
export class AntigravitySource implements AgentSource {
  readonly provider = 'antigravity' as const;
  readonly history: AntigravityHistory;
  private account: AccountEntry;
  private live = new Map<string, Live>();
  private projects = new Map<string, string>();
  private currentQuota?: AccountInfo['antigravityQuota'];
  private readonly quotaStore?: AntigravityQuotaStore;
  private lastStoredAt = 0;
  private lastStoredFingerprint = '';
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  constructor(private readonly opts: { accounts: AccountsService; office: Office; dir: string; statusFile?: string; now?: () => number; pollMs?: number }) {
    this.now = opts.now ?? Date.now;
    this.quotaStore = opts.statusFile ? new AntigravityQuotaStore(opts.statusFile, this.now) : undefined;
    const saved = this.quotaStore?.load();
    this.currentQuota = saved?.quota;
    this.account = opts.accounts.setProviderAccounts('antigravity', [{ dir: opts.dir,
      detected: { ...detectAntigravityAccount(opts.dir, opts.accounts.allEntries().map((a) => a.detected)),
        ...(saved?.email ? { email: saved.email } : {}), ...(saved?.plan ? { plan: saved.plan } : {}) } }])[0];
    if (saved) {
      this.lastStoredAt = saved.quota?.fetchedAt ?? 0;
      this.lastStoredFingerprint = this.fingerprint();
    }
    this.history = new AntigravityHistory({ dir: opts.dir, account: () => this.account.id,
      projectOf: (id) => this.projects.get(id), openAgentOf: (id) => this.live.get(id)?.id, now: this.now });
  }
  accountEntry(): AccountEntry { return this.account; }
  quota(): AccountInfo['antigravityQuota'] | undefined { return this.currentQuota; }
  start(): void { this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? 1000); this.timer.unref?.(); }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined;
    for (const s of this.live.values()) this.opts.office.closeMain(s.id); this.live.clear(); }
  sources(): SourceInfo[] { return [{ label: this.account.id, provider: 'antigravity', path: this.opts.dir, sessions: this.live.size, ok: true }]; }
  transcriptPathOf(agentId: string): string | undefined {
    const s = [...this.live.values()].find((v) => v.id === agentId);
    return s ? this.history.pathForLive(s.conversationId) : undefined;
  }
  terminalParser(agentId: string): AntigravityTerminalParser | undefined {
    return [...this.live.values()].some((v) => v.id === agentId) ? new AntigravityTerminalParser() : undefined;
  }
  private present(id: string, cwd: string | undefined, status: 'idle' | 'working' | 'waiting'): void {
    const project = cwd ?? this.projects.get(id) ?? this.history.projectFor(id);
    if (!project || !safePath(project)) return;
    this.projects.set(id, project);
    const old = this.live.get(id);
    const agentId = `${this.account.id}:${id}`;
    if (old && old.cwd !== project) { this.opts.office.closeMain(old.id); this.live.delete(id); }
    if (!old || old.cwd !== project) this.opts.office.addMain({ id: agentId, provider: 'antigravity', account: this.account.id,
      sessionId: id, cwd: project, role: tr('Agente principal (Antigravity CLI)'), startedAt: this.now(), status,
      waitingFor: status === 'waiting' ? tr('aprovar uma permissão no Antigravity CLI') : undefined });
    else this.opts.office.setStatus(old.id, status, status === 'waiting' ? tr('aprovar uma permissão no Antigravity CLI') : undefined);
    this.live.set(id, { id: agentId, conversationId: id, cwd: project, seenAt: this.now() });
  }
  applyHook(raw: unknown): boolean {
    const event = parseAntigravityHook(raw);
    if (!event) return false;
    if (event.event === 'Stop' && !this.live.has(event.conversationId)) return true;
    this.present(event.conversationId, event.cwd, event.event === 'PreInvocation' || (event.event === 'Stop' && !event.fullyIdle) ? 'working' : 'idle');
    return true;
  }
  applyStatusline(raw: unknown): boolean {
    const event = parseAntigravityStatusline(raw, this.now());
    if (!event) return false;
    const switchedAccount = !!event.email && !!this.account.detected.email && event.email !== this.account.detected.email;
    if (switchedAccount) { this.currentQuota = undefined; this.opts.office.markDirty(); }
    if (event.email && event.email !== this.account.detected.email || event.plan && event.plan !== this.account.detected.plan) {
      this.account = this.opts.accounts.setProviderAccounts('antigravity', [{ dir: this.opts.dir,
        detected: { ...this.account.detected, email: event.email ?? this.account.detected.email,
          plan: event.plan ?? (switchedAccount ? undefined : this.account.detected.plan) } }])[0];
    }
    // A CLI pode emitir quota={} enquanto ainda carrega. Isso não é uma leitura nova dos buckets.
    const measuredQuota = event.quota?.buckets.length ? event.quota : undefined;
    if (measuredQuota) { this.currentQuota = measuredQuota; this.opts.office.markDirty(); }
    if (event.email || event.plan || measuredQuota) this.persistQuota();
    if (!event.conversationId) return !!(event.quota || event.email || event.plan);
    const status = event.waiting ? 'waiting' : event.state === 'working' || event.state === 'tool_use' || event.state === 'reviewing' ? 'working' : 'idle';
    this.present(event.conversationId, event.cwd, status);
    return true;
  }
  private fingerprint(): string {
    return JSON.stringify({ email: this.account.detected.email, plan: this.account.detected.plan, buckets: this.currentQuota?.buckets });
  }
  private persistQuota(): void {
    if (!this.quotaStore) return;
    const fingerprint = this.fingerprint();
    if (fingerprint === this.lastStoredFingerprint && this.now() - this.lastStoredAt < 30_000) return;
    try {
      this.quotaStore.save({ email: this.account.detected.email, plan: this.account.detected.plan, quota: this.currentQuota });
      this.lastStoredFingerprint = fingerprint;
      this.lastStoredAt = this.now();
    } catch {
      log.warnOnce('antigravity-quota-store', tr('Falha ao salvar o cache local de cota do Antigravity CLI.'));
    }
  }
  poll(): void {
    for (const [key, s] of this.live) if (this.now() - s.seenAt > PRESENCE_MS) {
      this.opts.office.closeMain(s.id); this.live.delete(key);
    }
  }
}
