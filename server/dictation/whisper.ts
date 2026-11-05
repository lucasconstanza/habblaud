// Ditado: transforma o áudio gravado no navegador em texto com o Whisper LOCAL (whisper.cpp: `whisper-cli`), sem mandar
// a voz para nenhum serviço. O idioma é detectado sozinho (`-l auto`); como o ditado é em português ou inglês, um
// resultado em outra língua (o Whisper às vezes confunde português com espanhol ou galego) é refeito em português.
// Precisa do whisper-cli, do ffmpeg (o áudio do celular vem em mp4/webm) e de um modelo multilíngue ggml-*.bin (os
// ".en" só entendem inglês e ficam de fora). Roda onde está o Whisper: o servidor no modo Node, o auxiliar do host
// (scripts/codex-bridge.ts) no Docker. Sem shell (execFile), com prazo, numa pasta temporária apagada no fim.
// Node puro e sem dependências: também é importado pelo auxiliar do host (via tsx).
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { tr } from '../../shared/i18n';
import { findExecutable } from '../claude-bin';

export const TRANSCRIBE_TIMEOUT_MS = 120_000;
/** Idiomas do ditado: o primeiro é o de reserva quando o detectado não está na lista. */
export const DEFAULT_LANGS = ['pt', 'en'] as const;
/** Do melhor para o mais leve: usa o primeiro que existir. */
const MODELS = ['ggml-large-v3-turbo.bin', 'ggml-large-v3.bin', 'ggml-medium.bin', 'ggml-small.bin', 'ggml-base.bin', 'ggml-tiny.bin'];

export interface WhisperSetup {
  bin: string;
  ffmpeg: string;
  model: string;
  langs: string[];
}

export interface Transcript {
  text: string;
  /** Código ISO do idioma reconhecido (ex.: "pt", "en"). */
  lang: string;
}

export type Transcriber = (audio: Buffer, type: string) => Promise<Transcript>;

/** execFile no Windows não executa wrappers .cmd/.bat; procure apenas binários nativos. */
function directExecutable(name: string, env: NodeJS.ProcessEnv): string | undefined {
  if (process.platform !== 'win32') return findExecutable(name, env);
  return findExecutable(`${name}.exe`, env) ?? findExecutable(`${name}.com`, env);
}

function runnableBin(file: string | undefined, exists: (p: string) => boolean): file is string {
  return !!file && exists(file) && (process.platform !== 'win32' || /\.(exe|com)$/i.test(file));
}

/** Acha o whisper-cli, o ffmpeg e o melhor modelo multilíngue; undefined (com o motivo) se faltar algum. */
export function findWhisper(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): WhisperSetup | { missing: string } {
  const home = env.HOME || homedir();
  const bin = env.HABBLAUD_WHISPER_BIN?.trim() || ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'].find(exists) || directExecutable('whisper-cli', env);
  if (!runnableBin(bin, exists)) return { missing: process.platform === 'win32' ? tr('whisper-cli (instale whisper.cpp ou defina HABBLAUD_WHISPER_BIN)') : 'whisper-cli (brew install whisper-cpp)' };
  const ffmpeg = env.HABBLAUD_FFMPEG_BIN?.trim() || ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(exists) || directExecutable('ffmpeg', env);
  if (!runnableBin(ffmpeg, exists)) return { missing: process.platform === 'win32' ? tr('ffmpeg (instale ou defina HABBLAUD_FFMPEG_BIN)') : 'ffmpeg (brew install ffmpeg)' };
  const homePath = /^[A-Za-z]:[\\/]/.test(home) ? win32 : posix;
  const dirs = [homePath.join(home, '.local', 'share', 'whisper'), homePath.join(home, '.whisper'), '/opt/homebrew/share/whisper-cpp', '/usr/local/share/whisper-cpp'];
  const model =
    env.HABBLAUD_WHISPER_MODEL?.trim() ||
    MODELS.flatMap((m) => dirs.map((d) => (/^[A-Za-z]:[\\/]/.test(d) ? win32 : posix).join(d, m))).find(exists);
  if (!model || !exists(model)) return { missing: tr('um modelo multilíngue do Whisper (ggml-small.bin ou ggml-base.bin em ~/.local/share/whisper)') };
  const langs = (env.HABBLAUD_DICTATION_LANGS ?? '')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => /^[a-z]{2,3}$/.test(l));
  return { bin, ffmpeg, model, langs: langs.length ? langs : [...DEFAULT_LANGS] };
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((ok) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, _out, stderr) => {
      if (!err) return ok({ ok: true });
      const line = (stderr || err.message || '').split('\n').filter((l) => l.trim()).pop() ?? tr('falhou');
      ok({ ok: false, error: line.trim().slice(0, 300) });
    });
  });
}

/** Texto e idioma do JSON do whisper-cli (-oj). */
export function parseWhisperJson(raw: string): Transcript {
  const d = JSON.parse(raw) as { result?: { language?: unknown }; transcription?: Array<{ text?: unknown }> };
  const text = (d.transcription ?? [])
    .map((t) => (typeof t.text === 'string' ? t.text : ''))
    .join(' ')
    .replace(/\[(BLANK_AUDIO|MUSIC|Música|SILENCE)\]|\((?:silence|música|music)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, lang: typeof d.result?.language === 'string' ? d.result.language : '' };
}

/** Transcritor com o whisper-cli; a pasta temporária some no fim, com ou sem erro. */
export function createWhisperTranscriber(setup: WhisperSetup, timeoutMs = TRANSCRIBE_TIMEOUT_MS): Transcriber {
  return async (audio) => {
    const dir = mkdtempSync(join(tmpdir(), 'habblaud-dictation-'));
    try {
      const input = join(dir, 'audio.in');
      const wav = join(dir, 'audio.wav');
      writeFileSync(input, audio, { mode: 0o600 });
      const conv = await run(setup.ffmpeg, ['-nostdin', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], timeoutMs);
      if (!conv.ok) throw new Error(tr('não deu para ler o áudio ({0})', [conv.error]));
      const pass = async (lang: string): Promise<Transcript> => {
        const out = join(dir, `out-${lang}`);
        const r = await run(setup.bin, ['-m', setup.model, '-l', lang, '-f', wav, '-nt', '-np', '-oj', '-of', out], timeoutMs);
        if (!r.ok) throw new Error(tr('o Whisper falhou ({0})', [r.error]));
        return parseWhisperJson(readFileSync(`${out}.json`, 'utf8'));
      };
      const first = await pass('auto');
      if (!first.lang || setup.langs.includes(first.lang) || !first.text) return first;
      // Detectou uma língua fora da lista (ex.: "es" para português): refaz no idioma principal.
      const again = await pass(setup.langs[0]);
      return { text: again.text, lang: setup.langs[0] };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
