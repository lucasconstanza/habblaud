import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { AccountsService } from '../accounts/service';
import type { Office } from '../model/office';
import { legacyGeminiEnabled } from '../sources/gemini/accounts';
import { AntigravityHistory } from '../sources/antigravity/history';
import { AntigravitySource, parseAntigravityStatusline, parseAntigravityHook } from '../sources/antigravity/source';
import { AntigravityTerminalParser } from '../sources/antigravity/terminal';
import { AntigravityQuotaStore, parseSavedAntigravityQuota } from '../sources/antigravity/quota-store';
import { saveAntigravityChanges, updateAntigravityHooks, updateAntigravitySettings } from '../../scripts/antigravity-install';

const id = '11111111-1111-4111-8111-111111111111';
const path = `C:\\Users\\Test\\.gemini\\antigravity-cli\\brain\\${id}\\.system_generated\\logs\\transcript.jsonl`;
const cwd = 'C:\\Users\\Test\\Project';

describe('Antigravity CLI', () => {
  it('preserva grupos alheios e instalação idempotente', () => {
    const before = { 'orca-status': { PreInvocation: [{ command: 'orca' }] } };
    const installed = updateAntigravityHooks(before, 'install', 'C:\\Habblaud\\mod\\habblaud-antigravity\\hook.mjs');
    expect(installed['orca-status']).toEqual(before['orca-status']);
    expect(updateAntigravityHooks(installed, 'install', 'C:\\Habblaud\\mod\\habblaud-antigravity\\hook.mjs')).toEqual(installed);
    expect(updateAntigravityHooks(installed, 'uninstall')).toEqual(before);
    const settings = { model: 'chosen' };
    const line = updateAntigravitySettings(settings, 'install', 'C:\\Habblaud\\mod\\habblaud-antigravity\\statusline.mjs');
    expect(line).toMatchObject({ model: 'chosen', statusLine: { stack_with_default: true } });
    expect(updateAntigravitySettings(line, 'uninstall')).toEqual(settings);
    expect(() => updateAntigravitySettings({ statusLine: { command: 'other' } }, 'install')).toThrow();
  });

  it.skipIf(process.platform !== 'win32')('comandos instalados executam pelo cmd no Windows', () => {
    const hook = updateAntigravityHooks({}, 'install');
    const command = (hook['habblaud-antigravity'] as { SessionStart: Array<{ command: string }> }).SessionStart[0].command;
    const result = spawnSync(command, { shell: true, input: JSON.stringify({}), encoding: 'utf8',
      env: { ...process.env, HABBLAUD_PORT: '65534' } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
    const line = updateAntigravitySettings({}, 'install').statusLine as { command: string };
    const status = spawnSync(line.command, { shell: true, input: '{}', encoding: 'utf8',
      env: { ...process.env, HABBLAUD_PORT: '65534' } });
    expect(status.status).toBe(0);
    const local = join(process.cwd(), '.local');
    mkdirSync(local, { recursive: true });
    const spaced = mkdtempSync(join(local, 'agy script with spaces '));
    try {
      const copied = join(spaced, 'hook.mjs');
      copyFileSync(join(process.cwd(), 'mod', 'habblaud-antigravity', 'hook.mjs'), copied);
      const configured = updateAntigravityHooks({}, 'install', copied);
      const spacedCommand = (configured['habblaud-antigravity'] as { SessionStart: Array<{ command: string }> }).SessionStart[0].command;
      const resultWithSpaces = spawnSync(spacedCommand, { shell: true, input: '{}', encoding: 'utf8',
        env: { ...process.env, HABBLAUD_PORT: '65534' } });
      expect(resultWithSpaces.status, resultWithSpaces.stderr).toBe(0);
    } finally { rmSync(spaced, { recursive: true, force: true }); }
  });

  it('scripts transmitem somente campos permitidos', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk.toString(); });
      req.on('end', () => { bodies.push(JSON.parse(raw) as Record<string, unknown>); res.writeHead(200); res.end('{}'); });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('porta indisponível');
      const script = join(process.cwd(), 'mod', 'habblaud-antigravity', 'hook.mjs');
      const child = spawn(process.execPath, [script, 'PreInvocation'], { env: { ...process.env, HABBLAUD_PORT: String(address.port) } });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stdin.end(JSON.stringify({ conversationId: id, transcriptPath: path, workspacePaths: [cwd], lastUserInput: 'PROMPT-SECRETO',
        toolCall: { args: { secret: 'TOKEN-SECRETO' } } }));
      await new Promise<void>((resolve, reject) => child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`hook saiu com ${code}`))));
      expect(stdout.trim()).toBe('{}');
      expect(bodies).toHaveLength(1);
      expect(JSON.stringify(bodies[0])).not.toContain('SECRETO');
      expect(bodies[0]).toMatchObject({ event: 'PreInvocation', conversationId: id, workspacePaths: [cwd] });
      const lineScript = join(process.cwd(), 'mod', 'habblaud-antigravity', 'statusline.mjs');
      const line = spawn(process.execPath, [lineScript], { env: { ...process.env, HABBLAUD_PORT: String(address.port) } });
      line.stdin.end(JSON.stringify({ conversation_id: id, transcript_path: path, workspace: { project_dir: cwd },
        agent_state: 'working', email: 'person@example.test', plan_tier: 'Pro', quota: { fast: { remaining_fraction: 0.4,
          reset_time: '2030-01-01T00:00:00Z', remaining_amount: 999 } }, conversation_title: 'SECRETO-TITULO',
        context_window: { tokens: 'SECRETO-CONTEXTO' } }));
      await new Promise<void>((resolve, reject) => line.on('close', (code) => code === 0 ? resolve() : reject(new Error(`statusline saiu com ${code}`))));
      expect(bodies).toHaveLength(2);
      expect(JSON.stringify(bodies[1])).not.toContain('SECRETO');
      expect(JSON.stringify(bodies[1])).not.toContain('remaining_amount');
      expect(bodies[1]).toMatchObject({ conversationId: id, quota: { fast: { remainingFraction: 0.4 } } });
    } finally { server.close(); }
  });

  it('restaura o primeiro arquivo se a segunda gravação falhar', () => {
    const local = join(process.cwd(), '.local');
    mkdirSync(local, { recursive: true });
    const dir = mkdtempSync(join(local, 'habblaud-install-'));
    try {
      const first = join(dir, 'hooks.json');
      writeFileSync(first, '{"orca-status":{}}');
      expect(() => saveAntigravityChanges([
        { path: first, raw: '{"orca-status":{}}', next: { 'orca-status': {}, habblaud: {} } },
        { path: join(dir, 'missing', 'settings.json'), raw: '{}', next: { statusLine: {} } },
      ])).toThrow();
      expect(readFileSync(first, 'utf8')).toBe('{"orca-status":{}}');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('aceita só metadados CLI, UUID e frações válidas', () => {
    expect(parseAntigravityHook({ event: 'SessionStart', conversationId: id, transcriptPath: path,
      workspacePaths: [cwd], lastUserInput: 'SEGREDO' })).toEqual({ event: 'SessionStart', conversationId: id, cwd, fullyIdle: false });
    expect(parseAntigravityHook({ event: 'SessionStart', conversationId: id, transcriptPath: path.replace('transcript.jsonl', 'transcript_full.jsonl'),
      workspacePaths: [cwd] })?.cwd).toBe(cwd);
    expect(parseAntigravityHook({ event: 'SessionStart', conversationId: id, transcriptPath: path.replace('antigravity-cli', 'antigravity'), workspacePaths: [cwd] })).toBeUndefined();
    const line = parseAntigravityStatusline({ conversationId: id, transcriptPath: path,
      workspace: { projectDir: cwd }, agentState: 'working', quota: {
        good: { remainingFraction: 0.25, resetTime: '2030-01-01T00:00:00Z' }, bad: { remainingFraction: 1.5 } } }, 42);
    expect(line?.quota?.fetchedAt).toBe(42);
    expect(line?.quota?.buckets).toEqual([{ id: 'good', remainingFraction: 0.25, resetAt: Date.parse('2030-01-01T00:00:00Z') }, { id: 'bad' }]);
  });

  it('guarda apenas a leitura real, preserva idade no restart e invalida ao trocar conta', () => {
    const local = join(process.cwd(), '.local');
    mkdirSync(local, { recursive: true });
    const dir = mkdtempSync(join(local, 'habblaud-agy-quota-'));
    try {
      const file = join(dir, 'antigravity-quota.json');
      let now = Date.parse('2026-11-05T01:00:00Z');
      const store = new AntigravityQuotaStore(file, () => now);
      const quota = { fetchedAt: now - 20 * 60_000, buckets: [{ id: 'model.fast', remainingFraction: 0.4, resetAt: now + 60_000 }] };
      store.save({ email: 'old@example.test', plan: 'Pro', quota });
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, email: 'old@example.test', plan: 'Pro', quota });
      expect(parseSavedAntigravityQuota({ version: 1, email: 'old@example.test', extra: 'PROMPT-SECRETO', quota: {
        fetchedAt: now, buckets: [{ id: 'model.fast', remainingFraction: 0.4, prompt: 'PROMPT-SECRETO' }] } }, now))
        .toEqual({ email: 'old@example.test', plan: undefined, quota: { fetchedAt: now, buckets: [{ id: 'model.fast', remainingFraction: 0.4 }] } });
      const accounts = { allEntries: () => [], setProviderAccounts: (_provider: string, input: Array<{ dir: string; detected: object }>) => [
        { id: 'antigravity-cli', provider: 'antigravity', dir: input[0].dir, detected: input[0].detected },
      ] } as unknown as AccountsService;
      const office = { markDirty: () => {}, addMain: () => {}, setStatus: () => {}, closeMain: () => {} } as unknown as Office;
      now += 60_000;
      const source = new AntigravitySource({ accounts, office, dir, statusFile: file, now: () => now });
      expect(source.quota()?.fetchedAt).toBe(quota.fetchedAt);
      expect(source.accountEntry().detected.email).toBe('old@example.test');
      expect(source.applyStatusline({ email: 'old@example.test', quota: {} })).toBe(true);
      expect(source.quota()?.fetchedAt).toBe(quota.fetchedAt);
      expect(source.applyStatusline({ email: 'new@example.test' })).toBe(true);
      expect(source.quota()).toBeUndefined();
      expect(store.load()).toEqual({ email: 'new@example.test', plan: undefined, quota: undefined });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('abre sala só por evento recente, encerra por TTL e não lê conteúdo para presença', () => {
    let now = 1000;
    const actions: string[] = [];
    const detected = { id: 'antigravity-cli', provider: 'antigravity' as const, configDir: 'C:\\agy', short: 'G', name: 'Antigravity CLI', color: '#fff' };
    const accounts = { allEntries: () => [], setProviderAccounts: () => [{ id: detected.id, provider: detected.provider, dir: detected.configDir, detected }] } as unknown as AccountsService;
    const office = { addMain: (v: { cwd: string }) => actions.push(`open:${v.cwd}`), setStatus: () => actions.push('status'),
      closeMain: () => actions.push('close'), markDirty: () => actions.push('dirty') } as unknown as Office;
    const source = new AntigravitySource({ accounts, office, dir: 'C:\\agy', now: () => now });
    expect(source.sources()[0].sessions).toBe(0);
    expect(source.applyHook({ event: 'Stop', conversationId: id, transcriptPath: path, workspacePaths: [cwd], fullyIdle: true })).toBe(true);
    expect(source.sources()[0].sessions).toBe(0);
    expect(source.applyHook({ event: 'PreInvocation', conversationId: id, transcriptPath: path, workspacePaths: [cwd] })).toBe(true);
    expect(source.sources()[0].sessions).toBe(1);
    expect(actions).toContain(`open:${cwd}`);
    now += 120_001;
    source.poll();
    expect(source.sources()[0].sessions).toBe(0);
    expect(actions).toContain('close');
  });

  it('histórico valida UUID, mapeamento de projeto e symlink externo', async () => {
    const local = join(process.cwd(), '.local');
    mkdirSync(local, { recursive: true });
    const dir = mkdtempSync(join(local, 'habblaud-agy-'));
    const outside = mkdtempSync(join(local, 'habblaud-outside-'));
    try {
      const transcript = join(dir, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
      mkdirSync(join(dir, 'brain', id, '.system_generated', 'logs'), { recursive: true });
      mkdirSync(join(dir, 'cache'));
      writeFileSync(transcript, JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Teste neutro', created_at: '2026-01-01T00:00:00Z' }) + '\n');
      writeFileSync(join(dir, 'cache', 'last_conversations.json'), JSON.stringify({ [cwd]: id }));
      const history = new AntigravityHistory({ dir, account: () => 'agy', projectOf: () => undefined, openAgentOf: () => undefined });
      const listed = await history.list();
      expect(listed[0]).toMatchObject({ sessionId: id, project: cwd, open: false });
      expect('path' in history.resolve('agy', id)).toBe(true);
      expect(history.resolve('agy', '../x')).toMatchObject({ status: 400 });
      expect(history.pathForLive(id)).toBe(transcript);
      const parser = new AntigravityTerminalParser();
      expect(parser.push(readFileSync(transcript, 'utf8').trim())[0]).toMatchObject({ kind: 'user', text: 'Teste neutro' });
      const full = transcript.replace('transcript.jsonl', 'transcript_full.jsonl');
      writeFileSync(full, readFileSync(transcript));
      rmSync(transcript);
      expect(history.pathForLive(id)).toBe(full);
      expect('path' in history.resolve('agy', id)).toBe(true);
      const other = join(outside, 'other.json');
      writeFileSync(other, JSON.stringify({ [cwd]: id }));
      rmSync(join(dir, 'cache', 'last_conversations.json'));
      symlinkSync(other, join(dir, 'cache', 'last_conversations.json'));
      const withoutCache = await history.list();
      expect(withoutCache[0].project).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });

  it('prefere Antigravity e suprime Gemini OAuth pessoal no autodetect', () => {
    expect(legacyGeminiEnabled({}, true, true)).toBe(false);
    expect(legacyGeminiEnabled({ HABBLAUD_GEMINI: '1' }, true, true)).toBe(true);
    expect(legacyGeminiEnabled({}, false, true)).toBe(false);
    expect(legacyGeminiEnabled({}, false, false)).toBe(true);
  });
});
