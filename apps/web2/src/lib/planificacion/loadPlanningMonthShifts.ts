import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { belongsToEmpresaView } from '@/lib/multiempresa';
import type { PlanningShiftCell } from './planningCoverageWisdom';

function isOperationalOriginShift(data: Record<string, unknown>): boolean {
    const o = String(data?.origin || '').toUpperCase();
    if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
    if (data?.resolvedBy === 'OPERACIONES') return true;
    if (data?.isReten === true) return true;
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
        coversEmployeeId: data.coversEmployeeId ? String(data.coversEmployeeId) : undefined,
        coverageSegmentRole: data.coverageSegmentRole ? String(data.coverageSegmentRole) : undefined,
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

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59, 999);

    const turnosQ = scopeEmpresa
        ? query(
            collection(db, 'turnos'),
            where('empresaId', '==', empresaId),
            where('startTime', '>=', Timestamp.fromDate(firstDay)),
            where('startTime', '<=', Timestamp.fromDate(lastDay)),
        )
        : query(
            collection(db, 'turnos'),
            where('startTime', '>=', Timestamp.fromDate(firstDay)),
            where('startTime', '<=', Timestamp.fromDate(lastDay)),
        );

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

export function previousCalendarMonth(year: number, month: number): { year: number; month: number } {
    if (month <= 1) return { year: year - 1, month: 12 };
    return { year, month: month - 1 };
}
