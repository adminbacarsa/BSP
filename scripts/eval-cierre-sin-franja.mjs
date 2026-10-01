/**
 * Peaje 9 Norte, Puesto 1, 01/10/2026 17:00. SLA u7pMU1WQaGq1rxXxWstO:
 * última franja T2 15–17 y T3 16–17, nada después. FONTANA y VENENCIA
 * pasado el fin muestran «CIERRA 17:00 · sin franja siguiente» y no cuentan en RET.
 *
 *   node --experimental-strip-types scripts/eval-cierre-sin-franja.mjs
 */
import path from 'path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { etiquetaCierreSinContinuidad } = await load('packages/ops-core/src/cierreSinContinuidad.ts');
const { shiftMatchesOpsViewTab } = await load('packages/ops-core/src/shiftMatchesOpsViewTab.ts');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const END = new Date('2026-10-01T17:00:00-03:00');
const NOW = new Date('2026-10-01T17:02:00-03:00');
const dias = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** SLA real del puesto: T2 cierra 17:00, T3 cierra 17:00, no hay franja que arranque después. */
const slaPeaje = {
  id: 'u7pMU1WQaGq1rxXxWstO',
  objectiveId: 'peaje_9_norte',
  status: 'active',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  positions: [{
    name: 'Puesto 1',
    quantity: 1,
    coverageType: 'custom',
    activeDays: dias,
    allowedShiftTypes: [
      { code: 'M2', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
      { code: 'M3', startTime: '08:00', endTime: '16:00', hours: 8, quantity: 1 },
      { code: 'T2', startTime: '15:00', endTime: '17:00', hours: 2, quantity: 1 },
      { code: 'T3', startTime: '16:00', endTime: '17:00', hours: 1, quantity: 1 },
    ],
  }],
};

const fontana = {
  id: 'fontana', employeeId: 'e_fontana', employeeName: 'FONTANA', code: 'T2', positionName: 'Puesto 1',
  objectiveId: 'peaje_9_norte', isPresent: true, isCompleted: false, isRetention: false,
  checkInAt: new Date('2026-10-01T15:05:00-03:00'), endDateObj: END, startTime: new Date('2026-10-01T15:00:00-03:00'),
};
const venencia = {
  id: 'venencia', employeeId: 'e_venencia', employeeName: 'VENENCIA', code: 'T3', positionName: 'Puesto 1',
  objectiveId: 'peaje_9_norte', isPresent: true, isCompleted: false, isRetention: false,
  checkInAt: new Date('2026-10-01T16:02:00-03:00'), endDateObj: END, startTime: new Date('2026-10-01T16:00:00-03:00'),
};
const hermanos = [fontana, venencia];
const pedir = (shift) => etiquetaCierreSinContinuidad({
  slaDocs: [slaPeaje],
  positionName: 'Puesto 1',
  shiftEnd: END,
  outgoingCode: shift.code,
  outgoing: shift,
  siblings: hermanos,
});

const labelF = pedir(fontana);
const labelV = pedir(venencia);
report('FONTANA T2 y VENENCIA T3: CIERRA 17:00 · sin franja siguiente', labelF === 'CIERRA 17:00 · sin franja siguiente' && labelV === labelF, `${labelF} | ${labelV}`);

const cerrado = { ...fontana, isPendingClose: false, cierreSinFranja: labelF, isPresent: true, isCompleted: false, isRetention: false };
report('no cuenta en RET y no es pendiente de relevo', !shiftMatchesOpsViewTab(cerrado, 'RETENIDOS', NOW) && shiftMatchesOpsViewTab(cerrado, 'ACTIVOS', NOW) && !String(labelF).toLowerCase().includes('reten') && !String(labelF).toLowerCase().includes('vacante'));

const pendiente = { ...fontana, isPendingClose: true, isPresent: true, isCompleted: false };
report('el mismo turno con isPendingClose sí sumaría RET (el hook lo apaga)', shiftMatchesOpsViewTab(pendiente, 'RETENIDOS', NOW) === true);

const conNoche = {
  ...slaPeaje,
  positions: [{
    ...slaPeaje.positions[0],
    allowedShiftTypes: [
      ...slaPeaje.positions[0].allowedShiftTypes,
      { code: 'N2', startTime: '17:00', endTime: '23:00', hours: 6, quantity: 1 },
    ],
  }],
};
const t2a = { ...fontana, id: 'viejo', code: 'T2', checkInAt: new Date('2026-10-01T15:02:00-03:00') };
const t2b = { ...fontana, id: 'nuevo', code: 'T2', employeeId: 'e2', checkInAt: new Date('2026-10-01T15:40:00-03:00') };
const pedirN = (shift, siblings) => etiquetaCierreSinContinuidad({
  slaDocs: [conNoche], positionName: 'Puesto 1', shiftEnd: END, outgoingCode: 'T2', outgoing: shift, siblings,
});
report('con N2 17:00 (1 lugar): el más nuevo espera relevo, el más viejo cierra sin lugar', pedirN(t2b, [t2a, t2b]) === null && pedirN(t2a, [t2a, t2b]) === 'CIERRA 17:00 · sin lugar en la franja siguiente', `${pedirN(t2b, [t2a, t2b])} | ${pedirN(t2a, [t2a, t2b])}`);
report('un solo T2 con N2 siguiente: ESPERANDO RELEVO (null)', pedirN(t2a, [t2a]) === null);

report('fin de servicio sin cronograma: misma leyenda aunque haya N2', etiquetaCierreSinContinuidad({
  slaDocs: [conNoche], positionName: 'Puesto 1', shiftEnd: END, outgoingCode: 'T2', outgoing: t2a, siblings: [t2a], finServicioSinCronograma: true,
}) === 'CIERRA 17:00 · sin franja siguiente');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) {
  console.error('FALLAS:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
console.log('eval-cierre-sin-franja ok');
