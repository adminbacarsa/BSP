#!/usr/bin/env node
/**
 * Deploy en carpeta separada (git worktree) para no interferir con el lab local.
 * Default: ../cronoapp-deploy (hermano de cronoapp).
 * Rama: la rama actual del lab (HEAD), salvo COSP_DEPLOY_BRANCH=...
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runDeploy } = require('./deploy-lib');
const { parseDeployFlags, logDeployPlan } = require('./deploy-flags');

const LAB_ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flags = parseDeployFlags(args);
const DEPLOY_DIR = process.env.COSP_DEPLOY_DIR || path.join(LAB_ROOT, '..', 'cronoapp-deploy');

function git(cmd, cwd = LAB_ROOT) {
  const r = spawnSync(`git ${cmd}`, { cwd, shell: true, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }
  return (r.stdout || '').trim();
}

function gitTry(cmd, cwd = LAB_ROOT) {
  const r = spawnSync(`git ${cmd}`, { cwd, shell: true, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

/** Rama a desplegar: COSP_DEPLOY_BRANCH o la rama actual del lab (no main fijo). */
function resolveDeployBranch() {
  if (process.env.COSP_DEPLOY_BRANCH?.trim()) {
    return process.env.COSP_DEPLOY_BRANCH.trim();
  }
  const branch = gitTry('rev-parse --abbrev-ref HEAD', LAB_ROOT);
  if (!branch || branch === 'HEAD') {
    console.error('\n✗ Deploy: HEAD detached. Hacé checkout a una rama o definí COSP_DEPLOY_BRANCH.\n');
    process.exit(1);
  }
  return branch;
}

/** Ref exacta a buildear: HEAD del lab si es la misma rama; si no, origin/rama. */
function resolveDeployRef(branch) {
  const explicitBranch = !!process.env.COSP_DEPLOY_BRANCH?.trim();
  git(`fetch origin ${branch}`, LAB_ROOT);

  if (!explicitBranch) {
    const labBranch = gitTry('rev-parse --abbrev-ref HEAD', LAB_ROOT);
    const labSha = gitTry('rev-parse HEAD', LAB_ROOT);
    if (labBranch === branch && labSha) {
      const dirty = gitTry('status --porcelain', LAB_ROOT);
      if (dirty) {
        console.warn('\n⚠ Cambios sin commitear en el lab — el deploy usa el último commit (git HEAD), no el working tree.\n');
      }
      const ahead = gitTry(`rev-list --count origin/${branch}..HEAD`, LAB_ROOT);
      if (ahead && ahead !== '0') {
        console.log(`▶ Lab ${ahead} commit(s) adelante de origin/${branch} — deploy desde HEAD local (${labSha.slice(0, 7)}).\n`);
      }
      return labSha;
    }
  }

  const remoteSha = gitTry(`rev-parse origin/${branch}`, LAB_ROOT);
  if (!remoteSha) {
    console.error(`\n✗ No existe origin/${branch}. Hacé push antes del deploy o usá la rama actual desde el lab.\n`);
    process.exit(1);
  }
  return `origin/${branch}`;
}

const BRANCH = resolveDeployBranch();
const DEPLOY_REF = resolveDeployRef(BRANCH);

function normalizeDeployPath(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function ensureWorktree() {
  const list = git('worktree list --porcelain');
  const deployNorm = normalizeDeployPath(DEPLOY_DIR);
  const hasDeploy = list.split('\n').some((line) => {
    if (!line.startsWith('worktree ')) return false;
    return normalizeDeployPath(line.slice('worktree '.length).trim()) === deployNorm;
  });

  if (!fs.existsSync(DEPLOY_DIR)) {
    console.log(`\n▶ Creando worktree de deploy en ${DEPLOY_DIR} ...`);
    git(`worktree add --detach "${DEPLOY_DIR}" ${DEPLOY_REF}`, LAB_ROOT);
    return;
  }

  if (!hasDeploy) {
    console.log(`\n▶ Registrando worktree en ${DEPLOY_DIR} ...`);
    git(`worktree add --detach "${DEPLOY_DIR}" ${DEPLOY_REF}`, LAB_ROOT);
    return;
  }

  console.log(`\n▶ Actualizando worktree ${DEPLOY_DIR} ...`);
  git(`reset --hard ${DEPLOY_REF}`, DEPLOY_DIR);
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
console.log(` Rama:   ${BRANCH} → ${DEPLOY_REF}`);
console.log('═══════════════════════════════════════════════════════');

logDeployPlan(flags, { label: 'COSP deploy (worktree)' });
if (flags.dryRun) process.exit(0);

ensureWorktree();

console.log('\n▶ npm install en worktree de deploy ...');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// --ignore-scripts evita que el postinstall del root llame npm --prefix apps/web2 install
// dentro del proceso npm ya en curso (loop infinito en Windows con postinstall recursivo).
const install = spawnSync(npm, ['install', '--ignore-scripts'], {
  cwd: DEPLOY_DIR,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (install.status !== 0) process.exit(install.status ?? 1);
// Instalar deps de web2 directamente en su carpeta (sin --prefix para no re-disparar root postinstall)
const web2Dir = path.join(DEPLOY_DIR, 'apps', 'web2');
console.log('\n▶ npm install apps/web2 ...');
const installWeb2 = spawnSync(npm, ['install', '--ignore-scripts'], {
  cwd: web2Dir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (installWeb2.status !== 0) process.exit(installWeb2.status ?? 1);

const deployFunctions = flags.withFunctions;
if (deployFunctions) {
  const functionsDir = path.join(DEPLOY_DIR, 'apps', 'functions');
  console.log('\n▶ npm install apps/functions ...');
  const installFunctions = spawnSync(npm, ['install', '--ignore-scripts'], {
    cwd: functionsDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (installFunctions.status !== 0) process.exit(installFunctions.status ?? 1);
}

syncEnvLocal();
runDeploy(DEPLOY_DIR, args);
