#!/usr/bin/env node
/**
 * Deploy a producción sin tocar .env.local ni interrumpir el dev server.
 * USE_EMULATOR=false se inyecta solo en el proceso de build — el emulador
 * y el dev server en :3000 siguen corriendo sin cambios.
 *
 * Uso: npm run deploy              → solo hosting
 *      npm run deploy --functions  → hosting + functions
 *      npm run deploy --rules      → hosting + firestore:rules
 *      npm run deploy --all        → hosting + functions + rules
 */
const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const WEB2    = path.join(ROOT, 'apps', 'web2');
const DIST    = path.join(WEB2, '.next-prod');
const OUT     = path.join(WEB2, 'out');

const args = process.argv.slice(2);
const withFunctions = args.includes('--functions') || args.includes('--all');
const withRules     = args.includes('--rules')     || args.includes('--all');

function run(cmd, env = {}) {
  console.log(`\n▶ ${cmd}`);
  const result = spawnSync(cmd, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`\n✗ Falló: ${cmd}`);
    process.exit(result.status ?? 1);
  }
}

// Build con USE_EMULATOR=false y NEXT_DIST_DIR=.next-prod:
// - .next/ (dev server) NO se toca — localhost:3000 sigue corriendo
// - .next-prod/ recibe los artefactos de build + el export estático
run('npm --prefix apps/web2 run build', {
  NEXT_PUBLIC_USE_EMULATOR: 'false',
  NEXT_DIST_DIR: '.next-prod',
});

// Con NEXT_DIST_DIR=.next-prod, Next.js escribe el export estático en .next-prod/
// en vez de out/. Firebase deploya desde out/, así que sincronizamos ahora.
// Usamos robocopy (Windows) — copia todo excepto el cache interno de Next.js.
console.log('\n▶ Sincronizando .next-prod/ → out/ ...');
fs.mkdirSync(OUT, { recursive: true });
const syncCmd = process.platform === 'win32'
  ? `robocopy "${DIST}" "${OUT}" /E /PURGE /XD "${path.join(DIST, 'cache')}" /NFL /NDL /NJH /NJS`
  : `rsync -a --delete --exclude='cache/' "${DIST}/" "${OUT}/"`;
const sync = spawnSync(syncCmd, { stdio: 'inherit', cwd: ROOT, shell: true });
// robocopy devuelve 0-3 para éxito (0=sin cambios, 1=copiado, 3=copiado+extras)
if (sync.status !== null && sync.status > 3) {
  console.error('\n✗ Falló la sincronización de out/');
  process.exit(sync.status);
}
console.log('✓ out/ actualizado');

// Deploy selectivo según flags
const targets = ['hosting'];
if (withFunctions) targets.push('functions');
if (withRules)     targets.push('firestore:rules');

run(`firebase deploy --only "${targets.join(',')}" --force`);

console.log('\n✅ Deploy OK — el dev server y los emuladores siguen corriendo sin cambios.');
