import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('hook observacional Gemini CLI', () => {
  it('envia apenas metadados locais e devolve JSON neutro ao CLI', async () => {
    let body = '';
    const server = createServer();
    const received = new Promise<void>((resolve) => {
      server.on('request', (req, res) => {
        req.on('data', (chunk) => { body += chunk.toString('utf8'); });
        req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); resolve(); });
      });
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('porta local indisponível');
      const script = join(process.cwd(), 'mod', 'habblaud-gemini', 'hook.mjs');
      const child = spawn(process.execPath, [script], { env: { ...process.env, HABBLAUD_PORT: String(address.port) } });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stdin.end(JSON.stringify({ session_id: '11111111-1111-4111-8111-111111111111', cwd: 'C:\\projeto',
        transcript_path: 'C:\\gemini\\tmp\\chat.jsonl', hook_event_name: 'BeforeAgent', timestamp: '2026-01-01T00:00:00Z', prompt: 'CANARY-PRIVATE-PROMPT',
        tool_input: { secret: 'CANARY-SECRET' }, tool_response: { text: 'CANARY-RESPONSE' } }));
      await Promise.all([received, new Promise<void>((resolve, reject) => child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`hook saiu com ${code}`))))]);
      expect(JSON.parse(stdout)).toEqual({});
      expect(JSON.parse(body)).toEqual({ sessionId: '11111111-1111-4111-8111-111111111111', cwd: 'C:\\projeto',
        event: 'BeforeAgent', transcriptPath: 'C:\\gemini\\tmp\\chat.jsonl', timestamp: '2026-01-01T00:00:00Z' });
      expect(body).not.toContain('CANARY');
    } finally { server.close(); }
  });
});
