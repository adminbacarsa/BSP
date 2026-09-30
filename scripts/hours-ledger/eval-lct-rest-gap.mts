/**
 * Art. 197: fin planificado, o fin real si el turno ya cerró. El tope no se supone.
 * npx tsx scripts/hours-ledger/eval-lct-rest-gap.mts
 */
import { findLctRestGaps } from '../../apps/web2/src/lib/planificacion/lctRestGap.ts';

function fail(msg: string): never {
  throw new Error(msg);
}

const manana = findLctRestGaps([
  { employeeId: 'e1', code: 'M', dateStr: '2026-09-15', startTime: '07:00', endTime: '15:00', objectiveId: 'A' },
  { employeeId: 'e1', code: 'M', dateStr: '2026-09-16', startTime: '07:00', endTime: '15:00', objectiveId: 'A' },
]);
if (manana.length !== 0) fail(`M→M al día siguiente no es aviso (fin 15:00 → 07:00 = 16 h), marcó ${manana.length}`);

const tardeManana = findLctRestGaps([
  { employeeId: 'e1', code: 'T', dateStr: '2026-09-15', startTime: '15:00', endTime: '23:00', objectiveId: 'A' },
  { employeeId: 'e1', code: 'M', dateStr: '2026-09-16', startTime: '07:00', endTime: '15:00', objectiveId: 'B', objectiveName: 'Otro' },
]);
if (tardeManana.length !== 1) fail(`T 15-23 → M 07 debía avisar, marcó ${tardeManana.length}`);
if (tardeManana[0].closeAtLabel !== '23:00' || tardeManana[0].nextStartLabel !== '07:00') fail(`reloj T→M ${tardeManana[0].closeAtLabel} → ${tardeManana[0].nextStartLabel}`);
if (Math.round(tardeManana[0].gapHours) !== 8) fail(`T→M gap ${tardeManana[0].gapLabel}`);
if (!tardeManana[0].crossObjective) fail('T→M entre objetivos tiene que marcarlo');
if (!tardeManana[0].message.includes('fin 23:00')) fail(tardeManana[0].message);

const tope = findLctRestGaps([
  {
    employeeId: 'g1', employeeName: 'Giupponi', code: 'T', dateStr: '2026-09-15',
    startTime: '15:00', endTime: '23:00', realEndTime: '2026-09-16T03:59:00.000-03:00',
    objectiveId: 'A', objectiveName: 'Objetivo A',
  },
  { employeeId: 'g1', employeeName: 'Chavero', code: 'T', dateStr: '2026-09-16', startTime: '15:00', endTime: '23:00', objectiveId: 'B', objectiveName: 'Objetivo B' },
]);
if (tope.length !== 1) fail(`cierre real 03:59 → T 15:00 debía avisar, marcó ${tope.length}`);
const g = tope[0];
if (g.closeAtLabel !== '03:59' || g.nextStartLabel !== '15:00') fail(`reloj tope ${g.closeAtLabel} → ${g.nextStartLabel}`);
if (Math.round(g.gapHours * 60) !== 11 * 60 + 1) fail(`gap tope ${g.gapLabel}`);
if (!g.crossObjective) fail('el cierre por tope entre objetivos tiene que verse');
if (!g.message.includes('cierre real')) fail(g.message);

const mismoTurno = findLctRestGaps([
  { employeeId: 'g1', code: 'T', dateStr: '2026-09-15', startTime: '15:00', endTime: '23:00', objectiveId: 'A' },
  { employeeId: 'g1', code: 'T', dateStr: '2026-09-16', startTime: '15:00', endTime: '23:00', objectiveId: 'A' },
]);
if (mismoTurno.length !== 0) fail('T 15-23 → T 15 sin cierre real son 16 h, no aviso');

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
