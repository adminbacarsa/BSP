/**
 * Copia packages/hours-core → apps/functions/vendor/hours-core y compila dist ahí.
 * Firebase deploy solo sube apps/functions: el vendor queda dentro de ese árbol.
 * vendor/ está en .gitignore; `npm run build` en functions (prebuild) lo regenera.
 * No hace falta (ni debe) resolver ../../packages desde el runtime de Functions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(repoRoot, 'packages', 'hours-core');
const destRoot = path.join(repoRoot, 'apps', 'functions', 'vendor', 'hours-core');

function skipName(name) {
  return name === 'node_modules' || name === 'dist' || name === '.git';
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (skipName(ent.name)) continue;
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(srcRoot, 'package.json'))) {
  console.error('No existe packages/hours-core');
  process.exit(1);
}

fs.rmSync(destRoot, { recursive: true, force: true });
copyDir(srcRoot, destRoot);

const srcPkg = JSON.parse(fs.readFileSync(path.join(srcRoot, 'package.json'), 'utf8'));
const vendorPkg = {
  name: srcPkg.name || '@cosp/hours-core',
  version: srcPkg.version || '0.1.0',
  private: true,
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': {
      types: './dist/index.d.ts',
      default: './dist/index.js',
    },
  },
};
fs.writeFileSync(path.join(destRoot, 'package.json'), `${JSON.stringify(vendorPkg, null, 2)}\n`);

const tscCandidates = [
  path.join(srcRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(repoRoot, 'apps', 'functions', 'node_modules', 'typescript', 'bin', 'tsc'),
];
const tscJs = tscCandidates.find((p) => fs.existsSync(p));
const args = tscJs
  ? [tscJs, '-p', path.join(destRoot, 'tsconfig.json')]
  : null;

const r = args
  ? spawnSync(process.execPath, args, { cwd: destRoot, stdio: 'inherit' })
  : spawnSync('npx', ['--yes', 'tsc', '-p', path.join(destRoot, 'tsconfig.json')], {
      cwd: destRoot,
      stdio: 'inherit',
      shell: true,
    });

if (r.status !== 0) {
  console.error('sync-hours-core: tsc falló');
  process.exit(r.status ?? 1);
}

const distIndex = path.join(destRoot, 'dist', 'index.js');
if (!fs.existsSync(distIndex)) {
  console.error('sync-hours-core: no quedó dist/index.js');
  process.exit(1);
}

console.log('sync-hours-core: vendor listo en apps/functions/vendor/hours-core (main → dist/index.js)');
