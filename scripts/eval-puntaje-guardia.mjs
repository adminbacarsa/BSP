/**
 * Puntaje de guardias: fixtures del cálculo y desempate dentro del escalón.
 *   node --experimental-strip-types scripts/eval-puntaje-guardia.mjs
 */
import { calcularPuntajeDeFuentes } from '../apps/functions/src/desempeno/puntajeGuardia.ts';
import { buildCoverageCandidates, pickBestCandidate } from '../packages/ops-core/src/coverageCandidates.ts';
import { eventualesParaHueco } from '../packages/ops-core/src/eventoCoverage.ts';
import { ordenarCandidatos } from '../apps/web2/src/lib/eventuales/planificacion.mjs';

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

const ahora = Date.parse('2026-10-02T12:00:00-03:00');
const dia = (n) => ahora - n * 24 * 60 * 60 * 1000;

const base = calcularPuntajeDeFuentes({}, ahora);
report('base', base.total === 80 && base.cumplimiento === 100 && base.disposicion === 50, `total ${base.total}`);

const aa = calcularPuntajeDeFuentes({
  ausencias: [{ id: 'a1', shiftId: 't1', code: 'AA', fechaMs: dia(2), reverted: false }],
}, ahora);
report('aa', aa.cumplimiento === 85 && aa.total === 71, `c ${aa.cumplimiento} t ${aa.total}`);

const revertida = calcularPuntajeDeFuentes({
  ausencias: [{ id: 'a2', shiftId: 't2', code: 'AA', origin: 'AUTO_T30', fechaMs: dia(2), reverted: true }],
}, ahora);
report('revertida', revertida.total === 80, `t ${revertida.total}`);

const licencia = calcularPuntajeDeFuentes({
  ausencias: [{ id: 'a3', code: 'E', fechaMs: dia(1) }],
}, ahora);
report('licencia-guardia', licencia.total === 80 && licencia.detalle.length === 0, `t ${licencia.total}`);

const eventual = calcularPuntajeDeFuentes({
  ausencias: [{ id: 'a4', code: 'E', esEventual: true, fechaMs: dia(1) }],
}, ahora);
report('ausencia-eventual', eventual.cumplimiento === 85, `c ${eventual.cumplimiento}`);

const tarde = calcularPuntajeDeFuentes({
  turnos: [{ id: 'tt', startMs: dia(1), isPresent: true, lateMinutes: 12 }],
}, ahora);
report('tarde-sin-aviso', tarde.detalle.some((d) => d.tipo === 'LLEGADA_TARDE_SIN_AVISO' && d.delta === -8), tarde.detalle.map((d) => d.tipo).join(','));

const avisada = calcularPuntajeDeFuentes({
  turnos: [{ id: 'ta', startMs: dia(1), isPresent: true, lateMinutes: 12, avisoLlegada: true }],
}, ahora);
report('tarde-avisada', avisada.detalle.length === 0, `n ${avisada.detalle.length}`);

const abandono = calcularPuntajeDeFuentes({
  ausencias: [{ id: 'ab', shiftId: 'tab', code: 'AA', fechaMs: dia(3) }],
  turnos: [{ id: 'tab', startMs: dia(3), earlyWithdrawReason: 'ABANDONO' }],
}, ahora);
report('abandono-reemplaza-falta', abandono.detalle.length === 1 && abandono.detalle[0].tipo === 'ABANDONO' && abandono.cumplimiento === 80,
  abandono.detalle.map((d) => d.tipo).join(','));

const ft = calcularPuntajeDeFuentes({
  convocatorias: [{ id: 'c1', tipo: 'FT', status: 'ACCEPTED', fechaMs: dia(1) }],
}, ahora);
report('ft', ft.disposicion === 58 && ft.detalle.some((d) => d.tipo === 'FT_ACEPTADO'), `d ${ft.disposicion}`);

const rechazo = calcularPuntajeDeFuentes({
  convocatorias: [
    { id: 'c2', tipo: 'RET', status: 'REJECTED', fechaMs: dia(1) },
    { id: 'c3', tipo: 'REF', status: 'TIMEOUT', fechaMs: dia(1) },
  ],
}, ahora);
report('rechazo', rechazo.disposicion === 43, `d ${rechazo.disposicion}`);

const demo = calcularPuntajeDeFuentes({
  convocatorias: [{ id: 'cd', tipo: 'FT', status: 'ACCEPTED', fechaMs: dia(1), respondedBy: 'MODO_DEMO' }],
}, ahora);
report('demo', demo.detalle.length === 0, `n ${demo.detalle.length}`);

const viejo = calcularPuntajeDeFuentes({
  ausencias: [{ id: 'old', code: 'AA', fechaMs: dia(91) }],
}, ahora);
report('ventana', viejo.total === 80, `t ${viejo.total}`);

