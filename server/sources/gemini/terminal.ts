// Conversa do Gemini CLI em JSONL. Cada mensagem tem id estável; checkpoints antigos podem repetir mensagens.
import type { TerminalEntry } from '../../../shared/types';
import { marked, oneLine, prepare, TEXT_MAX, type TerminalParser } from '../terminal';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

function contentText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  return v.map((p) => typeof p === 'string' ? p : typeof rec(p)?.text === 'string' ? rec(p)!.text as string : '').filter(Boolean).join('\n');
}

export function geminiMessages(record: unknown): Rec[] {
  const j = rec(record);
  const set = rec(j?.$set);
  if (Array.isArray(j?.messages)) return j.messages.map(rec).filter((v): v is Rec => !!v);
  if (Array.isArray(set?.messages)) return set.messages.map(rec).filter((v): v is Rec => !!v);
  return typeof j?.type === 'string' && typeof j.id === 'string' ? [j] : [];
}

export class GeminiTerminalParser implements TerminalParser {
  private readonly seen = new Set<string>();
  push(line: string): TerminalEntry[] {
    let record: unknown;
    try { record = JSON.parse(line); } catch { return []; }
    const out: TerminalEntry[] = [];
    for (const m of geminiMessages(record)) {
      const id = typeof m.id === 'string' ? m.id : undefined;
      if (!id || this.seen.has(id)) continue;
      this.seen.add(id);
      if (this.seen.size > 20_000) this.seen.delete(this.seen.values().next().value as string);
      const at = typeof m.timestamp === 'string' ? Date.parse(m.timestamp) : NaN;
      const text = contentText(m.content);
      if (!text.trim()) continue;
      const formatted = marked(prepare(text, TEXT_MAX));
      if (!formatted) continue;
      if (m.type === 'user') out.push({ kind: 'user', id, at: Number.isFinite(at) ? at : Date.now(), text: formatted });
      else if (m.type === 'gemini') out.push({ kind: 'assistant', id, at: Number.isFinite(at) ? at : Date.now(), text: formatted });
    }
    return out;
  }
}

export function firstGeminiPrompt(raw: string): string | undefined {
  for (const line of raw.split('\n')) {
    let record: unknown;
    try { record = JSON.parse(line); } catch { continue; }
    for (const m of geminiMessages(record)) {
      if (m.type !== 'user') continue;
      const title = oneLine(contentText(m.content), 120);
      if (title) return title;
    }
  }
  return undefined;
}
