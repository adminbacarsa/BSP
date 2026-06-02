import { inferAbsenceCode } from '@/lib/planificacion/absenceCodes';

export const CRONO_COMPARE_SHIFT_STYLES: Record<string, string> = {
    M: 'bg-white text-blue-700 border border-blue-400 font-bold',
    T: 'bg-white text-orange-600 border border-orange-400 font-bold',
    N: 'bg-white text-indigo-700 border border-indigo-500 font-bold',
    D12: 'bg-white text-cyan-700 border border-cyan-400 font-bold',
    N12: 'bg-white text-purple-700 border border-purple-400 font-bold',
    F: 'bg-green-500 text-white border border-green-600 font-black',
    V: 'bg-emerald-700 text-white border border-emerald-800 font-black',
    L: 'bg-white text-purple-700 border border-purple-400 font-black',
    E: 'bg-white text-rose-700 border border-rose-400 font-black',
    AA: 'bg-white text-amber-700 border border-amber-400',
    RET: 'bg-white text-amber-800 border border-amber-500 font-black',
    REF: 'bg-violet-100 text-violet-800 border border-violet-500 font-black',
    ESC: 'bg-sky-100 text-sky-800 border border-sky-500 font-black',
    PG: 'bg-white text-blue-700 border border-blue-400 font-black',
    FT: 'bg-violet-600 text-white border border-violet-700 font-black',
    FF: 'bg-green-600 text-white border border-green-700 font-black',
};

export function cronoCompareDateKey(dateInput: Date | { toDate?: () => Date }): string {
    const d = dateInput instanceof Date ? dateInput : dateInput.toDate?.() ?? new Date(dateInput as unknown as string);
    const parts = new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d);
    const day = parts.find((p) => p.type === 'day')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const year = parts.find((p) => p.type === 'year')?.value;
    return `${year}-${month}-${day}`;
}

export function cronoCompareDayLetter(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][date.getDay()];
}

export function isOperationalOriginShift(data: any): boolean {
    const o = String(data?.origin || '').toUpperCase();
    if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
    if (data?.resolvedBy === 'OPERACIONES') return true;
    if (data?.isReten === true) return true;
    return false;
}

export function resolveCommittedShiftAtObjective(
    empId: string,
    dateStr: string,
    objectiveId: string,
    shiftsMap: Record<string, any>,
): any | null {
    const key = `${empId}_${dateStr}`;
    const shift = shiftsMap[key];
    if (!shift) return null;
    if (String(shift.objectiveId || '') !== String(objectiveId)) return null;
    if (isOperationalOriginShift(shift)) return null;
    return shift;
}

export function buildCronoCompareEmployees(
    employees: any[],
    objectiveId: string,
    shiftsMap: Record<string, any>,
    slaIdToObjId: Record<string, string>,
): any[] {
    if (!objectiveId) return [];
    const guestIds = new Set<string>();
    for (const shift of Object.values(shiftsMap)) {
        if (shift?.objectiveId === objectiveId && shift?.employeeId) guestIds.add(shift.employeeId);
    }
    return employees
        .filter((e) => e.status !== 'inactivo')
        .filter(
            (e) =>
                e.preferredObjectiveId === objectiveId ||
                slaIdToObjId[e.preferredObjectiveId] === objectiveId ||
                guestIds.has(e.id),
        )
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function monthParamFromDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

export function dateFromMonthParam(month: string): Date {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return new Date(y, m - 1, 1);
}

export function inferAbsenceCellStyle(absence: any): { content: string; style: string } {
    const absCode = absence.inferredCode || inferAbsenceCode(absence);
    const code = String(absCode).toUpperCase();
    return {
        content: absCode,
        style: CRONO_COMPARE_SHIFT_STYLES[code] || 'bg-rose-50 text-rose-700 border border-rose-200 font-bold',
    };
}
