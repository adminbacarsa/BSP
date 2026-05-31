/** Cobertura pie UI día a día — Misericordia jun 2026 rotativo */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateScheduleV2, pickOptimalAutoCycles } from '../src/lib/planificacion/autoScheduleEngineV2';
import { sumDayCoverageFromCodeCounts } from '../src/lib/planificacion/positionCoverageUnits';
import type { V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getDayLetter = (ds: string) => DAY_LETTERS[new Date(`${ds}T12:00:00`).getDay()];
const FRANCO = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const NON_BILL = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);

async function main() {
    const oid = '1768936428905';
    const slaSnap = await db.collection('servicios_sla').where('objectiveId', '==', oid).limit(1).get();
    const sla = slaSnap.docs[0].data() as any;

    const empSnap = await db.collection('empleados').where('preferredObjectiveId', '==', oid).get();
    const employees = empSnap.docs.filter(d => d.data().status !== 'inactivo')
        .map(d => ({ id: d.id, nombre: String(d.data().nombre || d.data().name) }));
    console.log(`Empleados activos objetivo: ${employees.length}`);

    const daysInMonth: Date[] = [];
    for (let d = 1; d <= 30; d++) daysInMonth.push(new Date(2026, 5, d));

    const positions: V2PositionDef[] = (sla.positions || []).map((p: any) => ({
        positionName: p.name,
        qty: Math.max(1, Number(p.quantity) || 1),
        coverageType: p.coverageType || '24hs',
        activeDays: p.activeDays || ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
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
    console.log(`Turnos trailing mayo (días ${getDateKey(trailStart)}..${getDateKey(prevMonthEnd)}): ${trailSnap.size}`);

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

    const baseCtx: V2EngineContext = {
        positions, employees, daysInMonth,
        empMonthlyInitial: Object.fromEntries(employees.map(e => [e.id, 0])),
        absences: {}, slaVendidas: 2880, autoCycles: [], getDayLetter, getDateKey,
        demandDriven: true, rotateShifts: true, budgetMode: 'cct',
        prevMonthTrailingWorkDays, prevMonthTrailingRestDays,
    };
    baseCtx.autoCycles = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] }).cycles;

    const gen = generateScheduleV2(baseCtx);

    console.log('\nPie UI (pax cerrados / requeridos) por día:');
    let badDays = 0;
    for (const day of daysInMonth) {
        const dateStr = getDateKey(day);
        const dayLetter = getDayLetter(dateStr);
        const byPos: Record<string, Record<string, number>> = {};
        for (const p of positions) byPos[p.positionName] = {};

        for (const a of gen.assignments) {
            if (a.dateStr !== dateStr) continue;
            const code = String(a.code || '').toUpperCase();
            if (NON_BILL.has(code) || !a.positionName) continue;
            const pn = a.positionName;
            if (!byPos[pn]) byPos[pn] = {};
            byPos[pn][code] = (byPos[pn][code] || 0) + 1;
        }

        const totals = sumDayCoverageFromCodeCounts(positions, dayLetter, byPos, baseCtx.autoCycles);
        const mark = totals.closed >= totals.required ? 'OK' : '!!';
        if (totals.closed < totals.required) badDays++;
        console.log(`  ${dateStr} ${mark} ${totals.closed}/${totals.required}${totals.closed < totals.required ? ' → ' + totals.positions.filter(p => p.closed < p.required).map(p => `${p.positionName}:${p.closed}/${p.required}`).join(', ') : ''}`);
    }
    console.log(`\nDías con cobertura incompleta: ${badDays}/30`);
    console.log(`positionGroups:`, JSON.stringify(gen.stats.positionGroups));
}

main().catch(e => { console.error(e); process.exit(1); });
