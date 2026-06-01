#!/usr/bin/env node
/**
 * Deploy en carpeta separada (git worktree) para no interferir con el lab local.
 * Default: ../cronoapp-deploy (hermano de cronoapp).
 *
 * Uso: node scripts/deploy-worktree.js [--functions] [--rules] [--all]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runDeploy } = require('./deploy-lib');

const LAB_ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2).filter((a) => a.startsWith('--'));
const DEPLOY_DIR = process.env.COSP_DEPLOY_DIR || path.join(LAB_ROOT, '..', 'cronoapp-deploy');
const BRANCH = process.env.COSP_DEPLOY_BRANCH || 'main';

function git(cmd, cwd = LAB_ROOT) {
  const r = spawnSync(`git ${cmd}`, { cwd, shell: true, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }
  return (r.stdout || '').trim();
}

function ensureWorktree() {
  const list = git('worktree list --porcelain');
  const hasDeploy = list.split('\n').some((line) => line.startsWith('worktree ') && line.includes(DEPLOY_DIR));

  if (!fs.existsSync(DEPLOY_DIR)) {
    console.log(`\n▶ Creando worktree de deploy en ${DEPLOY_DIR} ...`);
    git(`worktree add "${DEPLOY_DIR}" ${BRANCH}`);
    return;
  }

  if (!hasDeploy) {
    console.log(`\n▶ Registrando worktree en ${DEPLOY_DIR} ...`);
    git(`worktree add "${DEPLOY_DIR}" ${BRANCH}`);
    return;
  }

  console.log(`\n▶ Actualizando worktree ${DEPLOY_DIR} ...`);
  git('fetch origin', LAB_ROOT);
  git(`reset --hard origin/${BRANCH}`, DEPLOY_DIR);
}

function syncEnvLocal() {
  const src = path.join(LAB_ROOT, 'apps', 'web2', '.env.local');
  const dest = path.join(DEPLOY_DIR, 'apps', 'web2', '.env.local');
  if (!fs.existsSync(src)) {
    console.warn('\n⚠ No hay apps/web2/.env.local en el lab — el build en deploy puede fallar sin credenciales Firebase.');
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('✓ .env.local copiado al worktree de deploy (solo credenciales de build, USE_EMULATOR=false en build).');
}

console.log('═══════════════════════════════════════════════════════');
console.log(' COSP — Deploy aislado (worktree)');
console.log(` Lab:    ${LAB_ROOT}`);
console.log(` Deploy: ${DEPLOY_DIR}`);
console.log('═══════════════════════════════════════════════════════');

ensureWorktree();

console.log('\n▶ npm install en worktree de deploy ...');
const install = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], {
  cwd: DEPLOY_DIR,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (install.status !== 0) process.exit(install.status ?? 1);

syncEnvLocal();
runDeploy(DEPLOY_DIR, args);
