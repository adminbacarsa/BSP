/**
 * Proyección comparativa calendario 2026 por esquema de ciclo (días de trabajo efectivos × horas/turno).
 * Fuente: matriz operativa COSP / CCT SUVICO — sirve para alertas de “zona roja” (>200h calendario)
 * complementando el tope por **ciclo CCT** (26→25) que aplica el motor en `empMonthlyInitial` y tramos.
 *
 * Notas:
 *  - 4+2 asume turnos de 12h; 6+2 y 6+1 asumen 8h.
 *  - La regla “dos meses seguidos en 6+1 → el tercero preferir 6+2” depende de historial RRHH;
 *    hoy solo emitimos la recomendación genérica cuando el esquema 6+1 está seleccionado.
 */

import { SUVICO_POLICY } from './suvicoPolicy';

export type CctSchemeProjectionCycleKey = '4+2' | '6+2' | '6+1';

export interface CctSchemeMonthRow {
    workDays: number;
    billableHours: number;
}

/** Índice 0 = enero … 11 = diciembre (valores auditados 2026). */
const PROJECTION_2026: Record<CctSchemeProjectionCycleKey, readonly CctSchemeMonthRow[]> = {
    '4+2': [
        { workDays: 21, billableHours: 252 },
        { workDays: 18, billableHours: 216 },
        { workDays: 21, billableHours: 252 },
        { workDays: 20, billableHours: 240 },
        { workDays: 21, billableHours: 252 },
        { workDays: 20, billableHours: 240 },
        { workDays: 21, billableHours: 252 },
        { workDays: 20, billableHours: 240 },
        { workDays: 20, billableHours: 240 },
        { workDays: 21, billableHours: 252 },
        { workDays: 20, billableHours: 240 },
        { workDays: 20, billableHours: 240 },
    ],
    '6+2': [
        { workDays: 23, billableHours: 184 },
        { workDays: 21, billableHours: 168 },
        { workDays: 23, billableHours: 184 },
        { workDays: 23, billableHours: 184 },
        { workDays: 23, billableHours: 184 },
        { workDays: 22, billableHours: 176 },
        { workDays: 24, billableHours: 192 },
        { workDays: 23, billableHours: 184 },
        { workDays: 22, billableHours: 176 },
        { workDays: 24, billableHours: 192 },
        { workDays: 22, billableHours: 176 },
        { workDays: 24, billableHours: 192 },
    ],
    '6+1': [
        { workDays: 27, billableHours: 216 },
        { workDays: 24, billableHours: 192 },
        { workDays: 27, billableHours: 216 },
        { workDays: 26, billableHours: 208 },
        { workDays: 26, billableHours: 208 },
        { workDays: 26, billableHours: 208 },
        { workDays: 27, billableHours: 216 },
        { workDays: 26, billableHours: 208 },
        { workDays: 26, billableHours: 208 },
        { workDays: 27, billableHours: 216 },
        { workDays: 25, billableHours: 200 },
        { workDays: 26, billableHours: 208 },
    ],
} as const;

const MONTH_NAMES_ES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/** Acepta claves UI habituales y las normaliza al interno del motor. */
export function normalizeProjectionCycleKey(raw: string): CctSchemeProjectionCycleKey | null {
    const k = String(raw || '').trim().replace(/x/gi, '+');
    if (k === '4+2') return '4+2';
    if (k === '6+2') return '6+2';
    if (k === '6+1') return '6+1';
    return null;
}

export function getCctSchemeMonthProjection2026(
    cycleKey: string,
    month1to12: number,
): CctSchemeMonthRow | null {
    const nk = normalizeProjectionCycleKey(cycleKey);
    if (!nk || month1to12 < 1 || month1to12 > 12) return null;
    const row = PROJECTION_2026[nk][month1to12 - 1];
    return row ? { workDays: row.workDays, billableHours: row.billableHours } : null;
}

export interface CctSchemeCalendarProjectionRow {
    cycleKey: CctSchemeProjectionCycleKey;
    workDays: number;
    billableHours: number;
    overHardCap: boolean;
    overSoftWarn: boolean;
}

