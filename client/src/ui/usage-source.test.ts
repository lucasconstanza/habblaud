import { describe, expect, it, vi } from 'vitest';
import type { AccountInfo } from '../../../shared/types';
import { antigravityQuotaView, cardState, claudeLiveCaptureNote, codexUsageNote, geminiUsageNote, requestClaudeUsageRefresh, showsUsageAge, sourceLabel, staleMeterDisplay, usageMessage, usageSubtitle } from './usage';

const MIN = 60_000;
type Acc = Pick<AccountInfo, 'usage' | 'usageStatus' | 'provider' | 'email' | 'plan' | 'configDir'>;
const codex = (over: Partial<Acc> = {}): Acc => ({ provider: 'codex', usageStatus: 'ok', configDir: '~/.codex', plan: 'Team', ...over });
const win = { utilization: 42, resetsAt: 10 * 60 * MIN };

describe('sourceLabel', () => {
  it('diz quem gravou o uso ao vivo', () => {
    expect(sourceLabel({ source: 'statusline', via: 'mod', fetchedAt: 0 })).toBe('ao vivo (mod do Habblaud)');
    expect(sourceLabel({ source: 'statusline', via: 'tap', fetchedAt: 0 })).toBe('ao vivo (statusline do Claude Code)');
    expect(sourceLabel({ source: 'statusline', fetchedAt: 0 })).toBe('ao vivo (statusline do Claude Code)');
    expect(sourceLabel({ source: 'cache', fetchedAt: 0 })).toBe('cache do /usage do Claude Code');
    expect(sourceLabel({ source: 'codex', fetchedAt: 0 })).toBe('arquivos do Codex');
  });
});

describe('orientação por conta', () => {
  it('Antigravity mostra apenas fração restante verificada por grupo e esconde leituras antigas', () => {
    const at = 1_000_000_000;
    const q = { antigravityQuota: { fetchedAt: at, buckets: [
      { id: 'gemini-weekly', remainingFraction: 0.9378, resetAt: at + 3_600_000 },
      { id: 'sem-fracao' },
      { id: 'invalido', remainingFraction: 1.2 },
      { id: 'desligado', remainingFraction: 0.8, disabled: true },
    ] } };
    const fresh = antigravityQuotaView(q, at + MIN);
    expect(fresh.state).toBe('ok');
    expect(fresh.buckets[0]).toMatchObject({ id: 'gemini-weekly', remainingPct: 93.8, current: true });
    expect(fresh.buckets.slice(1).every((b) => b.remainingPct === undefined)).toBe(true);
    expect(antigravityQuotaView(q, at + 31 * MIN).buckets[0].current).toBe(false);
    expect(antigravityQuotaView(q, at + 31 * MIN).state).toBe('stale');
    expect(antigravityQuotaView({ antigravityQuota: { fetchedAt: at, buckets: [{ id: 'expirado', remainingFraction: 0.5, resetAt: at + 1 }] } }, at + MIN).state).toBe('stale');
    expect(usageMessage({ provider: 'antigravity', usageStatus: 'disabled' })).toEqual(['Cota ainda não capturada', 'Sem leitura']);
  });
  it('explica a última captura do mod sem tratar o cache posterior como prova de uso ao vivo', () => {
    expect(claudeLiveCaptureNote({ lastLiveUsage: { via: 'mod', fetchedAt: 0 } }, 2 * 60 * MIN)).toContain('O mod do Habblaud já capturou uso nesta conta (há 2 h).');
    expect(claudeLiveCaptureNote({ lastLiveUsage: { via: 'tap', fetchedAt: 0 } }, 2 * 60 * MIN)).toContain('O tap de statusline já capturou uso nesta conta (há 2 h).');
    expect(claudeLiveCaptureNote({}, 0)).toBe('');
  });

  it('retira percentual e preenchimento da barra stale; preserva o valor histórico somente na dica', () => {
    const view = { pct: 100, renewed: false, reset: '', resetShort: '', summary: '100% usado' };
    expect(staleMeterDisplay(view, 'Semana')).toEqual({ pct: '—', barPct: '0', label: 'Semana: última leitura 100% usado. Uso atual desconhecido.' });
    expect(staleMeterDisplay({ ...view, pct: null, renewed: true }, 'Semana')).toBeNull();
  });

  it('Gemini orienta a consultar a cota na própria CLI sem inventar janelas de 5 h/semana', () => {
    expect(usageMessage({ provider: 'gemini', usageStatus: 'disabled' })).toEqual(['Cota no Gemini CLI', 'Ver cota na CLI']);
    expect(geminiUsageNote()).toContain('/stats model');
  });
});

