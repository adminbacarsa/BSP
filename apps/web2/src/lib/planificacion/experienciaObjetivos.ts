/**
 * Experiencia del empleado por objetivo (escuela, refuerzo, titular).
 * Fuente de verdad: turnos completados; cache en empleados.experienciaObjetivos.
 */

import { ESCUELA_TURNOS_PARA_CONOCIDO } from './deploymentRoles';

export type ExperienciaNivel = 'NINGUNO' | 'ESCUELA' | 'CONOCIDO' | 'TITULAR';

export interface ExperienciaObjetivoEntry {
    nivel?: ExperienciaNivel;
    turnosRegulares?: number;
    turnosRefuerzo?: number;
    turnosEscuela?: number;
    turnosConvocado?: number;
    ultimaPresencia?: unknown;
    posicionesConocidas?: string[];
}

export type ExperienciaObjetivosMap = Record<string, ExperienciaObjetivoEntry>;

export function computeExperienciaNivel(
    entry: ExperienciaObjetivoEntry | undefined,
    isTitular: boolean,
): ExperienciaNivel {
    if (isTitular) return 'TITULAR';
    const escuela = entry?.turnosEscuela ?? 0;
    if (escuela >= ESCUELA_TURNOS_PARA_CONOCIDO) return 'CONOCIDO';
    if (escuela > 0) return 'ESCUELA';
    const total = (entry?.turnosRegulares ?? 0) + (entry?.turnosRefuerzo ?? 0) + (entry?.turnosConvocado ?? 0);
    if (total >= ESCUELA_TURNOS_PARA_CONOCIDO) return 'CONOCIDO';
    return 'NINGUNO';
}

export function experienciaNivelLabel(nivel: ExperienciaNivel): string {
    switch (nivel) {
        case 'TITULAR': return 'Titular';
        case 'CONOCIDO': return 'Conocido';
        case 'ESCUELA': return 'En escuela';
        default: return 'Sin experiencia';
    }
}

export function experienciaBadgeForReplacement(
    empId: string,
    objectiveId: string,
    experiencia: ExperienciaObjetivosMap | undefined,
    preferredObjectiveId?: string | null,
): string {
    const isTitular = preferredObjectiveId === objectiveId;
    const entry = experiencia?.[objectiveId];
    const nivel = computeExperienciaNivel(entry, isTitular);
    const esc = entry?.turnosEscuela ?? 0;
    switch (nivel) {
        case 'TITULAR': return '★ Titular';
        case 'CONOCIDO': return `◆ Conocido${esc ? ` (${esc} esc.)` : ''}`;
        case 'ESCUELA': return `◇ Escuela ${esc}/${ESCUELA_TURNOS_PARA_CONOCIDO}`;
        default: return '⚠ Sin experiencia';
    }
}

/** Incremento al guardar turno ESC completado/planificado (fase 1: al publicar en Firestore). */
export function patchExperienciaForTurno(
    current: ExperienciaObjetivosMap | undefined,
    objectiveId: string,
    turno: {
        code?: unknown;
        deploymentRole?: unknown;
        positionName?: unknown;
        isCompleted?: boolean;
    },
    preferredObjectiveId?: string | null,
): ExperienciaObjetivosMap {
    if (!objectiveId) return current || {};
    const code = String(turno.code || '').toUpperCase();
    const role = String(turno.deploymentRole || '').toUpperCase();
    const next: ExperienciaObjetivosMap = { ...(current || {}) };
    const entry: ExperienciaObjetivoEntry = { ...(next[objectiveId] || {}) };
    const pos = turno.positionName ? String(turno.positionName) : '';

    if (code === 'ESC' || role === 'TRAINING') {
        entry.turnosEscuela = (entry.turnosEscuela ?? 0) + 1;
    } else if (code === 'REF' || role === 'SURPLUS') {
        entry.turnosRefuerzo = (entry.turnosRefuerzo ?? 0) + 1;
    } else if (code === 'RET') {
        entry.turnosConvocado = (entry.turnosConvocado ?? 0) + 1;
    } else if (!['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG'].includes(code)) {
        entry.turnosRegulares = (entry.turnosRegulares ?? 0) + 1;
    }

    if (pos && pos !== 'General' && pos !== 'Retén') {
        const set = new Set(entry.posicionesConocidas || []);
        set.add(pos);
        entry.posicionesConocidas = [...set];
    }

    entry.nivel = computeExperienciaNivel(entry, preferredObjectiveId === objectiveId);
    next[objectiveId] = entry;
    return next;
}
