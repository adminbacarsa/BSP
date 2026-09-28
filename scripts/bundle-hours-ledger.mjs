/**
 * Empaqueta el motor del libro para Firebase Functions.
 * npx esbuild (no agrega dependencia al repo).
 *
 * El motor tiene que ser PURO: nada del SDK cliente de Firebase puede entrar al bundle.
 * En Functions no existe NEXT_PUBLIC_FIREBASE_API_KEY y `initializeApp` del cliente
 * tumba el cron con `auth/invalid-api-key`. Si aparece, el build FALLA.
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

const FORBIDDEN = [
  'firebase/app',
  'firebase/firestore',
  'firebase/auth',
  'firebase/functions',
  'firebase/storage',
  '@firebase/',
  'node_modules/firebase/',
  'initializeApp(',
  'apps/web2/src/lib/firebase.ts',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
];
const source = fs.readFileSync(outfile, 'utf8');
const hits = FORBIDDEN.filter((needle) => source.includes(needle));
if (hits.length) {
  fs.unlinkSync(outfile);
  console.error('hours-ledger bundle: el motor arrastra el SDK cliente de Firebase. Cortá la dependencia.');
  for (const h of hits) {
    const idx = source.indexOf(h);
    const line = source.slice(0, idx).split('\n').length;
    console.error(`  - "${h}" (línea ${line})`);
  }
  process.exit(1);
}

const kb = Math.round(fs.statSync(outfile).size / 1024);
console.log(`hours-ledger bundle ${kb} KB (sin SDK cliente de Firebase)`);
