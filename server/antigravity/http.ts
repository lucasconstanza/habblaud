import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { AntigravitySource } from '../sources/antigravity/source';

export async function handleAntigravityEvent(req: IncomingMessage, res: ServerResponse,
  source: AntigravitySource | undefined, kind: 'hook' | 'statusline'): Promise<void> {
  if (!source) { req.resume(); sendJson(res, 404, { error: 'Antigravity CLI não encontrado' }); return; }
  const body = await readJson(req, 16 * 1024);
  if (!(kind === 'hook' ? source.applyHook(body) : source.applyStatusline(body))) {
    sendJson(res, 400, { error: 'evento do Antigravity CLI inválido' }); return;
  }
  sendJson(res, 200, { ok: true });
}
