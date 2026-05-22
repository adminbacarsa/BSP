/** npx tsx scripts/test-objective-coverage-demand.ts */
import { buildObjectiveCoveragePreflight, formatDayDemandSummary } from '../src/lib/planificacion/objectiveCoverageDemand';

const POSITIONS = [
    { positionName: 'Puesto 1', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }] },
    { positionName: 'Puesto 2', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }] },
    { positionName: '136', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }] },
    { positionName: 'Internado', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }] },
];

const days = Array.from({ length: 30 }, (_, i) => {
    const d = i + 1;
    const dateStr = `2026-06-${String(d).padStart(2, '0')}`;
    const letters = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    return { dateStr, dayLetter: letters[new Date(`${dateStr}T12:00:00`).getDay()] };
});

const employees = Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, nombre: `Guardia ${i}` }));
const absences: Record<string, Set<string>> = { e0: new Set(['2026-06-10']) };

const pf = buildObjectiveCoveragePreflight({
    positions: POSITIONS,
    days,
    employees,
    absences,
    slaVendidas: 2880,
    cycles: ['6+2'],
});

console.log('Demanda mes:', pf.monthDemandHours, 'h · vendidas', pf.slaVendidas);
console.log('Bandas mes:', pf.monthBandDemand);
console.log('Día 1:', formatDayDemandSummary(pf.dayDemands[0]));
console.log('Empleados:', pf.employeeCount, '· ausencias bloqueadas:', pf.totalAbsenceDays);
console.log('OK');
