/** Misericordia jun 2026 — rotativo ON (ruta UI con cerebro) */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateScheduleV2, pickOptimalAutoCycles } from '../src/lib/planificacion/autoScheduleEngineV2';
import { verifyScheduleCoverage } from '../src/lib/planificacion/coverageVerification';
import { checkRestBetweenShifts, type AgreementRestConfig } from '../src/lib/planificacion/restBetweenShifts';
import { SUVICO_POLICY } from '../src/lib/planificacion/suvicoPolicy';
import { assignmentBreaksBandTransition } from '../src/lib/planificacion/rotativeBandGuard';
import type { V2EngineContext, V2PositionDef, V2Assignment } from '../src/lib/planificacion/autoScheduleEngineV2';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const getDayLetter = (ds: string) => DAY_LETTERS[new Date(`${ds}T12:00:00`).getDay()];
const FRANCO = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const NON_BILL = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);

async function main() {
    const oid = '1768936428905';
    const slaSnap = await db.collection('servicios_sla').where('objectiveId', '==', oid).limit(1).get();
    if (slaSnap.empty) throw new Error(`Sin SLA para objectiveId=${oid}`);
    const sla = slaSnap.docs[0].data() as any;
    console.log('SLA doc:', slaSnap.docs[0].id);
    const employees = (await db.collection('empleados').where('preferredObjectiveId', '==', oid).get()).docs
        .filter(d => d.data().status !== 'inactivo')
        .map(d => ({ id: d.id, nombre: String(d.data().nombre || d.data().name) }));

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
        demandDriven: true, rotateShifts: true, budgetMode: 'cct',
        prevMonthTrailingWorkDays, prevMonthTrailingRestDays,
    };

    const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
    baseCtx.autoCycles = picked.cycles;

    console.log('\n=== Misericordia — rotativo ON (V2) ===');
    const gen = generateScheduleV2(baseCtx);
    const cov = verifyScheduleCoverage(baseCtx, gen.assignments, gen.stats);

    console.log('Billable:', gen.stats.totalBillableHours, 'h · SLA cerrado:', gen.stats.slaHoursClosed);
    console.log('Slots:', cov.coverage.coveredSlots, '/', cov.coverage.totalSlots,
        '· sin cubrir:', cov.coverage.uncoveredSlots);
    cov.uncovered.forEach(u =>
        console.log(`  ${u.dateStr} ${u.positionName} ${u.shiftCode} (${u.qtyAssigned}/${u.qtyRequested})`));

    const restCfg: AgreementRestConfig = {
        minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
        longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
        minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
        maxConsecutiveWorkDays: 6,
    };
    const ds9 = '2026-06-09';

    const internadoT = gen.assignments.find(a => a.dateStr === ds9 && a.positionName === 'Internado' && a.code === 'T');
    if (internadoT) {
        const getShift2 = (eid2: string, dds: string) => {
            const ax = gen.assignments.find(x => x.empId === eid2 && x.dateStr === dds);
            if (!ax) return null;
            const c = String(ax.code || '').toUpperCase();
            const nonWork = c === 'RET' || FRANCO.has(c);
            return { code: c, startTime: ax.startTime || '06:00', hours: nonWork ? 0 : (ax.hours ?? 8) };
        };
        const err = checkRestBetweenShifts({
            empId: internadoT.empId,
            targetDateStr: ds9,
            proposed: { code: 'M', startTime: '06:00', hours: 8 },
            getShift: getShift2,
            cfg: restCfg,
        });
        console.log(`\nInternado T→M (${internadoT.empId.slice(-4)}): ${err ?? 'OK'}`);
    }

    const day9F = gen.assignments.filter(a => a.dateStr === ds9 && a.code === 'F');
    console.log('\nRest check F→Internado M (día 9):');
    for (const a of day9F) {
        const jun = gen.assignments.filter(x => x.empId === a.empId && (x.hours ?? 0) > 0)
            .reduce((s, x) => s + (x.hours ?? 0), 0);
        const cola = empMonthlyInitial[a.empId] || 0;
        const getShift = (eid2: string, dds: string) => {
            const ax = gen.assignments.find(x => x.empId === eid2 && x.dateStr === dds);
            if (!ax) return null;
            const c = String(ax.code || '').toUpperCase();
            const nonWork = c === 'RET' || FRANCO.has(c);
            return { code: c, startTime: ax.startTime || '06:00', hours: nonWork ? 0 : (ax.hours ?? 8) };
        };
        const restErr = checkRestBetweenShifts({
            empId: a.empId,
            targetDateStr: ds9,
            proposed: { code: 'M', startTime: '06:00', hours: 8 },
            getShift,
            cfg: restCfg,
        });
        console.log(`  ${a.empId.slice(-4)} ${cola}+${jun}=${cola + jun}h → ${restErr ?? 'OK'}`);
    }

    for (const ds of ['2026-06-09', '2026-06-23', '2026-06-25']) {
        console.log(`\n--- ${ds} assignments ---`);
        const dayAssign = gen.assignments.filter(a => a.dateStr === ds);
        for (const pos of positions) {
            const codes = dayAssign.filter(a => a.positionName === pos.positionName).map(a => `${a.code}@${a.empId.slice(-4)}`);
            console.log(`  ${pos.positionName} (${pos.coverageType}): ${codes.join(', ') || '(vacío)'}`);
        }
        const fr = dayAssign.filter(a => ['F','FF','FP','RET'].includes(String(a.code).toUpperCase()));
        console.log(`  F/RET (${fr.length}):`, fr.map(a => `${a.code}@${a.empId.slice(-4)}`).join(', '));
        const work = dayAssign.filter(a => !['F','FF','FP','RET','V','L','E'].includes(String(a.code).toUpperCase()));
        console.log(`  trabajo: ${work.length} · M=${work.filter(a=>a.code==='M').length} T=${work.filter(a=>a.code==='T').length} N=${work.filter(a=>a.code==='N').length}`);
        for (const a of fr.filter(x => x.code === 'F')) {
            const jun = gen.assignments.filter(x => x.empId === a.empId && (x.hours ?? 0) > 0)
                .reduce((s, x) => s + (x.hours ?? 0), 0);
            const cola = empMonthlyInitial[a.empId] || 0;
            console.log(`    F ${a.empId.slice(-4)} cola+mes=${cola}+${jun}=${cola + jun}h`);
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); });
