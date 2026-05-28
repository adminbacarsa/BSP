/** Debug: mismos parámetros UI — CCT tramos + cola mayo + trailing */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateScheduleFixedBand } from '../src/lib/planificacion/fixedBandScheduleEngine';
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
const NON_BILL = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);

async function main() {
    const oid = '1768936428905';
    const sla = (await db.collection('servicios_sla').doc('wVE9l8qxMNUYlCRznj3N').get()).data() as any;
    const employees = (await db.collection('empleados').where('preferredObjectiveId', '==', oid).get()).docs
        .filter(d => d.data().status !== 'inactivo')
        .map(d => ({ id: d.id, nombre: String(d.data().nombre || d.data().name) }));

    const daysInMonth: Date[] = [];
    for (let d = 1; d <= 30; d++) daysInMonth.push(new Date(2026, 5, d));

    const positions: V2PositionDef[] = (sla.positions || []).map((p: any) => ({
        positionName: p.name, qty: 1, coverageType: '24hs',
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

    // Cola CCT 26-mayo → fin mayo
    const cyclePreStart = new Date(2026, 4, 26);
    const cyclePreEnd = new Date(2026, 5, 0, 23, 59, 59);
    const prevTailSnap = await db.collection('turnos')
        .where('objectiveId', '==', oid)
        .where('startTime', '>=', Timestamp.fromDate(cyclePreStart))
        .where('startTime', '<=', Timestamp.fromDate(cyclePreEnd))
        .get();

    const empMonthlyInitial: Record<string, number> = Object.fromEntries(employees.map(e => [e.id, 0]));
    const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
    prevTailSnap.docs.forEach(d => {
        const data = d.data() as any;
        const empId = data.employeeId;
        if (!empId || NON_BILL.has(String(data.code || '').toUpperCase())) return;
        const h = Number(data.hours) || SHIFT_HRS[String(data.code || '').toUpperCase()] || 8;
        empMonthlyInitial[empId] = (empMonthlyInitial[empId] || 0) + h;
    });

    const baseCtx: V2EngineContext = {
        positions, employees, daysInMonth, empMonthlyInitial, absences: {},
        slaVendidas: 2880, autoCycles: [], getDayLetter, getDateKey,
        demandDriven: true, rotateShifts: false, budgetMode: 'cct',
        prevMonthTrailingWorkDays, prevMonthTrailingRestDays,
    };

    const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
    baseCtx.autoCycles = picked.cycles;

    console.log('Cola CCT (26-may) horas previas por emp:');
    employees.filter(e => (empMonthlyInitial[e.id] || 0) > 0).forEach(e =>
        console.log(`  ${e.nombre.slice(0, 20)}: ${empMonthlyInitial[e.id]}h`));

    const gen = generateScheduleFixedBand(baseCtx);
    const cov = verifyScheduleCoverage(baseCtx, gen.assignments, gen.stats);

    console.log('\nEsquemas por guardia (bandas fijas):');
    const schemes = gen.stats.fixedBandSchemeByEmp || {};
    const byScheme: Record<string, string[]> = {};
    employees.forEach(e => {
        const s = schemes[e.id] || '?';
        if (!byScheme[s]) byScheme[s] = [];
        byScheme[s].push(e.nombre.slice(0, 18));
    });
    Object.entries(byScheme).forEach(([s, names]) =>
        console.log(`  ${s}: ${names.length} — ${names.join(', ')}`));

    console.log('\nResultado CCT+trailing:');
    console.log('  billable:', gen.stats.totalBillableHours, 'closed:', gen.stats.slaHoursClosed);
    console.log('  slots:', cov.coverage.coveredSlots, '/', cov.coverage.totalSlots, 'open:', cov.coverage.uncoveredSlots);
    cov.uncovered.forEach(u =>
        console.log(`  HUECO ${u.dateStr} ${u.positionName} ${u.shiftCode} (${u.qtyAssigned}/${u.qtyRequested})`));

    // Horas por empleado
    const hrs: Record<string, number> = {};
    gen.assignments.forEach(a => {
        if ((a.hours ?? 0) > 0) hrs[a.empId] = (hrs[a.empId] || 0) + (a.hours ?? 0);
    });
    console.log('\nHoras junio generadas + cola:');
    employees.forEach(e => {
        const jun = hrs[e.id] || 0;
        const cola = empMonthlyInitial[e.id] || 0;
        const tot = jun + cola;
        if (tot !== 200 && tot !== 180 && tot !== 192) {
            console.log(`  ⚠ ${e.nombre.slice(0, 22)}: cola ${cola}h + jun ${jun}h = ${tot}h`);
        }
    });

    if (gen.capOverflowSlots?.length) {
        console.log('\nCap 200h bloqueos:', gen.capOverflowSlots.length);
        const byEmp = new Map<string, number>();
        gen.capOverflowSlots.forEach(s => byEmp.set(s.empId, (byEmp.get(s.empId) || 0) + 1));
        byEmp.forEach((n, id) => {
            const emp = employees.find(e => e.id === id);
            console.log(`  ${emp?.nombre?.slice(0, 22)}: ${n} slots bloqueados por tope 200h`);
        });
    }

    let maxConsecF = 0;
    let worstEmp = '';
    employees.forEach(e => {
        const days = gen.assignments.filter(a => a.empId === e.id).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        let streak = 0;
        for (const a of days) {
            if (String(a.code || '').toUpperCase() === 'F') {
                streak++;
                if (streak > maxConsecF) { maxConsecF = streak; worstEmp = e.nombre.slice(0, 22); }
            } else streak = 0;
        }
    });
    const retTotal = gen.stats.totalRetCount ?? 0;
    console.log(`\nMáx F consecutivos: ${maxConsecF}${worstEmp ? ` (${worstEmp})` : ''} · RET mes: ${retTotal}`);
}

main().catch(e => { console.error(e); process.exit(1); });
