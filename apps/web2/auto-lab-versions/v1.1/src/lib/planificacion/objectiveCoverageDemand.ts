/**
 * Pipeline de planificación por objetivo:
 *   1. Demanda de cobertura (SLA → puestos × qty × bandas/día)
 *   2. Disponibilidad (dotación − ausencias/licencias)
 *   3. Input para generador / preflight AUTO
 */

import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import {
    positionSchemeLabelForDay,
    shiftBandHours,
} from './positionCoverageUnits';

export type PlanningPositionLike = {
    positionName?: string;
    qty?: number;
    coverageType?: string;
    shifts?: Array<{ code?: string; hours?: number }>;
    activeDays?: string[];
};

export interface PositionDayDemand {
    positionName: string;
    qty: number;
    schemeLabel: string;
    bandSlots: Record<string, number>;
    hoursRequired: number;
    alternateBandSlots?: Record<string, number>;
}

export interface ObjectiveDayDemand {
    dateStr: string;
    dayLetter: string;
    positions: PositionDayDemand[];
    totalBandSlots: Record<string, number>;
    totalPaxUnits: number;
    hoursRequired: number;
}

export interface EmployeeDayAvailability {
    empId: string;
    nombre: string;
    blockedDays: Set<string>;
    blockedCount: number;
    availableDays: number;
}

export interface ObjectiveCoveragePreflight {
    objectiveId?: string;
    slaVendidas: number;
    monthDemandHours: number;
    hoursDelta: number;
    employeeCount: number;
    totalAbsenceDays: number;
    dayDemands: ObjectiveDayDemand[];
    employees: EmployeeDayAvailability[];
    monthBandDemand: Record<string, number>;
    warnings: string[];
    canPlan: boolean;
}

const DEFAULT_IS_ACTIVE = (pos: PlanningPositionLike, dayLetter: string) => {
    const days = pos.activeDays;
    if (!days || days.length === 0) return true;
    return days.includes(dayLetter);
};

