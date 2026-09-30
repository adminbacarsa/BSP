/**
 * Guarda de deploy: apps/functions tiene que cargar SOLA, sin el resto del repo.
 *
 * Copia apps/functions/lib + package.json + vendor a una carpeta temporal aislada
 * (node_modules entra como junction), requiere lib/index.js y además importa cada
 * módulo que el código carga con import() dinámico. Si algo no resuelve, falla.
 * Así un `import('../../../web2/...')` no llega a producción (gestionarEventual 500).
 *
 *   node scripts/check-functions-standalone.mjs
 *   node scripts/check-functions-standalone.mjs --keep   → deja la carpeta temporal
 *
 * Requiere lib/ compilado: `npm --prefix apps/functions run build`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsRoot = path.join(repoRoot, 'apps', 'functions');
const BUILTINS = new Set(['crypto', 'fs', 'path', 'os', 'url', 'stream', 'module', 'child_process', 'util', 'events', 'http', 'https', 'zlib', 'buffer']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      copyDir(s, d);
    } else fs.copyFileSync(s, d);
  }
}

/**
 * Copia aislada de lo que sube firebase deploy. La carpeta vive fuera del repo:
 * ninguna ruta ../../../web2 ni ../../packages puede resolver desde ahí.
 */
export function prepareStandaloneCopy({ label = 'cosp-functions-standalone' } = {}) {
  const lib = path.join(functionsRoot, 'lib');
  if (!fs.existsSync(path.join(lib, 'index.js'))) {
    throw new Error('Falta apps/functions/lib/index.js. Corré: npm --prefix apps/functions run build');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  copyDir(lib, path.join(tmp, 'lib'));
  fs.copyFileSync(path.join(functionsRoot, 'package.json'), path.join(tmp, 'package.json'));
  const vendor = path.join(functionsRoot, 'vendor');
  if (fs.existsSync(vendor)) copyDir(vendor, path.join(tmp, 'vendor'));
  for (const envName of ['.env', '.env.local']) {
    const p = path.join(functionsRoot, envName);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(tmp, envName));
  }
  const realNodeModules = path.join(functionsRoot, 'node_modules');
  if (!fs.existsSync(realNodeModules)) throw new Error('Falta apps/functions/node_modules (npm install).');
  fs.symlinkSync(realNodeModules, path.join(tmp, 'node_modules'), 'junction');
  return tmp;
}

export function removeStandaloneCopy(tmp) {
  try {
    const link = path.join(tmp, 'node_modules');
    if (fs.existsSync(link)) fs.rmSync(link, { recursive: false, force: true });
  } catch { /* junction */ }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

function listFiles(dir, ext, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(p, ext, out);
    else if (ext.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out;
}

/** import('x') con literal en apps/functions/src → { fromLib, spec }. */
export function collectDynamicImports() {
  const srcRoot = path.join(functionsRoot, 'src');
  const out = [];
  for (const file of listFiles(srcRoot, ['.ts', '.mjs', '.js'])) {
    if (/\.(test|spec)\.ts$/.test(file) || file.endsWith('.d.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(srcRoot, file);
    const libFile = path.join('lib', rel.replace(/\.ts$/, '.js'));
    for (const m of text.matchAll(/\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g)) {
      out.push({ srcFile: rel.replace(/\\/g, '/'), fromLib: libFile, spec: m[2] });
    }
  }
  return out;
}

function forbiddenRequires(libDir) {
  const hits = [];
  for (const file of listFiles(libDir, ['.js', '.mjs'])) {
    if (file.endsWith(path.join('hoursLedger', 'bundledEngine.js'))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:require\(|import\(|from\s*)\s*['"]((?:\.\.\/){2,}(?:web2|packages|apps)\/[^'"]*)['"]/g)) {
      if (/hours-core\/src\/motors\/server\/payrollTurnoAccumulator\.ts$/.test(m[1]) && file.endsWith('remuneracion.mjs')) continue;
      hits.push(`${path.relative(libDir, file).replace(/\\/g, '/')} → ${m[1]}`);
    }
  }
  return hits;
}

async function main() {
  const keep = process.argv.includes('--keep');
  const tmp = prepareStandaloneCopy();
  const failures = [];
  console.log(`check-functions-standalone: copia en ${tmp}`);

  const statics = forbiddenRequires(path.join(tmp, 'lib'));
  for (const h of statics) failures.push(`ruta fuera de apps/functions: ${h}`);

  process.env.GCLOUD_PROJECT ||= 'demo-standalone';
  process.env.FUNCTIONS_EMULATOR ||= 'true';
  delete process.env.FIRESTORE_EMULATOR_HOST;

  try {
    await import(pathToFileURL(path.join(tmp, 'lib', 'index.js')).href);
    console.log('OK\tlib/index.js carga');
  } catch (e) {
    failures.push(`lib/index.js no carga: ${e?.message || e}`);
  }

  const dyn = collectDynamicImports();
  const seen = new Set();
  let ok = 0;
  for (const d of dyn) {
    const key = `${d.fromLib}|${d.spec}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bare = !d.spec.startsWith('.') && !d.spec.startsWith('/');
    if (bare && (BUILTINS.has(d.spec) || d.spec.startsWith('node:'))) continue;
    const fromFile = path.join(tmp, d.fromLib);
    const requireFrom = createRequire(fs.existsSync(fromFile) ? fromFile : path.join(tmp, 'package.json'));
    let resolved;
    try {
      resolved = requireFrom.resolve(d.spec);
    } catch (e) {
      // import('./x') solo en posición de tipo (import('./t').Foo) no emite JS: si existe el .d.ts, se ignora.
      const dts = path.join(path.dirname(fromFile), `${d.spec}.d.ts`);
      if (!bare && fs.existsSync(dts)) continue;
      failures.push(`${d.srcFile}: import('${d.spec}') no resuelve desde ${d.fromLib} (${e?.code || e?.message})`);
      continue;
    }
    if (bare) { ok += 1; continue; }
    try {
      await import(pathToFileURL(resolved).href);
      ok += 1;
    } catch (e) {
      failures.push(`${d.srcFile}: import('${d.spec}') no carga: ${e?.message || e}`);
    }
  }
  console.log(`OK\t${ok} import() dinámicos resueltos (${dyn.length} en src)`);

  if (!keep) removeStandaloneCopy(tmp);
  if (failures.length) {
    console.error(`\nFALLA check-functions-standalone (${failures.length}):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('check-functions-standalone: OK, apps/functions carga aislada del repo');
  process.exit(0);
}

const esMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
