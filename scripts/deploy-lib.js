/**
 * Lógica compartida de deploy (hosting build + firebase).
 * Artefactos de producción en build/ — no toca apps/web2/out ni .next del dev server.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function isPortListening(port) {
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true });
    const out = r.stdout || '';
    return out.split('\n').some((line) => line.includes(`:${port}`) && line.includes('LISTENING'));
  }
  const r = spawnSync('ss', ['-tln'], { encoding: 'utf8' });
  return (r.stdout || '').includes(`:${port}`);
}

function labIsActive() {
  return isPortListening(8080) || isPortListening(9099) || isPortListening(3000);
}

function run(cmd, cwd, env = {}) {
  console.log(`\n▶ ${cmd}`);
  const result = spawnSync(cmd, {
    stdio: 'inherit',
    cwd,
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`\n✗ Falló: ${cmd}`);
    process.exit(result.status ?? 1);
  }
}

/**
 * @param {string} projectRoot — raíz del repo donde correr build + firebase
 * @param {string[]} args — flags: --functions, --rules, --all
 */
function runDeploy(projectRoot, args = []) {
  const web2 = path.join(projectRoot, 'apps', 'web2');
  const buildRoot = path.join(projectRoot, 'build');
  const dist = path.join(buildRoot, '.next-prod');
  const hosting = path.join(buildRoot, 'hosting');

  const withFunctions = args.includes('--functions') || args.includes('--all');
  const withRules = args.includes('--rules') || args.includes('--all');

  fs.mkdirSync(buildRoot, { recursive: true });

  // Build prod en build/.next-prod — apps/web2/.next (dev) no se toca
  run('npm --prefix apps/web2 run build', projectRoot, {
    NEXT_PUBLIC_USE_EMULATOR: 'false',
    NEXT_DIST_DIR: path.relative(web2, dist).replace(/\\/g, '/'),
  });

  console.log('\n▶ Sincronizando build/.next-prod/ → build/hosting/ ...');
  fs.mkdirSync(hosting, { recursive: true });
  const syncCmd =
    process.platform === 'win32'
      ? `robocopy "${dist}" "${hosting}" /E /PURGE /XD "${path.join(dist, 'cache')}" /NFL /NDL /NJH /NJS`
      : `rsync -a --delete --exclude='cache/' "${dist}/" "${hosting}/"`;
  const sync = spawnSync(syncCmd, { stdio: 'inherit', cwd: projectRoot, shell: true });
  if (sync.status !== null && sync.status > 3) {
    console.error('\n✗ Falló la sincronización de build/hosting/');
    process.exit(sync.status);
  }
  console.log('✓ build/hosting/ actualizado');

  const targets = ['hosting'];
  if (withFunctions) targets.push('functions');
  if (withRules) targets.push('firestore:rules');

  run(`firebase deploy --only "${targets.join(',')}" --force`, projectRoot);

  console.log('\n✅ Deploy OK.');
  if (projectRoot !== path.join(__dirname, '..')) {
    console.log(`   Carpeta lab (${path.join(__dirname, '..')}) no ejecutó build ni firebase deploy.`);
  }
}

module.exports = { runDeploy, labIsActive, isPortListening };
