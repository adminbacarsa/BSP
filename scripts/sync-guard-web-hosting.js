/**
 * Copia apps/mobile-guardia/dist-web → destino (build/hosting/app o apps/web2/public/app).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const mobileRoot = path.join(repoRoot, 'apps', 'mobile-guardia');
const distWeb = path.join(mobileRoot, 'dist-web');

function run(cmd, cwd) {
  console.log(`\n▶ ${cmd}`);
  const r = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(`\n✗ Falló: ${cmd}`);
    process.exit(r.status ?? 1);
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

  run('npm run build:web', mobileRoot);
  assertDistWebReady();
  copyDir(distWeb, dest);
}

main();
