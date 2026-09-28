/**
 * P7 — ESC/REF/RET no relevan; ops_cov de cobertura sí; badge de código.
 *   npx tsx apps/web2/scripts/eval-p7-relevo-codigos.ts
 */
import {
  isExtraNonReliefShift,
  isReliefEligibleShift,
  opsShiftCodeBadge,
  reliefIneligibleReason,
} from '@cosp/ops-core';

function report(id: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
  if (!ok) process.exitCode = 1;
}

report(
  'esc-plan',
  reliefIneligibleReason({ code: 'ESC', positionName: 'Puesto 1' }) === 'EXTRA_NO_RELEVA'
    && !isReliefEligibleShift({ code: 'ESC' })
    && isExtraNonReliefShift({ code: 'ESC' }),
  'ESC planificado no releva',
);

report(
  'ref-ret',
  isExtraNonReliefShift({ code: 'REF' }) && isExtraNonReliefShift({ type: 'RET' }),
  'REF y RET (alias type) no relevan',
);

report(
  'base-m',
  isReliefEligibleShift({ code: 'M' }) && opsShiftCodeBadge({ code: 'M' })?.code === 'M',
  'M titular sí releva y muestra badge',
);

report(
  'franco-licencia',
  !isReliefEligibleShift({ code: 'F' }) && !isReliefEligibleShift({ code: 'V' }),
  'franco y licencia no relevan',
);

report(
  'ops-cov-ft',
  isReliefEligibleShift({
    code: 'FT',
    origin: 'OPERATIONS_COVERAGE',
    status: 'PRESENT',
  }),
  'ops_cov FT convocado sí releva',
);

report(
  'ops-cov-esc',
  isReliefEligibleShift({
    code: 'ESC',
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'ESC',
    status: 'PRESENT',
  }),
  'ESC convertido en cobertura sí releva la franja',
);

report(
  'trace-ext',
  reliefIneligibleReason({
    code: 'M',
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'EXTEND',
    coverageHoursOnSource: true,
  }) === 'OPS_COV_TRACE',
  'registro EXT no es presencia en la franja',
);

const escBadge = opsShiftCodeBadge({ code: 'ESC' });
report(
  'badge-esc',
  escBadge?.code === 'ESC' && escBadge.tone === 'extra',
  `badge=${escBadge?.code}/${escBadge?.tone}`,
);

const named = opsShiftCodeBadge({ code: 'N', positionName: 'Rondín' });
report('badge-rondin', named?.code === 'N' && named.tone === 'base', 'Rondín sigue mostrando N');

console.log('\nFin eval P7 relevo/códigos');
