/**
 * Simula ruta UI: trailing mayo + ausencias + positionStructure real.
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateScheduleFixedBand, buildFixedBandPlan } from '../src/lib/planificacion/fixedBandScheduleEngine';
import { pickOptimalAutoCycles } from '../src/lib/planificacion/autoScheduleEngineV4';
import { verifyScheduleCoverage } from '../src/lib/planificacion/coverageVerification';
import type { V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const getDayLetter = (ds: string) => DAY_LETTERS[new Date(`${ds}T12:00:00`).getDay()];
const FRANCO = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);

async function main() {
    const oid = '1768936428905';
    const slaDoc = await db.collection('servicios_sla').doc('wVE9l8qxMNUYlCRznj3N').get();
    const sla = { id: slaDoc.id, ...slaDoc.data() } as any;
    const empSnap = await db.collection('empleados').where('preferredObjectiveId', '==', oid).get();
    const employees = empSnap.docs.filter(d => d.data().status !== 'inactivo')
        .map(d => ({ id: d.id, nombre: String(d.data().nombre || d.data().name || d.id) }));

    const daysInMonth: Date[] = [];
    for (let d = 1; d <= 30; d++) daysInMonth.push(new Date(2026, 5, d));

    const positions: V2PositionDef[] = (sla.positions || []).map((p: any) => ({
        positionName: p.name, qty: Math.max(1, Number(p.quantity) || 1),
        coverageType: p.coverageType || '24hs', activeDays: p.activeDays || ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: (p.allowedShiftTypes || []).map((s: any) => ({
            code: s.code, name: s.name, hours: s.hours, startTime: s.startTime, endTime: s.endTime,
        })),
    }));

    const prevMonthEnd = new Date(2026, 5, 0);
    const trailStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), Math.max(1, prevMonthEnd.getDate() - 9));
    const trailSnap = await db.collection('turnos')
        .where('objectiveId', '==', oid)
        .where('startTime', '>=', Timestamp.fromDate(trailStart))
        .where('startTime', '<=', Timestamp.fromDate(new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), prevMonthEnd.getDate(), 23, 59, 59)))
        .get();

    const prevTrailByEmp: Record<string, Record<string, string>> = {};
    trailSnap.docs.forEach(d => {
        const data = d.data() as any;
        if (!data.employeeId || !data.startTime) return;
        const dateStr = getDateKey((data.startTime as Timestamp).toDate());
        if (!prevTrailByEmp[data.employeeId]) prevTrailByEmp[data.employeeId] = {};
        prevTrailByEmp[data.employeeId][dateStr] = String(data.code || '').toUpperCase();
    });

    const lastDayStr = getDateKey(prevMonthEnd);
    const prevMonthTrailingWorkDays: Record<string, number> = {};
    const prevMonthTrailingRestDays: Record<string, number> = {};
    employees.forEach(emp => {
        const empShifts = prevTrailByEmp[emp.id] || {};
        const lastCode = empShifts[lastDayStr];
        if (!lastCode) return;
        const isFrancoLast = FRANCO.has(lastCode);
        let count = 0;
        for (let d = prevMonthEnd.getDate(); d >= 1; d--) {
            const ds = getDateKey(new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), d));
            const c = empShifts[ds];
            if (!c) break;
            const isFranco = FRANCO.has(c);
            if (isFrancoLast && isFranco) count++;
            else if (!isFrancoLast && !isFranco) count++;
            else break;
        }
        if (isFrancoLast) prevMonthTrailingRestDays[emp.id] = count;
        else prevMonthTrailingWorkDays[emp.id] = count;
    });

    console.log('Trailing work:', Object.keys(prevMonthTrailingWorkDays).length,
        'rest:', Object.keys(prevMonthTrailingRestDays).length);

    const baseCtx: V2EngineContext = {
        positions, employees, daysInMonth,
        empMonthlyInitial: Object.fromEntries(employees.map(e => [e.id, 0])),
        absences: {}, slaVendidas: 2880, autoCycles: [],
        getDayLetter, getDateKey, demandDriven: true, rotateShifts: false,
        prevMonthTrailingWorkDays, prevMonthTrailingRestDays,
    };

    const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
    baseCtx.autoCycles = picked.cycles;

    const gen = generateScheduleFixedBand(baseCtx);
    const cov = verifyScheduleCoverage(baseCtx, gen.assignments, gen.stats);

    console.log('Con trailing UI-like:');
    console.log('  billable:', gen.stats.totalBillableHours, 'closed:', gen.stats.slaHoursClosed);
    console.log('  slots:', cov.coverage.coveredSlots, '/', cov.coverage.totalSlots, 'open:', cov.coverage.uncoveredSlots);
    if (cov.coverage.uncoveredSlots > 0) {
        cov.uncovered.slice(0, 10).forEach(u =>
            console.log(`    ${u.dateStr} ${u.positionName} ${u.shiftCode}`));
    }
}

main().catch(e => { console.error(e); process.exit(1); });
