#!/usr/bin/env node
/**
 * Corre tsc sobre todo src/ (pages y components incluidos) y falla solo con errores
 * de símbolo inexistente: variables, tipos, namespaces o módulos que no existen.
 * El resto de errores de tipos del legacy no frena el CI.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const WEB2_ROOT = path.join(__dirname, '..');

// TS2304/TS2552 nombre inexistente · TS2503 namespace · TS2307 módulo · TS2451 redeclaración · TS2686/TS18004 uso inválido
const BLOCKING_CODES = ['TS2304', 'TS2552', 'TS2503', 'TS2307', 'TS2451', 'TS2686', 'TS18004'];
const BLOCKING_RE = new RegExp(`error (${BLOCKING_CODES.join('|')}):`);

const tsc = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '-p', 'tsconfig.names.json'],
  { cwd: WEB2_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
);

const output = `${tsc.stdout || ''}${tsc.stderr || ''}`;
const offenders = output
  .split(/\r?\n/)
  .filter((line) => line.startsWith('src/') && BLOCKING_RE.test(line));

if (offenders.length > 0) {
  console.error('\n✗ Símbolos inexistentes (crashean en runtime aunque el build pase):\n');
  offenders.forEach((line) => console.error(`  ${line}`));
  console.error(`\n  Total: ${offenders.length}\n`);
  process.exit(1);
}

if (tsc.status !== 0 && !output.includes('error TS')) {
  console.error(output || 'tsc falló sin salida.');
  process.exit(tsc.status ?? 1);
}

console.log('✓ Sin símbolos inexistentes en src/ (pages, components, hooks, lib, services).');
