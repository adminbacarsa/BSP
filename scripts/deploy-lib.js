/**
 * Lógica compartida de deploy (hosting build + firebase).
 * Artefactos de producción en build/ — no toca apps/web2/out ni .next del dev server.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseDeployFlags, logDeployPlan } = require('./deploy-flags');

function isPortListening(port) {
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true });
    const out = r.stdout || '';
    return out.split('\n').some((line) => line.includes(`:${port}`) && line.includes('LISTENING'));
  }
  const r = spawnSync('ss', ['-tln'], { encoding: 'utf8' });
  return (r.stdout || '').includes(`:${port}`);
}

const DEV_PORT = Number(process.env.COSP_DEV_PORT) || 3001;

function labIsActive() {
  return isPortListening(8080) || isPortListening(9099) || isPortListening(DEV_PORT) || isPortListening(3000);
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
 * @param {string[]} args — flags: --functions, --rules, --all (ver deploy-flags.js)
 */
function runDeploy(projectRoot, args = []) {
  const flags = parseDeployFlags(args);
  if (flags.dryRun) {
    logDeployPlan(flags);
    return;
  }

  const web2 = path.join(projectRoot, 'apps', 'web2');
  const buildRoot = path.join(projectRoot, 'build');
  const dist = path.join(buildRoot, '.next-prod');
  const hosting = path.join(buildRoot, 'hosting');

  const withFunctions = flags.withFunctions;
  const withRules = flags.withRules;

  fs.mkdirSync(buildRoot, { recursive: true });

  // Evita ENOENT en Windows cuando Next intenta unlink sobre un .next a medias (AV / dev server).
  for (const dir of [dist, path.join(web2, '.next')]) {
    if (fs.existsSync(dir)) {
      console.log(`\n▶ Limpiando ${path.relative(projectRoot, dir).replace(/\\/g, '/')} ...`);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }

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

  console.log('\n▶ Portal guardia web (Expo) → build/hosting/app ...');
  const syncGuard = spawnSync(
    process.execPath,
    [path.join(__dirname, 'sync-guard-web-hosting.js'), path.join(hosting, 'app')],
    { stdio: 'inherit', cwd: projectRoot, env: { ...process.env, COSP_GUARD_WEB_PROD: '1' } },
  );
  if (syncGuard.status !== 0) {
    console.error('\n✗ Falló sync-guard-web-hosting (mobile-guardia build:web)');
    process.exit(syncGuard.status ?? 1);
  }

  const targets = [];
  if (flags.withHosting) targets.push('hosting');
  if (withFunctions) targets.push('functions');
  if (withRules) targets.push('firestore:rules');

  if (!targets.length) {
    console.error('\n✗ Sin objetivos de deploy. Usá npm run deploy:functions o npm run deploy -- --functions');
    process.exit(1);
  }

  // Hosting en un comando aparte: con muchas functions el CLI puede agotar cuota y no llegar a publicarlo.
  const nonHosting = targets.filter((t) => t !== 'hosting');
  if (nonHosting.length) run(`firebase deploy --only "${nonHosting.join(',')}" --force`, projectRoot);
  if (flags.withHosting) run('firebase deploy --only hosting --force', projectRoot);

  // El CLI puede salir con 0 sin publicar el hosting (visto con errores de cuota en functions):
  // se compara el bundle de /app publicado con el recién compilado.
  if (flags.withHosting) verifyHostingReleased(projectRoot);

  console.log('\n✅ Deploy OK.');
  if (projectRoot !== path.join(__dirname, '..')) {
    console.log(`   Carpeta lab (${path.join(__dirname, '..')}) no ejecutó build ni firebase deploy.`);
  }
}

function verifyHostingReleased(projectRoot) {
  const localIndex = path.join(projectRoot, 'build', 'hosting', 'app', 'index.html');
  if (!fs.existsSync(localIndex)) return;
  const entryRe = /entry-[a-f0-9]+\.js/;
  const expected = (fs.readFileSync(localIndex, 'utf8').match(entryRe) || [])[0];
  if (!expected) return;
  const url = `https://comtroldata.web.app/app/?deploycheck=${Date.now()}`;
  const probe = spawnSync(
    process.execPath,
    ['-e', `fetch(${JSON.stringify(url)}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(2))`],
    { encoding: 'utf8' },
  );
  const published = ((probe.stdout || '').match(entryRe) || [])[0];
  if (published !== expected) {
    console.error(
      `\n✗ El hosting no quedó publicado: /app sirve ${published || '(sin respuesta)'} y el build es ${expected}.\n` +
        '  Reintentá solo hosting: npm run deploy',
    );
    process.exit(1);
  }
  console.log(`✓ Hosting publicado (/app → ${expected})`);
  const bundleUrl = `https://comtroldata.web.app/app/_expo/static/js/web/${expected}`;
  const bundleProbe = spawnSync(
    process.execPath,
    ['-e', `fetch(${JSON.stringify(bundleUrl)}).then(r=>r.text()).then(t=>process.stdout.write(/useEmulator\\W{0,4}true/.test(t)?'EMU':'PROD')).catch(()=>process.exit(2))`],
    { encoding: 'utf8' },
  );
  if (String(bundleProbe.stdout || '') !== 'PROD') {
    console.error(`\n✗ /app publicado apunta al EMULADOR (${bundleProbe.stdout || 'sin respuesta'}). Redeploy urgente de hosting.`);
    process.exit(1);
  }
  console.log('✓ /app publicado en modo producción');
  verifyAppAssetServed(projectRoot);
}

// Un asset que falta se responde con el index.html del rewrite /app/** → hay que mirar el content-type.
function verifyAppAssetServed(projectRoot) {
  const assetsDir = path.join(projectRoot, 'build', 'hosting', 'app', 'assets');
  if (!fs.existsSync(assetsDir)) return;
  const stack = [assetsDir];
  let sample = null;
  while (stack.length && !sample) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (/\.(ttf|png)$/.test(entry.name)) { sample = p; break; }
    }
  }
  if (!sample) return;
  const rel = path.relative(path.join(projectRoot, 'build', 'hosting'), sample).split(path.sep).join('/');
  const url = `https://comtroldata.web.app/${rel}`;
  const probe = spawnSync(
    process.execPath,
    ['-e', `fetch(${JSON.stringify(url)}).then(r=>process.stdout.write(r.headers.get('content-type')||'')).catch(()=>process.exit(2))`],
    { encoding: 'utf8' },
  );
  const type = String(probe.stdout || '');
  if (!type || type.includes('text/html')) {
    console.error(`\n✗ Asset de /app no publicado (${rel} devuelve ${type || 'sin respuesta'}): revisá "ignore" en firebase.json.`);
    process.exit(1);
  }
  console.log(`✓ Assets de /app publicados (${type})`);
}

module.exports = { runDeploy, labIsActive, isPortListening, verifyHostingReleased };
