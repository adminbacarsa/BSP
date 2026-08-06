/**
 * Presupuesto de francos — separa rotación 24 HS (1 F por pax/subgrupo) del pool operativo día pico.
 */

import type { V2PositionDef } from './autoScheduleEngineV2';
import {
    is24hsRotationPosition,
    isCustomCoverPosition,
    positionIsActiveOn,
} from './autoScheduleEngineV2';
import { customCoverSlotsRequiredOnDay } from './customCoverCycle';
import {
    computeObjectiveRequiredHeadcount,
    headcountPerPax24hs,
} from './objectiveHeadcount';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';

const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export interface FrancoBudget24hsPosition {
    positionName: string;
    qty: number;
    subgroups: number;
    /** En ciclo 6+2: 1 franco simultáneo por subgrupo (por pax). */
    francosSimultaneosRotacion: number;
    guardiasPorSubgrupo: number;
}

export interface FrancoBudgetCustomPosition {
    positionName: string;
    qty: number;
    activeDaysLabel: string;
    /** Días sin servicio del puesto (titulares en franco estructural). */
    offWeekdays: string[];
}

export interface FrancoBudgetDayProfile {
    dayLetter: string;
    label: string;
    servicioModo8: number;
    servicio24hs: number;
    servicioCustom: number;
    plantilla: number;
    poolOperativoDia: number;
    francosRotacion24hs: number;
    customTitularesEnServicio: number;
    customTitularesEnFrancoEstructural: number;
}

export interface ObjectiveFrancoBudget {
    cycleKey: string;
    plantillaTotal: number;
    /** Pico servicio/día (8h) usado por el cerebro — típ. L–V en mixto. */
    peakServicioDiaModo8: number;
    /** plantilla − servicio pico (colchón al instante de máxima demanda). */
    poolFrancosDiaPico: number;
    rotation24hs: {
        totalPax: number;
        francosSimultaneosRotacion: number;
        perPosition: FrancoBudget24hsPosition[];
        ruleLabel: string;
    };
    custom: {
        peakCuposDia: number;
        perPosition: FrancoBudgetCustomPosition[];
        ruleLabel: string;
    };
    dayProfiles: FrancoBudgetDayProfile[];
    summaryLines: string[];
}

function activeDaysLabel(pos: V2PositionDef): string {
    const ad = pos.activeDays;
    if (!ad || ad.length === 0 || ad.length >= 7) return 'L–D (7d)';
    return ad.join(' ');
}

function offWeekdaysForPosition(pos: V2PositionDef): string[] {
    return WEEKDAY_LETTERS.filter((d) => !positionIsActiveOn(pos, d));
}

function serviceSlotsModo8ForDay(positions: V2PositionDef[], dayLetter: string): {
    total: number;
    slots24hs: number;
    slotsCustom: number;
    pax24hs: number;
    customInService: number;
    customOff: number;
} {
    let slots24hs = 0;
    let slotsCustom = 0;
    let pax24hs = 0;
    let customInService = 0;
    let customOff = 0;

    for (const pos of positions) {
        if (is24hsRotationPosition(pos)) {
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            slots24hs += qty * 3;
            pax24hs += qty;
        } else if (isCustomCoverPosition(pos)) {
            const qty = Math.max(1, Number(pos.qty) || 1);
            if (positionIsActiveOn(pos, dayLetter)) {
                slotsCustom += customCoverSlotsRequiredOnDay(pos, dayLetter);
                customInService += qty;
            } else {
                customOff += qty;
            }
        }
    }

    return {
        total: slots24hs + slotsCustom,
        slots24hs,
        slotsCustom,
        pax24hs,
        customInService,
        customOff,
    };
}

function dayProfileLabel(dayLetter: string): string {
    switch (dayLetter) {
        case 'L': return 'Lunes (referencia L–V)';
        case 'S': return 'Sábado (custom apagado si L–V)';
        case 'D': return 'Domingo';
        default: return `Día ${dayLetter}`;
    }
}

/**
 * Presupuesto de francos para UI / verificación (no muta cronograma).
 */
