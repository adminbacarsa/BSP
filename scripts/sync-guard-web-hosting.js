/**
 * Copia apps/mobile-guardia/dist-web → destino (build/hosting/app o apps/web2/public/app).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const mobileRoot = path.join(repoRoot, 'apps', 'mobile-guardia');
const distWeb = path.join(mobileRoot, 'dist-web');

function run(cmd, cwd, extraEnv = {}) {
  console.log(`\n▶ ${cmd}`);
  const r = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) {
    console.error(`\n✗ Falló: ${cmd}`);
    const err = new Error(`Falló: ${cmd}`);
    err.exitCode = r.status ?? 1;
    throw err;
  }
}

function copyMobileGuardiaEnv(fromRoot, toRoot) {
  const srcDir = path.join(fromRoot, 'apps', 'mobile-guardia');
  const destDir = path.join(toRoot, 'apps', 'mobile-guardia');
  if (path.resolve(srcDir) === path.resolve(destDir)) return;
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(srcDir)) {
    if (name === '.env' || name.startsWith('.env.')) {
      fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
      console.log(`✓ mobile-guardia/${name} → worktree deploy`);
      copied += 1;
    }
  }
  if (copied === 0 && process.env.COSP_LAB_ROOT) {
    console.warn('\n⚠ No hay .env* en apps/mobile-guardia del lab — build:web puede fallar sin EXPO_PUBLIC_*.');
  }
}

function assertDistWebReady() {
  const indexHtml = path.join(distWeb, 'index.html');
  if (!fs.existsSync(distWeb)) {
    console.error(`\n✗ No existe ${distWeb} tras build:web.`);
    process.exit(1);
  }
  if (!fs.existsSync(indexHtml)) {
    console.error(`\n✗ Falta ${indexHtml} — abortando deploy de hosting /app.`);
    process.exit(1);
  }
}

// La clave VAPID de push web es la misma del panel (web2); la app no la trae en su .env.
function readWeb2VapidKey(root) {
  for (const name of ['.env.local', '.env.production.local', '.env']) {
    const p = path.join(root, 'apps', 'web2', name);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^NEXT_PUBLIC_FIREBASE_VAPID_KEY=(.+)$/m);
    if (m && m[1].trim()) return m[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '';
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

function assertNotEmulatorBuild() {
  const files = listFilesRecursive(distWeb).filter((f) => /\.(js|html|json)$/.test(f));
  // La config viaja como JSON escapado dentro del bundle: \"useEmulator\":true
  const hit = files.find((f) => /\\?"useEmulator\\?"\s*:\s*true/.test(fs.readFileSync(f, 'utf8')));
  if (hit) {
    console.error(`\n✗ El build web quedó en modo emulador (${path.relative(repoRoot, hit)}) — abortando deploy.`);
    process.exit(1);
  }
  console.log('✓ build web en modo producción (sin emulador)');
  const hasVapid = files.some((f) => /\\?"vapidKey\\?"\s*:\s*\\?"[A-Za-z0-9_-]{20,}/.test(fs.readFileSync(f, 'utf8')));
  console.log(hasVapid ? '✓ clave VAPID incluida (push web)' : '⚠ bundle sin clave VAPID: /app no recibe push web');
}

function copyDir(src, dest) {
  assertDistWebReady();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  fs.cpSync(src, dest, { recursive: true });
  console.log(`✓ ${path.relative(repoRoot, src)} → ${path.relative(repoRoot, dest)}`);
}

function main() {
  const destArg = process.argv[2];
  const dest = destArg
    ? path.resolve(destArg)
    : path.join(repoRoot, 'build', 'hosting', 'app');

  const labRoot = process.env.COSP_LAB_ROOT || repoRoot;
  copyMobileGuardiaEnv(labRoot, repoRoot);

  // El .env del lab trae USE_EMULATOR=true. Producción = cualquier destino que no sea el
  // public/ del lab (deploy-lib pasa build/hosting/app y COSP_GUARD_WEB_PROD=1).
  const labPublic = path.join(repoRoot, 'apps', 'web2', 'public');
  const isProdDeploy =
    process.env.COSP_GUARD_WEB_PROD === '1' || !destArg || !path.resolve(dest).startsWith(path.resolve(labPublic));
  // Expo toma el .env aunque el proceso traiga la variable: .env.production.local tiene prioridad en export.
  const prodEnvFile = path.join(mobileRoot, '.env.production.local');
  if (isProdDeploy) {
    const lines = ['EXPO_PUBLIC_USE_EMULATOR=false'];
    const vapid = readWeb2VapidKey(labRoot);
    if (vapid) lines.push(`EXPO_PUBLIC_FIREBASE_VAPID_KEY=${vapid}`);
    else console.warn('\n⚠ Sin NEXT_PUBLIC_FIREBASE_VAPID_KEY en apps/web2/.env.local: /app no va a recibir push web.');
    fs.writeFileSync(prodEnvFile, `${lines.join('\n')}\n`);
  }
  try {
    // --clear: la caché de Metro reutiliza el bundle con la config del lab incrustada.
    run(
      isProdDeploy ? 'npm run build:web -- --clear' : 'npm run build:web',
      mobileRoot,
      isProdDeploy ? { EXPO_PUBLIC_USE_EMULATOR: 'false' } : {},
    );
  } finally {
    if (isProdDeploy && fs.existsSync(prodEnvFile)) fs.rmSync(prodEnvFile);
  }
  assertDistWebReady();
  if (isProdDeploy) assertNotEmulatorBuild();
  copyDir(distWeb, dest);
}

try {
  main();
} catch (e) {
  process.exit(e.exitCode ?? 1);
}
