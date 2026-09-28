/**
 * Compila packages/hours-core → dist antes de web2 y de functions.
 * Next (export "default") y cualquier consumidor que no use la condición
 * "development" leen dist/index.js. Si dist queda viejo, se publica el motor anterior.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(repoRoot, 'packages', 'hours-core');
const tsconfig = path.join(pkgDir, 'tsconfig.json');

const tscCandidates = [
  path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(repoRoot, 'apps', 'web2', 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(repoRoot, 'apps', 'functions', 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(pkgDir, 'node_modules', 'typescript', 'bin', 'tsc'),
];
const tscJs = tscCandidates.find((p) => fs.existsSync(p));
if (!tscJs) {
  console.error('build-hours-core: no se encontró typescript/bin/tsc');
  process.exit(1);
}
if (!fs.existsSync(tsconfig)) {
  console.error('build-hours-core: falta packages/hours-core/tsconfig.json');
  process.exit(1);
}

const r = spawnSync(process.execPath, [tscJs, '-p', tsconfig], {
  cwd: pkgDir,
  stdio: 'inherit',
});
if (r.status !== 0) {
  console.error('build-hours-core: tsc falló');
  process.exit(r.status ?? 1);
}
const dist = path.join(pkgDir, 'dist', 'index.js');
if (!fs.existsSync(dist)) {
  console.error('build-hours-core: no quedó packages/hours-core/dist/index.js');
  process.exit(1);
}
console.log('build-hours-core: dist actualizado en packages/hours-core/dist');
