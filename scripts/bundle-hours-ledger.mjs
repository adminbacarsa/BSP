/**
 * Empaqueta el motor del libro para Firebase Functions.
 * npx esbuild (no agrega dependencia al repo).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'apps/functions/src/hoursLedger/bundledEngine.js');
const alias = `@=${path.join(root, 'apps/web2/src').replace(/\\/g, '/')}`;
const args = [
  '--yes', 'esbuild',
  path.join(root, 'scripts/hours-ledger/engineEntry.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  `--outfile=${outfile}`,
  `--alias:${alias}`,
  '--external:firebase-admin',
  '--external:firebase-functions',
  '--legal-comments=none',
];
const r = spawnSync('npx', args, { stdio: 'inherit', cwd: root, shell: true });
if (r.status !== 0) process.exit(r.status || 1);
const kb = Math.round(fs.statSync(outfile).size / 1024);
console.log(`hours-ledger bundle ${kb} KB`);
