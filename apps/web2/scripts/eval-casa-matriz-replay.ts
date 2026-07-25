/**
 * Replay export Auto Lab Casa Matriz y diagnóstico de huecos SLA.
 * npm run eval:casa-matriz
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateScheduleV4 } from '../src/lib/planificacion/autoScheduleEngineV4';
import type { V2EmployeeDef, V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';
import { verifyScheduleCoverage } from '../src/lib/planificacion/coverageVerification';
import { buildPositionRequiredHeadcountMap } from '../src/lib/planificacion/objectiveHeadcount';
import { resolveObjectiveScheduleFlags } from '../src/lib/planificacion/scheduleObjectiveFlags';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

function getAutoLabDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getAutoLabDayLetter(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return DAY_LETTERS[new Date(y, m - 1, d).getDay()];
}

interface ExportJson {
    period: { year: number; month: number };
    synthetic: {
        positions: V2PositionDef[];
        employees: V2EmployeeDef[];
        slaVendidas: number;
        cycle: string;
    };
    brain: {
        pickedCycle: string;
        cycles: string[];
        rotateShifts: boolean;
        ajustarCrono: boolean;
        strictSixTwo: boolean;
    };
}

function buildDaysInMonth(year: number, month: number): Date[] {
    const days: Date[] = [];
    const last = new Date(year, month, 0).getDate();
    for (let d = 1; d <= last; d++) days.push(new Date(year, month - 1, d));
    return days;
}

function buildLabDefaultPositionByEmp(
    positions: V2PositionDef[],
    employees: { id: string }[],
    positionHeadcount: Record<string, number>,
): Record<string, string> {
    const map: Record<string, string> = {};
    let idx = 0;
    for (const pos of positions) {
        const headcount = positionHeadcount[pos.positionName] || 1;
        let assigned = 0;
        while (assigned < headcount && idx < employees.length) {
            map[employees[idx].id] = pos.positionName;
            idx += 1;
            assigned += 1;
        }
    }
    return map;
}

function main() {
    const fixturePath = join(__dirname, 'fixtures', 'casa-matriz-export.json');
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExportJson;
    const { year, month } = raw.period;
    const daysInMonth = buildDaysInMonth(year, month);
    const cycleKey = raw.brain.cycles[0] || raw.brain.pickedCycle;
    const positionHeadcount = buildPositionRequiredHeadcountMap(raw.synthetic.positions, cycleKey);
    const scheduleFlags = resolveObjectiveScheduleFlags(raw.synthetic.positions);

    const ctx: V2EngineContext = {
        positions: raw.synthetic.positions,
        employees: raw.synthetic.employees.map((e) => ({
            ...e,
            preferredObjectiveId: 'auto-lab-case-real-service',
        })),
        daysInMonth,
        calendarDaysInMonth: daysInMonth,
        serviceExcludedDates: [],
        empMonthlyInitial: Object.fromEntries(raw.synthetic.employees.map((e) => [e.id, 0])),
        absences: {},
        slaVendidas: raw.synthetic.slaVendidas,
        autoCycles: raw.brain.cycles,
        objectiveId: 'auto-lab-case-real-service',
        defaultPositionByEmp: buildLabDefaultPositionByEmp(
            raw.synthetic.positions,
            raw.synthetic.employees,
            positionHeadcount,
        ),
        budgetMode: 'cct',
        getDayLetter: getAutoLabDayLetter,
        getDateKey: getAutoLabDateKey,
        rotateShifts: raw.brain.rotateShifts,
        ajustarCrono: raw.brain.ajustarCrono,
        modo12Days: [],
        contingencyApretarDays: [],
        apretarCronoDays: [],
        strictSixTwo: raw.brain.strictSixTwo,
        noFlexSchemeEmployees: true,
        allowCustom24hsBackup: scheduleFlags.allowCustom24hsBackup,
        schedulePhasedRotativeFirst: scheduleFlags.schedulePhasedRotativeFirst,
        preserveRotativeIntegrity: scheduleFlags.preserveRotativeIntegrity,
        allowFrancoWorkedRescue: false,
        headcountByPax: true,
    };

    const gen = generateScheduleV4(ctx);
    const stats = gen.stats;
    const report = verifyScheduleCoverage(ctx, gen.assignments, stats, { inferModo12TCoverage: false });

    console.log('=== Casa Matriz replay ===');
    console.log('Uncovered (motor):', stats.uncoveredSlots);
    console.log('Uncovered (verificador):', report.coverage.uncoveredSlots);
    console.log('Billable hours:', stats.totalBillableHours);
    console.log('Roster phased:', stats.rosterPhasedByKind);
    console.log('Virtual roster:', stats.rosterVirtualAssignmentCount);
    console.log('Position groups:', JSON.stringify(stats.positionGroups, null, 2));

    console.log('\n--- Huecos verificador ---');
    for (const u of report.uncovered) {
        console.log(
            `${u.dateStr} ${u.positionName} ${u.shiftCode}: pedido=${u.qtyRequested} asignado=${u.qtyAssigned}`,
        );
    }

    const p1Emps = stats.positionGroups?.['Puesto 1'] || [];
    const p1ByDay: Record<string, Record<string, number>> = {};
    for (const a of gen.assignments) {
        if (a.positionName !== 'Puesto 1') continue;
        const c = String(a.code).toUpperCase();
        if (!['M', 'T', 'N'].includes(c)) continue;
        if (!p1ByDay[a.dateStr]) p1ByDay[a.dateStr] = { M: 0, T: 0, N: 0 };
        p1ByDay[a.dateStr][c] = (p1ByDay[a.dateStr][c] || 0) + 1;
    }
    console.log('\n--- Puesto 1: días con banda faltante ---');
    let gapDays = 0;
    for (const day of daysInMonth) {
        const ds = getAutoLabDateKey(day);
        const cov = p1ByDay[ds] || { M: 0, T: 0, N: 0 };
        const missing = ['M', 'T', 'N'].filter((b) => (cov[b] || 0) < 1);
        if (missing.length > 0) {
            gapDays++;
            console.log(`${ds}: falta ${missing.join(',')} (M=${cov.M} T=${cov.T} N=${cov.N})`);
        }
    }
    console.log(`Total días con hueco 24hs: ${gapDays}`);

    // Quién está en franco cuando falta banda
    console.log('\n--- Francos Puesto 1 en días con hueco ---');
    for (const day of daysInMonth) {
        const ds = getAutoLabDateKey(day);
        const cov = p1ByDay[ds] || { M: 0, T: 0, N: 0 };
        const missing = ['M', 'T', 'N'].filter((b) => (cov[b] || 0) < 1);
        if (missing.length === 0) continue;
        const francos = gen.assignments
            .filter((a) => p1Emps.includes(a.empId) && a.dateStr === ds && ['F', 'FF', 'RET'].includes(String(a.code).toUpperCase()))
            .map((a) => `${a.empId.slice(0, 6)}=${a.code}`);
        console.log(`${ds}: ${francos.join(' ')}`);
    }

    if ((stats.uncoveredSlots ?? 0) > 0) process.exit(2);
    console.log('\neval-casa-matriz-replay: OK');
}

main();
