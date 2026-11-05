import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeBinFrom, runnableClaudeBin } from './claude-bin';

describe('binário do Claude no Windows', () => {
  it('resolve o shim npm para o executável real, sem executar o .cmd pelo shell', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-claude-bin-'));
    try {
      const pkg = join(root, 'node_modules', '@anthropic-ai', 'claude-code');
      const exe = join(pkg, 'bin', 'claude.exe');
      const shim = join(root, 'claude.cmd');
      mkdirSync(join(pkg, 'bin'), { recursive: true });
      writeFileSync(shim, '@echo off\n');
      writeFileSync(exe, '');
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { claude: 'bin/claude.exe' } }));
      const env = { HABBLAUD_CLAUDE_BIN: shim };
      expect(claudeBinFrom(env, 'win32')).toBe(exe);
      expect(runnableClaudeBin(env, 'win32')).toBe(exe);
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { claude: '../../outro.exe' } }));
      expect(claudeBinFrom(env, 'win32')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('shim sem pacote correspondente não é tratado como executável', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-claude-bin-'));
    try {
      const shim = join(root, 'claude.cmd');
      writeFileSync(shim, '@echo off\n');
      expect(runnableClaudeBin({ HABBLAUD_CLAUDE_BIN: shim }, 'win32')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
