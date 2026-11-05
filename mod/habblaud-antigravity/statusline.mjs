// Captura a whitelist de metadados do statusline. Não armazena nem transmite o JSON bruto.
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 262144) break; }
try {
  if (raw.length <= 262144) {
    const input = JSON.parse(raw);
    const q = input?.quota && typeof input.quota === 'object' && !Array.isArray(input.quota) ? input.quota : {};
    const quota = {};
    for (const [id, b] of Object.entries(q).slice(0, 24)) {
      if (!/^[\w.:-]{1,80}$/.test(id) || !b || typeof b !== 'object') continue;
      quota[id] = { ...(typeof b.remaining_fraction === 'number' ? { remainingFraction: b.remaining_fraction } : {}),
        ...(typeof b.reset_time === 'string' ? { resetTime: b.reset_time } : {}),
        ...(typeof b.disabled === 'boolean' ? { disabled: b.disabled } : {}) };
    }
    const body = { conversationId: input?.conversation_id, transcriptPath: input?.transcript_path,
      workspace: { projectDir: input?.workspace?.project_dir }, cwd: input?.cwd, agentState: input?.agent_state,
      email: typeof input?.email === 'string' && /^[^\s@]{1,80}@[^\s@]{1,120}$/.test(input.email) ? input.email : undefined,
      planTier: typeof input?.plan_tier === 'string' && /^[\w .+-]{1,60}$/.test(input.plan_tier) ? input.plan_tier : undefined,
      toolConfirmationPending: input?.tool_confirmation_pending === true,
      ...(input?.quota ? { quota } : {}) };
    const port = /^\d{1,5}$/.test(process.env.HABBLAUD_PORT || '') ? process.env.HABBLAUD_PORT : '4747';
    await fetch(`http://127.0.0.1:${port}/api/antigravity/statusline`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(800) }).catch(() => {});
  }
} catch { /* statusline não impede a CLI */ }
process.stdout.write('\n');