function bandSetsForPosition(pos: PlanningPositionLike): { bands8: string[]; bands12: string[] } {
    const allShifts = Array.isArray(pos.shifts) ? pos.shifts : [];
    const bands8 = [...new Set(
        allShifts.filter(s => shiftBandHours(s) < 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
    )];
    const bands12 = [...new Set(
        allShifts.filter(s => shiftBandHours(s) >= 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
    )];
    return { bands8, bands12 };
}

export function isApretarCronoDay(dateStr: string, apretarCronoDays?: string[] | Set<string>): boolean {
    if (!apretarCronoDays || (apretarCronoDays instanceof Set ? apretarCronoDays.size === 0 : apretarCronoDays.length === 0)) {
        return false;
    }
    return apretarCronoDays instanceof Set ? apretarCronoDays.has(dateStr) : apretarCronoDays.includes(dateStr);
}

export type Modo12ScheduleCtx = {
    modo12Days?: string[];
    apretarCronoDays?: string[];
    contingencyApretarDays?: string[];
    rotateShifts?: boolean;
    ajustarCrono?: boolean;
};

/** Todos los días con demanda D12+N12 (ausencias V/L/E + contingencia manual). */
export function getModo12Days(ctx: Modo12ScheduleCtx): string[] {
    if (ctx.modo12Days?.length) return ctx.modo12Days;
    return ctx.apretarCronoDays ?? [];
}

/** Día con esquema D12+N12 en la demanda SLA. */
export function isModo12Day(dateStr: string, ctx: Modo12ScheduleCtx): boolean {
    return isApretarCronoDay(dateStr, getModo12Days(ctx));
}

/** Contingencia manual: permite pool RET / liberación operativa. Ausencias auto NO entran acá. */
export function isContingencyApretarDay(dateStr: string, ctx: Modo12ScheduleCtx): boolean {
    return isApretarCronoDay(dateStr, ctx.contingencyApretarDays);
}

/** Contingencia manual activa (rotativo ON): pool RET y conversión F→RET. */
export function isApretarScheduleActive(ctx: Modo12ScheduleCtx, dateStr: string): boolean {
    if (ctx.rotateShifts === false) return false;
    if (!ctx.contingencyApretarDays?.length) return false;
    return isContingencyApretarDay(dateStr, ctx);
}

/** Pool RET ampliado: ajustar crono (mes entero) o contingencia manual — nunca solo por V/L/E. */
export function usesExpandedRetPool(ctx: Modo12ScheduleCtx, dateStr: string): boolean {
    if (ctx.rotateShifts === false) return false;
    if (ctx.ajustarCrono === true) return true;
    return isApretarScheduleActive(ctx, dateStr);
}

/** Guardias liberados ese día al usar D12+N12 en todos los puestos 24hs (1 por pax). */
export function apretarSlotsFreedPerDay(day: ObjectiveDayDemand): number {
    if (!day.positions.some(p => p.schemeLabel === 'D12+N12' || (p.bandSlots.D12 && p.bandSlots.N12))) return 0;
    return day.totalPaxUnits;
}

function buildBandSlotsForPositionDay(
    pos: PlanningPositionLike,
    dayLetter: string,
    cycles?: string[],
    dateStr?: string,
    apretarCronoDays?: string[] | Set<string>,
): { primary: Record<string, number>; alternate?: Record<string, number>; hours: number; schemeLabel?: string } {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const coverageType = String(pos.coverageType || 'custom').toLowerCase();

    if (coverageType === '24hs' || coverageType === '24' || coverageType === '24h') {
        const { bands8, bands12 } = bandSetsForPosition(pos);
        const b12 = bands12.length >= 2 ? bands12 : ['D12', 'N12'];
        if (dateStr && isApretarCronoDay(dateStr, apretarCronoDays)) {
            const primary: Record<string, number> = {};
            for (const b of b12) primary[b] = qty;
            return { primary, hours: qty * 24, schemeLabel: 'D12+N12' };
        }
        const mtn = bands8.length > 0 ? bands8 : ['M', 'T', 'N'];
        const primary: Record<string, number> = {};
        for (const b of mtn) primary[b] = qty;
        let alternate: Record<string, number> | undefined;
        if (bands12.length >= 2) {
            alternate = {};
            for (const b of bands12) alternate[b] = qty;
        }
        return { primary, alternate, hours: qty * 24 };
    }

    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles);
    const bands = eff.length > 0
        ? eff.map(s => String(s.code || '').toUpperCase()).filter(Boolean)
        : (pos.shifts || []).map(s => String(s.code || '').toUpperCase()).filter(Boolean);
    const primary: Record<string, number> = {};
    let hours = 0;
    for (const b of bands) {
        primary[b] = qty;
        const sh = (pos.shifts || []).find(s => String(s.code || '').toUpperCase() === b);
        hours += qty * shiftBandHours(sh || { code: b });
    }
    return { primary, hours: hours || qty * 8 };
}

/** Paso 1: leer SLA → demanda de cobertura por día/puesto/banda. */
export function buildObjectiveCoverageDemand(
    positions: PlanningPositionLike[],
    days: Array<{ dateStr: string; dayLetter: string }>,
    cycles?: string[],
    isPosActiveOnDay: (pos: PlanningPositionLike, dayLetter: string) => boolean = DEFAULT_IS_ACTIVE,
    apretarCronoDays?: string[] | Set<string>,
): ObjectiveDayDemand[] {
    return days.map(({ dateStr, dayLetter }) => {
        const dayPositions: PositionDayDemand[] = [];
        const totalBandSlots: Record<string, number> = {};
        let totalPaxUnits = 0;
        let hoursRequired = 0;

        for (const pos of positions) {
            if (!isPosActiveOnDay(pos, dayLetter)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const built = buildBandSlotsForPositionDay(pos, dayLetter, cycles, dateStr, apretarCronoDays);
            const schemeLabel = built.schemeLabel || positionSchemeLabelForDay(pos, dayLetter, cycles);

            dayPositions.push({
                positionName: String(pos.positionName || 'General'),
                qty,
                schemeLabel,
                bandSlots: built.primary,
                alternateBandSlots: built.alternate,
                hoursRequired: built.hours,
            });

            totalPaxUnits += qty;
            hoursRequired += built.hours;
            for (const [code, n] of Object.entries(built.primary)) {
                totalBandSlots[code] = (totalBandSlots[code] || 0) + n;
            }
        }

        return { dateStr, dayLetter, positions: dayPositions, totalBandSlots, totalPaxUnits, hoursRequired };
    });
}

/** Paso 2: disponibilidad real (ausencias + licencias bloquean días). */
export function buildEmployeeAvailability(
    employees: Array<{ id: string; nombre?: string; name?: string }>,
    days: Array<{ dateStr: string }>,
    absences: Record<string, Set<string> | undefined>,
): EmployeeDayAvailability[] {
    return employees.map(emp => {
        const blocked = absences[emp.id] ?? new Set<string>();
        const blockedCount = days.filter(d => blocked.has(d.dateStr)).length;
        return {
            empId: emp.id,
            nombre: emp.nombre || emp.name || emp.id,
            blockedDays: blocked,
            blockedCount,
            availableDays: days.length - blockedCount,
        };
    });
}

/** Preflight: demanda SLA vs dotación antes de generar cronograma. */
export function buildObjectiveCoveragePreflight(opts: {
    positions: PlanningPositionLike[];
    days: Array<{ dateStr: string; dayLetter: string }>;
    employees: Array<{ id: string; nombre?: string; name?: string }>;
    absences: Record<string, Set<string> | undefined>;
    slaVendidas: number;
    cycles?: string[];
    objectiveId?: string;
    isPosActiveOnDay?: (pos: PlanningPositionLike, dayLetter: string) => boolean;
    /** Días YYYY-MM-DD con esquema D12+N12 (apretar crono → liberar RET). */
    apretarCronoDays?: string[];
}): ObjectiveCoveragePreflight {
    const dayDemands = buildObjectiveCoverageDemand(
        opts.positions,
        opts.days,
        opts.cycles,
        opts.isPosActiveOnDay,
        opts.apretarCronoDays,
    );
    const employees = buildEmployeeAvailability(opts.employees, opts.days, opts.absences);

    const monthDemandHours = dayDemands.reduce((s, d) => s + d.hoursRequired, 0);
    const slaVendidas = Math.max(0, opts.slaVendidas || 0);
    const hoursDelta = slaVendidas > 0 ? monthDemandHours - slaVendidas : 0;

    const monthBandDemand: Record<string, number> = {};
    for (const day of dayDemands) {
        for (const [code, n] of Object.entries(day.totalBandSlots)) {
            monthBandDemand[code] = (monthBandDemand[code] || 0) + n;
        }
    }

    const totalAbsenceDays = employees.reduce((s, e) => s + e.blockedCount, 0);
    const warnings: string[] = [];

    if (slaVendidas > 0 && Math.abs(hoursDelta) > 1) {
        warnings.push(
            hoursDelta > 0
                ? `Estructura SLA (${monthDemandHours}h) supera vendidas (${slaVendidas}h) en ${Math.round(hoursDelta)}h`
                : `Estructura SLA (${monthDemandHours}h) está ${Math.round(-hoursDelta)}h por debajo de vendidas (${slaVendidas}h)`,
        );
    }

    const peakDay = dayDemands.reduce((best, d) => (
        d.totalPaxUnits > (best?.totalPaxUnits ?? 0) ? d : best
    ), dayDemands[0]);
    if (peakDay && peakDay.totalPaxUnits > 0) {
        const slotsPerDay = Object.values(peakDay.totalBandSlots).reduce((a, b) => a + b, 0);
        const availSlots = employees.reduce((s, e) => s + e.availableDays, 0);
        if (slotsPerDay > 0 && availSlots < slotsPerDay) {
            warnings.push(
                `Día pico: piden ${slotsPerDay} turnos/día pero hay ${availSlots} días-persona disponibles (con ausencias)`,
            );
        }
    }

    if (opts.apretarCronoDays?.length) {
        for (const ds of opts.apretarCronoDays) {
            const day = dayDemands.find(d => d.dateStr === ds);
            if (!day) continue;
            const freed = apretarSlotsFreedPerDay(day);
            const bands = Object.entries(day.totalBandSlots).map(([c, n]) => `${n}×${c}`).join(' + ');
            warnings.push(
                `Modo 12 ${ds.slice(8, 10)}/${ds.slice(5, 7)}: ${bands} (≈${freed} guardia(s) menos activos vs M+T+N)`,
            );
        }
    }

    const canPlan = opts.employees.length > 0 && dayDemands.some(d => d.totalPaxUnits > 0);

    return {
        objectiveId: opts.objectiveId,
        slaVendidas,
        monthDemandHours,
        hoursDelta,
        employeeCount: opts.employees.length,
        totalAbsenceDays,
        dayDemands,
        employees,
        monthBandDemand,
        warnings,
        canPlan,
    };
}

export function formatDayDemandSummary(day: ObjectiveDayDemand): string {
    const bands = Object.entries(day.totalBandSlots)
        .map(([c, n]) => `${n}×${c}`)
        .join(' + ');
    return `${day.totalPaxUnits} puestos · ${bands || 'sin bandas'} (${day.hoursRequired}h)`;
}
