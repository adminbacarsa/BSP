import { createRequire } from 'node:module';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');
const root = join(here, '../apps/web2/src');

const { createWriteQueue } = await import(pathToFileURL(join(root, 'lib/movil/writeQueue.ts')).href);
const { resumenDiaRrhh } = await import(pathToFileURL(join(root, 'lib/movil/rrhhDia.ts')).href);
const { compileMovilLib } = await import('./movil-eval-lib.mjs');
const outdir = join(here, '../apps/web2/.movil-eval');
rmSync(outdir, { recursive: true, force: true });
const lib = compileMovilLib(outdir);
const { movilNavForPermissions } = await import(lib.navItems);

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
const queued = await queue.enqueue('Ausencia Guerrero', async () => { writes += 1; });
check('ausencia sin red queda pendiente', queued === 'queued' && queue.pending()[0] === 'Ausencia Guerrero' && writes === 0);
online.value = true;
const flushed = await queue.flush();
check('la ausencia se envía al volver la señal', flushed === 1 && writes === 1);

const dia = resumenDiaRrhh('2026-10-04', [
  { id: '1', employeeId: 'g', employeeName: 'Guerrero, Martín', type: 'Enfermedad', startDate: '2026-10-04', endDate: '2026-10-06', status: 'En verificación', hasCertificate: false },
  { id: '2', employeeId: 'b', employeeName: 'Baez, Juan', type: 'Vacaciones', startDate: '2026-10-01', endDate: '2026-10-04', status: 'Autorizada', hasCertificate: true },
]);
check('tarjetas del día', dia.ausenciasHoy.length === 2 && dia.licencias.length === 2 && dia.certificados.length === 1 && dia.certificados[0].employeeName.includes('Guerrero'));

const { modulosMovil } = await import(lib.movilModulos);
check('superadmin ve el menú', modulosMovil(() => false, true).map((item) => item.label).join(',') === 'Operación,Supervisión,Planificación,Eventuales,RRHH,Servicios');
const ops = movilNavForPermissions((key) => key === 'OPERATIONS', '/admin/operaciones').map((item) => item.label).join(',');
check('barra de Operación sin RRHH', ops === 'Objetivos,Alertas,Sala,Menú');

function compile(file, name) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: name,
  }).outputText;
  const out = join(outdir, name.replace(/\.tsx$/, '.mjs'));
  writeFileSync(out, js);
  return out;
}
compile(join(root, 'components/movil/BottomSheet.tsx'), 'BottomSheet.tsx');
const eventualesSrc = readFileSync(join(root, 'components/movil/EventualesScreens.tsx'), 'utf8')
  .replace("from './BottomSheet'", `from ${JSON.stringify(pathToFileURL(join(outdir, 'BottomSheet.mjs')).href)}`);
writeFileSync(join(outdir, 'EventualesScreens.mjs'), ts.transpileModule(eventualesSrc, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  fileName: 'EventualesScreens.tsx',
}).outputText);
compile(join(root, 'components/movil/RrhhScreens.tsx'), 'RrhhScreens.tsx');

const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
const { RrhhScreens } = await import(pathToFileURL(join(outdir, 'RrhhScreens.mjs')).href);
const { EventualesScreens } = await import(pathToFileURL(join(outdir, 'EventualesScreens.mjs')).href);

