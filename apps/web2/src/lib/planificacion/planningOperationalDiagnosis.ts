/**
 * Diagnóstico operativo COSP — demanda → oferta → balance → resolución.
 * Debe ejecutarse antes de elegir esquemas flex o rescates F→turno.
 */

import type { V2FeasibilityReport, V2PositionDef } from './autoScheduleEngineV2';
import { computeObjectiveRequiredHeadcount } from './objectiveHeadcount';

export type PlanningBalanceKind = 'short' | 'exact' | 'surplus' | 'hours_short';

export interface PlanningStaffingRef {
    servicioDiarioModo8: number;
    structuralHoras: number;
    cycleKey: string;
}

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

function computeModo8Slots(positions: V2PositionDef[]): {
    slotsPerDay: number;
    slots24hs: number;
    slotsCustom: number;
    peakConcurrent: number;
    structuralMonthHours: number;
} {
    let slotsPerDay = 0;
    let slots24hs = 0;
    let slotsCustom = 0;
    let peakConcurrent = 0;
    let structuralMonthHours = 0;
    for (const pos of positions) {
        const qty = Math.max(1, Number(pos.qty) || 1);
        if (is24hs(pos)) {
            const s = qty * 3;
            slotsPerDay += s;
            slots24hs += s;
            peakConcurrent += qty;
            structuralMonthHours += s * 30 * 8;
        } else {
            const bands = (pos.shifts || []).length || 1;
            const s = qty * bands;
            slotsPerDay += s;
            slotsCustom += s;
            peakConcurrent += s;
            structuralMonthHours += s * 30 * 8;
        }
    }
    return { slotsPerDay, slots24hs, slotsCustom, peakConcurrent, structuralMonthHours };
}

export interface PlanningOperationalDiagnosis {
    /** Demanda */
    demand: {
        slotsPerDay: number;
        slotsMonth: number;
        structuralHours: number;
        soldHours: number;
        hoursDelta: number;
        peakConcurrent: number;
        modo12DayCount: number;
    };
    /** Oferta */
    supply: {
        peopleAvailable: number;
        offerHours: number;
        offerHoursT1: number;
        offerHoursT2: number;
        priorHoursTeam: number;
        absenceHoursTeam: number;
        plantillaRequired6x2: number;
        servicioDiario: number;
        poolFrancos6x2: number;
    };
    /** Balance */
    balance: PlanningBalanceKind;
    balanceLabel: string;
    headcountDelta: number;
    hoursGap: number;
    /** Resolución sugerida (texto operativo) */
    resolution: string;
    /** Motor: 6+2 estricto — sin flex 5+1/6+1 ni F→turno agresivo */
    strictSixTwo: boolean;
    /** Esquema recomendado */
    recommendedCycle: string;
    warnings: string[];
}

const CYCLE_MAP: Record<string, [number, number]> = {
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '6+2': [6, 2],
};

function plantillaForCycle(servicioDiario: number, cycleKey: string): number {
    const [cL, cF] = CYCLE_MAP[cycleKey] ?? CYCLE_MAP['6+2'];
    const factor = (cL + cF) / cL;
    return Math.max(Math.ceil(servicioDiario * factor), Math.ceil(servicioDiario * factor));
}

