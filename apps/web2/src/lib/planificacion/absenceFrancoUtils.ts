/**
 * Utilidades: ausencia en día laboral vs franco del ciclo 24d (6M+2F+6T+2F+6N+2F).
 * Si el ausente caería en F, no hay brecha SLA — solo marcar la licencia/enfermedad.
 */

import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';

const WORK_BANDS = new Set(['M', 'T', 'N']);

export function expectedBandForEmployee(
    empId: string,
    dateStr: string,
    openingSlotByEmp: Record<string, number>,
    daysInMonth: Date[],
    getDateKey: (d: Date) => string,
): string | null {
    const opening = openingSlotByEmp[empId];
    if (opening === undefined) return null;
    const di = daysInMonth.findIndex((d) => getDateKey(d) === dateStr);
    if (di < 0) return null;
    return String(CYCLE_24_MTN[(opening + di) % 24] || '').toUpperCase();
}

export function isWorkBandCode(code: string | null | undefined): boolean {
    return WORK_BANDS.has(String(code || '').toUpperCase());
}

/** true = el ausente habría trabajado M/T/N ese día → hay que cubrir. */
export function absenceRequiresCoverage(
    empId: string,
    dateStr: string,
    openingSlotByEmp: Record<string, number> | undefined,
    ctx: Pick<V2EngineContext, 'daysInMonth' | 'getDateKey'>,
): boolean {
    if (!openingSlotByEmp) return true;
    const band = expectedBandForEmployee(
        empId,
        dateStr,
        openingSlotByEmp,
        ctx.daysInMonth,
        ctx.getDateKey,
    );
    if (!band) return true;
    return isWorkBandCode(band);
}

/** Marca celdas de ausencia (incl. días que serían franco del ciclo). */
export function ensureAbsenceCells(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
): V2Assignment[] {
    const result = [...assignments];
    const keys = new Set(result.map((a) => `${a.empId}__${a.dateStr}`));

    for (const [empId, dateMap] of Object.entries(ctx.absences)) {
        for (const [dateStr, code] of dateMap.entries()) {
            const k = `${empId}__${dateStr}`;
            if (keys.has(k)) {
                const cell = result.find((a) => a.empId === empId && a.dateStr === dateStr);
                if (cell) {
                    cell.code = code;
                    cell.name = code;
                    cell.hours = 0;
                    cell.startTime = '00:00';
                    cell.isFranco = false;
                    cell.isReten = false;
                }
                continue;
            }
            const pos = ctx.defaultPositionByEmp?.[empId] || '';
            result.push({
                empId,
                dateStr,
                positionName: pos,
                code,
                name: code,
                hours: 0,
                startTime: '00:00',
                isFranco: false,
            });
            keys.add(k);
        }
    }

    return result;
}

/**
 * Celdas sin turno → RET (flotante / stand-by).
 * Si el ciclo marca F para ese guardia, se asigna F en lugar de dejar hueco.
 */
export function fillEmptyCellsWithRet(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp?: Record<string, number>,
): V2Assignment[] {
    const result = [...assignments];
    const keys = new Set(result.map((a) => `${a.empId}__${a.dateStr}`));

    for (const emp of ctx.employees) {
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            const k = `${emp.id}__${dateStr}`;
            if (keys.has(k)) continue;

            const absenceCode = ctx.absences[emp.id]?.get(dateStr);
            if (absenceCode) {
                result.push({
                    empId: emp.id,
                    dateStr,
                    positionName: ctx.defaultPositionByEmp?.[emp.id] || '',
                    code: absenceCode,
                    name: absenceCode,
                    hours: 0,
                    startTime: '00:00',
                    isFranco: false,
                });
                keys.add(k);
                continue;
            }

            if (openingSlotByEmp) {
                const band = expectedBandForEmployee(
                    emp.id,
                    dateStr,
                    openingSlotByEmp,
                    ctx.daysInMonth,
                    ctx.getDateKey,
                );
                if (band === 'F') {
                    result.push({
                        empId: emp.id,
                        dateStr,
                        positionName: '',
                        code: 'F',
                        name: 'Franco',
                        hours: 0,
                        startTime: '00:00',
                        isFranco: true,
                    });
                    keys.add(k);
                    continue;
                }
            }

            result.push({
                empId: emp.id,
                dateStr,
                positionName: '',
                code: 'RET',
                name: 'Retén',
                hours: 0,
                startTime: '00:00',
                isReten: true,
                isFranco: false,
            });
            keys.add(k);
        }
    }

    return result;
}
