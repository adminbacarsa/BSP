import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function compile(file, name, transform = (src) => src) {
  const js = ts.transpileModule(transform(readFileSync(file, 'utf8')), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: name,
  }).outputText;
  const out = join(outdir, name.replace(/\.tsx?$/, '.mjs'));
  writeFileSync(out, js);
  return out;
}
// BottomSheet toma los tokens de estilo de components/movil/ui/tones.
mkdirSync(join(outdir, 'ui'), { recursive: true });
compile(join(root, 'components/movil/ui/tones.ts'), 'ui/tones.ts');
compile(join(root, 'components/movil/ui/MovilTopBar.tsx'), 'ui/MovilTopBar.tsx', (src) => src.replace("from './tones'", "from './tones.mjs'"));
compile(join(root, 'components/movil/ui/MovilBadge.tsx'), 'ui/MovilBadge.tsx', (src) => src.replace("from './tones'", "from './tones.mjs'"));
const conTopBar = (src) => src
  .replace("from './ui/MovilTopBar'", "from './ui/MovilTopBar.mjs'")
  .replace("from './ui/MovilBadge'", "from './ui/MovilBadge.mjs'")
  .replace("from './ui/tones'", "from './ui/tones.mjs'");
compile(join(root, 'components/movil/BottomSheet.tsx'), 'BottomSheet.tsx', (src) => src.replace("from './ui/tones'", "from './ui/tones.mjs'"));
const eventualesSrc = conTopBar(readFileSync(join(root, 'components/movil/EventualesScreens.tsx'), 'utf8'))
  .replace("from './BottomSheet'", `from ${JSON.stringify(pathToFileURL(join(outdir, 'BottomSheet.mjs')).href)}`);
writeFileSync(join(outdir, 'EventualesScreens.mjs'), ts.transpileModule(eventualesSrc, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  fileName: 'EventualesScreens.tsx',
}).outputText);
compile(join(root, 'components/movil/RrhhScreens.tsx'), 'RrhhScreens.tsx', conTopBar);

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
  totalEmpresa: 1,
  personas: [{ id: '20111111112', nombre: 'Sosa, Carla', cuil: '20-11111111-2', marco: 'Marco vigente', marcoEstado: 'MARCO_VIGENTE', telefono: '351', legajo: '148', primerIngreso: '15/02/2024' }],
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
  arca: [
    { id: 'a', nombre: 'Sosa, Carla', cuil: '20-11111111-2', tipo: 'AT', estado: 'PENDIENTE', fecha: '01/10/2026', nroTransaccion: '' },
    { id: 'b', nombre: 'Lopez, Luis', cuil: '20-22222222-8', tipo: 'BT', estado: 'ERROR', fecha: '30/09/2026', nroTransaccion: '' },
  ],
  nro: '',
  onNro: noop,
  arcaId: 'a',
  onArca: noop,
  onConfirmarArca: noop,
  elegido: { id: '20111111112', nombre: 'Sosa, Carla', cuil: '20-11111111-2', marco: 'Marco vigente', marcoEstado: 'MARCO_VIGENTE', telefono: '351', legajo: '148', primerIngreso: '15/02/2024' },
};
const ev = renderToStaticMarkup(createElement(EventualesScreens, evProps));
const evArca = renderToStaticMarkup(createElement(EventualesScreens, { ...evProps, panel: 'arca' }));
check('eventuales 390 muestra bolsa, marco y arca', ev.includes('data-viewport="390x844"') && ev.includes('Sosa, Carla') && ev.includes('Marco vigente') && ev.includes('Alta rápida') && evArca.includes('ARCA requiere conexión') && ev.includes('20-11111111-2 válido'));
check('bolsa muestra legajo y 1º ingreso', ev.includes('data-legajo="148"') && ev.includes('data-primer-ingreso="15/02/2024"') && ev.includes('Legajo 148') && ev.includes('1º ingreso 15/02/2024') && ev.includes('1 habilitado'));
check('ARCA lista alta y baja de la empresa activa', evArca.includes('Alta AT') && evArca.includes('Baja BT') && evArca.includes('ERROR') && evArca.includes('Pruebas S.A.') && evArca.includes('data-movil-arca-form="a"'));

const evOnline = { ...evProps, panel: 'arca', online: true };
const sinNro = renderToStaticMarkup(createElement(EventualesScreens, evOnline));
const conNro = renderToStaticMarkup(createElement(EventualesScreens, { ...evOnline, nro: '20261001-AT-000777' }));
const sinEnvio = renderToStaticMarkup(createElement(EventualesScreens, { ...evOnline, arcaId: '', nro: '123' }));
const botonConfirmar = (html) => html.match(/<button[^>]*>Confirmar en ARCA<\/button>/)?.[0] || '';
check('confirmar requiere envío elegido y nro', botonConfirmar(sinNro).includes('disabled=""') && botonConfirmar(sinEnvio).includes('disabled=""') && sinEnvio.includes('Elegí un envío de la lista') && botonConfirmar(conNro) !== '' && !botonConfirmar(conNro).includes('disabled=""'));
const confirmado = renderToStaticMarkup(createElement(EventualesScreens, {
  ...evOnline,
  arcaId: '',
  arca: [evProps.arca[1], { ...evProps.arca[0], estado: 'CONFIRMADO', nroTransaccion: '20261001-AT-000777' }],
}));
check('alta confirmada pasa a CONFIRMADO con su transacción', confirmado.includes('Confirmados ahora') && confirmado.includes('data-arca-estado="CONFIRMADO"') && confirmado.includes('Transacción 20261001-AT-000777') && confirmado.includes('ARCA pendiente · Pruebas S.A. · <span class="tabular-nums text-slate-900">1</span>'));

if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('eval-movil-rrhh ok');
