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

const gapBazan = gap({
  titularShiftId: 'macarena',
  absentEmployeeId: 'macarena',
  objectiveId: 'obrador',
  positionName: 'Puesto 1',
  startMs: hm('2026-09-29T16:00:00-03:00'),
  endMs: hm('2026-09-30T00:00:00-03:00'),
  band: 'T',
});
const franco = (id, day) => ({
  id,
  employeeId: 'bazan',
  employeeName: 'BAZAN, ANA CAROLINA',
  code: 'F',
  isFranco: true,
  objectiveId: 'peaje',
  positionName: 'General',
  startMs: hm(`2026-09-${day}T00:00:00-03:00`),
  endMs: hm(`2026-09-${day}T23:59:59-03:00`),
});
const dedupe = core.buildCoverageCandidates({
  nowMs: hm('2026-09-29T18:30:00-03:00'),
  gap: gapBazan,
  shifts: [franco('f-hoy', '29'), franco('f-manana', '30')],
});
const bazanFt = dedupe.byType.FT.filter((r) => r.employeeId === 'bazan');
report('p9e-dedupe', bazanFt.length === 1 && bazanFt[0].eligible === true && bazanFt[0].sourceShiftId === 'f-hoy',
  bazanFt.map((r) => `${r.sourceShiftId}:${r.eligible}`).join(',') || 'nadie');

const yaCubre = core.buildCoverageCandidates({
  nowMs: hm('2026-09-29T18:40:00-03:00'),
  gap: gapBazan,
  shifts: [
    { ...franco('ft-hoy', '29'), code: 'FT', isFranco: false },
    franco('f-manana', '30'),
    {
      id: 'ops-obrador',
      employeeId: 'bazan',
      employeeName: 'BAZAN, ANA CAROLINA',
      code: 'FT',
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'FT',
      objectiveId: 'obrador',
      positionName: 'Puesto 1',
      startMs: gapBazan.startMs,
      endMs: gapBazan.endMs,
      absenceShiftId: 'macarena',
      isPresent: true,
    },
  ],
});
const ya = yaCubre.byType.FT.filter((r) => r.employeeId === 'bazan');
report('p9e-ya-cubre', ya.length === 1 && ya[0].eligible === false && ya[0].rejectReason === 'SOLAPA_COBERTURA',
  ya[0] ? `${ya[0].sourceShiftId}:${ya[0].rejectReason}` : 'nadie');

const gapNoche = gap({
  titularShiftId: 'otro',
  absentEmployeeId: 'otro',
  objectiveId: 'obrador',
  positionName: 'Puesto 1',
  startMs: hm('2026-09-29T20:00:00-03:00'),
  endMs: hm('2026-09-30T04:00:00-03:00'),
  band: 'N',
});
const tope = core.buildCoverageCandidates({
  nowMs: hm('2026-09-29T18:30:00-03:00'),
  gap: gapNoche,
  shifts: [
    { ...franco('ft-hoy', '29'), code: 'FT', isFranco: false },
    {
      id: 'ops-manana',
      employeeId: 'bazan',
      employeeName: 'BAZAN, ANA CAROLINA',
      code: 'FT',
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'FT',
      objectiveId: 'peaje',
      positionName: 'General',
      startMs: hm('2026-09-29T00:00:00-03:00'),
      endMs: hm('2026-09-29T08:00:00-03:00'),
      absenceShiftId: 'otro-hueco',
      isPresent: true,
    },
  ],
});
const topeRow = tope.byType.FT.find((r) => r.employeeId === 'bazan');
report('p9e-tope', topeRow?.eligible === false && topeRow.rejectReason === 'TOPE_12_59', topeRow?.rejectReason || 'elegible');

const descanso = core.buildCoverageCandidates({
  nowMs: hm('2026-09-29T18:30:00-03:00'),
  gap: gapBazan,
  shifts: [
    { ...franco('ft-hoy', '29'), code: 'FT', isFranco: false },
    {
      id: 'ops-siesta',
      employeeId: 'bazan',
      employeeName: 'BAZAN, ANA CAROLINA',
      code: 'FT',
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'FT',
      objectiveId: 'peaje',
      positionName: 'General',
      startMs: hm('2026-09-29T07:00:00-03:00'),
      endMs: hm('2026-09-29T11:00:00-03:00'),
      absenceShiftId: 'hueco-manana',
      isPresent: true,
    },
  ],
});
const descRow = descanso.byType.FT.find((r) => r.employeeId === 'bazan');
report('p9e-descanso', descRow?.eligible === false && descRow.rejectReason === 'DESCANSO', descRow?.rejectReason || 'elegible');

const geo = await import('../apps/web2/src/lib/operaciones/coverageGeo.ts');
const sinObj = geo.coverageGeoForEmployee({ objectiveId: 'obrador' }, { lat: '-31.3867', lng: '-64.1670' });
report('p9e-geo-objetivo', sinObj.hasGeo === false && sinObj.geoMiss === 'objetivo', sinObj.geoMiss || 'geo');
const conDom = geo.coverageGeoForEmployee(
  { objectiveId: 'obrador', lat: -31.44700088880517, lng: -64.34663142666159 },
  { lat: '-31.386702396379015', lng: '-64.16703988778258' },
);
report('p9e-geo-domicilio', conDom.hasGeo === true && conDom.distanceKm > 1 && conDom.etaMinutes > 0,
  conDom.distanceKm != null ? `${conDom.distanceKm.toFixed(1)} km` : 'sin');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) process.exitCode = 1;
