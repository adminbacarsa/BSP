/**
 * Misericordia jun 2026 — bandas fijas, dotación real emulador.
 * Uso: npx tsx scripts/debug-misericordia-fixed.ts
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { generateScheduleFixedBand, buildFixedBandPlan } from '../src/lib/planificacion/fixedBandScheduleEngine';
import { pickOptimalAutoCycles } from '../src/lib/planificacion/autoScheduleEngineV4';
import { verifyScheduleCoverage } from '../src/lib/planificacion/coverageVerification';
import type { V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const getDayLetter = (dateStr: string) => DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];

async function main() {
    const oid = '1768936428905';
    const slaDoc = await db.collection('servicios_sla').doc('wVE9l8qxMNUYlCRznj3N').get();
    const sla = slaDoc.data() as any;
    const empSnap = await db.collection('empleados').where('preferredObjectiveId', '==', oid).get();
    const employees = empSnap.docs
        .filter(d => d.data().status !== 'inactivo')
        .map(d => ({ id: d.id, nombre: String(d.data().nombre || d.data().name || d.id) }));

    const daysInMonth: Date[] = [];
    for (let d = 1; d <= 30; d++) daysInMonth.push(new Date(2026, 5, d));

    const positions: V2PositionDef[] = (sla.positions || []).map((p: any) => ({
        positionName: p.name,
        qty: Math.max(1, Number(p.quantity) || 1),
        coverageType: p.coverageType || '24hs',
        activeDays: p.activeDays || ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: (p.allowedShiftTypes || []).map((s: any) => ({
            code: s.code, name: s.name, hours: s.hours,
            startTime: s.startTime, endTime: s.endTime,
        })),
    }));

    console.log('\n=== H. Misericordia — bandas fijas ===');
    console.log(`SLA: ${sla.totalMonthlyHours}h · ${employees.length} guardias · ${positions.length} puestos`);

    const baseCtx: V2EngineContext = {
        positions, employees, daysInMonth,
        empMonthlyInitial: Object.fromEntries(employees.map(e => [e.id, 0])),
        absences: {}, slaVendidas: Number(sla.totalMonthlyHours) || 2880,
        autoCycles: [], getDayLetter, getDateKey,
        demandDriven: true, rotateShifts: false,
    };

    const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
    baseCtx.autoCycles = picked.cycles;
    console.log('Ciclo auto:', picked.cycles);

    const plan = buildFixedBandPlan(baseCtx, employees.map(e => e.id));
    console.log('Plan bandas:', plan.bandCounts);

    const gen = generateScheduleFixedBand(baseCtx);
    const cov = verifyScheduleCoverage(baseCtx, gen.assignments, gen.stats);

    console.log('Billable:', gen.stats.totalBillableHours, 'h');
    console.log('SLA cerrado:', gen.stats.slaHoursClosed);
    console.log('Slots:', cov.coverage.coveredSlots, '/', cov.coverage.totalSlots,
        'sin cubrir:', cov.coverage.uncoveredSlots);
    if (cov.coverage.uncoveredSlots > 0) {
        cov.uncovered.slice(0, 8).forEach(u =>
            console.log(`  ${u.dateStr} ${u.positionName} ${u.shiftCode} (${u.qtyAssigned}/${u.qtyRequested})`));
    }
}

main().catch(e => { console.error(e); process.exit(1); });
