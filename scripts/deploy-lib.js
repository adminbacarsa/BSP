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

/** Parsea .env / .env.local (KEY=VALUE). No exporta al process. */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function mergeEnvFiles(...maps) {
  const out = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m || {})) {
      if (v !== undefined && v !== '') out[k] = v;
    }
  }
  return out;
}

/**
 * Credenciales Expo para build web de producción.
 * Prioridad: env del proceso → mobile-guardia/.env* → map desde web2/.env.local (NEXT_PUBLIC_*).
 */
function resolveMobileWebBuildEnv(projectRoot) {
  const mobileDir = path.join(projectRoot, 'apps', 'mobile-guardia');
  const web2Dir = path.join(projectRoot, 'apps', 'web2');

  const fromMobile = mergeEnvFiles(
    parseEnvFile(path.join(mobileDir, '.env')),
    parseEnvFile(path.join(mobileDir, '.env.local')),
  );
  const fromWeb2 = mergeEnvFiles(
    parseEnvFile(path.join(web2Dir, '.env.emulator')),
    parseEnvFile(path.join(web2Dir, '.env.local')),
  );

  const mapNextToExpo = {
    EXPO_PUBLIC_FIREBASE_API_KEY: 'NEXT_PUBLIC_FIREBASE_API_KEY',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    EXPO_PUBLIC_FIREBASE_APP_ID: 'NEXT_PUBLIC_FIREBASE_APP_ID',
    EXPO_PUBLIC_FIREBASE_VAPID_KEY: 'NEXT_PUBLIC_FIREBASE_VAPID_KEY',
  };

  const resolved = {};
  for (const [expoKey, nextKey] of Object.entries(mapNextToExpo)) {
    resolved[expoKey] =
      (process.env[expoKey] || '').trim() ||
      (fromMobile[expoKey] || '').trim() ||
      (fromWeb2[nextKey] || '').trim() ||
      (fromWeb2[expoKey] || '').trim() ||
      '';
  }

  resolved.EXPO_PUBLIC_USE_EMULATOR = 'false';
  resolved.EXPO_PUBLIC_PORTAL_WEB_ORIGIN =
    (process.env.EXPO_PUBLIC_PORTAL_WEB_ORIGIN || '').trim() ||
    (fromMobile.EXPO_PUBLIC_PORTAL_WEB_ORIGIN || '').trim() ||
    'https://comtroldata.web.app';

  return resolved;
}

function ensureMobileGuardiaDeps(projectRoot) {
  const mobileDir = path.join(projectRoot, 'apps', 'mobile-guardia');
  const nm = path.join(mobileDir, 'node_modules', 'expo');
  if (fs.existsSync(nm)) {
    console.log('✓ apps/mobile-guardia/node_modules presente');
    return;
  }
  console.log('\n▶ npm ci en apps/mobile-guardia (faltaba node_modules) ...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const lock = path.join(mobileDir, 'package-lock.json');
  const args = fs.existsSync(lock) ? ['ci', '--ignore-scripts'] : ['install', '--ignore-scripts'];
  const r = spawnSync(npm, args, {
    cwd: mobileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error('\n✗ Falló npm ci/install en apps/mobile-guardia');
    process.exit(r.status ?? 1);
  }
}

function findJsBundles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) findJsBundles(full, acc);
    else if (name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/**
 * Build Expo web → dist-web y validación dura (abort si falla).
 * Obligatorio cuando se despliega hosting: las redirects /empleado→/app no pueden salir sin /app.
 */
function buildMobileWebPortal(projectRoot) {
  const mobileDir = path.join(projectRoot, 'apps', 'mobile-guardia');
  const mobileDist = path.join(mobileDir, 'dist-web');
  const indexHtml = path.join(mobileDist, 'index.html');

  console.log('\n▶ Build portal guardia web (apps/mobile-guardia → dist-web) ...');
  ensureMobileGuardiaDeps(projectRoot);

  const buildEnv = resolveMobileWebBuildEnv(projectRoot);
  const apiKey = buildEnv.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey || apiKey.length < 10) {
    console.error(
      '\n✗ Firebase incompleto para build:web.\n' +
        '  Falta EXPO_PUBLIC_FIREBASE_API_KEY (o NEXT_PUBLIC_FIREBASE_API_KEY en apps/web2/.env.local).\n' +
        '  Copiá credenciales del lab al worktree (deploy-worktree) o definí apps/mobile-guardia/.env.',
    );
    process.exit(1);
  }

  const vapid = buildEnv.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapid) {
    console.warn(
      '\n⚠ EXPO_PUBLIC_FIREBASE_VAPID_KEY vacía — el portal /app funcionará sin push web.\n' +
        '  Para push: misma clave que NEXT_PUBLIC_FIREBASE_VAPID_KEY en apps/web2/.env.local\n' +
        '  (Firebase Console → Cloud Messaging → Web Push certificates).',
    );
  } else {
    console.log('✓ VAPID key presente (desde mobile .env* o NEXT_PUBLIC_FIREBASE_VAPID_KEY de web2)');
  }

  // Limpiar dist-web previo para no copiar artefactos viejos si el export falla a medias
  if (fs.existsSync(mobileDist)) {
    fs.rmSync(mobileDist, { recursive: true, force: true });
  }

  run('npm run build:web', mobileDir, buildEnv);

  if (!fs.existsSync(indexHtml)) {
    console.error(
      '\n✗ Abort deploy: no existe apps/mobile-guardia/dist-web/index.html tras build:web.\n' +
        '  No se publicarán redirects /empleado → /app sin el portal.',
    );
    process.exit(1);
  }

  const bundles = findJsBundles(path.join(mobileDist, '_expo'));
  if (bundles.length === 0) {
    console.error('\n✗ Abort deploy: dist-web sin bundles JS en _expo/');
    process.exit(1);
  }

  let foundKey = false;
  for (const file of bundles) {
    const chunk = fs.readFileSync(file, 'utf8');
    // La apiKey debe estar embebida (app.config extra.firebase); rechazar placeholder vacío.
    if (chunk.includes(apiKey)) {
      foundKey = true;
      break;
    }
  }
  if (!foundKey) {
    console.error(
      '\n✗ Abort deploy: el bundle de /app no incluye la Firebase apiKey del build.\n' +
        '  Revisá EXPO_PUBLIC_FIREBASE_* / NEXT_PUBLIC_FIREBASE_* en el entorno de export.',
    );
    process.exit(1);
  }
  console.log('✓ dist-web/index.html OK · Firebase apiKey embebida en el bundle');

  return mobileDist;
}

