// Executado pelo Antigravity: envia só identidade e estado, sem conteúdo da conversa.
const event = process.argv.at(-1);
const allowed = new Set(['SessionStart', 'PreInvocation', 'Stop']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 262144) break; }
try {
  if (allowed.has(event) && raw.length <= 262144) {
    const input = JSON.parse(raw);
    const id = input?.conversationId;
    const path = input?.transcriptPath;
    const match = typeof path === 'string' && /(?:^|[\\/])antigravity-cli[\\/]brain[\\/]([0-9a-f-]{36})[\\/]\.system_generated[\\/]logs[\\/]transcript(?:_full)?\.jsonl$/i.exec(path);
    if (typeof id === 'string' && uuid.test(id) && match?.[1].toLowerCase() === id.toLowerCase()) {
      const body = { event, conversationId: id, transcriptPath: path,
        workspacePaths: Array.isArray(input.workspacePaths) ? input.workspacePaths.filter((v) => typeof v === 'string').slice(0, 8) : [],
        ...(event === 'Stop' ? { fullyIdle: input.fullyIdle === true } : {}) };
      const port = /^\d{1,5}$/.test(process.env.HABBLAUD_PORT || '') ? process.env.HABBLAUD_PORT : '4747';
      await fetch(`http://127.0.0.1:${port}/api/antigravity/events`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(800) }).catch(() => {});
    }
  }
} catch { /* hook observacional: nunca bloqueia a CLI */ }
process.stdout.write(event === 'Stop' ? '{"decision":"stop"}\n' : '{}\n');
