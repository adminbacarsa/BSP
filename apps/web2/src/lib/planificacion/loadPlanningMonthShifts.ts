import { collection, getDocs, query, Timestamp, where, type Query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { belongsToEmpresaView, empresaCollectionQuery } from '@/lib/multiempresa';
import type { PlanningAbsenceRecord, PlanningShiftCell } from './planningCoverageWisdom';
import {
    inferAbsenceCode,
    isActiveAbsence,
    iterateCalendarDateRange,
    toCalendarDateStr,
} from './absenceCodes';

/** Rango del mes calendario (month = 1..12). */
export function planningMonthBounds(year: number, month: number): { firstDay: Date; lastDay: Date } {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59, 999);
    return { firstDay, lastDay };
}

/** Listener/getDocs: solo turnos del mes (no toda la colección). */
export function buildPlanningMonthTurnosQuery(params: {
    empresaId: string;
    scopeEmpresa?: boolean;
    year: number;
    month: number;
}): Query {
    const { empresaId, scopeEmpresa = true, year, month } = params;
    const { firstDay, lastDay } = planningMonthBounds(year, month);
    const startTs = Timestamp.fromDate(firstDay);
    const endTs = Timestamp.fromDate(lastDay);
    const col = collection(db, 'turnos');
    const id = String(empresaId ?? '').trim();
    if (scopeEmpresa && id && id.toLowerCase() !== 'bacarsa') {
        return query(
            col,
            where('empresaId', '==', id),
            where('startTime', '>=', startTs),
            where('startTime', '<=', endTs),
        );
    }
    return query(col, where('startTime', '>=', startTs), where('startTime', '<=', endTs));
}

