/**
 * Copia apps/web2/src/lib/eventuales/*.mjs (sin tests) a
 *   apps/functions/src/eventuales-shared/   (para que tsc resuelva los import())
 *   apps/functions/lib/eventuales-shared/   (lo que sube firebase deploy)
 *
 * Firebase deploy solo sube apps/functions: un import a ../../../web2 no existe allá.
 * Las dos carpetas están en .gitignore; `npm run build` en functions (prebuild) las regenera.
 *
 *   node scripts/sync-eventuales-to-functions.mjs          → src + lib
 *   node scripts/sync-eventuales-to-functions.mjs --lib    → solo lib (postbuild)
 *   node scripts/sync-eventuales-to-functions.mjs --check  → falla si alguna copia difiere
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'apps', 'web2', 'src', 'lib', 'eventuales');
const destSrc = path.join(repoRoot, 'apps', 'functions', 'src', 'eventuales-shared');
const destLib = path.join(repoRoot, 'apps', 'functions', 'lib', 'eventuales-shared');

const args = new Set(process.argv.slice(2));
const onlyLib = args.has('--lib');
const check = args.has('--check');

export function listarModulosCompartidos() {
  return fs
    .readdirSync(srcDir)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .sort();
}

function contenidoProhibido(name, text) {
  // Un .mjs compartido no puede tirar de otro paquete del repo por ruta relativa: en Functions no existe.
  const malos = [];
  for (const m of text.matchAll(/(?:import\s[^'"]*from\s*|import\(|require\()\s*['"]((?:\.\.\/)+(?:packages|apps|web2)\/[^'"]*)['"]/g)) {
    malos.push(m[1]);
  }
  // remuneracion.mjs tiene el .ts del paquete como primera opción y cae a @cosp/hours-core (vendor).
  const permitidos = name === 'remuneracion.mjs' ? [/packages\/hours-core\/src\/motors\/server\/payrollTurnoAccumulator\.ts$/] : [];
  return malos.filter((ruta) => !permitidos.some((re) => re.test(ruta)));
}

function sincronizar(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const nombres = listarModulosCompartidos();
  for (const name of nombres) {
    const text = fs.readFileSync(path.join(srcDir, name), 'utf8');
    const malos = contenidoProhibido(name, text);
    if (malos.length) {
      console.error(`sync-eventuales: ${name} importa fuera de apps/functions: ${malos.join(', ')}`);
      process.exit(1);
    }
    fs.writeFileSync(path.join(dest, name), text);
  }
  fs.writeFileSync(
    path.join(dest, 'README.txt'),
    'Generado por scripts/sync-eventuales-to-functions.mjs desde apps/web2/src/lib/eventuales. No editar acá.\n',
  );
  return nombres;
}

function verificar(dest) {
  const nombres = listarModulosCompartidos();
  const faltan = [];
  for (const name of nombres) {
    const copia = path.join(dest, name);
    if (!fs.existsSync(copia)) {
      faltan.push(`${name} (no existe)`);
      continue;
    }
    if (fs.readFileSync(copia, 'utf8') !== fs.readFileSync(path.join(srcDir, name), 'utf8')) faltan.push(`${name} (difiere)`);
  }
  return faltan;
}

const esMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esMain) {
  if (!fs.existsSync(srcDir)) {
    console.error(`sync-eventuales: no existe ${srcDir}`);
    process.exit(1);
  }
  if (check) {
    const problemas = [...verificar(destSrc).map((p) => `src: ${p}`), ...verificar(destLib).map((p) => `lib: ${p}`)];
    if (problemas.length) {
      console.error(`sync-eventuales: copias desactualizadas\n  ${problemas.join('\n  ')}\n  Corré: node scripts/sync-eventuales-to-functions.mjs`);
      process.exit(1);
    }
    console.log('sync-eventuales: src y lib al día');
  } else {
    const destinos = onlyLib ? [destLib] : [destSrc, destLib];
    let n = 0;
    for (const d of destinos) n = sincronizar(d).length;
    console.log(`sync-eventuales: ${n} módulos → ${destinos.map((d) => path.relative(repoRoot, d).replace(/\\/g, '/')).join(', ')}`);
  }
}
