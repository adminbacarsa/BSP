import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps/functions/src/hoursLedger/bundledEngine.js');
const destDir = path.join(root, 'apps/functions/lib/hoursLedger');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'bundledEngine.js'));
console.log('hours-ledger bundle copiado a functions/lib');
