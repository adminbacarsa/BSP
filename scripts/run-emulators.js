/**
 * Firebase Emulator Suite con JDK 21+. Import opcional si backups/latest tiene datos.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function logErr(...parts) {
  process.stderr.write(parts.join(' ') + '\n');
}

function javaExe(home) {
  return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

function isJava21Plus(home) {
  const exe = javaExe(home);
  if (!fs.existsSync(exe)) return false;
  const out = spawnSync(exe, ['-version'], { encoding: 'utf8' });
  const ver = `${out.stderr || out.stdout || ''}`;
  return /version "21/.test(ver) || /version "2[2-9]/.test(ver);
}

function findJdk21Home() {
  if (process.env.JAVA_HOME21 && isJava21Plus(process.env.JAVA_HOME21)) return process.env.JAVA_HOME21;
  if (process.env.JAVA_HOME && isJava21Plus(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

  const bases =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java']
      : ['/usr/lib/jvm', '/usr/local'];

  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    const candidateNames = (d) => {
      if (!d.isDirectory()) return false;
      const n = d.name;
      if (process.platform === 'win32') return /^jdk-21/i.test(n);
      return /(^|-)21(\.|$)/.test(n) && /java|jdk|openjdk|temurin/i.test(n);
    };
    const jdkDirs = entries.filter(candidateNames).map((d) => path.join(base, d.name)).sort();
    for (const dir of jdkDirs) {
      if (isJava21Plus(dir)) return dir;
    }
  }
  return null;
}

const jdkHome = findJdk21Home();
const env = { ...process.env };
const sep = process.platform === 'win32' ? ';' : ':';
/** El emulador de Functions en Windows suele invocar `node` sin PATH; forzamos el mismo Node que ejecuta este script. */
const nodeBinDir = path.dirname(process.execPath);

if (jdkHome) {
  env.JAVA_HOME = jdkHome;
  env.PATH = `${path.join(jdkHome, 'bin')}${sep}${nodeBinDir}${sep}${env.PATH || ''}`;
  logErr(`[emulators] JAVA_HOME=${jdkHome}`);
  logErr(`[emulators] PATH (prefijo JDK + Node)=...${nodeBinDir}`);
} else {
  logErr('No se encontró JDK 21+. winget install EclipseAdoptium.Temurin.21.JDK o JAVA_HOME21.');
  process.exit(1);
}

const skipFunctions =
  process.argv.includes('--without-functions') || process.env.COSP_EMULATORS_NO_FUNCTIONS === '1';

const backupsDir = path.join(projectRoot, 'backups');
const latestDir = path.join(backupsDir, 'latest');
fs.mkdirSync(backupsDir, { recursive: true });

let hasImport = false;
try {
  if (fs.existsSync(latestDir) && fs.statSync(latestDir).isDirectory()) {
    hasImport = fs.readdirSync(latestDir).length > 0;
  }
} catch {
  hasImport = false;
}

const emulatorArgs = ['emulators:start'];
if (skipFunctions) {
  emulatorArgs.push('--only', 'auth,firestore,ui');
  logErr('[emulators] Sin Functions (--without-functions o COSP_EMULATORS_NO_FUNCTIONS=1)');
}
if (hasImport) {
  emulatorArgs.push('--import=./backups/latest');
  logErr('[emulators] Import backups/latest');
} else {
  logErr('[emulators] Sin datos en backups/latest (Firestore vacío al inicio)');
}
emulatorArgs.push('--export-on-exit=./backups/latest');

const firebaseJs = path.join(projectRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
let r;
if (fs.existsSync(firebaseJs)) {
  r = spawnSync(process.execPath, [firebaseJs, ...emulatorArgs], {
    stdio: 'inherit',
    env,
    cwd: projectRoot,
  });
} else {
  logErr('[emulators] Instalá dependencias: npm install (firebase-tools en la raíz)');
  r = spawnSync('npx', ['--yes', 'firebase-tools', ...emulatorArgs], {
    stdio: 'inherit',
    env,
    cwd: projectRoot,
    shell: true,
  });
}

process.exit(r && r.status !== null && r.status !== undefined ? r.status : 1);
