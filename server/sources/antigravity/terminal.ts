// Conversa local do Antigravity CLI: só mensagens explícitas do usuário e respostas do agente.
import type { TerminalEntry } from '../../../shared/types';
import { marked, oneLine, prepare, TEXT_MAX, type TerminalParser } from '../terminal';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

export class AntigravityTerminalParser implements TerminalParser {
  private seen = new Set<string>();
  push(line: string): TerminalEntry[] {
    let j: Rec | undefined;
    try { j = rec(JSON.parse(line)); } catch { return []; }
    if (!j || typeof j.content !== 'string' || !j.content.trim()) return [];
    const kind = j.type === 'USER_INPUT' && j.source === 'USER_EXPLICIT' ? 'user'
      : j.type === 'PLANNER_RESPONSE' && j.source === 'MODEL' ? 'assistant' : undefined;
    if (!kind) return [];
    const step = typeof j.step_index === 'number' && Number.isSafeInteger(j.step_index) ? j.step_index : undefined;
    if (step === undefined) return [];
    const id = `${step}:${j.type}`;
    if (this.seen.has(id)) return [];
    this.seen.add(id);
    if (this.seen.size > 20_000) this.seen.delete(this.seen.values().next().value!);
    const text = marked(prepare(j.content, TEXT_MAX));
    if (!text) return [];
    const at = typeof j.created_at === 'string' ? Date.parse(j.created_at) : NaN;
    return [{ kind, id, at: Number.isFinite(at) ? at : Date.now(), text }];
  }
}

export function firstAntigravityPrompt(raw: string): string | undefined {
  for (const line of raw.split('\n')) {
    try {
      const j = rec(JSON.parse(line));
      if (j?.type === 'USER_INPUT' && j.source === 'USER_EXPLICIT' && typeof j.content === 'string') {
        const title = oneLine(j.content, 120);
        if (title) return title;
      }
    } catch { /* linha parcial */ }
  }
  return undefined;
}