describe('atualização manual do cartão Claude', () => {
  it('envia somente o ID da conta e recarrega o snapshot depois do sucesso', async () => {
    const requester = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const reload = vi.fn(async () => {});
    await requestClaudeUsageRefresh('.claude-conta2', reload, requester as typeof fetch);
    expect(requester).toHaveBeenCalledWith('/api/usage/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"accountId":".claude-conta2"}',
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('mostra erro seguro do servidor sem recarregar o snapshot', async () => {
    const requester = vi.fn(async () => new Response(JSON.stringify({ error: 'CLI indisponível' }), { status: 503 }));
    const reload = vi.fn(async () => {});
    await expect(requestClaudeUsageRefresh('.claude', reload, requester as typeof fetch)).rejects.toThrow('CLI indisponível');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('cartão de uso de uma conta do Codex', () => {
  it('"sem cota" é um estado próprio (nunca 0% nem "sem dados")', () => {
    const noQuota = codex({ usage: { source: 'codex', noQuota: true, fetchedAt: 0 } });
    expect(cardState(noQuota)).toBe('noquota');
    expect(usageMessage(noQuota)).toEqual(['sem cota', 'sem cota']);
    expect(codexUsageNote(noQuota, 3 * MIN)).toMatch(/^Na última leitura \(há 3 min\), a conta estava sem cota nem créditos .*Não é 0%/);
    expect(cardState(codex({ usage: { source: 'codex', fiveHour: win, fetchedAt: 0 } }))).toBe('ok');
    expect(cardState(codex({ usage: { source: 'codex', fiveHour: win, fetchedAt: 0 }, usageStatus: 'stale' }))).toBe('stale');
    expect(cardState(codex())).toBe('empty');
  });

  it('a idade fica sempre à mostra no Codex (só se renova com sessão rodando); no Claude Code, só quando é antiga', () => {
    const fresh = { source: 'codex' as const, fiveHour: win, fetchedAt: 0 };
    expect(showsUsageAge(codex({ usage: fresh }))).toBe(true);
    expect(showsUsageAge(codex({ usage: { source: 'codex', noQuota: true, fetchedAt: 0 } }))).toBe(true);
    expect(showsUsageAge(codex())).toBe(false);
    expect(showsUsageAge({ usage: { ...fresh, source: 'statusline' }, usageStatus: 'ok' })).toBe(false);
    expect(showsUsageAge({ usage: { ...fresh, source: 'cache' }, usageStatus: 'stale' })).toBe(true);
    expect(codexUsageNote(codex({ usage: fresh }), 12 * MIN)).toBe('O Codex só grava o uso enquanto alguma sessão roda: estes números são da última leitura (há 12 min).');
  });

  it('sem números: não há o que instalar; embaixo do nome, o plano (sem e-mail)', () => {
    expect(usageMessage(codex())).toEqual(['sem dados ainda', 'sem dados']);
    expect(codexUsageNote(codex(), 0)).toBe('Não precisa instalar nada: os números chegam com a próxima sessão do Codex.');
    expect(usageSubtitle(codex())).toBe('plano Team');
    expect(usageSubtitle(codex({ plan: undefined }))).toBe('Codex');
    // Claude Code: como antes.
    expect(usageMessage({ usageStatus: 'disabled' })).toEqual(['sem dados de uso', 'sem dados']);
    expect(usageSubtitle({ email: 'a@b.c', configDir: '~/.claude' })).toBe('a@b.c');
    expect(usageSubtitle({ configDir: '~/.claude' })).toBe('~/.claude');
    expect(codexUsageNote({ usageStatus: 'ok' }, 0)).toBe('');
  });
});
