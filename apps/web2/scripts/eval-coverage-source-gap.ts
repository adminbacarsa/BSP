/**
 * Eval solape REF/ESC/RET vs hueco (caso Gaitán ESC 16–00 vs titular 08–18).
 *   npx tsx apps/web2/scripts/eval-coverage-source-gap.ts
 */
import { sourceShiftEligibleForCoverageGap } from '../src/lib/operaciones/coverageSourceShiftForGap';

function ar(iso: string) {
  return new Date(iso).getTime();
}

function report(id: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
  if (!ok) process.exitCode = 1;
}

const gapRomero = {
  startMs: ar('2026-09-24T08:00:00-03:00'),
  endMs: ar('2026-09-24T18:00:00-03:00'),
  band: 'M',
};

const escGaitanBad = {
  code: 'ESC',
  startTime: new Date('2026-09-24T16:00:00-03:00'),
  endTime: new Date('2026-09-25T00:00:00-03:00'),
  deploymentBand: 'N',
};

const escSameBandOk = {
  code: 'ESC',
  startTime: new Date('2026-09-24T08:00:00-03:00'),
  endTime: new Date('2026-09-24T16:00:00-03:00'),
  deploymentBand: 'M',
};

const refOk = {
  code: 'REF',
  startTime: new Date('2026-09-24T08:00:00-03:00'),
  endTime: new Date('2026-09-24T18:00:00-03:00'),
  deploymentBand: 'M',
};

report(
  'gaitan-esc-tarde-rechazado',
  !sourceShiftEligibleForCoverageGap(escGaitanBad, gapRomero),
  'ESC 16–00 no cubre hueco 08–18',
);
report(
  'esc-misma-banda-inicio',
  sourceShiftEligibleForCoverageGap(escSameBandOk, gapRomero),
  'ESC 08–16 banda M',
);
report(
  'ref-solape',
  sourceShiftEligibleForCoverageGap(refOk, gapRomero),
  'REF 08–18',
);

console.log('\nFin eval coverage source gap');
