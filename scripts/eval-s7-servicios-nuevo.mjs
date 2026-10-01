/**
 * Alta de SLA: el default es el mes elegido (o el mes en curso), no el mes siguiente al último.
 * Un fin pasado nace cerrado; hoy o futuro no. El motivo de reapertura ignora espacios.
 *
 *   node --experimental-strip-types scripts/eval-s7-servicios-nuevo.mjs
 */
import {
  defaultNewSlaDates,
  newSlaBornClosed,
  reopenMotivoError,
  normalizeReopenMotivo,
  stripSlaLifecycle,
  REOPEN_MOTIVO_MSG,
} from '../apps/web2/src/lib/servicios/newSlaDraft.ts';

let failed = 0;
const check = (label, ok) => {
  if (ok) console.log(`  ok ${label}`);
  else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
};

const today = new Date(2026, 9, 1);
const current = defaultNewSlaDates(today, null);
check('sin selector: octubre 2026 (1 al 31)', current.startDate === '2026-10-01' && current.endDate === '2026-10-31');
check('mes en curso no nace cerrado', newSlaBornClosed(current.endDate, '2026-10-01') === false);

const selectedOct = defaultNewSlaDates(today, { year: 2026, monthIndex0: 9 });
check('selector octubre respeta el mes', selectedOct.startDate === '2026-10-01' && selectedOct.endDate === '2026-10-31');

const selectedNov = defaultNewSlaDates(today, { year: 2026, monthIndex0: 10 });
check('selector noviembre es futuro', selectedNov.startDate === '2026-11-01' && selectedNov.endDate === '2026-11-30');
check('vigencia futura no nace cerrada', newSlaBornClosed(selectedNov.endDate, '2026-10-01') === false);

const selectedJul = defaultNewSlaDates(today, { year: 2026, monthIndex0: 6 });
check('selector julio no salta a agosto', selectedJul.startDate === '2026-07-01' && selectedJul.endDate === '2026-07-31');
check('fin pasado nace cerrado', newSlaBornClosed(selectedJul.endDate, '2026-10-01') === true);
check('fin hoy no nace cerrado', newSlaBornClosed('2026-10-01', '2026-10-01') === false);

const cloned = stripSlaLifecycle({
  closed: true,
  closedReason: 'VENCIDO',
  reopenReason: 'viejo',
  clientName: 'X',
  startDate: '2026-07-01',
});
check('el clon no arrastra closed', cloned.closed === undefined && cloned.reopenReason === undefined && cloned.clientName === 'X');

check('motivo vacío', reopenMotivoError('') === REOPEN_MOTIVO_MSG);
check('motivo espacios', reopenMotivoError('   ') === REOPEN_MOTIVO_MSG);
check('motivo corto', reopenMotivoError('  ab ') === REOPEN_MOTIVO_MSG);
check('motivo válido', reopenMotivoError('  reabrir contrato ') === null);
try {
  normalizeReopenMotivo('   \n  ');
  check('normalize espacios lanza', false);
} catch (e) {
  check('normalize espacios lanza el mensaje', e instanceof Error && e.message === REOPEN_MOTIVO_MSG);
}
check('normalize recorta', normalizeReopenMotivo('  se reabre el contrato  ') === 'se reabre el contrato');

if (failed) {
  console.error(`S7_SERVICIOS_FAIL ${failed}`);
  process.exit(1);
}
console.log('S7_SERVICIOS_OK');
