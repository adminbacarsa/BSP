#!/usr/bin/env node
/**
 * Deploy a producción: cambia env → build → firebase deploy hosting → restaura env → limpia .next
 * Uso: npm run deploy  (desde la raíz del repo)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '../apps/web2/.env.local');
const nextDir = path.join(__dirname, '../apps/web2/.next');

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

function replaceInFile(file, from, to) {
  const content = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, content.replace(from, to), 'utf8');
}

let restored = false;
function restoreEnv() {
  if (restored) return;
  restored = true;
  try { replaceInFile(envFile, 'USE_EMULATOR=false', 'USE_EMULATOR=true'); } catch {}
  console.log('✓ USE_EMULATOR restaurado a true');
}

process.on('exit', restoreEnv);
process.on('SIGINT', () => { restoreEnv(); process.exit(1); });
process.on('uncaughtException', (e) => { console.error(e); restoreEnv(); process.exit(1); });

try {
  replaceInFile(envFile, 'USE_EMULATOR=true', 'USE_EMULATOR=false');
  console.log('✓ USE_EMULATOR=false');

  run('npm --prefix apps/web2 run build');
  run('firebase deploy --only hosting');

  restoreEnv();

  // Limpiar .next para que el dev server no quede roto
  fs.rmSync(nextDir, { recursive: true, force: true });
  console.log('✓ .next limpiado — podés correr npm run dev normalmente');
} catch (e) {
  restoreEnv();
  process.exit(1);
}
