/**
 * Smoke test local (sin emulador): node apps/functions/scripts/test-turno-hours-calc.js
 * Requiere: npm run build en apps/functions
 */
const { calcTurnoHoursContrib } = require('../lib/liquidacion/turnoHoursCalc');
const admin = require('firebase-admin');

function ts(d) {
  return admin.firestore.Timestamp.fromDate(d);
}

const base = {
  employeeId: 'emp1',
  draft: false,
  isUnassigned: false,
  isCompleted: true,
  code: 'M',
  startTime: ts(new Date('2026-06-10T06:00:00-03:00')),
  endTime: ts(new Date('2026-06-10T14:00:00-03:00')),
  realStartTime: ts(new Date('2026-06-10T06:00:00-03:00')),
  realEndTime: ts(new Date('2026-06-10T14:00:00-03:00')),
};

const r = calcTurnoHoursContrib(base);
if (!r || r.hsReales !== 8) {
  console.error('FAIL calcTurnoHoursContrib', r);
  process.exit(1);
}

const incomplete = calcTurnoHoursContrib({ ...base, isCompleted: false });
if (incomplete !== null) {
  console.error('FAIL incomplete should be null');
  process.exit(1);
}

console.log('OK turnoHoursCalc smoke', r);
process.exit(0);
