// Cache local da última leitura real do statusline; contém só e-mail, plano e buckets de cota.
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountInfo } from '../../../shared/types';
import { createPrivateTempFile, protectPrivateFile } from '../../windows-acl';

export interface SavedAntigravityQuota { email?: string; plan?: string; quota?: AccountInfo['antigravityQuota'] }
const EMAIL = /^[^\s@]{1,80}@[^\s@]{1,120}$/;
const PLAN = /^[\w .+-]{1,60}$/;
const ID = /^[\w.:-]{1,80}$/;
const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

/** Projeta dados não confiáveis na whitelist antes de guardar ou usar um cache antigo. */
export function parseSavedAntigravityQuota(raw: unknown, now = Date.now()): SavedAntigravityQuota | undefined {
  const r = object(raw);
  if (!r || r.version !== 1) return undefined;
  const email = typeof r.email === 'string' && EMAIL.test(r.email) ? r.email : undefined;
  const plan = typeof r.plan === 'string' && PLAN.test(r.plan) ? r.plan : undefined;
  const q = object(r.quota);
  let quota: AccountInfo['antigravityQuota'] | undefined;
  if (q && typeof q.fetchedAt === 'number' && Number.isSafeInteger(q.fetchedAt) && q.fetchedAt > 0 && q.fetchedAt <= now + 5 * 60_000 && Array.isArray(q.buckets)) {
    const buckets: NonNullable<AccountInfo['antigravityQuota']>['buckets'] = [];
    for (const item of q.buckets.slice(0, 24)) {
      const b = object(item);
      if (!b || typeof b.id !== 'string' || !ID.test(b.id)) continue;
      buckets.push({ id: b.id,
        ...(typeof b.remainingFraction === 'number' && Number.isFinite(b.remainingFraction) && b.remainingFraction >= 0 && b.remainingFraction <= 1
          ? { remainingFraction: b.remainingFraction } : {}),
        ...(typeof b.resetAt === 'number' && Number.isSafeInteger(b.resetAt) && b.resetAt > 0 ? { resetAt: b.resetAt } : {}),
        ...(typeof b.disabled === 'boolean' ? { disabled: b.disabled } : {}) });
    }
    quota = { fetchedAt: q.fetchedAt, buckets };
  }
  return email || plan || quota ? { email, plan, quota } : undefined;
}

export class AntigravityQuotaStore {
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  load(): SavedAntigravityQuota | undefined {
    try {
      const st = lstatSync(this.file);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 32 * 1024) return undefined;
      protectPrivateFile(this.file);
      chmodSync(this.file, 0o600);
      return parseSavedAntigravityQuota(JSON.parse(readFileSync(this.file, 'utf8')) as unknown, this.now());
    } catch { return undefined; }
  }

  save(value: SavedAntigravityQuota): void {
    const projected = parseSavedAntigravityQuota({ version: 1, ...value }, this.now());
    if (!projected) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    let tmp: string | undefined;
    try {
      tmp = createPrivateTempFile(this.file);
      writeFileSync(tmp, JSON.stringify({ version: 1, ...projected }) + '\n');
      renameSync(tmp, this.file);
      tmp = undefined;
    } finally { if (tmp) rmSync(tmp, { force: true }); }
  }
}
