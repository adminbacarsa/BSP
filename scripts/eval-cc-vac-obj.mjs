/**
 * Paridad de solapas del CC: LISTA = unión de turnos dentro de los objetivos de OBJ.
 * Caso prod 05/10: VENENCIA T3 16:00 ausente, VAC=1 en lista y vacío en OBJ.
 */
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  OPS_OBJECTIVE_PARITY_TABS,
  addShiftToOpsBucket,
  emptyOpsObjectiveBucket,
  opsTabShiftIds,
} = await import(pathToFileURL(join(root, 'packages/ops-core/src/opsObjectiveTab.ts')).href);

const require = createRequire(join(root, 'apps/web2/package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const now = new Date(2026, 9, 5, 13, 53, 0);
const start = (h, m) => new Date(2026, 9, 5, h, m, 0);
const end = (h, m) => new Date(2026, 9, 5, h, m, 0);

const shifts = [
  {
    id: 'venencia', objectiveId: 'peaje', employeeName: 'VENENCIA, Daiana Soledad',
    code: 'T3', isAbsent: true, isFuture: true, isUnassigned: false,
    shiftDateObj: start(16, 0), endDateObj: end(17, 0),
  },
  {
    id: 'bosio', objectiveId: 'peaje', employeeName: 'BOSIO',
    code: 'M', isPresent: true, isCompleted: false,
    shiftDateObj: start(11, 30), endDateObj: end(15, 15),
  },
  {
    id: 'farias', objectiveId: 'peaje', employeeName: 'FARIAS',
    code: 'M3', isPresent: true, isCompleted: false, isRetention: true,
    shiftDateObj: start(12, 30), endDateObj: end(16, 0),
  },
  {
    id: 'plan', objectiveId: 'peaje', employeeName: 'PLANIFICADO',
    code: 'N', isFuture: true, isUnassigned: false,
    shiftDateObj: start(23, 0), endDateObj: end(7, 0),
  },
  {
    id: 'franco', objectiveId: 'peaje', employeeName: 'FRANCO',
    code: 'F', isFranco: true,
    shiftDateObj: start(0, 0), endDateObj: end(23, 59),
  },
  {
    // RET stand-by (caso prod 06/10, pruebas_sa): va a FRANC junto con los francos, no a AUS/VAC.
    id: 'reten', objectiveId: 'peaje', employeeName: 'RETEN',
    code: 'RET', isAbsent: true, isFuture: true, isUnassigned: false,
    shiftDateObj: start(0, 0), endDateObj: end(0, 0),
  },
  {
    id: 'reten-presente', objectiveId: 'peaje', employeeName: 'RETEN USADO',
    code: 'RET', isPresent: true, isCompleted: false,
    shiftDateObj: start(7, 0), endDateObj: end(15, 0),
  },
  {
    id: 'cubierta', objectiveId: 'otro', employeeName: 'CUBIERTA',
    code: 'T', isAbsent: true, operacionallyCovered: true, isFuture: true,
    shiftDateObj: start(16, 0), endDateObj: end(0, 0),
  },
  {
    id: 'ev-aus', objectiveId: 'base', isEvent: true, eventKey: 'ev1',
    employeeName: 'EVENTO', code: 'EV', isAbsent: true, isFuture: true,
    shiftDateObj: start(18, 0), endDateObj: end(22, 0),
  },
];

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK' : 'FALLA'}\t${label}`);
}

const bucket = emptyOpsObjectiveBucket();
addShiftToOpsBucket(bucket, shifts[0], now);
check('ausente futuro descubierto suma VAC y AUS', bucket.vacant === 1 && bucket.absent === 1);

for (const tab of OPS_OBJECTIVE_PARITY_TABS) {
  const { list, objectives } = opsTabShiftIds(shifts, tab, now);
  const a = [...list].sort().join(',');
  const b = [...objectives].sort().join(',');
  check(`${tab}: LISTA = OBJ (${a || '—'})`, a === b);
}

const vac = opsTabShiftIds(shifts, 'VACANTES', now);
check('VAC incluye a VENENCIA', vac.list.includes('venencia') && vac.objectives.includes('venencia'));
check('VAC no incluye la ausencia ya cubierta', !vac.list.includes('cubierta'));

// Solapa FRANC: francos + retenes stand-by; el RET presente (ya trabaja) va a ACT.
const { shiftMatchesOpsViewTab, isStandbyRetDisponible } = await import(
  pathToFileURL(join(root, 'packages/ops-core/src/shiftMatchesOpsViewTab.ts')).href
);
const franc = opsTabShiftIds(shifts, 'FRANCOS', now);
check('FRANC lista francos y RET stand-by', franc.list.includes('franco') && franc.list.includes('reten'));
check('FRANC no lista el RET presente', !franc.list.includes('reten-presente'));
check('RET stand-by no vuelve a VAC', !vac.list.includes('reten'));
check('RET stand-by no vuelve a AUS', !opsTabShiftIds(shifts, 'AUSENTES', now).list.includes('reten'));
check('RET stand-by no sale en PLAN (solo FRANC)', !opsTabShiftIds(shifts, 'PLAN', now).list.includes('reten'));
check('RET presente está en ACT', opsTabShiftIds(shifts, 'ACTIVOS', now).list.includes('reten-presente'));
const francHoy = shifts.filter((s) => shiftMatchesOpsViewTab(s, 'FRANCOS', now));
const francos = francHoy.filter((s) => !isStandbyRetDisponible(s)).length;
const retenes = francHoy.filter((s) => isStandbyRetDisponible(s)).length;
check('contador «1 FRANC · 1 RET» = lista por secciones', francos === 1 && retenes === 1 && francos + retenes === franc.list.length);

function Vista({ ids }) {
  if (!ids.length) return React.createElement('p', null, 'Sin objetivos en este filtro');
  return React.createElement('ul', null, ids.map((id) => React.createElement('li', { key: id }, id)));
}
const html = renderToStaticMarkup(React.createElement(Vista, { ids: vac.objectives }));
check('render VAC muestra el turno y no el vacío', html.includes('venencia') && !html.includes('Sin objetivos en este filtro'));
const vacio = renderToStaticMarkup(React.createElement(Vista, { ids: [] }));
check('render sin turnos dice el vacío', vacio.includes('Sin objetivos en este filtro'));

const page = readFileSync(new URL('../apps/web2/src/pages/admin/operaciones/index.tsx', import.meta.url), 'utf8');
check('OBJ usa objectiveVisibleOnOpsTab', page.includes('objectiveVisibleOnOpsTab(o.shifts || [], logic.viewTab)'));
check('OBJ ya no filtra VAC por el contador exclusivo', !page.includes("case 'VACANTES':  return o.vacant > 0"));
check('solapa FRANC muestra el RET aparte', page.includes('`FRANC · ${logic.stats.retenes} RET`'));
check('vista FRANC separa francos y retenes', page.includes('data-ops-ret-count={retenesLista.length}') && page.includes('data-ops-franc-count={francosLista.length}'));
const mapView = readFileSync(new URL('../apps/web2/src/pages/admin/operaciones/map-view.tsx', import.meta.url), 'utf8');
check('mapa muestra el RET aparte en FRAN', mapView.includes('`FRAN · ${logic.stats.retenes} RET`'));

const { partesNombreTarjeta } = await import(pathToFileURL(join(root, 'apps/web2/src/lib/operaciones/guardCardNombre.ts')).href);
const baez = partesNombreTarjeta('BAEZ, Augusto Damian');
const lallana = partesNombreTarjeta('LALLANA Fabian Alberto');
check('apellido entero: BAEZ Augusto Damian', baez.apellido === 'BAEZ' && baez.resto === 'Augusto Damian' && baez.completo === 'BAEZ Augusto Damian');
check('sin coma el apellido es la primera palabra', lallana.apellido === 'LALLANA' && lallana.resto === 'Fabian Alberto');
const estadoChip = readFileSync(new URL('../apps/web2/src/components/operaciones/EstadoAusenciaChip.tsx', import.meta.url), 'utf8');
check('tarjeta: nombre en su fila, cubierto debajo, puesto en la meta', page.includes('data-ops-guard-nombre') && estadoChip.includes("data-ops-guard-cubierto={estado.kind === 'CUBIERTO' ? '1' : undefined}") && page.includes('data-ops-guard-meta="1"') && page.includes('whitespace-nowrap'));
check('el nombre de la tarjeta ya no va con truncate', !page.includes('font-black truncate ${isActionableOpsVacancy'));
check('popover del objetivo abre a 720 px si hay lugar', page.includes('Math.max(r.width, 720)'));
const { textoSinNotificacionesDe: textoPush } = await import(pathToFileURL(join(root, 'apps/web2/src/lib/operaciones/pushAviso.ts')).href);
const pushAt = new Date('2026-10-06T15:00:00.000Z');
check('sin notificaciones: denegado desde 06/10 y activo no', textoPush({ pushEstado: 'denegado', pushEstadoAt: pushAt }) === 'No recibe avisos de la app (permiso denegado desde 06/10). Llamalo.' && textoPush({ pushEstado: 'activo' }) === null && textoPush({}) === null);
check('lista y OBJ muestran la campana', page.includes('<SinNotificacionesMark shift={shift} />'));
const popupSrc = readFileSync(new URL('../apps/web2/src/components/operaciones/OperacionesMapPopup.tsx', import.meta.url), 'utf8');
check('popup y panel del mapa muestran la campana', popupSrc.includes('<SinNotificacionesMark shift={shift}') && mapView.includes('<SinNotificacionesMark shift={s}'));
const movil = readFileSync(new URL('../apps/web2/src/lib/movil/operacionFiltros.ts', import.meta.url), 'utf8');
check('celular agrupa con el mismo bucket', movil.includes('addShiftToOpsBucket(grupo, s as never, now)'));
const mapa = readFileSync(new URL('../apps/web2/src/hooks/useOperacionesMonitor.ts', import.meta.url), 'utf8');
check('mapa sale de listData (misma solapa)', mapa.includes('listData.filter((s: any) => !isEventShift(s))'));
check('monitor pega pushEstado del catálogo', mapa.includes('empPushMap') && mapa.includes('pushEstado: pushLegajo.pushEstado'));

// ---- Estado único de la ausencia (06/10, Peaje 9 Norte: FARIAS «DESCUBIERTO» + «Cubierto · KOPP») ----
const { estadoAusenciaCc, ausenciaSinCubrir, contadorAusLabel } = await import(
  pathToFileURL(join(root, 'packages/ops-core/src/estadoAusenciaCc.ts')).href
);
const { mostrarDescubierto } = await import(pathToFileURL(join(root, 'apps/web2/src/lib/operaciones/guardCardEstado.ts')).href);

const fariasCubierto = {
  id: 'farias-m3', objectiveId: 'peaje', employeeName: 'FARIAS Marcos Matias Agustin', code: 'M3',
  isAbsent: true, isSinCobertura: true, isUnassigned: true, status: 'SIN_COBERTURA', vacanteEscalada: true,
  operacionallyCovered: true, coverageStatus: 'COVERED',
  coveringDisplayName: 'KOPP Franco Isaias', coveringTipo: 'FT', coveringDesdeMs: start(12, 30).getTime(),
  shiftDateObj: start(12, 30), endDateObj: end(16, 0),
};
const eFarias = estadoAusenciaCc(fariasCubierto);
check('FARIAS cubierto → AUSENTE · CUBIERTO (la cobertura gana al isSinCobertura viejo)', eFarias?.kind === 'CUBIERTO' && eFarias.label === 'AUSENTE · CUBIERTO' && eFarias.tone === 'verde' && eFarias.sinCubrir === false);
check('FARIAS detalle: Cubre: KOPP Franco Isaias (FT) desde 12:30', eFarias?.detalle === 'Cubre: KOPP Franco Isaias (FT) desde 12:30');
check('FARIAS cubierto ya no muestra DESCUBIERTO', mostrarDescubierto(fariasCubierto) === false);
check('un hueco sin asignar sigue siendo DESCUBIERTO', mostrarDescubierto({ id: 'hueco', isUnassigned: true, isDescubierto: true }) === true);

const baezSinCubrir = { id: 'baez-aa', objectiveId: 'peaje', employeeName: 'BAEZ', code: 'M', isAbsent: true, shiftDateObj: start(10, 45), endDateObj: end(12, 0) };
const eBaez = estadoAusenciaCc(baezSinCubrir);
check('ausente sin cobertura → AUSENTE · SIN CUBRIR rojo', eBaez?.kind === 'SIN_CUBRIR' && eBaez.tone === 'rojo' && eBaez.sinCubrir === true && eBaez.detalle === null);
check('convocatoria en curso → AUSENTE · CUBRIENDO ámbar', estadoAusenciaCc({ ...baezSinCubrir, convocatoriaEnCurso: true })?.kind === 'CUBRIENDO'
  && estadoAusenciaCc(baezSinCubrir, { convocatoriaEnCurso: true })?.label === 'AUSENTE · CUBRIENDO');
const eParcial = estadoAusenciaCc({
  id: 'venencia-p', objectiveId: 'peaje', employeeName: 'VENENCIA', code: 'T', isAbsent: true,
  coverageStatus: 'PARTIAL', coverageType: 'EXTEND', coveredByEmployeeName: 'LOPEZ (Ext)',
  shiftDateObj: start(15, 0), endDateObj: end(23, 0),
});
check('Ext+Adel con una pata → COBERTURA PARCIAL con el tramo que falta', eParcial?.kind === 'PARCIAL' && eParcial.sinCubrir === true && eParcial.detalle === 'Ext: LOPEZ · Falta 19:00–23:00');
check('provisoria (NO LLEGÓ) y presente no son ausencia', estadoAusenciaCc({ isAbsent: true, isProvisionalLateAbsence: true }) === null && estadoAusenciaCc({ isPresent: true }) === null);
check('ausenciaSinCubrir: cubierto false, resto true', ausenciaSinCubrir(fariasCubierto) === false && ausenciaSinCubrir(baezSinCubrir) === true && ausenciaSinCubrir({ ...baezSinCubrir, convocatoriaEnCurso: true }) === true);
check('rótulo del contador: «AUS · 0 sin cubrir»', contadorAusLabel(2, 0) === 'AUS · 0 sin cubrir' && contadorAusLabel(2, 1) === 'AUS · 1 sin cubrir' && contadorAusLabel(0, 0) === 'AUS');

const bucketAus = emptyOpsObjectiveBucket();
addShiftToOpsBucket(bucketAus, fariasCubierto, now);
addShiftToOpsBucket(bucketAus, baezSinCubrir, now);
check('OBJ: absent cuenta las dos, absentSinCubrir solo la de BAEZ', bucketAus.absent === 2 && bucketAus.absentSinCubrir === 1);

check('LISTA usa contadorAusLabel y el rojo es por sin cubrir', page.includes('contadorAusLabel(logic.stats.ausentes, logic.stats.ausentesSinCubrir)') && page.includes("t.id === 'AUSENTES' ? ((t as { urgent?: number }).urgent ?? 0) > 0"));
check('mapa usa el mismo rótulo', mapView.includes('contadorAusLabel(logic.stats.ausentes, logic.stats.ausentesSinCubrir)'));
check('monitor publica ausentesSinCubrir y escucha convocatorias en curso', mapa.includes('ausentesSinCubrir:') && mapa.includes("where('status', 'in', ['PENDING', 'ESCALATED'])") && mapa.includes('s.convocatoriaEnCurso = true'));
check('OBJ pinta el chip de ausencias con sin cubrir', page.includes('<AusChipObj absent={obj.absent} sinCubrir={obj.absentSinCubrir} />') && page.includes('<AusChipObj absent={ev.absent} sinCubrir={ev.absentSinCubrir} />'));
check('la tarjeta usa el estado único (chip + detalle)', page.includes('estadoAusenciaCc(shift)') && page.includes('<EstadoAusenciaChip estado={estadoAus} />') && page.includes('<EstadoAusenciaDetalle estado={estadoAus}'));
check('se fue la caja VENCIDO; queda «Revertir vencido (T+60)»', !page.includes('>VENCIDO<') && page.includes('data-ops-revertir-vencido="1"') && estadoChip.length > 0);
const guardCardEstadoSrc = readFileSync(new URL('../apps/web2/src/lib/operaciones/guardCardEstado.ts', import.meta.url), 'utf8');
check('texto del vencido definido una sola vez', guardCardEstadoSrc.includes("REVERTIR_VENCIDO_TEXTO = 'Revertir vencido (T+60)'"));
const popup = readFileSync(new URL('../apps/web2/src/components/operaciones/OperacionesMapPopup.tsx', import.meta.url), 'utf8');
check('popup del mapa: mismo estado y mismo texto de vencido', popup.includes('estadoAusenciaCc(shift)') && popup.includes('REVERTIR_VENCIDO_TEXTO') && popup.includes("shift.isSinCobertura && shift.isUnassigned"));
const compacto = readFileSync(new URL('../apps/web2/src/lib/movil/guardCompacto.ts', import.meta.url), 'utf8');
check('celular: guardCompacto deriva del mismo estado', compacto.includes('estadoAusenciaCc(shift)') && compacto.includes("'cubriendo'") && compacto.includes("'parcial'"));
check('celular: contador AUS con sin cubrir', movil.includes('export function ausentesSinCubrirMovil') && movil.includes('export function etiquetaAus'));
check('bandeja de alertas: cubierto no entra', movil.includes('estado.kind !== \'CUBIERTO\'') && movil.includes('export function turnoEnBandejaAlertas'));
check('novedad atendida o vista no vuelve a alertas', page.includes('novedadYaResuelta(n)') && page.includes('novedadDeAusenciaCubierta(n, logic.processedData)') && mapView.includes('novedadYaResuelta(n)') && mapView.includes('novedadDeAusenciaCubierta(n, logic.processedData)'));
const planif = readFileSync(new URL('../apps/web2/src/pages/admin/planificacion/index.tsx', import.meta.url), 'utf8');
const sem = readFileSync(new URL('../apps/web2/src/lib/cosp/coverageSemantics.ts', import.meta.url), 'utf8');
check('grilla: REF/ESC usado como cobertura se ve con el código del titular', planif.includes('etiquetaCeldaOpsCoverage(opsShiftForCell)') && sem.includes("ct === 'REF' || ct === 'ESC'") && sem.includes('esRefEsc: true'));

if (failed) {
  console.error(`\n${failed} falla(s)`);
  process.exit(1);
}
console.log('\nparidad OBJ/LISTA ok');
