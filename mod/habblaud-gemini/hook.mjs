// Hook observacional do Gemini CLI. Lê a entrada local, manda só metadados para o Habblaud local.
// Nunca envia prompt, resposta, argumentos de ferramentas, credenciais ou dados clínicos.
let input = '';
for await (const chunk of process.stdin) {
  if (input.length < 256 * 1024) input += chunk.toString('utf8');
}
try {
  const j = JSON.parse(input);
  const port = Number(process.env.HABBLAUD_PORT ?? 4747);
  if (Number.isInteger(port) && port > 0 && port <= 65535 && typeof j.session_id === 'string' && typeof j.cwd === 'string') {
    const event = { sessionId: j.session_id, cwd: j.cwd, event: j.hook_event_name, transcriptPath: j.transcript_path,
      timestamp: j.timestamp, toolName: j.tool_name, notificationType: j.notification_type };
    await fetch(`http://127.0.0.1:${port}/api/gemini/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
      signal: AbortSignal.timeout(800),
    }).catch(() => undefined);
  }
} catch { /* Gemini continua funcionando mesmo sem Habblaud */ }
process.stdout.write('{}\n');