const noop = () => {};
const rrhh = renderToStaticMarkup(createElement(RrhhScreens, {
  empresa: 'Pruebas S.A.',
  online: false,
  pendingLabel: 'Ausencia Guerrero',
  panel: 'ausencia',
  hoyLabel: 'sábado 4 de octubre',
  ausenciasHoy: [{ id: '1', employeeId: 'g', nombre: 'Guerrero, Martín', tipo: 'Enfermedad' }],
  licencias: [],
  certificados: [{ id: '1', employeeId: 'g', nombre: 'Guerrero, Martín' }],
  busqueda: 'Gue',
  onBusqueda: noop,
  guardias: [{ id: 'g', nombre: 'Guerrero, Martín', telefono: '3510000000' }],
  tipos: [{ id: 'e', label: 'Enfermedad', code: 'E' }],
  tipoId: 'e',
  onTipo: noop,
  dias: '3',
  onDias: noop,
  fotoNombre: null,
  onFoto: noop,
  onGuardarAusencia: noop,
  novedadTipo: 'Observación',
  onNovedadTipo: noop,
  novedadTexto: '',
  onNovedadTexto: noop,
  onGuardarNovedad: noop,
  ficha: { nombre: 'Guerrero, Martín', telefono: '3510000000', turnos: [{ id: 't', dia: 'lun 06/10', codigo: 'M' }] },
  onElegir: noop,
  onFicha: noop,
  onPanel: noop,
}));
check('rrhh 390 muestra ausencia y pendiente', rrhh.includes('data-viewport="390x844"') && rrhh.includes('max-w-[390px]') && rrhh.includes('min-h-[844px]') && rrhh.includes('Guardar · pendiente de enviar') && rrhh.includes('Guerrero, Martín') && rrhh.includes('Pendiente de enviar'));

const ficha = renderToStaticMarkup(createElement(RrhhScreens, {
  empresa: 'Pruebas S.A.',
  online: true,
  pendingLabel: null,
  panel: 'ficha',
  hoyLabel: 'sábado 4 de octubre',
  ausenciasHoy: [],
  licencias: [],
  certificados: [],
  busqueda: '',
  onBusqueda: noop,
  guardias: [],
  tipos: [],
  tipoId: '',
  onTipo: noop,
  dias: '1',
  onDias: noop,
  fotoNombre: null,
  onFoto: noop,
  onGuardarAusencia: noop,
  novedadTipo: 'Observación',
  onNovedadTipo: noop,
  novedadTexto: '',
  onNovedadTexto: noop,
  onGuardarNovedad: noop,
  ficha: { nombre: 'Guerrero, Martín', telefono: '3510000000', turnos: [{ id: 't', dia: 'lun 06/10', codigo: 'M' }] },
  onElegir: noop,
  onFicha: noop,
  onPanel: noop,
}));
check('ficha con llamar', ficha.includes('Llamar') && ficha.includes('lun 06/10') && ficha.includes('href="tel:3510000000"'));

const evProps = {
  empresa: 'Pruebas S.A.',
  online: false,
  pendingLabel: null,
  panel: 'alta',
  buscar: 'Sosa',
  onBuscar: noop,
  personas: [{ id: '20111111112', nombre: 'Sosa, Carla', cuil: '20-11111111-2', marco: 'Marco vigente', telefono: '351' }],
  onElegir: noop,
  onCerrarAlta: noop,
  cuil: '20-11111111-2',
  onCuil: noop,
  cuilEstado: '20-11111111-2 válido',
  nombre: 'Sosa, Carla',
  onNombre: noop,
  mail: 'carla@pruebas.test',
  onMail: noop,
  telefono: '351',
  onTelefono: noop,
  onGuardarAlta: noop,
  onCrearAcceso: noop,
  arca: [{ id: 'a', nombre: 'Sosa, Carla', tipo: 'AT', estado: 'PENDIENTE' }],
  nro: '',
  onNro: noop,
  arcaId: 'a',
  onArca: noop,
  onConfirmarArca: noop,
  elegido: { id: '20111111112', nombre: 'Sosa, Carla', cuil: '20-11111111-2', marco: 'Marco vigente', telefono: '351' },
};
const ev = renderToStaticMarkup(createElement(EventualesScreens, evProps));
const evArca = renderToStaticMarkup(createElement(EventualesScreens, { ...evProps, panel: 'arca' }));
check('eventuales 390 muestra bolsa, marco y arca', ev.includes('data-viewport="390x844"') && ev.includes('Sosa, Carla') && ev.includes('Marco vigente') && ev.includes('Alta rápida') && evArca.includes('ARCA requiere conexión') && ev.includes('20-11111111-2 válido'));

if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('eval-movil-rrhh ok');
