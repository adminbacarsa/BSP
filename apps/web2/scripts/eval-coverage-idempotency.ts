/**
 * Invariante demo/prod: 1 ausencia → 1 cobertura ops activa.
 * Smoke puro (sin Firestore) para validar el criterio del circuito.
 */
import assert from 'node:assert/strict';

function isTitularAlreadyCovered(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (data.operacionallyCovered === true) return true;
  if (String(data.coverageStatus || '').toUpperCase() === 'COVERED') return true;
  if (data.coveredByEmployeeId) return true;
  if (data.coveredByEmployeeName) return true;
  return false;
}

function isActiveOpsCoverageDoc(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (String(data.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  if (data.coverageSuperseded === true) return false;
  if (String(data.status || '').toUpperCase() === 'CANCELLED') return false;
  if (data.isDeleted === true) return false;
  return true;
}

function countActiveCoveragesForAbsence(
  docs: Array<{ id: string; data: Record<string, unknown> }>,
  absenceShiftId: string,
): number {
  return docs.filter((d) => {
    const linked =
      String(d.data.absenceShiftId || '') === absenceShiftId ||
      String(d.data.coveredShiftId || '') === absenceShiftId;
    return linked && isActiveOpsCoverageDoc(d.data);
  }).length;
}

// --- casos ---
assert.equal(isTitularAlreadyCovered(null), false);
assert.equal(isTitularAlreadyCovered({ isAbsent: true }), false);
assert.equal(
  isTitularAlreadyCovered({ isAbsent: true, operacionallyCovered: true, coveredByEmployeeId: 'e2' }),
  true,
);

const absenceId = 'regalo-shift-1';
const swarm = [
  { id: 'c1', data: { origin: 'OPERATIONS_COVERAGE', absenceShiftId: absenceId, status: 'PENDING' } },
  { id: 'c2', data: { origin: 'OPERATIONS_COVERAGE', absenceShiftId: absenceId, status: 'PENDING' } },
  { id: 'c3', data: { origin: 'OPERATIONS_COVERAGE', absenceShiftId: absenceId, status: 'PENDING' } },
  { id: 'c4', data: { origin: 'OPERATIONS_COVERAGE', absenceShiftId: absenceId, status: 'PENDING' } },
  { id: 'c5', data: { origin: 'OPERATIONS_COVERAGE', absenceShiftId: absenceId, status: 'PENDING' } },
];
assert.equal(countActiveCoveragesForAbsence(swarm, absenceId), 5, 'bug original: 5 coberturas activas');

// Tras supersede: solo 1 queda activa
const cleaned = swarm.map((d, i) =>
  i === 0
    ? d
    : { ...d, data: { ...d.data, coverageSuperseded: true, status: 'CANCELLED' } },
);
assert.equal(countActiveCoveragesForAbsence(cleaned, absenceId), 1, 'invariante: 1 cobertura activa');

// Titular ya cubierto → cascada no debe reabrirse
assert.equal(
  isTitularAlreadyCovered({
    isAbsent: true,
    status: 'ABSENT',
    operacionallyCovered: true,
    coveredByEmployeeName: 'GENOVA, WALTER',
  }),
  true,
);

console.log('OK eval-coverage-idempotency: 1 ausencia = 1 cobertura activa');