export function buildObjectiveFrancoBudget(
    positions: V2PositionDef[],
    cycleKey: string = '6+2',
): ObjectiveFrancoBudget {
    const profile = buildObjectiveScheduleProfile(positions);
    const plantillaTotal = computeObjectiveRequiredHeadcount(positions, cycleKey);
    const guardsPerSubgroup = headcountPerPax24hs(cycleKey);

    const per24: FrancoBudget24hsPosition[] = profile.positions24hs.map((pos) => {
        const qty = Math.max(1, Number(pos.qty) || 1);
        return {
            positionName: pos.positionName,
            qty,
            subgroups: qty,
            francosSimultaneosRotacion: qty,
            guardiasPorSubgrupo: guardsPerSubgroup,
        };
    });
    const totalPax = per24.reduce((s, p) => s + p.qty, 0);
    const francosRotacion = per24.reduce((s, p) => s + p.francosSimultaneosRotacion, 0);

    const perCustom: FrancoBudgetCustomPosition[] = profile.positionsCustom.map((pos) => ({
        positionName: pos.positionName,
        qty: Math.max(1, Number(pos.qty) || 1),
        activeDaysLabel: activeDaysLabel(pos),
        offWeekdays: offWeekdaysForPosition(pos),
    }));

    let peakServicio = 0;
    const allProfiles: FrancoBudgetDayProfile[] = [];
    for (const dayLetter of WEEKDAY_LETTERS) {
        const s = serviceSlotsModo8ForDay(positions, dayLetter);
        peakServicio = Math.max(peakServicio, s.total);
        allProfiles.push({
            dayLetter,
            label: dayProfileLabel(dayLetter),
            servicioModo8: s.total,
            servicio24hs: s.slots24hs,
            servicioCustom: s.slotsCustom,
            plantilla: plantillaTotal,
            poolOperativoDia: Math.max(0, plantillaTotal - s.total),
            francosRotacion24hs: s.pax24hs,
            customTitularesEnServicio: s.customInService,
            customTitularesEnFrancoEstructural: s.customOff,
        });
    }

    const dayProfiles = allProfiles.filter((p) => {
        if (profile.kind === 'mixed') {
            return p.dayLetter === 'L' || p.dayLetter === 'S';
        }
        if (profile.kind === 'custom_only') {
            return p.dayLetter === 'L' || p.dayLetter === 'S';
        }
        return p.dayLetter === 'L';
    });

    const poolFrancosDiaPico = Math.max(0, plantillaTotal - peakServicio);
    const customPeak = profile.peakConcurrentCustom;

    const summaryLines: string[] = [];
    summaryLines.push(
        `Rotación 24 HS: ${francosRotacion} franco(s) simultáneo(s) en rotación `
        + `(1 por pax / subgrupo de ${guardsPerSubgroup} guardias, ciclo ${cycleKey}).`,
    );
    if (perCustom.length > 0) {
        summaryLines.push(
            `Custom: francos en días sin servicio del puesto (no cuarteto M/T/N); `
            + `pico ${customPeak} cupo(s)/día en días operativos.`,
        );
    }
    summaryLines.push(
        `Día pico operativo: servicio ${peakServicio} cupos (8h) → pool plantilla `
        + `${plantillaTotal} − ${peakServicio} = ${poolFrancosDiaPico} `
        + '(legajos fuera de cupo facturable a la vez; en L–V mixto coincide con francos de rotación).',
    );
    if (profile.kind === 'mixed') {
        const sat = allProfiles.find((p) => p.dayLetter === 'S');
        if (sat) {
            summaryLines.push(
                `Fin de semana (ej. S): servicio ${sat.servicioModo8} → pool ${sat.poolOperativoDia} `
                + `(custom en franco estructural: ${sat.customTitularesEnFrancoEstructural} titular(es)).`,
            );
        }
    }

    return {
        cycleKey,
        plantillaTotal,
        peakServicioDiaModo8: peakServicio,
        poolFrancosDiaPico,
        rotation24hs: {
            totalPax,
            francosSimultaneosRotacion: francosRotacion,
            perPosition: per24,
            ruleLabel: `3 trabajan + 1 franco por subgrupo (${guardsPerSubgroup} guardias/pax)`,
        },
        custom: {
            peakCuposDia: customPeak,
            perPosition: perCustom,
            ruleLabel: 'Titular por cupo; F en días fuera del calendario del puesto',
        },
        dayProfiles,
        summaryLines,
    };
}
