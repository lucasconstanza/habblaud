// Atualização sob demanda do /usage pela CLI autenticada da conta Claude. Nunca lê credenciais nem registra a saída.
import { execFile } from 'node:child_process';
import { isDefaultDir } from './detect';
import type { AccountsService } from './service';

const TIMEOUT_MS = 60_000;
const COOLDOWN_MS = 60_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

export type RefreshResult = 'ok' | 'unknown-account' | 'busy' | 'rate-limited' | 'cli-failed' | 'no-new-usage';
export type UsageCommand = (configDir: string) => Promise<boolean>;

/** Roda o comando local do Claude Code; saída e erros da CLI ficam somente em memória. */
export function claudeUsageEnv(configDir: string, home: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  // A conta padrão usa ~/.claude.json; definir CLAUDE_CONFIG_DIR para ~/.claude muda o perfil que a CLI abre.
  if (isDefaultDir(configDir, home)) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = configDir;
  // Uma sessão-filha não deve herdar o contexto de outra CLI que iniciou o servidor.
  for (const key of ['CLAUDECODE', 'AI_AGENT', 'CLAUDE_PID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT']) delete env[key];
  return env;
}

export function claudeUsageCommand(bin: string, home: string, launch: typeof execFile = execFile): UsageCommand {
  return (configDir) => new Promise((resolve) => {
    const child = launch(
      bin,
      ['--print', '--no-session-persistence', '--output-format', 'json', '/usage'],
      {
        env: claudeUsageEnv(configDir, home),
        windowsHide: true,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
      },
      (error) => resolve(!error),
    );
    // `--print` também lê stdin; o pipe aberto do execFile o deixava aguardando até o timeout.
    child.stdin?.end();
  });
}

/** Uma atualização por conta por minuto; não executa caminhos recebidos do navegador. */
export class ClaudeUsageRefresher {
  private readonly started = new Map<string, number>();
  private readonly busy = new Set<string>();

  constructor(private readonly accounts: AccountsService, private readonly command: UsageCommand, private readonly now: () => number = Date.now) {}

  async refresh(accountId: string): Promise<RefreshResult> {
    const account = this.accounts.find(accountId);
    if (!account || account.provider !== 'claude') return 'unknown-account';
    if (this.busy.has(accountId)) return 'busy';
    const now = this.now();
    const last = this.started.get(accountId);
    if (last !== undefined && now - last < COOLDOWN_MS) return 'rate-limited';
    this.started.set(accountId, now);
    this.busy.add(accountId);
    const previous = this.accounts.usage.source(accountId, 'cache')?.fetchedAt ?? 0;
    try {
      const ok = await this.command(account.dir);
      if (!ok) return 'cli-failed';
      this.accounts.refresh();
      const current = this.accounts.usage.source(accountId, 'cache')?.fetchedAt ?? 0;
      return current > previous ? 'ok' : 'no-new-usage';
    } catch {
      return 'cli-failed';
    } finally {
      this.busy.delete(accountId);
    }
  }
}