function copyMobileWebToHosting(projectRoot, hosting) {
  const mobileDist = buildMobileWebPortal(projectRoot);
  const hostingApp = path.join(hosting, 'app');

  console.log('\n▶ Copiando apps/mobile-guardia/dist-web → build/hosting/app/ ...');
  fs.rmSync(hostingApp, { recursive: true, force: true });
  fs.mkdirSync(hostingApp, { recursive: true });
  const copyApp =
    process.platform === 'win32'
      ? `robocopy "${mobileDist}" "${hostingApp}" /E /NFL /NDL /NJH /NJS`
      : `rsync -a "${mobileDist}/" "${hostingApp}/"`;
  const copy = spawnSync(copyApp, { stdio: 'inherit', cwd: projectRoot, shell: true });
  if (process.platform === 'win32') {
    if (copy.status !== null && copy.status > 3) {
      console.error('\n✗ Falló la copia de dist-web → hosting/app');
      process.exit(copy.status);
    }
  } else if (copy.status !== 0) {
    console.error('\n✗ Falló la copia de dist-web → hosting/app');
    process.exit(copy.status ?? 1);
  }

  if (!fs.existsSync(path.join(hostingApp, 'index.html'))) {
    console.error('\n✗ Abort deploy: build/hosting/app/index.html no quedó tras la copia');
    process.exit(1);
  }
  console.log('✓ build/hosting/app/ (portal guardia web) listo');
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

  // Portal guardia (Expo web) — obligatorio si hay hosting (redirects /empleado → /app)
  if (flags.withHosting) {
    copyMobileWebToHosting(projectRoot, hosting);
  }

  const targets = [];
  if (flags.withHosting) targets.push('hosting');
  if (withFunctions) targets.push('functions');
  if (withRules) targets.push('firestore:rules');

  if (!targets.length) {
    console.error('\n✗ Sin objetivos de deploy. Usá npm run deploy:functions o npm run deploy -- --functions');
    process.exit(1);
  }

  run(`firebase deploy --only "${targets.join(',')}" --force`, projectRoot);

  console.log('\n✅ Deploy OK.');
  if (projectRoot !== path.join(__dirname, '..')) {
    console.log(`   Carpeta lab (${path.join(__dirname, '..')}) no ejecutó build ni firebase deploy.`);
  }
}

module.exports = { runDeploy, labIsActive, isPortListening, buildMobileWebPortal, resolveMobileWebBuildEnv };
