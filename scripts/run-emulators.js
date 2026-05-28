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
  return /version "(2[1-9]|[3-9]\d)/.test(ver);
}

function findJdk21Home() {
  if (process.env.JAVA_HOME21 && isJava21Plus(process.env.JAVA_HOME21)) return process.env.JAVA_HOME21;
  if (process.env.JAVA_HOME && isJava21Plus(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const bases =
    process.platform === 'win32'
      ? [
          path.join(userHome, 'AppData', 'Local', 'Programs', 'Eclipse Adoptium'),
          'C:\\Program Files\\Eclipse Adoptium',
          'C:\\Program Files\\Java',
        ]
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
      if (process.platform === 'win32') return /^jdk-(2[1-9]|[3-9]\d)/i.test(n);
      return /(^|-)2[1-9](\.|$)/.test(n) && /java|jdk|openjdk|temurin/i.test(n);
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
  // Heap fijo para evitar que el emulador de Firestore (JVM) crashee con exit 4294967295
  env.JAVA_TOOL_OPTIONS = (env.JAVA_TOOL_OPTIONS || '') + ' -Xms128m -Xmx768m -XX:+UseG1GC';
  logErr('[emulators] JAVA_TOOL_OPTIONS: heap 128m–768m, G1GC');
} else {
  logErr('No se encontró JDK 21+. winget install EclipseAdoptium.Temurin.21.JDK o JAVA_HOME21.');
  process.exit(1);
}

/** En Windows, Cursor/shells a veces ejecutan node sin npm en PATH; priorizamos Node instalado en Program Files. */
if (process.platform === 'win32') {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const sysNode = path.join(pf, 'nodejs');
  if (fs.existsSync(path.join(sysNode, 'npm.cmd'))) {
    env.PATH = `${sysNode}${sep}${env.PATH || ''}`;
    logErr(`[emulators] PATH+: ${sysNode} (npm/npx del sistema)`);
  }
}

const skipFunctions =
  process.argv.includes('--without-functions') || process.env.COSP_EMULATORS_NO_FUNCTIONS === '1';

const functionsDir = path.join(projectRoot, 'apps', 'functions');

function functionsEnvHasGeminiKey() {
  for (const name of ['.env', '.env.local']) {
    const p = path.join(functionsDir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const text = fs.readFileSync(p, 'utf8');
      const m = text.match(/^\s*GEMINI_API_KEY\s*=\s*(\S+)/m);
      if (m && m[1] && m[1] !== 'your-key-here') return true;
    } catch {
      /* ignore */
    }
  }
  return Boolean((process.env.GEMINI_API_KEY || '').trim());
}

if (!skipFunctions) {
  for (const name of ['.env', '.env.local']) {
    const p = path.join(functionsDir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const text = fs.readFileSync(p, 'utf8');
      const m = text.match(/^\s*GEMINI_API_KEY\s*=\s*(\S+)/m);
      if (m && m[1] && m[1] !== 'your-key-here') {
        env.GEMINI_API_KEY = m[1].trim();
        logErr('[emulators] GEMINI_API_KEY inyectada en env del proceso Functions');
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!functionsEnvHasGeminiKey()) {
    logErr(
      '[emulators] AVISO: sin GEMINI_API_KEY en apps/functions/.env — el asistente COSP y optimizePlanningGemini no responderán.',
    );
    logErr(
      '[emulators] Local: firebase functions:secrets:access GEMINI_API_KEY > apps/functions/.env (línea GEMINI_API_KEY=...)',
    );
  }
  logErr('[emulators] Compilando Functions (tsc)...');
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: functionsDir,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) {
    logErr('[emulators] ERROR: falló npm run build en apps/functions');
    process.exit(build.status ?? 1);
  }
}

const backupsDir = path.join(projectRoot, 'backups');
const latestDir   = path.join(backupsDir, 'latest');
const previousDir = path.join(backupsDir, 'previous');
fs.mkdirSync(backupsDir, { recursive: true });

/** Devuelve true si el directorio tiene datos reales (auth users o archivos Firestore). */
function hasRealData(dir) {
  if (!fs.existsSync(dir)) return false;
  try {
    const accounts = JSON.parse(fs.readFileSync(path.join(dir, 'auth_export', 'accounts.json'), 'utf8'));
    if (accounts.users && accounts.users.length > 0) return true;
  } catch {}
  try {
    const fsFiles = fs.readdirSync(path.join(dir, 'firestore_export'));
    // Más de 1 archivo = hay colecciones exportadas además del metadata
    if (fsFiles.length > 1) return true;
  } catch {}
  return false;
}

/** Copia recursiva de src → dest (limpia dest si existe). */
function copyDirSync(src, dest) {
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// hasImport = true solo si el backup tiene datos reales; un backup vacío NO se importa
// (un import vacío/corrupto puede hacer crashear el emulador de Firestore)
const hasImport = hasRealData(latestDir);

if (hasImport) {
  try {
    copyDirSync(latestDir, previousDir);
    logErr('[emulators] Backup previo guardado en backups/previous');
  } catch (e) {
    logErr('[emulators] AVISO: no se pudo copiar a backups/previous:', e.message);
  }
} else {
  logErr('[emulators] AVISO: backups/latest vacío o sin datos reales — iniciando Firestore limpio.');
  logErr('[emulators] Tip: una vez arrancado corré "npm run seed" y cerrá con Ctrl+C para guardar el backup.');
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
  logErr('[emulators] firebase-tools no está en node_modules; uso npx firebase-tools (puede descargar la primera vez).');
  const npxCmd =
    process.platform === 'win32'
      ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'npx.cmd')
      : 'npx';
  const useCmd = process.platform === 'win32' && fs.existsSync(npxCmd) ? npxCmd : 'npx';
  r = spawnSync(useCmd, ['--yes', 'firebase-tools', ...emulatorArgs], {
    stdio: 'inherit',
    env,
    cwd: projectRoot,
    shell: process.platform === 'win32',
  });
}

// Al salir: si latest quedó vacío pero previous tiene datos → restaurar automáticamente
if (!hasRealData(latestDir) && hasRealData(previousDir)) {
  logErr('[emulators] AVISO: el export salió vacío. Restaurando backups/previous → backups/latest...');
  try {
    copyDirSync(previousDir, latestDir);
    logErr('[emulators] Restauración completada. El próximo arranque cargará los datos de la sesión anterior.');
  } catch (e) {
    logErr('[emulators] ERROR al restaurar backup:', e.message);
  }
}

process.exit(r && r.status !== null && r.status !== undefined ? r.status : 1);
