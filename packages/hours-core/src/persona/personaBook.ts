import {
    calculateLiquidationHoursStats,
    dedupeShiftsByAbsencePriority,
    isShiftEligibleForReports,
    isShiftPublishedForReports,
    prepareShiftsForEmployeeLiquidation,
    propagateFrancoTrabajadoFlags,
    shiftCalendarDateKey,
    type ReportPublishFilter,
} from '../motors/liquidation/reportesLiquidation';
import { arYmd } from '../time/ar';

export type PersonaLiquidationStats = ReturnType<typeof calculateLiquidationHoursStats>;

export type PersonaBookInput = {
    /** Turnos ya acotados a empresa, alcance y rango de `startTime` (mismo fetch que Reportes). */
    turnos: any[];
    /** Ausencias de la empresa que solapan el rango (`{ id, ...data }`). */
    ausencias: any[];
    publishStatusMap: Record<string, boolean>;
    rangeStartYmd: string;
    rangeEndYmd: string;
    /** Legajos conocidos → nombre visible (mismo formato que Reportes). */
    empNameById: Record<string, string>;
    holidays: Record<string, boolean>;
    usePlannedHours?: boolean;
    publishFilter?: ReportPublishFilter;
};

export type PersonaBookEmployee = {
    employeeId: string;
    shifts: any[];
    stats: PersonaLiquidationStats;
};

export type PersonaBook = {
    rawShifts: any[];
    enrichShift: (s: any) => any;
    employees: PersonaBookEmployee[];
    byEmployee: Map<string, PersonaBookEmployee>;
};

export function personaEmployeeDisplayName(data: { name?: unknown; firstName?: unknown; lastName?: unknown } | null | undefined): string {
    if (!data) return 'Sin Nombre';
    if (data.name) return String(data.name);
    if (data.firstName) return `${data.lastName}, ${data.firstName}`;
    return 'Sin Nombre';
}

export function personaCalendarDateStr(val: unknown): string | null {
    if (val == null || val === '') return null;
    if (typeof val === 'string') {
        const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        const dt = new Date(val);
        return isNaN(dt.getTime()) ? null : arYmd(dt);
    }
    if (typeof val === 'object') {
        const rec = val as { toDate?: () => Date; seconds?: number; _seconds?: number };
        if (typeof rec.toDate === 'function') return arYmd(rec.toDate());
        const sec = rec.seconds ?? rec._seconds;
        if (typeof sec === 'number') return arYmd(new Date(sec * 1000));
    }
    return null;
}

export function personaIterateDateRange(startStr: string, endStr: string): string[] {
    if (String(endStr).slice(0, 10) < String(startStr).slice(0, 10)) return [];
    const [sy, sm, sd] = startStr.split('-').map(Number);
    const [ey, em, ed] = endStr.split('-').map(Number);
    if (!sy || !ey) return [];
    const out: string[] = [];
    let cur = Date.UTC(sy, sm - 1, sd);
    const end = Date.UTC(ey, em - 1, ed);
    while (cur <= end) {
        const d = new Date(cur);
        out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
        cur += 24 * 3600000;
    }
    return out;
}

export function parsePlanificacionEstadoDocIdForPersona(docId: string): { objectiveId: string; year: number; month: number } | null {
    const parts = String(docId ?? '').split('_');
    if (parts.length < 3) return null;
    const month = parseInt(parts[parts.length - 1], 10);
    const year = parseInt(parts[parts.length - 2], 10);
    if (!Number.isFinite(month) || !Number.isFinite(year) || year < 2000) return null;
    if (parts.length === 3) return { objectiveId: parts[0], year, month };
    if (parts.length === 4) return { objectiveId: parts[1], year, month };
    return { objectiveId: parts.slice(1, -2).join('_'), year, month };
}

/** Mismo mapa que Reportes: `${objectiveId}_${year}_${month}` y el doc id crudo. */
export function buildPersonaPublishStatusMap(docIds: string[]): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const id of docIds) {
        const parsed = parsePlanificacionEstadoDocIdForPersona(id);
        if (parsed) map[`${String(parsed.objectiveId).trim()}_${parsed.year}_${parsed.month}`] = true;
        map[id] = true;
    }
    return map;
}

export function computePersonaEmployeeLiquidation(
    shifts: any[],
    holidays: Record<string, boolean>,
    opts?: { usePlannedHours?: boolean },
): { shifts: any[]; stats: PersonaLiquidationStats } {
    const usePlannedHours = opts?.usePlannedHours ?? false;
    const prepared = prepareShiftsForEmployeeLiquidation(
        dedupeShiftsByAbsencePriority(
            propagateFrancoTrabajadoFlags(shifts, { usePlannedHours }),
            { usePlannedHours },
        ),
    );
    return {
        shifts: prepared,
        stats: calculateLiquidationHoursStats(prepared, holidays, { usePlannedHours }),
    };
}

