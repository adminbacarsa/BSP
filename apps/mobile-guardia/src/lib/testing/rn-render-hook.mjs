/**
 * Loader de Node para renderizar componentes RN en tests (react-dom/server):
 * - `.tsx` se transpila con TypeScript (JSX automático); `.ts` lo cubre --experimental-strip-types.
 * - `react-native` y AsyncStorage se reemplazan por stubs de `src/lib/testing/`.
 * - Imports relativos sin extensión prueban `.ts` y luego `.tsx`.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');

const STUBS = {
  'react-native': pathToFileURL(path.join(here, 'reactNativeStub.mjs')).href,
  '@react-native-async-storage/async-storage': pathToFileURL(path.join(here, 'asyncStorageStub.mjs')).href,
  '@cosp/portal-core': pathToFileURL(path.join(here, 'portalCoreStub.mjs')).href,
  '@expo/vector-icons': pathToFileURL(path.join(here, 'ioniconsStub.mjs')).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExt = /\.(tsx?|jsx?|mjs|cjs|json|node)$/.test(specifier);
  if (relative && !hasExt) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      try {
        return await nextResolve(`${specifier}.tsx`, context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const out = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
