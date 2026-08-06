/**
 * Smoke: ciclo pool 5+1 — arranque (cycleStartDate) vs continuidad (trailing julio).
 * Caso tipo Shopping: 12 legajos, 10 cupos.
 */
import {
    buildObjectivePoolCycleWorkDays,
    francosPerOperationalDay,
    validatePoolFrancoBalance,
} from '../src/lib/planificacion/poolCycleBootstrap';
import type { AutoLabCaseDefinition } from '../src/lib/planificacion/autoLabCaseCatalog';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

function monthStartGlobalDayIndex(daysInMonth: Date[]): number {
    const d0 = daysInMonth[0];
    if (!d0) return 0;
    const ANCHOR = new Date(2020, 0, 1);
    return Math.round((d0.getTime() - ANCHOR.getTime()) / 86_400_000);
}

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

function buildDaysInMonth(year: number, month: number): Date[] {
    const days: Date[] = [];
    const last = new Date(year, month, 0).getDate();
    for (let d = 1; d <= last; d++) {
        days.push(new Date(year, month - 1, d));
    }
    return days;
}

const ALL = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

function buildShoppingCase(extra: Partial<AutoLabCaseDefinition> = {}): AutoLabCaseDefinition {
    return {
        id: 'eval-shopping-pool-cycle',
        order: 99,
        title: 'Shopping pool cycle eval',
        subtitle: 'synthetic',
        description: 'eval',
        expectations: [],
        coverageNotes: '',
        positions: [],
        employeeCount: 12,
        cycle: '5+1',
        rotationMode: 'fixed',
        rotateShiftsOverride: false,
        slaVendidas: 2480,
        serviceStartDate: '2026-08-01',
        serviceEndDate: '2026-08-31',
        ...extra,
    };
}

function employeeIds(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `emp-${String(i + 1).padStart(2, '0')}`);
}

function poolOperationalDay() {
    return () => true;
}

function runPoolCycleOnly(label: string, caseDef: AutoLabCaseDefinition): boolean {
    const year = 2026;
    const month = 8;
    const daysInMonth = buildDaysInMonth(year, month);
    const ids = employeeIds(caseDef.employeeCount);
    const monthStart = monthStartGlobalDayIndex(daysInMonth);
    const cycleWork = buildObjectivePoolCycleWorkDays({
        employeeIds: ids,
        daysInMonth,
        cycleKey: '5+1',
        monthStartGlobalDayIndex: monthStart,
        getDateKey: getAutoLabDateKey,
        getDayLetter: getAutoLabDayLetter,
        isOperationalDay: poolOperationalDay(),
        poolCycleStartDate: caseDef.poolCycleStartDate,
        cycleAnchorByEmp: caseDef.poolCycleAnchorByEmp,
        prevMonthTrailingWorkDays: caseDef.prevMonthTrailingWorkDays,
        prevMonthTrailingRestDays: caseDef.prevMonthTrailingRestDays,
    });
    const dateStrs = daysInMonth.map((d) => getAutoLabDateKey(d));
    const expectedF = francosPerOperationalDay(ids.length, 10);
    const balance = validatePoolFrancoBalance(cycleWork, ids, dateStrs, expectedF);
    console.log(`\n=== ${label} ===`);
    console.log(`Francos/día esperados: ${expectedF} | OK: ${balance.ok}`);
    if (!balance.ok) {
        console.log(`Días desbalanceados (${balance.badDays.length}):`, balance.badDays.slice(0, 8).join(', '));
    }
    const day1Off = ids.filter((id) => !cycleWork[id]?.has('2026-08-01')).length;
    console.log(`2026-08-01: ${day1Off} de franco (artifact: 2 con offset 5)`);
    return balance.ok;
}

let ok = true;

ok = runPoolCycleOnly(
    'Arranque — poolCycleStartDate 2026-08-01, sin trailing',
    buildShoppingCase({ poolCycleStartDate: '2026-08-01' }),
) && ok;

ok = runPoolCycleOnly(
    'Continuidad — trailing emp-11 y emp-12 en F al 31/07',
    buildShoppingCase({
        poolCycleStartDate: '2026-08-01',
        prevMonthTrailingRestDays: {
            'emp-11': 1,
            'emp-12': 1,
        },
    }),
) && ok;

console.log('\nMotor completo: probá en /admin/planificacion/auto-lab (caso real, ago 2026).');

if (!ok) {
    process.exitCode = 1;
    console.error('\n[eval-pool-cycle-autolab] FALLÓ balance 2F/día en capa ciclo');
} else {
    console.log('\n[eval-pool-cycle-autolab] OK capa ciclo pool');
}
