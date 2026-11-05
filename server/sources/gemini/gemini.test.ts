import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { Office } from '../../model/office';
import { NameStore } from '../../model/names';
import { tempDir } from '../../test/fixtures';
import { GeminiHistory } from './history';
import { GeminiSource, parseGeminiHook } from './source';
import { GeminiTerminalParser } from './terminal';

const S1 = '11111111-1111-4111-8111-111111111111';
const now = Date.now();

describe('Gemini CLI local', () => {
  it('usa .project_root e conversas reais, sem inferir o projeto pelo slug', async () => {
    const tmp = tempDir();
    try {
      const chats = join(tmp.dir, 'tmp', 'hash-que-nao-e-caminho', 'chats');
      mkdirSync(chats, { recursive: true });
      writeFileSync(join(tmp.dir, 'tmp', 'hash-que-nao-e-caminho', '.project_root'), join(tmp.dir, 'projeto-real'));
      const path = join(chats, `session-${S1}.jsonl`);
      writeFileSync(path, [
        JSON.stringify({ sessionId: S1, kind: 'main', startTime: new Date(now - 1000).toISOString(), lastUpdated: new Date(now).toISOString() }),
        JSON.stringify({ $set: { messages: [{ id: 'm1', type: 'user', timestamp: new Date(now).toISOString(), content: 'Primeiro pedido' }, { id: 'm2', type: 'gemini', timestamp: new Date(now).toISOString(), content: 'Resposta' }] } }),
      ].join('\n') + '\n');
      const h = new GeminiHistory({ dir: tmp.dir, account: () => '.gemini', openAgentOf: () => undefined });
      const list = await h.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ provider: 'gemini', project: join(tmp.dir, 'projeto-real'), title: 'Primeiro pedido', open: false });
      const found = h.resolve('.gemini', list[0].sessionId);
      expect('path' in found ? found.path : undefined).toBe(path);
      expect(h.pathForLive(S1, join(tmp.dir, 'projeto-real'))).toBe(path);
      expect(h.resolve('.gemini', '../x')).toMatchObject({ status: 400 });
      const parser = new GeminiTerminalParser();
      const line = JSON.stringify({ $set: { messages: [{ id: 'm1', type: 'user', content: 'Primeiro pedido' }] } });
      expect(parser.push(line)).toHaveLength(1);
      expect(parser.push(line)).toHaveLength(0);
      writeFileSync(join(chats, `session-${S1}.extra.jsonl`), [
        JSON.stringify({ sessionId: S1, kind: 'main', startTime: new Date(now).toISOString() }),
        JSON.stringify({ $set: { messages: [{ id: 'other', type: 'user', content: 'Outro pedido' }] } }),
      ].join('\n') + '\n');
      const distinct = await h.list();
      expect(distinct).toHaveLength(2);
      expect(new Set(distinct.map((s) => s.sessionId)).size).toBe(2);
      expect(distinct.every((s) => 'path' in h.resolve('.gemini', s.sessionId))).toBe(true);
      const old = new GeminiHistory({ dir: tmp.dir, account: () => '.gemini', openAgentOf: () => undefined, now: () => now + 9 * 24 * 60 * 60_000 });
      expect(await old.list()).toHaveLength(0);
      expect(old.pathForLive(S1, join(tmp.dir, 'projeto-real'), path)).toBe(path);
      expect(old.pathForLive(S1, join(tmp.dir, 'projeto-real'))).toBeUndefined();
    } finally { tmp.cleanup(); }
  });

  it('só cria presença por hook; três provedores no mesmo cwd dividem sala e outro cwd cria outra', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.gemini');
      mkdirSync(join(dir, 'tmp'), { recursive: true });
      let clock = now;
      const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: { HOME: tmp.dir }, onChange: () => undefined, now: () => clock });
      const office = new Office({ names: new NameStore(null), version: 'test', startedAt: clock,
        accounts: (sessions) => accounts.list(sessions), sources: () => [], accountName: (id) => accounts.find(id)?.detected.name,
        now: () => clock });
      const source = new GeminiSource({ dir, accounts, office, now: () => clock });
      const cwd = join(tmp.dir, 'projeto');
      office.addMain({ id: 'claude-1', provider: 'claude', account: 'claude-test', sessionId: 'claude-s', cwd, role: 'Principal', startedAt: clock, status: 'working' });
      office.addMain({ id: 'codex-1', provider: 'codex', account: 'codex-test', sessionId: 'codex-s', cwd, role: 'Principal', startedAt: clock, status: 'working' });
      expect(office.commit().snapshot.agents).toHaveLength(2);
      expect(source.sources()[0].sessions).toBe(0);
      expect(isAbsolute(cwd)).toBe(true);
      expect(parseGeminiHook({ sessionId: S1, cwd, event: 'SessionStart' })).toBeDefined();
      expect(parseGeminiHook({ sessionId: 'a2a-server', cwd, event: 'SessionStart' })).toBeDefined();
      expect(source.applyHook({ sessionId: S1, cwd, event: 'SessionStart' })).toBe(true);
      let snap = office.commit().snapshot;
      expect(snap.rooms).toHaveLength(1);
      expect(snap.agents.map((a) => a.provider ?? 'claude').sort()).toEqual(['claude', 'codex', 'gemini']);
      expect(snap.agents.map((a) => a.roomId)).toEqual([snap.rooms[0].id, snap.rooms[0].id, snap.rooms[0].id]);
      expect(source.applyHook({ sessionId: S1, cwd: join(tmp.dir, 'outro'), event: 'BeforeAgent' })).toBe(true);
      snap = office.commit().snapshot;
      expect(snap.rooms).toHaveLength(2);
      expect(snap.agents.filter((a) => a.provider === 'gemini')).toHaveLength(2);
      source.applyHook({ sessionId: S1, cwd, event: 'SessionEnd' });
      expect(source.sources()[0].sessions).toBe(1);
      expect(office.commit().snapshot.agents.filter((a) => a.provider === 'gemini' && a.status !== 'offline')).toHaveLength(1);
      clock += 2 * 60_000 + 1;
      source.poll();
      expect(source.sources()[0].sessions).toBe(0);
    } finally { tmp.cleanup(); }
  });

  it('Docker lê projeto Windows e associa transcript_path do host só a um chat montado', async () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.gemini');
      const chats = join(dir, 'tmp', 'slug-do-projeto', 'chats');
      mkdirSync(chats, { recursive: true });
      const project = 'C:\\Users\\Lucas\\Projects\\Projeto';
      writeFileSync(join(dir, 'tmp', 'slug-do-projeto', '.project_root'), project);
      const file = join(chats, 'session-a2a-server.jsonl');
      writeFileSync(file, JSON.stringify({ sessionId: 'a2a-server', kind: 'main', startTime: new Date(now).toISOString() }) + '\n');
      const old = new Date(now - 60_000);
      utimesSync(file, old, old);
      const hint = 'C:\\Users\\Lucas\\.gemini\\tmp\\slug-do-projeto\\chats\\session-a2a-server.jsonl';
      const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: { HOME: tmp.dir }, onChange: () => undefined });
      const office = new Office({ names: new NameStore(null), version: 'test', startedAt: now,
        accounts: (sessions) => accounts.list(sessions), sources: () => [], accountName: () => undefined });
      const source = new GeminiSource({ dir, accounts, office, inDocker: true, now: () => now });
      expect(parseGeminiHook({ sessionId: 'a2a-server', cwd: project, transcriptPath: hint, event: 'SessionStart' })).toBeDefined();
      expect(source.applyHook({ sessionId: 'a2a-server', cwd: project, event: 'SessionStart' })).toBe(true);
      const agent = office.commit().snapshot.agents.find((a) => a.provider === 'gemini')!;
      expect(source.transcriptPathOf(agent.id)).toBeUndefined(); // chat antigo com mesmo id não é desta sessão
      expect(source.applyHook({ sessionId: 'a2a-server', cwd: project.toLowerCase(), transcriptPath: hint, event: 'BeforeAgent' })).toBe(true);
      const firstAgent = office.commit().snapshot.agents.find((a) => a.provider === 'gemini' && a.status !== 'offline')!;
      expect(source.transcriptPathOf(firstAgent.id)).toBe(file);
      const secondFile = join(chats, 'session-a2a-server-2.jsonl');
      writeFileSync(secondFile, JSON.stringify({ sessionId: 'a2a-server', kind: 'main', startTime: new Date(now).toISOString() }) + '\n');
      const secondHint = 'C:\\Users\\Lucas\\.gemini\\tmp\\slug-do-projeto\\chats\\session-a2a-server-2.jsonl';
      expect(source.applyHook({ sessionId: 'a2a-server', cwd: project, transcriptPath: secondHint, event: 'SessionStart' })).toBe(true);
      expect(source.sources()[0].sessions).toBe(2);
      expect(office.commit().snapshot.agents.filter((a) => a.provider === 'gemini' && a.status !== 'offline')).toHaveLength(2);
      expect((await source.history.list()).filter((s) => s.open)).toHaveLength(2);
      source.applyHook({ sessionId: 'a2a-server', cwd: project, event: 'SessionEnd' });
      expect(source.sources()[0].sessions).toBe(2); // sem path, dois processos são indistinguíveis
      source.applyHook({ sessionId: 'a2a-server', cwd: project, transcriptPath: hint, event: 'SessionEnd' });
      expect(source.sources()[0].sessions).toBe(1);
      expect(await source.history.list()).toHaveLength(2);
      expect((await source.history.list())[0].project).toBe(project);
      expect(source.history.pathForLive('a2a-server', project, hint.replace('slug-do-projeto', 'outro'))).toBeUndefined();
    } finally { tmp.cleanup(); }
  });
});
