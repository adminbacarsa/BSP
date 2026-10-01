import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');

const { createWriteQueue } = await import(pathToFileURL(join(here, '../apps/web2/src/lib/movil/writeQueue.ts')).href);
const { createCallableGate } = await import(pathToFileURL(join(here, '../apps/web2/src/lib/movil/callableOnline.ts')).href);
const { movilNavForPermissions } = await import(pathToFileURL(join(here, '../apps/web2/src/lib/movil/navItems.ts')).href);
const { coveragePct, guardStatusLabel, guardTone } = await import(pathToFileURL(join(here, '../apps/web2/src/lib/movil/guardTone.ts')).href);
let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('OK', name);
  }
}

const online = { value: false };
const queue = createWriteQueue(() => online.value);
let writes = 0;
const queued = await queue.enqueue('Salida Baez', async () => { writes += 1; });
check('sin red queda pendiente', queued === 'queued' && queue.pending()[0] === 'Salida Baez' && writes === 0);
online.value = true;
const flushed = await queue.flush();
check('al volver la señal se envía', flushed === 1 && writes === 1 && queue.pending().length === 0);

const gate = createCallableGate(() => online.value);
online.value = false;
let calls = 0;
let threw = false;
try {
  await gate.run('Revertir', async () => { calls += 1; });
} catch (error) {
  threw = String(error.message).includes('requiere conexión');
}
check('callable avisa y queda para reintentar', threw && gate.pending().length === 1 && calls === 0);
online.value = true;
check('callable se reintenta', (await gate.retry()) === 1 && calls === 1);

const nav = movilNavForPermissions((key) => key === 'OPERATIONS');
check('nav del operador', nav.map((item) => item.label).join(',') === 'Operaciones,Alertas,Novedades,Más');
check('rrhh ve eventuales', movilNavForPermissions((key) => key === 'RRHH').some((item) => item.id === 'eventuales'));

const shift = { isAbsent: true, employeeName: 'Guerrero, Martín', code: 'T', id: '1' };
check('ausente es Llegó', guardTone(shift) === 'aus' && guardStatusLabel(shift).includes('Ausente'));
check('cobertura', coveragePct({ active: 3, retention: 1, absent: 1, vacant: 1 }) === 67);

const outdir = join(here, '../apps/web2/.movil-eval');
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
const outfile = join(outdir, 'screens.mjs');
const source = readFileSync(join(here, '../apps/web2/src/components/movil/OperacionScreens.tsx'), 'utf8')
  .replace("from '@/lib/movil/guardTone'", `from ${JSON.stringify(pathToFileURL(join(here, '../apps/web2/src/lib/movil/guardTone.ts')).href)}`);
const js = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  fileName: 'OperacionScreens.tsx',
}).outputText;
writeFileSync(outfile, js);
const reactPath = require.resolve('react');
const reactDomPath = require.resolve('react-dom/server');
const { createElement } = await import(pathToFileURL(reactPath).href);
const { renderToStaticMarkup } = await import(pathToFileURL(reactDomPath).href);
const { OperacionScreens } = await import(pathToFileURL(outfile).href);
const html = renderToStaticMarkup(createElement(OperacionScreens, {
  empresa: 'Pruebas S.A.',
  modeLabel: 'Manual',
  online: true,
  pendingLabel: null,
  stats: { activos: 12, retenidos: 1, ausentes: 2, vacantes: 3, plan: 1 },
  panel: 'home',
  objective: null,
  alerts: [],
  objectives: [{
    objectiveId: 'peaje',
    name: 'Peaje 9 Norte',
    client: 'Ruta 9',
    active: 3,
    retention: 1,
    absent: 1,
    vacant: 1,
    plan: 0,
    shifts: [],
  }, {
    objectiveId: 'obra',
    name: 'Obrador Malagueño',
    client: 'Malagueño',
    active: 6,
    retention: 0,
    absent: 0,
    vacant: 0,
    plan: 0,
    shifts: [],
  }],
  onBack: () => {},
  onOpen: () => {},
  onCounter: () => {},
  onLlego: () => {},
  onRevertir: () => {},
  onSalida: () => {},
  onProtocolo: () => {},
  onRetencion: () => {},
  onSala: () => {},
}));
check('home 390 muestra Peaje y contadores', html.includes('Peaje 9 Norte') && html.includes('Obrador Malagueño') && html.includes('>12<'));

const guardHtml = renderToStaticMarkup(createElement(OperacionScreens, {
  empresa: 'Pruebas S.A.',
  modeLabel: 'Manual',
  online: false,
  pendingLabel: 'Salida Baez',
  stats: { activos: 1, retenidos: 1, ausentes: 1, vacantes: 0, plan: 0 },
  panel: 'objetivo',
  alerts: [],
  objectives: [],
  objective: {
    objectiveId: 'peaje',
    name: 'Peaje 9 Norte',
    active: 1,
    retention: 1,
    absent: 1,
    vacant: 0,
    plan: 0,
    shifts: [
      { id: 'b', employeeName: 'Baez, Juan', code: 'M', isRetention: true, retentionMinutes: 42, positionName: 'Puesto 1' },
      { id: 'g', employeeName: 'Guerrero, Martín', code: 'T', isAbsent: true, positionName: 'Puesto 1' },
    ],
  },
  onBack: () => {},
  onOpen: () => {},
  onCounter: () => {},
  onLlego: () => {},
  onRevertir: () => {},
  onSalida: () => {},
  onProtocolo: () => {},
  onRetencion: () => {},
  onSala: () => {},
}));
check('objetivo muestra Llegó, protocolo y pendiente', guardHtml.includes('Llegó?') && guardHtml.includes('Protocolo') && guardHtml.includes('Pendiente de enviar') && guardHtml.includes('42'));
check('marco de pantalla', html.includes('data-movil-screen') && html.includes('max-w-[480px]'));
rmSync(outdir, { recursive: true, force: true });

if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('movil operacion ok');
