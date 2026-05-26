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
const path = require('path');

const ROOT = path.join(__dirname, '..');
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
// - .next-prod/ recibe los artefactos de producción (webpack cache, etc.)
// - apps/web2/out/ sigue siendo el directorio de export estático para Firebase
run('npm --prefix apps/web2 run build', {
  NEXT_PUBLIC_USE_EMULATOR: 'false',
  NEXT_DIST_DIR: '.next-prod',
});

// Deploy selectivo según flags
const targets = ['hosting'];
if (withFunctions) targets.push('functions');
if (withRules)     targets.push('firestore:rules');

run(`firebase deploy --only ${targets.join(',')}`);

console.log('\n✅ Deploy OK — el dev server y los emuladores siguen corriendo sin cambios.');
