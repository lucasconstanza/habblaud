// Eventos observacionais do hook local do Gemini CLI. Nenhum prompt ou resultado é recebido.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { GeminiSource } from '../sources/gemini/source';
import { tr } from '../../shared/i18n';

export async function handleGeminiEvent(req: IncomingMessage, res: ServerResponse, source: GeminiSource | undefined): Promise<void> {
  if (!source) {
    req.resume();
    sendJson(res, 404, { error: tr('Gemini CLI não encontrado') });
    return;
  }
  const body = await readJson(req, 8 * 1024);
  if (!source.applyHook(body)) {
    sendJson(res, 400, { error: tr('evento do Gemini CLI inválido') });
    return;
  }
  sendJson(res, 200, { ok: true });
}