export interface CctSchemeCalendarProjectionBlock {
    year: number;
    month: number;
    monthNameEs: string;
    rows: CctSchemeCalendarProjectionRow[];
    /** Textos listos para `feasibility.warnings` / UI. */
    messages: string[];
}

/**
 * Arma filas + mensajes para el mes del calendario que se está planificando (solo año 2026 con tabla cargada).
 */
export function buildCctSchemeCalendarProjectionBlock(
    year: number,
    month1to12: number,
    autoCycles: readonly string[],
): CctSchemeCalendarProjectionBlock | null {
    if (year !== 2026 || month1to12 < 1 || month1to12 > 12) return null;

    const hard = SUVICO_POLICY.REST.MAX_MONTHLY_HARD;
    const soft = SUVICO_POLICY.ALERTS.MONTHLY_BILLABLE_SOFT_WARN_HOURS;
    const seen = new Set<CctSchemeProjectionCycleKey>();
    const rows: CctSchemeCalendarProjectionRow[] = [];
    const messages: string[] = [];

    for (const raw of autoCycles) {
        const nk = normalizeProjectionCycleKey(String(raw));
        if (!nk || seen.has(nk)) continue;
        seen.add(nk);
        const r = PROJECTION_2026[nk][month1to12 - 1];
        if (!r) continue;
        const overHardCap = r.billableHours > hard;
        const overSoftWarn =
            (nk === '4+2' || nk === '6+1') && r.billableHours >= soft && r.billableHours <= hard;
        rows.push({
            cycleKey: nk,
            workDays: r.workDays,
            billableHours: r.billableHours,
            overHardCap,
            overSoftWarn,
        });

        const label = `${nk} (~${r.workDays} días × ${nk === '4+2' ? 12 : 8}h ≈ ${r.billableHours}h calendario)`;
        if (overHardCap) {
            messages.push(
                `Proyección 2026 / ${MONTH_NAMES_ES[month1to12 - 1]}: ${label} supera el tope CCT de ${hard}h si todo el mes fuera facturable a ritmo pleno. ` +
                    `Conviene rotar parte de la nómina a 8h, sumar francos compensatorios o repartir RET antes del fin de mes; el motor sigue respetando el cupo por ciclo 26→25 y la cola cargada.`,
            );
        } else if (overSoftWarn && nk === '4+2') {
            messages.push(
                `Proyección 2026 / ${MONTH_NAMES_ES[month1to12 - 1]}: ${label} entra en zona de alerta (≥${soft}h). ` +
                    `Hacia mitad/fin de mes conviene que el fixer de cobertura busque relevos para los últimos turnos si la cola CCT ya viene alta.`,
            );
        } else if (overSoftWarn && nk === '6+1') {
            messages.push(
                `Proyección 2026 / ${MONTH_NAMES_ES[month1to12 - 1]}: ${label} se acerca al tope de ${hard}h en calendario — controlar cola CCT y uso de suplementarias.`,
            );
        } else if (nk === '6+1' && r.billableHours >= hard - 8 && !overHardCap) {
            messages.push(
                `Proyección 2026 / ${MONTH_NAMES_ES[month1to12 - 1]}: 6+1 con ~${r.billableHours}h calendario — uso intensivo. ` +
                    `Reservarlo para picos o bajas; si un vigilador lleva varios meses seguidos en 6+1, valorar pasar el siguiente a 6+2 para recuperar descanso.`,
            );
        }
    }

    if (rows.length === 0) return null;

    const has62 = seen.has('6+2');
    const has42 = seen.has('4+2');
    const has61 = seen.has('6+1');
    if (has62 && (has42 || has61)) {
        messages.push(
            'Balanceo de carga: con 6+2 disponible en los ciclos elegidos, el motor debería priorizar asignar el grueso de la nómina a 6+2 (menor fatiga, casi siempre bajo el objetivo mensual de 192h) y usar 4+2 / 6+1 solo donde la estructura del SLA lo exija.',
        );
    }

    return {
        year,
        month: month1to12,
        monthNameEs: MONTH_NAMES_ES[month1to12 - 1],
        rows,
        messages,
    };
}
