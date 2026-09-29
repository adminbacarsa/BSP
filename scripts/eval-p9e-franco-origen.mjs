/**
 * Franco origen de una cobertura: no se simula, no entra al pipeline de ausencias,
 * y el portal lo trata igual que functions.
 *
 *   node --experimental-strip-types scripts/eval-p9e-franco-origen.mjs
 */
import { register } from 'node:module';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);
const fn = await import('../apps/functions/src/coverage/coverageTraceShift.ts');
const sim = await import('../apps/functions/src/common/simulableShift.ts');
const portal = await import('../packages/portal-core/src/shifts/francoCoverageOrigin.ts');

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

const origen = {
  id: 'IyiwO0Dyh7LxBKXLkx7a',
  code: 'FT',
  isFranco: false,
  isFrancoTrabajado: true,
  coverageDocId: 'ops_cov_R5MsjwU3eryItmbhRDbZ_textkEqMdkBC4U7Aa3et',
  comments: 'Franco Trabajado (cobertura ops_cov_R5MsjwU3eryItmbhRDbZ_textkEqMdkBC4U7Aa3et)',
  startTime: '2026-09-29T00:00:00-03:00',
  endTime: '2026-09-29T23:59:59-03:00',
  origin: 'PLANIFICADOR',
};
const ops = {
  id: 'ops_cov_R5MsjwU3eryItmbhRDbZ_textkEqMdkBC4U7Aa3et',
  code: 'FT',
  origin: 'OPERATIONS_COVERAGE',
  coverageType: 'FT',
  isPresent: true,
  startTime: '2026-09-29T16:00:00-03:00',
  endTime: '2026-09-30T00:00:00-03:00',
};
const titular = {
  id: 'R5MsjwU3eryItmbhRDbZ',
  code: 'T',
  coverageDocId: ops.id,
  startTime: '2026-09-29T16:00:00-03:00',
  endTime: '2026-09-30T00:00:00-03:00',
};
const francoPlano = {
  code: 'F',
  isFranco: true,
  startTime: '2026-09-30T00:00:00-03:00',
  endTime: '2026-09-30T23:59:59-03:00',
};

report('origen-fn', fn.isFrancoCoverageOriginDoc(origen) === true, 'functions');
report('origen-portal', portal.isFrancoCoverageOriginDoc(origen) === true, 'portal-core');
report('paridad', fn.isFrancoCoverageOriginDoc(origen) === portal.isFrancoCoverageOriginDoc(origen)
  && fn.isFrancoCoverageOriginDoc(ops) === portal.isFrancoCoverageOriginDoc(ops)
  && fn.isFrancoCoverageOriginDoc(titular) === portal.isFrancoCoverageOriginDoc(titular),
  'mismo veredicto');
report('ops-no', fn.isFrancoCoverageOriginDoc(ops) === false, 'el ops_cov se ficha');
report('titular-no', fn.isFrancoCoverageOriginDoc(titular) === false, 'el T cubierto sigue siendo el titular');
report('franco-plano', fn.isFrancoCoverageOriginDoc(francoPlano) === false
  && sim.simulableShiftSkipReason(francoPlano) === 'FRANCO', sim.simulableShiftSkipReason(francoPlano));
report('demo', sim.simulableShiftSkipReason(origen) === 'FRANCO_ORIGEN', sim.simulableShiftSkipReason(origen) || 'simulable');
report('pipeline', fn.skipAbsencePipelineForShift(origen) === true, 'detectarAusencias / crons');
report('puesto', sim.simulableShiftSkipReason({
  code: 'T',
  startTime: '2026-09-29T16:00:00-03:00',
  endTime: '2026-09-30T00:00:00-03:00',
}) === null, 'un T real sigue siendo simulable');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) process.exitCode = 1;