/** RFZ con campo fecha (sin startTime Firestore) dentro del mes. */
export function buildPlanningMonthRfzQuery(params: {
    empresaId: string;
    scopeEmpresa?: boolean;
    year: number;
    month: number;
}): Query {
    const { empresaId, scopeEmpresa = true, year, month } = params;
    const monthStr = String(month).padStart(2, '0');
    const monthStart = `${year}-${monthStr}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
    const col = collection(db, 'turnos');
    const id = String(empresaId ?? '').trim();
    if (scopeEmpresa && id && id.toLowerCase() !== 'bacarsa') {
        return query(
            col,
            where('empresaId', '==', id),
            where('code', '==', 'RFZ'),
            where('fecha', '>=', monthStart),
            where('fecha', '<=', monthEnd),
        );
    }
    return query(
        col,
        where('code', '==', 'RFZ'),
        where('fecha', '>=', monthStart),
        where('fecha', '<=', monthEnd),
    );
}

function isOperationalOriginShift(data: Record<string, unknown>): boolean {
    const o = String(data?.origin || '').toUpperCase();
    if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
    if (data?.resolvedBy === 'OPERACIONES') return true;
    return false;
}

function toDateStr(startTime: unknown): string | null {
    if (!startTime) return null;
    try {
        let d: Date | null = null;
        if (typeof (startTime as { toDate?: () => Date }).toDate === 'function') {
            d = (startTime as { toDate: () => Date }).toDate();
        } else if (typeof (startTime as { seconds?: number }).seconds === 'number') {
            d = new Date((startTime as { seconds: number }).seconds * 1000);
        } else {
            d = new Date(startTime as string);
        }
        if (!d || Number.isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch {
        return null;
    }
}

function turnoToCell(
    id: string,
    data: Record<string, unknown>,
    employeeNames: Record<string, string>,
): PlanningShiftCell | null {
    const objectiveId = String(data.objectiveId || '').trim();
    const employeeId = String(data.employeeId || data.empleadoId || '').trim();
    if (!objectiveId || !employeeId) return null;
    if (isOperationalOriginShift(data)) return null;

    const dateStr = toDateStr(data.startTime);
    if (!dateStr) return null;

    const code = String(data.code || data.type || '').toUpperCase().trim();
    if (!code) return null;

    return {
        id,
        employeeId,
        employeeName: employeeNames[employeeId] || String(data.employeeName || data.empleadoNombre || ''),
        objectiveId,
        dateStr,
        code,
        positionName: String(data.positionName || data.puesto || '').trim() || undefined,
        coveredBy: data.coveredBy ? String(data.coveredBy) : undefined,
        coveredByEmployeeId: data.coveredByEmployeeId ? String(data.coveredByEmployeeId) : undefined,
        coveredByEmployeeName: data.coveredByEmployeeName ? String(data.coveredByEmployeeName) : undefined,
        coversEmployeeId: data.coversEmployeeId ? String(data.coversEmployeeId) : undefined,
        coverageSegmentRole: data.coverageSegmentRole ? String(data.coverageSegmentRole) : undefined,
        comments: data.comments ? String(data.comments) : undefined,
        isFrancoTrabajado: data.isFrancoTrabajado === true || code === 'FT',
        draft: data.draft === true,
    };
}

export async function fetchPlanningMonthShifts(params: {
    empresaId: string;
    objectiveId: string;
    year: number;
    month: number;
    scopeEmpresa?: boolean;
    migracionCompleta?: boolean;
    employeeNames?: Record<string, string>;
    publishedOnly?: boolean;
}): Promise<PlanningShiftCell[]> {
    const {
        empresaId,
        objectiveId,
        year,
        month,
        scopeEmpresa = true,
        migracionCompleta = true,
        employeeNames = {},
        publishedOnly = false,
    } = params;

    const turnosQ = buildPlanningMonthTurnosQuery({
        empresaId,
        scopeEmpresa,
        year,
        month,
    });

    const snap = await getDocs(turnosQ);
    const cells: PlanningShiftCell[] = [];

    snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (String(data.objectiveId || '') !== objectiveId) return;
        if (publishedOnly && data.draft === true) return;
        const cell = turnoToCell(d.id, data, employeeNames);
        if (cell) cells.push(cell);
    });

    return cells;
}

export async function fetchPlanningMonthAbsences(params: {
    empresaId: string;
    year: number;
    month: number;
    rosterEmployeeIds: Set<string>;
    scopeEmpresa?: boolean;
    migracionCompleta?: boolean;
}): Promise<PlanningAbsenceRecord[]> {
    const {
        empresaId,
        year,
        month,
        rosterEmployeeIds,
        scopeEmpresa = true,
        migracionCompleta = true,
    } = params;

    if (rosterEmployeeIds.size === 0) return [];

    const lastDay = new Date(year, month, 0).getDate();
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const ausenciasQ = scopeEmpresa
        ? empresaCollectionQuery('ausencias', empresaId, true)
        : collection(db, 'ausencias');
    const snap = await getDocs(ausenciasQ as ReturnType<typeof query>);
    const records: PlanningAbsenceRecord[] = [];
    const keys = new Set<string>();

    snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (!isActiveAbsence(data)) return;

        const employeeId = String(data.employeeId || '').trim();
        if (!employeeId || !rosterEmployeeIds.has(employeeId)) return;

        const startStr = toCalendarDateStr(data.startDate);
        const endStr = toCalendarDateStr(data.endDate) || startStr;
        if (!startStr) return;
        if (endStr < monthStart || startStr > monthEnd) return;

        const code = inferAbsenceCode(data);
        const employeeName = String(data.employeeName || data.empleadoNombre || '').trim() || undefined;
        const rangeStart = startStr > monthStart ? startStr : monthStart;
        const rangeEnd = endStr < monthEnd ? endStr : monthEnd;

        iterateCalendarDateRange(rangeStart, rangeEnd).forEach((dateStr) => {
            const key = `${employeeId}__${dateStr}`;
            if (keys.has(key)) return;
            keys.add(key);
            records.push({
                employeeId,
                employeeName,
                dateStr,
                code,
                absenceId: d.id,
            });
        });
    });

    return records;
}

export function previousCalendarMonth(year: number, month: number): { year: number; month: number } {
    if (month <= 1) return { year: year - 1, month: 12 };
    return { year, month: month - 1 };
}