const cancel = calcularPuntajeDeFuentes({
  convocatorias: [{
    id: 'cc', tipo: 'EXTEND', status: 'CANCELLED', fechaMs: dia(1),
    acceptedAtMs: dia(1), cancelledAtMs: dia(1) + 60 * 60 * 1000,
    startMs: dia(1) + 3 * 60 * 60 * 1000,
  }],
}, ahora);
report('cancelacion', cancel.detalle.some((d) => d.tipo === 'EXT_ACEPTADO') && cancel.detalle.some((d) => d.tipo === 'CANCELACION_TARDIA'),
  cancel.detalle.map((d) => d.tipo).join(','));

const tope = calcularPuntajeDeFuentes({
  ausencias: Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, shiftId: `s${i}`, code: 'AA', fechaMs: dia(i + 1) })),
}, ahora);
report('clamp', tope.cumplimiento === 0 && tope.total >= 0 && tope.total <= 100, `c ${tope.cumplimiento} t ${tope.total}`);

const dedup = calcularPuntajeDeFuentes({
  ausencias: [{ id: 'd1', shiftId: 'mismo', code: 'AA', fechaMs: dia(1) }],
  eventos: [{ id: 'e1', tipo: 'FALTA_SIN_AVISO', fechaMs: dia(1), turnoId: 'mismo' }],
}, ahora);
report('dedup', dedup.detalle.filter((d) => d.tipo === 'FALTA_SIN_AVISO').length === 1, `n ${dedup.detalle.length}`);

function adv(id, name) {
  return {
    id, employeeId: id, employeeName: name, code: 'T', objectiveId: 'obj', positionName: 'Recepción',
    startMs: Date.parse('2026-09-28T15:00:00-03:00'),
    endMs: Date.parse('2026-09-28T23:00:00-03:00'),
    isPresent: false, isCompleted: false,
  };
}
const gap = {
  titularShiftId: 'gap', absentEmployeeId: 'ausente', objectiveId: 'obj', positionName: 'Recepción',
  startMs: Date.parse('2026-09-28T07:00:00-03:00'), endMs: Date.parse('2026-09-28T15:00:00-03:00'), band: 'M',
};
const nowMs = Date.parse('2026-09-28T08:00:00-03:00');
const conPuntaje = buildCoverageCandidates({ nowMs, gap, shifts: [adv('ana', 'Ana'), adv('zoe', 'Zoe')], puntajePorEmpleado: { ana: 40, zoe: 90 } });
report('desempate', pickBestCandidate(conPuntaje, 'ADVANCE')?.employeeId === 'zoe', pickBestCandidate(conPuntaje, 'ADVANCE')?.employeeId || 'nadie');
const sinPuntaje = buildCoverageCandidates({ nowMs, gap, shifts: [adv('ana', 'Ana'), adv('zoe', 'Zoe')] });
report('sin-puntaje', pickBestCandidate(sinPuntaje, 'ADVANCE')?.employeeId === 'ana', pickBestCandidate(sinPuntaje, 'ADVANCE')?.employeeId || 'nadie');
const uno = buildCoverageCandidates({ nowMs, gap, shifts: [adv('ana', 'Ana'), adv('zoe', 'Zoe')], puntajePorEmpleado: { zoe: 90 } });
report('puntaje-parcial', pickBestCandidate(uno, 'ADVANCE')?.employeeId === 'ana', pickBestCandidate(uno, 'ADVANCE')?.employeeId || 'nadie');

const bolsaBase = {
  disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['emp'], credencialVencimiento: '2026-12-01',
  aptoPsicofisico: { estado: 'APTO', vencimiento: '2026-12-01' },
  marcos: { emp: { firmado: true, estado: 'VIGENTE', vencimiento: '2026-12-01' } }, confiabilidad: 5,
};
const evs = eventualesParaHueco({
  bolsa: [
    { ...bolsaBase, cuil: 'ana', nombre: 'Ana', puntaje: 40 },
    { ...bolsaBase, cuil: 'zoe', nombre: 'Zoe', puntaje: 90 },
  ],
  hueco: { empresaId: 'emp', startMs: dia(1), endMs: dia(1) + 8 * 60 * 60 * 1000, hoyYmd: '2026-10-01' },
});
report('eventuales', evs[0]?.cuil === 'zoe' && evs[1]?.cuil === 'ana', evs.map((r) => r.cuil).join(','));

const orden = ordenarCandidatos([
  { elegible: true, distanciaKm: 3, confiabilidad: 5, nombre: 'Ana', puntaje: 40, cuil: 'ana' },
  { elegible: true, distanciaKm: 3, confiabilidad: 5, nombre: 'Zoe', puntaje: 90, cuil: 'zoe' },
]);
report('ordenar', orden[0].cuil === 'zoe', orden.map((r) => r.cuil).join(','));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) process.exitCode = 1;
