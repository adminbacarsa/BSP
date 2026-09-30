/**
 * Art. 197: T 15:00 cerrado por tope 03:59 y T 15:00 siguiente = 11 h 01 min, también entre objetivos.
 * npx tsx scripts/hours-ledger/eval-lct-rest-gap.mts
 */
import { findLctRestGaps } from '../../apps/web2/src/lib/planificacion/lctRestGap.ts';

function fail(msg: string): never {
  throw new Error(msg);
}

const giupponi = findLctRestGaps([
  { employeeId: 'g1', employeeName: 'Giupponi', code: 'T', dateStr: '2026-09-15', startTime: '15:00', endTime: '23:00', objectiveId: 'A', objectiveName: 'Objetivo A' },
  { employeeId: 'g1', employeeName: 'Giupponi', code: 'T', dateStr: '2026-09-16', startTime: '15:00', endTime: '23:00', objectiveId: 'B', objectiveName: 'Objetivo B' },
]);
if (giupponi.length !== 1) fail(`Giupponi/Chavero debía marcar 1, marcó ${giupponi.length}`);
const g = giupponi[0];
if (g.closeAtLabel !== '03:59' || g.nextStartLabel !== '15:00') fail(`reloj ${g.closeAtLabel} → ${g.nextStartLabel}`);
const min = Math.round(g.gapHours * 60);
if (min !== 11 * 60 + 1) fail(`gap ${g.gapLabel} (${min} min)`);
if (!g.crossObjective) fail('tiene que ver el descanso entre objetivos');
if (!g.cellKeys.includes('g1_2026-09-15') || !g.cellKeys.includes('g1_2026-09-16')) fail(`celdas ${g.cellKeys.join(',')}`);

const ok = findLctRestGaps([
  { employeeId: 'g1', code: 'T', dateStr: '2026-09-15', startTime: '15:00', endTime: '23:00', objectiveId: 'A' },
  { employeeId: 'g1', code: 'T', dateStr: '2026-09-17', startTime: '15:00', endTime: '23:00', objectiveId: 'A' },
]);
if (ok.length !== 0) fail('con un día de por medio el tope deja más de 12 h');

const franco = findLctRestGaps([
  { employeeId: 'g1', code: 'N', dateStr: '2026-09-15', startTime: '23:00', endTime: '07:00', objectiveId: 'A' },
  { employeeId: 'g1', code: 'F', dateStr: '2026-09-16', startTime: '00:00', endTime: '23:59', objectiveId: 'A' },
  { employeeId: 'g1', code: 'M', dateStr: '2026-09-17', startTime: '07:00', endTime: '15:00', objectiveId: 'A' },
]);
if (franco.length !== 0) fail('el franco no es jornada y no acorta el descanso');

const continuo = findLctRestGaps([
  { employeeId: 'g1', code: 'M', dateStr: '2026-09-15', startTime: '07:00', endTime: '15:00', objectiveId: 'A' },
  { employeeId: 'g1', code: 'T', dateStr: '2026-09-15', startTime: '15:00', endTime: '23:00', objectiveId: 'A' },
]);
if (continuo.length !== 0) fail('M seguido de T el mismo día es una jornada, no un descanso');

console.log('LCT_REST_GAP_OK');
