/**
 * Smoke lógico (sin Firestore) — casos 1–8 del contrato applyCoverage.
 * Ejecutar: npx tsx scripts/eval-coverage-acceptance-smoke.ts (desde apps/web2)
 */
import assert from 'node:assert/strict';
import {
  isDualSiblingOpsCoverage,
  isTitularAlreadyCovered,
} from '../src/lib/operaciones/coverageTitularState';
function isTitularOpsCoverageClosed(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const st = String(data.coverageStatus || '').toUpperCase();
  if (st === 'PLANNED' || st === 'PARTIAL') return false;
  if (data.operacionallyCovered === true) return true;
  if (st === 'COVERED') return true;
  const covId = String(data.coverageDocId || '').trim();
  if (covId && (data.operacionallyCovered === true || st === 'COVERED')) return true;
  return false;
}

assert.equal(isTitularAlreadyCovered({ coverageStatus: 'PARTIAL', operacionallyCovered: false }), false);
assert.equal(isTitularAlreadyCovered({ coverageStatus: 'PLANNED' }), false);
assert.equal(isTitularAlreadyCovered({ operacionallyCovered: true }), true);
assert.equal(isTitularAlreadyCovered({ coverageStatus: 'COVERED' }), true);
assert.equal(
  isTitularAlreadyCovered({ operacionallyCovered: true, coverageDocId: '' }),
  true,
  'legacy sin coverageDocId',
);

assert.equal(isTitularOpsCoverageClosed({ coverageStatus: 'PARTIAL', coverageDocId: 'x' }), false);
assert.equal(isTitularOpsCoverageClosed({ coverageStatus: 'COVERED', coverageDocId: 'x' }), true);

assert.equal(isDualSiblingOpsCoverage('EXTEND', 'ADVANCE'), true);
assert.equal(isDualSiblingOpsCoverage('EXTEND', 'RET'), false);

console.log('OK eval-coverage-acceptance-smoke (lógica PARTIAL/dual/legacy)');
