import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWhisper, parseWhisperJson } from './whisper';

describe('Whisper local', () => {
  it('lê texto e idioma do JSON do whisper-cli, sem marcas de silêncio', () => {
    const raw = JSON.stringify({ result: { language: 'pt' }, transcription: [{ text: ' Crie um agente' }, { text: ' para o relatório. [BLANK_AUDIO]' }] });
    expect(parseWhisperJson(raw)).toEqual({ text: 'Crie um agente para o relatório.', lang: 'pt' });
    expect(parseWhisperJson('{}')).toEqual({ text: '', lang: '' });
  });

  it('acha binários e o melhor modelo multilíngue (nunca um .en)', () => {
    if (process.platform === 'win32') return; // caminhos Homebrew só são executáveis em POSIX
    const have = new Set(['/opt/homebrew/bin/whisper-cli', '/opt/homebrew/bin/ffmpeg', '/h/.whisper/ggml-base.en.bin', '/h/.local/share/whisper/ggml-base.bin', '/h/.local/share/whisper/ggml-small.bin']);
    const setup = findWhisper({ HOME: '/h', PATH: '' }, (p) => have.has(p));
    expect(setup).toEqual({ bin: '/opt/homebrew/bin/whisper-cli', ffmpeg: '/opt/homebrew/bin/ffmpeg', model: '/h/.local/share/whisper/ggml-small.bin', langs: ['pt', 'en'] });
    have.delete('/h/.local/share/whisper/ggml-small.bin');
    have.delete('/h/.local/share/whisper/ggml-base.bin');
    expect(findWhisper({ HOME: '/h', PATH: '' }, (p) => have.has(p))).toHaveProperty('missing');
    expect(findWhisper({ HOME: '/h', PATH: '' }, () => false)).toEqual({ missing: 'whisper-cli (brew install whisper-cpp)' });
    expect(findWhisper({ HOME: '/h', PATH: '', HABBLAUD_DICTATION_LANGS: 'en, pt, xx-bad' }, () => true)).toMatchObject({ langs: ['en', 'pt'] });
  });

  it('no Windows encontra whisper-cli.exe e ffmpeg.exe no PATH', () => {
    if (process.platform !== 'win32') return;
    const home = mkdtempSync(join(tmpdir(), 'habblaud-whisper-'));
    try {
      const modelDir = join(home, '.local', 'share', 'whisper');
      mkdirSync(modelDir, { recursive: true });
      for (const file of ['whisper-cli.exe', 'ffmpeg.exe']) writeFileSync(join(home, file), '');
      writeFileSync(join(modelDir, 'ggml-base.bin'), '');
      expect(findWhisper({ HOME: home, PATH: home, PATHEXT: '.EXE;.CMD' })).toEqual({
        bin: join(home, 'whisper-cli.exe'),
        ffmpeg: join(home, 'ffmpeg.exe'),
        model: join(modelDir, 'ggml-base.bin'),
        langs: ['pt', 'en'],
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('no Windows ignora wrappers .cmd que execFile não consegue executar', () => {
    if (process.platform !== 'win32') return;
    const home = mkdtempSync(join(tmpdir(), 'habblaud-whisper-wrappers-'));
    try {
      const second = join(home, 'native');
      mkdirSync(second);
      const model = join(home, 'ggml-base.bin');
      writeFileSync(model, 'model');
      writeFileSync(join(home, 'whisper-cli.cmd'), 'echo wrapper');
      writeFileSync(join(home, 'ffmpeg.exe'), 'native');
      const env = { HOME: home, PATH: `${home};${second}`, PATHEXT: '.CMD;.EXE', HABBLAUD_WHISPER_MODEL: model };
      expect(findWhisper(env)).toHaveProperty('missing');
      writeFileSync(join(second, 'whisper-cli.exe'), 'native');
      expect(findWhisper(env)).toMatchObject({ bin: join(second, 'whisper-cli.exe'), ffmpeg: join(home, 'ffmpeg.exe') });
      expect(findWhisper({ ...env, HABBLAUD_WHISPER_BIN: join(home, 'whisper-cli.cmd') })).toHaveProperty('missing');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
