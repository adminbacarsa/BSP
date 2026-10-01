/** Compila lib/movil a .mjs para que Node cargue los imports relativos sin extensión. */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');
const root = join(here, '../apps/web2/src');

const LIB = ['modulos', 'modulosPlataforma', 'modulosRrhh', 'movilModulos', 'navItems', 'empresaSelector', 'fechaCorta'];

export function compileMovilLib(outdir) {
  mkdirSync(outdir, { recursive: true });
  const out = {};
  for (const name of LIB) {
    const src = readFileSync(join(root, 'lib/movil', `${name}.ts`), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.mjs'").replace(/import '\.\/(\w+)'/g, "import './$1.mjs'");
    const file = join(outdir, `${name}.mjs`);
    writeFileSync(file, ts.transpileModule(src, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      fileName: `${name}.ts`,
    }).outputText);
    out[name] = pathToFileURL(file).href;
  }
  return out;
}