export function buildPlanningOperationalDiagnosis(params: {
    positions: V2PositionDef[];
    feasibility: V2FeasibilityReport;
    staffing: PlanningStaffingRef;
    peopleAvailable: number;
    soldHours: number;
    modo12DayCount?: number;
    pickedCycle?: string;
}): PlanningOperationalDiagnosis {
    const { positions, feasibility, staffing, peopleAvailable, soldHours, pickedCycle } = params;
    const m = feasibility.metrics;
    const modo8 = computeModo8Slots(positions);
    const plantilla6x2 = computeObjectiveRequiredHeadcount(positions, '6+2');
    const servicio = staffing.servicioDiarioModo8;
    const poolFrancos = Math.max(0, plantilla6x2 - servicio);

    const structuralHours = m.structuralDemandHours || staffing.structuralHoras || 0;
    const sold = soldHours > 0 ? soldHours : m.contractedHours || 0;
    const hoursDelta = structuralHours - sold;
    const offerHours = m.offerHours || 0;
    const hoursGap = sold > 0 ? Math.max(0, sold - offerHours) : 0;

    const headcountDelta = peopleAvailable - plantilla6x2;
    const warnings: string[] = [...(feasibility.warnings || [])];

    let balance: PlanningBalanceKind;
    let balanceLabel: string;

    if (!feasibility.ok && (hoursGap > 1 || peopleAvailable < m.peopleNeededForTarget)) {
        balance = hoursGap > 1 && peopleAvailable >= plantilla6x2 ? 'hours_short' : 'short';
    } else if (headcountDelta < 0) {
        balance = 'short';
    } else if (headcountDelta === 0 && hoursGap <= 1) {
        balance = 'exact';
    } else if (headcountDelta > 0) {
        balance = 'surplus';
    } else if (hoursGap > 1) {
        balance = 'hours_short';
    } else {
        balance = headcountDelta >= 0 ? 'surplus' : 'short';
    }

    switch (balance) {
        case 'exact':
            balanceLabel = 'Justo — dotación = plantilla 6+2';
            break;
        case 'short':
            balanceLabel = `Faltan ${Math.abs(headcountDelta)} persona(s) vs plantilla 6+2`;
            break;
        case 'surplus':
            balanceLabel = `Sobran ${headcountDelta} persona(s) vs plantilla 6+2`;
            break;
        case 'hours_short':
            balanceLabel = `Faltan ~${Math.round(hoursGap)}h de capacidad del equipo`;
            break;
    }

    const recommendedCycle = balance === 'exact' && feasibility.ok
        ? '6+2'
        : (pickedCycle || staffing.cycleKey || '6+2');

    const strictSixTwo = balance === 'exact'
        && feasibility.ok
        && headcountDelta === 0
        && hoursGap <= 1
        && recommendedCycle === '6+2';

    let resolution: string;
    if (strictSixTwo) {
        resolution =
            `${peopleAvailable} guardias = ${servicio} servicio + ${poolFrancos} franco (6+2). `
            + 'Bandas fijas M/T/N + flotante por puesto (sin péndulo rotativo). '
            + 'No degradar a 5+1/6+1 ni convertir F→turno para cerrar SLA.';
    } else if (balance === 'short' || balance === 'hours_short') {
        resolution =
            'Dotación o capacidad horaria insuficiente. Evaluar refuerzo, Modo 12 en más días, '
            + 'esquema 6+1/5+1 puntual, o revisar horas vendidas / ausencias.';
    } else if (balance === 'surplus') {
        resolution =
            `${headcountDelta} guardia(s) por encima de plantilla 6+2. Excedente en RET (días laborables) y Franco (descanso); `
            + 'sin turnos facturables ni reparto extra que rompa ~180h/guardia.';
    } else {
        resolution =
            'Revisar viabilidad y esquema antes de generar. Preferir 6+2 si la capacidad horaria lo permite.';
    }

    if (Math.abs(hoursDelta) > 1) {
        warnings.push(
            hoursDelta > 0
                ? `Estructura SLA (${Math.round(structuralHours)}h) supera vendidas (${Math.round(sold)}h) en ${Math.round(hoursDelta)}h`
                : `Vendidas (${Math.round(sold)}h) superan estructura (${Math.round(structuralHours)}h) en ${Math.round(-hoursDelta)}h`,
        );
    }

    return {
        demand: {
            slotsPerDay: modo8.slotsPerDay,
            slotsMonth: m.totalSlotsAll || modo8.slotsPerDay * 30,
            structuralHours,
            soldHours: sold,
            hoursDelta,
            peakConcurrent: modo8.peakConcurrent,
            modo12DayCount: params.modo12DayCount ?? 0,
        },
        supply: {
            peopleAvailable,
            offerHours,
            offerHoursT1: m.offerHoursCurrentCycle || 0,
            offerHoursT2: m.offerHoursNextCycle || 0,
            priorHoursTeam: m.totalPriorHoursTeam || 0,
            absenceHoursTeam: m.totalAbsenceHoursTeam || 0,
            plantillaRequired6x2: plantilla6x2,
            servicioDiario: servicio,
            poolFrancos6x2: poolFrancos,
        },
        balance,
        balanceLabel,
        headcountDelta,
        hoursGap,
        resolution,
        strictSixTwo,
        recommendedCycle,
        warnings,
    };
}