/** Libro PERSONA: mismo recorrido que Reportes → Liquidación (elegibilidad, FT, ausencias, cobertura, legajo). */
export function buildPersonaBook(input: PersonaBookInput): PersonaBook {
    const usePlannedHours = input.usePlannedHours ?? false;
    const publishFilter = input.publishFilter ?? 'published';
    const { publishStatusMap, empNameById } = input;

    const ftShiftIds = new Set<string>();
    const allByEmp: Record<string, any[]> = {};
    for (const s of input.turnos) {
        if (!s.employeeId) continue;
        (allByEmp[s.employeeId] ||= []).push(s);
    }
    for (const empShifts of Object.values(allByEmp)) {
        propagateFrancoTrabajadoFlags(empShifts, { usePlannedHours }).forEach((s: any) => {
            if (s.isFrancoTrabajado || s._inferredFrancoTrabajado) ftShiftIds.add(s.id);
        });
    }

    const rawShifts = input.turnos.filter((d: any) => isShiftEligibleForReports(d, publishStatusMap, publishFilter));

    const absenceById: Record<string, any> = {};
    const absenceByEmpDate: Record<string, any> = {};
    for (const absDoc of input.ausencias) {
        absenceById[absDoc.id] = absDoc;
        const startStr = personaCalendarDateStr(absDoc.startDate);
        const endStr = personaCalendarDateStr(absDoc.endDate || absDoc.startDate);
        if (!startStr || !endStr) continue;
        for (const dateStr of personaIterateDateRange(startStr, endStr)) {
            if (dateStr < input.rangeStartYmd || dateStr > input.rangeEndYmd) continue;
            absenceByEmpDate[`${absDoc.employeeId}_${dateStr}`] = absDoc;
        }
    }

    const coverageByEmpDate: Record<string, string> = {};
    const coveringForByEmpDate: Record<string, string> = {};
    for (const s of rawShifts) {
        const dk = shiftCalendarDateKey(s);
        const comments = String(s.comments || '');
        const m = comments.match(/Cubriendo a (.+?) \(/);
        if (m && dk) {
            const titularName = m[1].trim();
            const titularId = Object.keys(empNameById).find((id) => empNameById[id] === titularName);
            if (titularId) {
                const covName = s.employeeName || empNameById[s.employeeId] || '—';
                coverageByEmpDate[`${titularId}_${dk}`] = covName;
                const coverCode = String(s.code || '').trim().toUpperCase();
                coveringForByEmpDate[`${s.employeeId}_${dk}`] = coverCode
                    ? `${titularName} turno ${coverCode}`
                    : titularName;
            }
        }
        if (s.coveredBy && dk) {
            coverageByEmpDate[`${s.employeeId}_${dk}`] = String(s.coveredBy).replace(/\s*\([^)]*\)\s*$/, '').trim();
        }
    }

    const shiftIdToShift: Record<string, any> = {};
    for (const s of rawShifts) if (s.id) shiftIdToShift[s.id] = s;

    const coveringForByEmpIdDate: Record<string, string> = {};
    for (const s of rawShifts) {
        if (!s.coveredByEmployeeId) continue;
        const dk = shiftCalendarDateKey(s);
        if (!dk) continue;
        const key = `${s.coveredByEmployeeId}_${dk}`;
        const isVacancy = !s.employeeId || s.isUnassigned;
        const desc = isVacancy
            ? `Vacante${s.positionName ? ' ' + s.positionName : ''}${s.code ? ' (' + s.code + ')' : ''}`
            : (s.employeeName || 'Guardia');
        if (!coveringForByEmpIdDate[key]) coveringForByEmpIdDate[key] = desc;
    }

    const resolveCoveringFor = (s: any, dk: string | null): string | null => {
        const refId = s.absenceShiftId;
        if (refId && shiftIdToShift[refId]) {
            const ref = shiftIdToShift[refId];
            const isVacancy = !ref.employeeId || ref.employeeId === 'VACANTE' || ref.isUnassigned;
            if (isVacancy) {
                const pos = ref.positionName || '';
                const code = (ref.code || '').toUpperCase();
                return `Vacante${pos ? ' ' + pos : ''}${code ? ' (' + code + ')' : ''}`;
            }
            return ref.employeeName || null;
        }
        if (dk && coveringForByEmpIdDate[`${s.employeeId}_${dk}`]) {
            return coveringForByEmpIdDate[`${s.employeeId}_${dk}`];
        }
        if (s.relievedEmployeeName) return s.relievedEmployeeName;
        if (dk && s.objectiveId && s.positionName) {
            const sameSlotAbsent = rawShifts.find((r: any) =>
                r.id !== s.id
                && (r.isAbsent || r.status === 'ABSENT')
                && r.objectiveId === s.objectiveId
                && (r.positionName || '').trim().toLowerCase() === (s.positionName || '').trim().toLowerCase()
                && shiftCalendarDateKey(r) === dk,
            );
            if (sameSlotAbsent?.employeeName) return sameSlotAbsent.employeeName;
            const isOpsShift = ['RETEN', 'EARLY_START', 'OPERATIONS_COVERAGE'].includes((s.origin || '').toUpperCase());
            if (isOpsShift) return `Vacante ${s.positionName || ''}`;
        }
        return null;
    };

    const enrichShift = (s: any) => {
        const dk = shiftCalendarDateKey(s);
        const abs = s.absenceId ? absenceById[s.absenceId] : (dk ? absenceByEmpDate[`${s.employeeId}_${dk}`] : null);
        const coveredByName = s.coveredByEmployeeName
            || s.coveredBy
            || (dk ? coverageByEmpDate[`${s.employeeId}_${dk}`] : null)
            || null;
        const coveringFor = resolveCoveringFor(s, dk)
            || (dk ? coveringForByEmpDate[`${s.employeeId}_${dk}`] : null)
            || null;
        return {
            ...s,
            _dateKey: dk,
            _isPublished: isShiftPublishedForReports(s, publishStatusMap),
            _absenceType: abs?.type || null,
            _absenceStatus: abs?.status || null,
            _absenceReason: abs?.reason || null,
            _coveredBy: coveredByName,
            _coveringFor: coveringFor,
        };
    };

    const empGroups: Record<string, any[]> = {};
    for (const s of rawShifts) {
        if (!s.employeeId || !empNameById[s.employeeId]) continue;
        const sWithFT = ftShiftIds.has(s.id)
            ? { ...s, isFrancoTrabajado: true, _inferredFrancoTrabajado: true, code: s.code || 'FT' }
            : s;
        (empGroups[s.employeeId] ||= []).push(enrichShift(sWithFT));
    }

    const employees: PersonaBookEmployee[] = [];
    const byEmployee = new Map<string, PersonaBookEmployee>();
    for (const [employeeId, group] of Object.entries(empGroups)) {
        const { shifts, stats } = computePersonaEmployeeLiquidation(group, input.holidays, { usePlannedHours });
        const entry = { employeeId, shifts, stats };
        employees.push(entry);
        byEmployee.set(employeeId, entry);
    }
    return { rawShifts, enrichShift, employees, byEmployee };
}

