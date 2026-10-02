import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const root = join(here, '../apps/web2/src');

const { createWriteQueue } = await import(pathToFileURL(join(root, 'lib/movil/writeQueue.ts')).href);
const { resumenDiaRrhh, esAusenciaInjustificada } = await import(pathToFileURL(join(root, 'lib/movil/rrhhDia.ts')).href);
const { compileMovilLib, compileMovilScreens } = await import('./movil-eval-lib.mjs');
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
check('la AA automática del día es justificable', esAusenciaInjustificada({ type: 'No Presentación', absenceType: 'AA', status: 'Confirmada' }) && !esAusenciaInjustificada(dia.ausenciasHoy[0]));

const { modulosMovil } = await import(lib.movilModulos);
check('superadmin ve el menú', modulosMovil(() => false, true).map((item) => item.label).join(',') === 'Operación,Supervisión,Planificación,Eventuales,RRHH,Servicios');
const ops = movilNavForPermissions((key) => key === 'OPERATIONS', '/admin/operaciones').map((item) => item.label).join(',');
check('barra de Operación sin RRHH', ops === 'Objetivos,Alertas,Sala,Menú');

// Pantallas + components/movil/ui + BottomSheet compilados con el helper compartido.
const plazoUrl = pathToFileURL(join(root, 'lib/eventuales/plazoAnulacion.mjs')).href;
const screens = compileMovilScreens(outdir, lib, ['RrhhScreens', 'EventualesScreens'], {
  '@/lib/eventuales/plazoAnulacion.mjs': plazoUrl,
});

const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
const { RrhhScreens } = await import(screens.RrhhScreens);
const { EventualesScreens } = await import(screens.EventualesScreens);

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
const anulaHtml = renderToStaticMarkup(createElement(EventualesScreens, {
  ...evOnline,
  arcaId: 'n',
  acuse: '',
  ahoraMs: Date.parse('2026-10-05T18:00:00-03:00'),
  arca: [{
    id: 'n', nombre: 'Sosa, Carla', cuil: '20-11111111-2', cuil11: '20111111112', tipo: 'ANULACION', estado: 'PENDIENTE',
    fecha: '05/10/2026', nroTransaccion: '', fechaInicioArca: '20261005', nroTransaccionAlta: '778899',
    venceAnulacionMs: Date.parse('2026-10-06T00:00:00-03:00'),
  }],
}));
check('anulación es tarea manual con datos, plazo y acuse', anulaHtml.includes('data-anulacion-manual="1"') && anulaHtml.includes('data-anula-cuil="1"') && anulaHtml.includes('20111111112') && anulaHtml.includes('20261005') && anulaHtml.includes('778899') && anulaHtml.includes('Anular Registro') && anulaHtml.includes('data-anula-plazo="abierto"') && anulaHtml.includes('Registrar acuse') && !anulaHtml.includes('Confirmar en ARCA'));

if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('eval-movil-rrhh ok');
