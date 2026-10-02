/**
 * Paridad del hueco de evento: ops-core y functions son el mismo archivo.
 *   node --experimental-strip-types scripts/eval-evento-coverage-parity.mjs
 */
import fs from 'fs';
import path from 'path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const aPath = path.join(root, 'packages/ops-core/src/eventoCoverage.ts');
const bPath = path.join(root, 'apps/functions/src/eventos/eventoCoverage.ts');
const a = fs.readFileSync(aPath, 'utf8');
const b = fs.readFileSync(bPath, 'utf8');
const core = await import(pathToFileURL(aPath).href);
const fn = await import(pathToFileURL(bPath).href);

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

report('archivo', a === b, a === b ? 'mismo archivo' : 'copias distintas');
report('es evento', core.isEventoShift({ code: 'EV' }) && fn.isEventoShift({ origin: 'EVENTO' }) && !core.isEventoShift({ code: 'M', eventoId: 'x' }), '');
report('sin continuidad', core.eventoTieneFranjasEncadenadas({}) === false && fn.eventoTieneFranjasEncadenadas({ eventoFranjasEncadenadas: true }) === true, '');
report('bolsa vacia', core.eventualesParaHueco().length === 0 && fn.eventualesParaHueco().length === 0, '');
report('orden evento', core.EVENT_COVERAGE_CASCADE_ORDER.join(',') === 'EVENTUAL,REF,ESC,EXTEND,ADVANCE,FT', core.EVENT_COVERAGE_CASCADE_ORDER.join(','));
report('orden objetivo', core.OBJECTIVE_COVERAGE_WITH_EVENTUAL.join(',') === 'RET,REF,ESC,EXTEND,ADVANCE,EVENTUAL,FT', core.OBJECTIVE_COVERAGE_WITH_EVENTUAL.join(','));
const hueco = { empresaId: 'e1', startMs: Date.parse('2026-10-02T10:00:00-03:00'), endMs: Date.parse('2026-10-02T18:00:00-03:00'), lat: -31.4, lng: -64.2, hoyYmd: '2026-10-02' };
const base = { disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['e1'], credencialVencimiento: '2027-01-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-01-01' }, uid: 'u', marcos: { e1: { firmado: true, fechaFirma: '2026-03-01', vigenciaDias: 365 } } };
const cerca = { ...base, cuil: '20111111111', nombre: 'Cerca', confiabilidad: 1, domicilioGeo: { lat: -31.41, lng: -64.21 } };
const lejos = { ...base, cuil: '20222222222', nombre: 'Lejos', confiabilidad: 9, domicilioGeo: { lat: -32.9, lng: -68.8 } };
const cruce = { ...base, cuil: '20333333333', nombre: 'Cruce', confiabilidad: 5, domicilioGeo: { lat: -31.4, lng: -64.2 } };
const lista = core.eventualesParaHueco({
  bolsa: [lejos, cruce, cerca],
  hueco,
  otrasJornadas: [{ cuil: '20333333333', empresaId: 'e2', startMs: hueco.startMs - 8 * 3600000, endMs: hueco.startMs - 6 * 3600000 }],
});
report('orden distancia', lista.map((r) => r.cuil).join(',') === '20111111111,20222222222' && !lista.some((r) => r.cuil === '20333333333'), lista.map((r) => r.nombre).join(','));
report('cruce espejo', fn.eventualesParaHueco({ bolsa: [cruce], hueco, otrasJornadas: [{ cuil: cruce.cuil, empresaId: 'e2', startMs: hueco.startMs - 8 * 3600000, endMs: hueco.startMs - 6 * 3600000 }] }).length === 0, '');
// Sin marco: el CC lo muestra bloqueado, salvo que además tenga otro bloqueo (ahí no aparece).
const sinMarco = { ...cerca, cuil: '20444444444', nombre: 'SinMarco', marcos: {} };
const soloMarco = core.eventualesParaHueco({ bolsa: [sinMarco], hueco });
report('sin marco visible bloqueado', soloMarco.length === 1 && soloMarco[0].elegible === false && soloMarco[0].motivoCodigo === 'SIN_MARCO', JSON.stringify(soloMarco.map((r) => [r.cuil, r.elegible, r.motivo])));
report('sin marco y con cruce no aparece', core.eventualesParaHueco({ bolsa: [sinMarco], hueco, otrasJornadas: [{ cuil: sinMarco.cuil, empresaId: 'e2', startMs: hueco.startMs - 8 * 3600000, endMs: hueco.startMs - 6 * 3600000 }] }).length === 0, '');
// Planificación: toda la bolsa con motivo y multi-jornada (dos días; la segunda cruza con una jornada ajena).
const dia2 = { startMs: hueco.startMs + 24 * 3600000, endMs: hueco.endMs + 24 * 3600000 };
const multi = core.eventualesParaHueco({
  bolsa: [lejos, cruce, cerca],
  hueco: { ...hueco, jornadas: [{ startMs: hueco.startMs, endMs: hueco.endMs }, dia2] },
  otrasJornadas: [{ cuil: '20333333333', empresaId: 'e2', startMs: dia2.startMs - 8 * 3600000, endMs: dia2.startMs - 6 * 3600000 }],
  incluirNoElegibles: true,
});
report('multi-jornada con motivo', multi.map((r) => `${r.nombre}:${r.elegible ? 'ok' : r.motivoCodigo}`).join(',') === 'Cerca:ok,Lejos:ok,Cruce:DESCANSO_12H', multi.map((r) => `${r.nombre}:${r.elegible ? 'ok' : r.motivoCodigo}`).join(','));
report('multi-jornada espejo', JSON.stringify(fn.eventualesParaHueco({ bolsa: [lejos, cruce, cerca], hueco: { ...hueco, jornadas: [{ startMs: hueco.startMs, endMs: hueco.endMs }, dia2] }, otrasJornadas: [{ cuil: '20333333333', empresaId: 'e2', startMs: dia2.startMs - 8 * 3600000, endMs: dia2.startMs - 6 * 3600000 }], incluirNoElegibles: true })) === JSON.stringify(multi), '');
const plan = core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', eventoId: 'ev', shiftId: 's', isEventual: true, punched: false });
report('eventual sin fichar', plan?.arcaBajaPendiente === true && plan.descuentaLiquidacion === true && plan.confiabilidadDelta === -1 && plan.desempeno === 'FALTA_SIN_AVISO' && plan.arca.accion === 'CANCELAR_AT', JSON.stringify(plan));
report('no eventual', core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', isEventual: false }) === null, '');
const { plazoAnulacionAlta } = await import('../apps/web2/src/lib/eventuales/plazoAnulacion.mjs');
const inicio = Date.parse('2026-10-05T08:00:00-03:00');
const feriados = [{ date: '2026-01-01', type: 'Nacional' }];
const dentro = plazoAnulacionAlta({ fechaInicio: '2026-10-05', horaInicio: '08:00', ahoraMs: inicio - 2 * 3600000, feriados });
const anula = core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', isEventual: true, aviso: true, atSubido: true, inicioMs: inicio, ahoraMs: inicio - 2 * 3600000, fechaInicio: '2026-10-05', puedeAnular: dentro.puedeAnular });
report('aviso con AT subido dentro del plazo → ANULACION sin motivo', anula?.arca.accion === 'ANULACION' && anula.arca.tipo === 'ANULACION' && anula.arca.movimiento == null && anula.arca.motivo == null && anula.arca.modulo === 'ANULACION_INCORPORACIONES' && anula.arca.bruto === 0 && anula.arca.canal === 'URGENTE' && anula.desempeno === 'CANCELACION_TARDIA', anula?.desempeno || '');
const anticipo = core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', isEventual: true, aviso: true, atSubido: false, inicioMs: inicio, ahoraMs: inicio - 30 * 3600000 });
report('aviso con más de 24 h y AT sin subir → cancela el AT', anticipo?.arca.accion === 'CANCELAR_AT' && anticipo.desempeno === 'CANCELACION_ANTICIPADA', anticipo?.desempeno || '');
const fuera = plazoAnulacionAlta({ fechaInicio: '2026-10-05', horaInicio: '08:00', ahoraMs: inicio + 30 * 3600000, feriados });
const baja = core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', isEventual: true, aviso: false, atSubido: true, inicioMs: inicio, ahoraMs: inicio + 30 * 3600000, fechaInicio: '2026-10-05', puedeAnular: fuera.puedeAnular });
report('fuera de plazo → BAJA el día de inicio, desistimiento', baja?.arca.tipo === 'BAJA_NO_PRESENTACION' && baja.arca.movimiento === 'BT' && baja.arca.fechaBaja === '2026-10-05' && baja.arca.revista === '30' && baja.arca.canal === 'URGENTE' && baja.arca.motivo === 'desistimiento / sin efectivización de tareas' && baja.arca.constanciaInterna === 'NO_SE_PRESENTO' && baja.desempeno === 'FALTA_SIN_AVISO' && baja.descuentaLiquidacion === true && fuera.puedeAnular === false, baja?.arca.tipo || '');

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
