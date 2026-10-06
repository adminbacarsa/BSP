/**
 * Paridad isRetShift ops-core / functions y solapas del CC.
 *   node scripts/eval-ret-no-ausente-parity.mjs
 */
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(pathToFileURL(join(root, 'packages/ops-core/src/retShift.ts')).href);
const fn = await import(pathToFileURL(join(root, 'apps/functions/src/common/retShift.ts')).href);
const { classifyOpsShift } = await import(pathToFileURL(join(root, 'packages/ops-core/src/classifyOpsShift.ts')).href);
const { shiftMatchesOpsViewTab } = await import(pathToFileURL(join(root, 'packages/ops-core/src/shiftMatchesOpsViewTab.ts')).href);
const { isPassiveRetStandbyShift } = await import(pathToFileURL(join(root, 'packages/ops-core/src/passiveRetShift.ts')).href);

const midnight = new Date(2026, 9, 6, 0, 0, 0, 0);
const fixtures = [
  { code: 'RET', positionName: 'Retén', type: 'Retén', deploymentRole: 'POOL', countsForCoverage: false, isReten: false },
  { shiftCode: 'RET', isReten: false },
  { positionName: 'Retén', code: 'M' },
  { type: 'Retén' },
  { deploymentRole: 'POOL', countsForCoverage: false, code: 'X' },
  { deploymentRole: 'POOL', countsForCoverage: true, code: 'M' },
  { isReten: true, code: 'M' },
  { code: 'T', positionName: 'Puesto 1' },
  { code: 'RET', origin: 'RETEN', isRetention: true },
  { code: 'RET', coverageUsed: true },
  null,
];

let failed = 0;
function check(id, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

for (const [i, row] of fixtures.entries()) {
  const a = core.isRetShift(row);
  const b = fn.isRetShift(row);
  check(`ret-${i}`, a === b, `core=${a} fn=${b}`);
}

const zero = { startTime: midnight, endTime: midnight };
const ocho = { startTime: midnight, endTime: new Date(midnight.getTime() + 8 * 3600000) };
check('cero', core.isZeroDurationShift(zero) === true && fn.isZeroDurationShift(zero) === true, '00:00');
check('ocho', core.isZeroDurationShift(ocho) === false && fn.isZeroDurationShift(ocho) === false, '8h');
check('pool-no', core.isRetShift(fixtures[5]) === false, 'pool con cobertura');
check('puesto', core.isRetShift(fixtures[2]) === true, 'position Retén');
check('standby', isPassiveRetStandbyShift(fixtures[0]) === true, 'planificado');
check('origen-reten', isPassiveRetStandbyShift(fixtures[8]) === false, 'ya en puesto');
check('usado', isPassiveRetStandbyShift(fixtures[9]) === false, 'coverageUsed sigue visible');

const now = new Date(2026, 9, 6, 8, 0, 0, 0);
const ret = classifyOpsShift({
  shift: {
    ...fixtures[0],
    isAbsent: true,
    absenceDetectedBy: 'AUTO_T30',
    vacancyOrigin: 'ABSENCE',
    employeeId: 'q',
    shiftDateObj: midnight,
    endDateObj: midnight,
  },
  now,
  isValidEmployee: true,
  isFranco: false,
  shiftCode: 'RET',
});
check('classify-ausente', ret.isAbsent === false && ret.isPassiveRetStandby === true && ret.opensCoverageVacancy === false, 'no AA en el CC');

const view = {
  ...fixtures[0],
  ...ret,
  code: 'RET',
  isUnassigned: false,
  shiftDateObj: midnight,
  endDateObj: midnight,
};
check('tab-vac', shiftMatchesOpsViewTab(view, 'VACANTES', now) === false, 'no VAC');
check('tab-aus', shiftMatchesOpsViewTab(view, 'AUSENTES', now) === false, 'no AUS');
check('tab-plan', shiftMatchesOpsViewTab(view, 'PLAN', now) === true, 'stand-by en PLAN');

const titular = classifyOpsShift({
  shift: {
    code: 'T',
    isAbsent: true,
    employeeId: 'v',
    positionName: 'Puesto 1',
    shiftDateObj: new Date(2026, 9, 6, 16, 0, 0, 0),
    endDateObj: new Date(2026, 9, 6, 17, 0, 0, 0),
  },
  now,
  isValidEmployee: true,
  isFranco: false,
  shiftCode: 'T',
});
const vacView = { ...titular, code: 'T', isUnassigned: false, shiftDateObj: new Date(2026, 9, 6, 16, 0, 0, 0), endDateObj: new Date(2026, 9, 6, 17, 0, 0, 0) };
check('titular-vac', shiftMatchesOpsViewTab(vacView, 'VACANTES', now) === true, 'un T ausente sigue VAC');
check('titular-aus', shiftMatchesOpsViewTab(vacView, 'AUSENTES', now) === true, 'un T ausente sigue AUS');

if (failed) {
  console.error(`FALLA ${failed}`);
  process.exit(1);
}
console.log('paridad RET ok');
