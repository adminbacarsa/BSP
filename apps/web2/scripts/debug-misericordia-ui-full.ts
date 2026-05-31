/**
 * Simula ruta UI applyAutoScheduleV2 — Misericordia jun 2026
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateScheduleV4 } from '../src/lib/planificacion/autoScheduleEngineV4';
import { resolveAutoPlanningBrain } from '../src/lib/planificacion/autoPlanningBrain';
import { canUseFixedBandFloater } from '../src/lib/planificacion/fixedBandFloaterScheduleEngine';
import { canUseSixPlusOne } from '../src/lib/planificacion/sixPlusOneEngine';
import { runSixPlusOnePipeline, runStrictSixTwoPipeline } from '../src/lib/planificacion/planningPipeline';
import { sumDayCoverageFromCodeCounts } from '../src/lib/planificacion/positionCoverageUnits';
import type { V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getDayLetter = (ds: string) => DAY_LETTERS[new Date(`${ds}T12:00:00`).getDay()];
const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const NON_BILL = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };

function turnoCuentaParaCrono(data: any, oid: string): boolean {
    if (!data || String(data.objectiveId || '') !== oid) return false;
    const op = data.origin === 'RETEN' || data.origin === 'OPERATIONS_COVERAGE' || data.origin === 'SLA_VIRTUAL'
        || !!data.isReten || data.resolvedBy === 'OPERACIONES';
    return !op;
}

async function main() {
    const oid = '1768936428905';
    const currentDate = new Date(2026, 5, 1);

    const slaSnap = await db.collection('servicios_sla').where('objectiveId', '==', oid).limit(1).get();
    const sla = slaSnap.docs[0].data() as any;

    const empSnap = await db.collection('empleados').get();
    const allEmps = empSnap.docs.filter(d => d.data().status !== 'inactivo').map(d => ({
        id: d.id,
        nombre: String(d.data().nombre || d.data().name || d.id),
        name: String(d.data().name || d.data().nombre || d.id),
        preferredObjectiveId: d.data().preferredObjectiveId,
        lat: d.data().lat,
        lng: d.data().lng,
    }));

    const trailSnap = await db.collection('turnos')
        .where('objectiveId', '==', oid)
        .where('startTime', '>=', Timestamp.fromDate(new Date(2026, 4, 1)))
        .where('startTime', '<=', Timestamp.fromDate(new Date(2026, 5, 31, 23, 59, 59)))
        .get();
    const activeGuestIds = new Set<string>();
    trailSnap.docs.forEach(d => {
        if (turnoCuentaParaCrono(d.data(), oid)) activeGuestIds.add(d.data().employeeId);
    });

    const displayed = allEmps.filter(e =>
        e.preferredObjectiveId === oid || activeGuestIds.has(e.id),
    );
    console.log(`Dotación UI-like: ${displayed.length} (guests: ${activeGuestIds.size})`);

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

    const empMonthlyInitial: Record<string, number> = Object.fromEntries(displayed.map(e => [e.id, 0]));
    const cyclePreStart = new Date(2026, 4, 26);
    const cyclePreEnd = new Date(2026, 5, 0, 23, 59, 59);
    const prevTailSnap = await db.collection('turnos')
        .where('objectiveId', '==', oid)
        .where('startTime', '>=', Timestamp.fromDate(cyclePreStart))
        .where('startTime', '<=', Timestamp.fromDate(cyclePreEnd))
        .get();
    prevTailSnap.docs.forEach(d => {
        const data = d.data() as any;
        if (!turnoCuentaParaCrono(data, oid)) return;
        const empId = data.employeeId;
        if (!empId || NON_BILL.has(String(data.code || '').toUpperCase())) return;
        empMonthlyInitial[empId] = (empMonthlyInitial[empId] || 0) + (Number(data.hours) || SHIFT_HRS[String(data.code || '').toUpperCase()] || 8);
    });

    const prevMonthEndDate = new Date(2026, 5, 0);
    const trailLookbackStart = new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), Math.max(1, prevMonthEndDate.getDate() - 9));
    const prevTrailSnap = await db.collection('turnos')
        .where('objectiveId', '==', oid)
        .where('startTime', '>=', Timestamp.fromDate(trailLookbackStart))
        .where('startTime', '<=', Timestamp.fromDate(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), prevMonthEndDate.getDate(), 23, 59, 59)))
        .get();

    const prevTrailByEmp: Record<string, Record<string, string>> = {};
    prevTrailSnap.docs.forEach(d => {
        const data = d.data() as any;
        if (!turnoCuentaParaCrono(data, oid) || !data.employeeId || !data.startTime) return;
        const dateStr = getDateKey((data.startTime as Timestamp).toDate());
        if (!prevTrailByEmp[data.employeeId]) prevTrailByEmp[data.employeeId] = {};
        prevTrailByEmp[data.employeeId][dateStr] = String(data.code || '').toUpperCase();
    });

    const prevMonthTrailingWorkDays: Record<string, number> = {};
    const prevMonthTrailingRestDays: Record<string, number> = {};
    const prevMonthLastShiftByEmp: Record<string, string> = {};
    const prevMonthLastWorkBandBeforeRest: Record<string, string> = {};
    const lastDayStr = getDateKey(prevMonthEndDate);

    displayed.forEach(emp => {
        const empShifts = prevTrailByEmp[emp.id] || {};
        const lastCode = empShifts[lastDayStr];
        if (!lastCode) return;
        if (lastCode === 'RET') {
            prevMonthLastShiftByEmp[emp.id] = 'RET';
            let workCount = 1;
            let foundBand: string | null = null;
            let consGap = 0;
            for (let d = prevMonthEndDate.getDate() - 1; d >= 1; d--) {
                const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
                const c = empShifts[ds];
                if (!c) { consGap++; if (consGap > 1) break; workCount++; continue; }
                consGap = 0;
                if (FRANCO_SET.has(c)) break;
                if (c !== 'RET' && !foundBand) foundBand = c;
                workCount++;
            }
            prevMonthTrailingWorkDays[emp.id] = workCount;
            if (foundBand) prevMonthLastWorkBandBeforeRest[emp.id] = foundBand;
            return;
        }
        prevMonthLastShiftByEmp[emp.id] = lastCode;
        const isFrancoLast = FRANCO_SET.has(lastCode);
        let count = 0;
        let consecutiveMissing = 0;
        for (let d = prevMonthEndDate.getDate(); d >= 1; d--) {
            const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
            const c = empShifts[ds];
            if (!c) { consecutiveMissing++; if (consecutiveMissing > 1) break; count++; continue; }
            consecutiveMissing = 0;
            const isFranco = FRANCO_SET.has(c);
            if (isFrancoLast && isFranco) count++;
            else if (!isFrancoLast && !isFranco) count++;
            else break;
        }
        if (isFrancoLast) prevMonthTrailingRestDays[emp.id] = count;
        else prevMonthTrailingWorkDays[emp.id] = count;
    });

    const absences: Record<string, Map<string, string>> = {};
    const brain = resolveAutoPlanningBrain({
        positions,
        employees: displayed,
        daysInMonth,
        empMonthlyInitial,
        absences,
        slaVendidas: Number(sla.totalHours || sla.hours || 2880),
        budgetMode: 'cct',
        objectiveId: oid,
        getDayLetter,
        getDateKey,
        contingencyDaysManual: [],
        rotateShiftsOverride: true,
    });

    console.log('\nBrain:', {
        pickedCycle: brain.pickedCycle,
        rotateShifts: brain.rotateShifts,
        strictSixTwo: brain.strictSixTwo,
        feasible: brain.feasibility.ok,
    });

    const baseGenCtx: V2EngineContext = {
        positions,
        employees: displayed,
        daysInMonth,
        empMonthlyInitial,
        absences,
        slaVendidas: Number(sla.totalHours || sla.hours || 2880),
        autoCycles: brain.cycles,
        budgetMode: 'cct',
        objectiveId: oid,
        getDayLetter,
        getDateKey,
        rotateShifts: brain.rotateShifts,
        ajustarCrono: false,
        modo12Days: brain.modo12DaysEngine,
        apretarCronoDays: brain.modo12DaysEngine,
        prevMonthTrailingWorkDays,
        prevMonthTrailingRestDays,
        prevMonthLastShiftByEmp,
        prevMonthLastWorkBandBeforeRest,
        strictSixTwo: brain.strictSixTwo,
    };

    const can6x1 = canUseSixPlusOne(baseGenCtx);
    const canFloater = !can6x1 && brain.rotateShifts === false && canUseFixedBandFloater(baseGenCtx);
    console.log('Pipeline:', { can6x1, canFloater, useStrict: brain.strictSixTwo, rotateShifts: brain.rotateShifts });

    const strictPipeline = can6x1
        ? (() => { try { return runSixPlusOnePipeline(baseGenCtx); } catch { return null; } })()
        : canFloater
            ? (() => { try { return runStrictSixTwoPipeline({ ...baseGenCtx, rotateShifts: false, demandDriven: false }); } catch { return null; } })()
            : null;

    const gen = strictPipeline?.generation ?? generateScheduleV4({
        ...baseGenCtx,
        ...(brain.strictSixTwo ? { rotateShifts: false, demandDriven: false } : {}),
    });

    console.log(`Motor: ${strictPipeline ? 'strictPipeline' : 'V4'} | billable=${gen.stats.totalBillableHours} | uncovered=${gen.stats.uncoveredSlots}`);
    console.log('positionGroups:', gen.stats.positionGroups);

    let emptyPosBill = 0, withPosBill = 0;
    gen.assignments.forEach(a => {
        if (NON_BILL.has(String(a.code || '').toUpperCase())) return;
        if (a.positionName) withPosBill++;
        else emptyPosBill++;
    });
    console.log(`Assignments billable: con positionName=${withPosBill} sin=${emptyPosBill}`);

    console.log('\nPie UI por día:');
    let bad = 0;
    for (const day of daysInMonth) {
        const dateStr = getDateKey(day);
        const byPos: Record<string, Record<string, number>> = {};
        for (const p of positions) byPos[p.positionName] = {};
        for (const a of gen.assignments) {
            if (a.dateStr !== dateStr) continue;
            const code = String(a.code || '').toUpperCase();
            if (NON_BILL.has(code)) continue;
            const pn = a.positionName || positions[0].positionName;
            if (!byPos[pn]) byPos[pn] = {};
            byPos[pn][code] = (byPos[pn][code] || 0) + 1;
        }
        const totals = sumDayCoverageFromCodeCounts(positions, getDayLetter(dateStr), byPos, brain.cycles);
        if (totals.closed < totals.required) {
            bad++;
            console.log(`  ${dateStr} ${totals.closed}/${totals.required} ← ${totals.positions.filter(p => p.closed < p.required).map(p => `${p.positionName}:${p.closed}/${p.required}`).join(', ')}`);
        }
    }
    console.log(`Días mal: ${bad}/30`);

    // Pie estricto: sin positionName NO cuenta (como UI con dominant fallback solo si falta)
    console.log('\nPie UI estricto (sin positionName = no cuenta):');
    bad = 0;
    for (const day of daysInMonth) {
        const dateStr = getDateKey(day);
        const byPos: Record<string, Record<string, number>> = {};
        for (const p of positions) byPos[p.positionName] = {};
        for (const a of gen.assignments) {
            if (a.dateStr !== dateStr || !a.positionName) continue;
            const code = String(a.code || '').toUpperCase();
            if (NON_BILL.has(code)) continue;
            byPos[a.positionName][code] = (byPos[a.positionName][code] || 0) + 1;
        }
        const totals = sumDayCoverageFromCodeCounts(positions, getDayLetter(dateStr), byPos, brain.cycles);
        if (totals.closed < totals.required) bad++;
        if (totals.closed <= 2) console.log(`  ${dateStr} ${totals.closed}/${totals.required}`);
    }
    console.log(`Días mal (estricto): ${bad}/30`);
}

main().catch(e => { console.error(e); process.exit(1); });