export type PersonaPayrollFigures = {
    acumulado: {
        hsTeoricas: number;
        hsReales: number;
        diurnas: number;
        nocturnas: number;
        al50: number;
        al100FT: number;
        plusFeriado: number;
    };
    liquidacion200: { bolsa: number; hsSimples: number; al50: number };
    totales: number;
    desglose: PersonaLiquidationStats['desglose'];
    turnosCount: number;
    turnosConFichada: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Traducción 1:1 de la fila de Reportes → Liquidación al contrato de payrollApi. */
export function personaStatsToPayrollFigures(
    entry: { shifts: any[]; stats: PersonaLiquidationStats },
    ajusteHoras = 0,
): PersonaPayrollFigures {
    const { stats } = entry;
    const bolsa = Math.max(0, stats.horasReales - stats.extra100);
    return {
        acumulado: {
            hsTeoricas: round2(stats.horasTeoricas + ajusteHoras),
            hsReales: round2(stats.horasReales),
            diurnas: round2(stats.totalDiurnas),
            nocturnas: round2(stats.totalNocturnas),
            al50: round2(stats.extra50),
            al100FT: round2(stats.extra100),
            plusFeriado: round2(stats.plusFeriado),
        },
        liquidacion200: {
            bolsa: round2(bolsa),
            hsSimples: round2(Math.min(bolsa, 200)),
            al50: round2(stats.extra50),
        },
        totales: round2(stats.totales),
        desglose: {
            plan: round2(stats.desglose.plan),
            ext: round2(stats.desglose.ext),
            adv: round2(stats.desglose.adv),
            cobertura: round2(stats.desglose.cobertura),
            ft: round2(stats.desglose.ft),
            tura: round2(stats.desglose.tura),
        },
        turnosCount: entry.shifts.length,
        turnosConFichada: stats.turnosConDatosReales,
    };
}

/** Ajustes manuales `ajustes_horas` (tipo AJUSTE_HORAS): suman a teóricas, igual que Reportes. */
export function sumPersonaAjustesHoras(
    ajustes: Array<{ tipo?: unknown; fecha?: unknown; employeeId?: unknown; horas?: unknown }>,
    rangeStart: Date,
    rangeEnd: Date,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of ajustes) {
        if (a.tipo !== 'AJUSTE_HORAS') continue;
        const f = a.fecha as { toDate?: () => Date } | undefined;
        const fecha = f && typeof f.toDate === 'function' ? f.toDate() : null;
        if (!fecha || fecha < rangeStart || fecha > rangeEnd) continue;
        const emp = String(a.employeeId ?? '');
        out[emp] = (out[emp] || 0) + (Number(a.horas) || 0);
    }
    return out;
}
