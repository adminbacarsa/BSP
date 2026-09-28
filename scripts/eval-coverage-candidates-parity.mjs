/**
 * Paridad de candidatos: la copia de functions y @cosp/ops-core son el mismo módulo,
 * y los casos de las reglas P2 dan el mismo resultado.
 *
 *   node --experimental-strip-types scripts/eval-coverage-candidates-parity.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = fs.readFileSync(path.join(root, 'packages/ops-core/src/coverageCandidates.ts'), 'utf8');
const b = fs.readFileSync(path.join(root, 'apps/functions/src/coverage/coverageCandidates.ts'), 'utf8');

const core = await import('../packages/ops-core/src/coverageCandidates.ts');
const fn = await import('../apps/functions/src/coverage/coverageCandidates.ts');

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

report('archivo', a === b, a === b ? 'ops-core y functions/src son el mismo archivo' : 'las copias difieren');

const order = ['RET', 'REF', 'ESC', 'EXTEND', 'ADVANCE', 'FT'];
report('orden', JSON.stringify(core.COVERAGE_CASCADE_ORDER) === JSON.stringify(order)
  && JSON.stringify(fn.COVERAGE_CASCADE_ORDER) === JSON.stringify(order),
  core.COVERAGE_CASCADE_ORDER.join('→'));

const hm = (iso) => Date.parse(iso);

function gap(partial) {
  return {
    titularShiftId: 'gap',
    absentEmployeeId: 'ausente',
    objectiveId: 'obj',
    positionName: 'Recepción',
    startMs: hm('2026-09-28T07:00:00-03:00'),
    endMs: hm('2026-09-28T15:00:00-03:00'),
    band: 'M',
    ...partial,
  };
}

const nowMs = hm('2026-09-28T08:00:00-03:00');

const zombie = {
  id: 'zombi',
  employeeId: 'ausente',
  employeeName: 'Quevedo',
  code: 'M',
  objectiveId: 'obj',
  positionName: 'Recepción',
  startMs: hm('2026-09-20T07:00:00-03:00'),
  endMs: hm('2026-09-20T15:00:00-03:00'),
  isPresent: true,
  isCompleted: false,
};

const extOk = {
  id: 'ext',
  employeeId: 'ext-ok',
  employeeName: 'Noche',
  code: 'N',
  objectiveId: 'obj',
  positionName: 'Recepción',
  startMs: hm('2026-09-27T23:00:00-03:00'),
  endMs: hm('2026-09-28T07:00:00-03:00'),
  isPresent: true,
  isCompleted: false,
};

const advMismo = {
  id: 'adv-mismo',
  employeeId: 'adv-mismo',
  employeeName: 'Tarde mismo puesto',
  code: 'T',
  objectiveId: 'obj',
  positionName: 'Recepción',
  startMs: hm('2026-09-28T15:00:00-03:00'),
  endMs: hm('2026-09-28T23:00:00-03:00'),
  isPresent: false,
  isCompleted: false,
};

const advOtro = {
  id: 'adv-otro',
  employeeId: 'ceb',
  employeeName: 'Ceballos',
  code: 'T',
  objectiveId: 'obj',
  positionName: 'Control y Vigilancia',
  startMs: hm('2026-09-28T15:00:00-03:00'),
  endMs: hm('2026-09-28T23:00:00-03:00'),
  isPresent: false,
  isCompleted: false,
};

const input = {
  nowMs,
  gap: gap(),
  shifts: [zombie, extOk, advMismo, advOtro],
  absences: [{
    employeeId: 'lic',
    code: 'V',
    status: 'Confirmada',
    startMs: hm('2026-09-28T00:00:00-03:00'),
    endMs: hm('2026-09-28T23:59:00-03:00'),
  }],
  employees: [{ id: 'lic', name: 'Licencia RRHH' }],
};

const left = core.buildCoverageCandidates(input);
const right = fn.buildCoverageCandidates(input);
report('paridad', JSON.stringify(left) === JSON.stringify(right), 'buildCoverageCandidates idéntico en las dos copias');

const ext = left.byType.EXTEND.find((r) => r.employeeId === 'ausente');
report('r1-zombi', ext?.eligible === false && ext?.rejectReason === 'ES_EL_AUSENTE',
  ext ? `${ext.rejectReason}` : 'no aparece');

const extBest = core.pickBestCandidate(left, 'EXTEND');
report('r3-ext', extBest?.employeeId === 'ext-ok' && extBest.sourceShiftId === 'ext',
  extBest ? extBest.employeeName : 'nadie');

const advBest = core.pickBestCandidate(left, 'ADVANCE');
report('r4-puesto', advBest?.employeeId === 'adv-mismo' && advBest.otherPosition === false,
  advBest ? `${advBest.employeeName} otro=${advBest.otherPosition}` : 'nadie');

const otro = left.byType.ADVANCE.find((r) => r.employeeId === 'ceb');
report('r4-etiqueta', otro?.eligible === true && otro.otherPosition === true, otro ? `otro=${otro.otherPosition}` : 'no');

const ramos = core.buildCoverageCandidates({
  nowMs,
  gap: gap({
    titularShiftId: 'ramos',
    endMs: hm('2026-09-28T17:00:00-03:00'),
    band: 'M1',
    positionName: 'Bunker',
  }),
  shifts: [advOtro],
});
const ramosRow = ramos.byType.ADVANCE.find((r) => r.employeeId === 'ceb');
report('ramos', ramosRow?.eligible === false && ramosRow.rejectReason === 'NO_CONTIGUO',
  ramosRow?.rejectReason || 'no');

const lic = left.rejected.filter((r) => r.employeeId === 'lic');
report('r2-ausencias', lic.length > 0 && lic.every((r) => r.rejectReason === 'LICENCIA_RRHH')
  && !left.eligible.some((r) => r.employeeId === 'lic'),
  `rechazos ${lic.length}`);

const largo = {
  ...extOk,
  id: 'largo',
  employeeId: 'largo',
  employeeName: 'Jornada larga',
  realStartMs: hm('2026-09-27T18:00:00-03:00'),
};
const cap = core.buildCoverageCandidates({ nowMs, gap: gap(), shifts: [largo] });
const capRow = cap.byType.EXTEND.find((r) => r.employeeId === 'largo');
report('r5-tope', capRow?.rejectReason === 'TOPE_12_59', capRow?.rejectReason || 'elegible');

const busy = core.buildCoverageCandidates({
  ...input,
  engagements: [{ employeeId: 'ext-ok', shiftId: 'otro-hueco', status: 'PENDING' }],
});
const busyRow = busy.byType.EXTEND.find((r) => r.employeeId === 'ext-ok');
report('r8', busyRow?.rejectReason === 'YA_CONVOCADO', busyRow?.rejectReason || 'elegible');

const accept = core.acceptanceStillValid(
  { ...input, purpose: 'accept' },
  'ADVANCE',
  'ceb',
  'adv-otro',
);
report('r10-ok', accept.ok === true, accept.message || 'acepta');

const acceptBad = core.acceptanceStillValid(
  {
    nowMs,
    purpose: 'accept',
    gap: gap({ endMs: hm('2026-09-28T17:00:00-03:00'), band: 'M1', titularShiftId: 'ramos' }),
    shifts: [advOtro],
  },
  'ADVANCE',
  'ceb',
  'adv-otro',
);
report('r10-rechaza', acceptBad.ok === false && !!acceptBad.message, acceptBad.message || acceptBad.reason || 'sin mensaje');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) process.exitCode = 1;
