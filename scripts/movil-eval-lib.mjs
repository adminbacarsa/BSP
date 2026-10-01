/** Compila lib/movil a .mjs para que Node cargue los imports relativos sin extensión. */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');
const root = join(here, '../apps/web2/src');

const LIB = ['modulos', 'menuLayout', 'supervisionMovil', 'modulosPlataforma', 'modulosRrhh', 'movilModulos', 'navItems', 'empresaSelector', 'fechaCorta', 'rrhhDia'];

const OPTS = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 };

export function compileMovilLib(outdir) {
  mkdirSync(outdir, { recursive: true });
  const out = {};
  for (const name of LIB) {
    const src = readFileSync(join(root, 'lib/movil', `${name}.ts`), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.mjs'").replace(/import '\.\/(\w+)'/g, "import './$1.mjs'");
    const file = join(outdir, `${name}.mjs`);
    writeFileSync(file, ts.transpileModule(src, { compilerOptions: OPTS, fileName: `${name}.ts` }).outputText);
    out[name] = pathToFileURL(file).href;
  }
  return out;
}

/**
 * Compila `components/movil/ui/*`, `BottomSheet` y las pantallas pedidas (`names`, sin extensión).
 * Reemplaza `./ui/X` → `./ui/X.mjs`, `./BottomSheet` → `./BottomSheet.mjs`, `@/lib/movil/X` → lib compilada,
 * y `extra` (import exacto → ruta) para stubs de otras libs. Devuelve { nombre: fileURL }.
 */
export function compileMovilScreens(outdir, lib, names, extra = {}) {
  mkdirSync(join(outdir, 'ui'), { recursive: true });
  const compile = (src, name) => {
    const out = join(outdir, name.replace(/\.tsx?$/, '.mjs'));
    writeFileSync(out, ts.transpileModule(src, { compilerOptions: { ...OPTS, jsx: ts.JsxEmit.ReactJSX }, fileName: name }).outputText);
    return out;
  };
  const uiDir = join(root, 'components/movil/ui');
  const out = {};
  for (const name of readdirSync(uiDir)) {
    const file = compile(readFileSync(join(uiDir, name), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.mjs'"), `ui/${name}`);
    if (name === 'index.ts') out.ui = pathToFileURL(file).href;
  }
  const rewrite = (src) => {
    let s = src
      .replace(/from '\.\/ui\/(\w+)'/g, "from './ui/$1.mjs'")
      .replace("from './ui'", "from './ui/index.mjs'")
      .replace("from './BottomSheet'", "from './BottomSheet.mjs'")
      .replace(/import type .*\n/g, '');
    s = s.replace(/from '@\/lib\/movil\/(\w+)'/g, (m, name) => (lib[name] ? `from ${JSON.stringify(lib[name])}` : m));
    for (const [from, to] of Object.entries(extra)) s = s.split(`from '${from}'`).join(`from ${JSON.stringify(to)}`);
    return s;
  };
  out.BottomSheet = pathToFileURL(compile(rewrite(readFileSync(join(root, 'components/movil/BottomSheet.tsx'), 'utf8')), 'BottomSheet.tsx')).href;
  for (const name of names) {
    out[name] = pathToFileURL(compile(rewrite(readFileSync(join(root, 'components/movil', `${name}.tsx`), 'utf8')), `${name}.tsx`)).href;
  }
  return out;
}

/** Stub .mjs con exports fijos (para libs que no hace falta compilar en el test). */
export function writeStub(outdir, name, body) {
  mkdirSync(outdir, { recursive: true });
  const file = join(outdir, `${name}.mjs`);
  writeFileSync(file, body);
  return pathToFileURL(file).href;
}
