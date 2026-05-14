/**
 * Reprocesamiento de errores del cronograma automático.
 *
 * Toma las asignaciones generadas + el reporte de `verifyScheduleCoverage`
 * y aplica fixes mecánicos sobre el mismo cronograma:
 *
 *   1. Conflictos con licencias  → reemplaza el turno por el código de
 *      la ausencia y busca cobertura entre RET/F del mismo grupo.
 *   2. Descansos rotos           → swap del turno violatorio con un
 *      compañero en RET/F que cumpla las 12/35 hs. Si no hay swap posible,
 *      degrada a RET (se convierte en slot descubierto, pero queda legal).
 *   3. Slots descubiertos        → promueve un RET (o F) del mismo grupo
 *      a la banda faltante, validando descanso, ausencias y cupo CCT.
 *
 * Vuelve a correr `verifyScheduleCoverage` después de cada iteración y
 * se detiene cuando todo da OK o no hay progreso.
 *
 * No reordena puestos ni cambia la dotación: solo opera sobre celdas
 * existentes. La idea es que sea rápido (≤ 5 iteraciones) y predecible.
 */

import type {
    V2Assignment,
    V2EngineContext,
    V2GenerateStats,
} from './autoScheduleEngineV2';
import { pickRepresentativeCycle, effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import { checkRestBetweenShifts, type AgreementRestConfig } from './restBetweenShifts';
import { verifyScheduleCoverage, type CoverageVerificationReport } from './coverageVerification';

const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
const DEFAULT_START: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00' };
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);

function billableHoursByEmp(assignments: V2Assignment[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (!c || c === 'RET' || FRANCO_CODES.has(c) || ABSENCE_CODES.has(c) || !a.positionName) continue;
        const h = Number(a.hours) || SHIFT_HRS[c] || 0;
        if (h <= 0) continue;
        m.set(a.empId, (m.get(a.empId) || 0) + h);
    }
    return m;
}

function sortGroupByBillableAsc(group: string[], hours: Map<string, number>): string[] {
    return [...group].sort((a, b) => (hours.get(a) || 0) - (hours.get(b) || 0));
}

const FIX_REST_BASE: AgreementRestConfig = {
    minRestBetweenShiftsHours: 12,
    longRestAfterWorkedHours: 48,
    minLongRestHours: 35,
};

function makeFixRestCfg(ctx: V2EngineContext): AgreementRestConfig {
    const { cL } = pickRepresentativeCycle(ctx.autoCycles || []);
    return { ...FIX_REST_BASE, maxConsecutiveWorkDays: cL };
}

export interface FixerLogEntry {
    iteration: number;
    issueType:
        | 'rest_swap'
        | 'rest_demote'
        | 'license_replace'
        | 'license_cover'
        | 'band_rebalance'
        | 'uncovered_fill'
        | 'noop';
    empId: string;
    dateStr: string;
    detail: string;
}

export interface FixerResult {
    assignments: V2Assignment[];
    report: CoverageVerificationReport;
    iterations: number;
    converged: boolean;
    summary: {
        restViolationsFixed: number;
        restViolationsRemaining: number;
        licenseConflictsFixed: number;
        licenseConflictsRemaining: number;
        uncoveredFixed: number;
        uncoveredRemaining: number;
    };
    log: FixerLogEntry[];
}

/**
 * Construye un getShift coherente con assignments + ausencias.
 * El getShift se reconstruye en cada iteración para reflejar los cambios.
 */
function makeGetShift(
    assignments: V2Assignment[],
    absences: V2EngineContext['absences'],
): (empId: string, dateStr: string) => any | null {
    const idx = new Map<string, V2Assignment>();
    assignments.forEach((a) => idx.set(`${a.empId}__${a.dateStr}`, a));
    return (empId, dateStr) => {
        const absMap = absences[empId];
        if (absMap?.has(dateStr)) {
            return { code: absMap.get(dateStr), hours: 0, startTime: '00:00' };
        }
        const a = idx.get(`${empId}__${dateStr}`);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        // RET / francos no son turnos trabajados: 0 horas, sin start laboral
        const isNonWork = c === 'RET' || FRANCO_CODES.has(c);
        return {
            code: c,
            startTime: a.startTime || (isNonWork ? '00:00' : DEFAULT_START[c] || '07:00'),
            hours: isNonWork ? 0 : (Number(a.hours) || SHIFT_HRS[c] || 8),
        };
    };
}

/** Verifica si un empleado puede tomar un turno en una fecha sin romper descansos ni licencias. */
function canTakeShift(
    empId: string,
    dateStr: string,
    shiftCode: string,
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    cfg: AgreementRestConfig,
): boolean {
    const code = String(shiftCode || '').toUpperCase();
    // No puede si está con licencia activa
    if (ctx.absences[empId]?.has(dateStr)) return false;
    const startResolved = DEFAULT_START[code] || '07:00';
    const hrs = SHIFT_HRS[code] || 8;
    const violation = checkRestBetweenShifts({
        empId,
        targetDateStr: dateStr,
        proposed: { code, startTime: startResolved, hours: hrs },
        getShift: makeGetShift(assignments, ctx.absences),
        cfg,
    });
    return violation === null;
}

/** Setea una celda como RET (capacidad ociosa válida, sin descanso requerido). */
function setAsRet(a: V2Assignment): void {
    a.code = 'RET';
    a.name = 'Retén';
    a.hours = 0;
    a.startTime = '00:00';
    a.isReten = true;
    a.isFranco = false;
    a.positionName = '';
}

/** Setea una celda con el código de licencia (V, L, A, E, PG, AA). */
function setAsAbsence(a: V2Assignment, absCode: string): void {
    a.code = absCode;
    a.name = absCode;
    a.hours = 0;
    a.startTime = '00:00';
    a.isReten = false;
    a.isFranco = false;
    a.positionName = '';
}

/** Setea una celda con un turno facturable. */
function setAsShift(
    a: V2Assignment,
    code: string,
    positionName: string,
): void {
    const c = code.toUpperCase();
    a.code = c;
    a.name = c;
    a.hours = SHIFT_HRS[c] || 8;
    a.startTime = DEFAULT_START[c] || '07:00';
    a.isReten = false;
    a.isFranco = false;
    a.positionName = positionName;
}

/** Devuelve los IDs de empleados del mismo grupo de puesto que el dado, según stats. */
function siblings(
    positionName: string,
    stats: V2GenerateStats,
): string[] {
    return (stats.positionGroups?.[positionName] || []).slice();
}

/** Intenta resolver un descanso roto (empId, dateStr, shiftCode) mediante swap con un RET/F del grupo. */
function fixRestViolation(
    empId: string,
    dateStr: string,
    shiftCode: string,
    assignments: V2Assignment[],
    byKey: Map<string, V2Assignment>,
    ctx: V2EngineContext,
    stats: V2GenerateStats,
    cfg: AgreementRestConfig,
    log: FixerLogEntry[],
    iteration: number,
): 'swapped' | 'demoted' | 'skipped' {
    const myKey = `${empId}__${dateStr}`;
    const mine = byKey.get(myKey);
    if (!mine) return 'skipped';
    const positionName = mine.positionName;
    if (!positionName) return 'skipped';

    // 1. Buscar un compañero del grupo con RET/F ese día que pueda tomar el turno
    const group = siblings(positionName, stats);
    const hrsMap = billableHoursByEmp(assignments);
    const groupSorted = sortGroupByBillableAsc(group, hrsMap);
    for (const otherId of groupSorted) {
        if (otherId === empId) continue;
        const otherKey = `${otherId}__${dateStr}`;
        const other = byKey.get(otherKey);
        if (!other) continue;
        const c = String(other.code || '').toUpperCase();
        if (c !== 'RET' && !FRANCO_CODES.has(c)) continue;

        // Simular: poner a "other" en ese turno y "mine" en RET; ver si cumple
        const saveOther = { ...other };
        const saveMine = { ...mine };
        setAsShift(other, shiftCode, positionName);
        setAsRet(mine);

        const okOther = canTakeShift(otherId, dateStr, shiftCode, assignments, ctx, cfg);
        if (okOther) {
            log.push({
                iteration,
                issueType: 'rest_swap',
                empId,
                dateStr,
                detail: `Swap: ${empId} → RET, ${otherId} toma ${shiftCode} en ${positionName}.`,
            });
            return 'swapped';
        }
        // Revertir
        Object.assign(other, saveOther);
        Object.assign(mine, saveMine);
    }

    // 2. Sin swap viable → degradar a RET (cae el slot, queda legal)
    setAsRet(mine);
    log.push({
        iteration,
        issueType: 'rest_demote',
        empId,
        dateStr,
        detail: `Sin swap viable. ${empId} pasa a RET en ${shiftCode}; el slot queda descubierto para revisar manualmente.`,
    });
    return 'demoted';
}

/** Reemplaza una asignación que choca con licencia y trata de cubrir el slot. */
function fixLicenseConflict(
    empId: string,
    dateStr: string,
    shiftCode: string,
    absenceCode: string,
    assignments: V2Assignment[],
    byKey: Map<string, V2Assignment>,
    ctx: V2EngineContext,
    stats: V2GenerateStats,
    cfg: AgreementRestConfig,
    log: FixerLogEntry[],
    iteration: number,
): void {
    const mine = byKey.get(`${empId}__${dateStr}`);
    if (!mine) return;
    const positionName = mine.positionName;

    setAsAbsence(mine, absenceCode);
    log.push({
        iteration,
        issueType: 'license_replace',
        empId,
        dateStr,
        detail: `Reemplazo del turno ${shiftCode} por licencia ${absenceCode}.`,
    });

    if (!positionName) return;

    // Buscar reemplazo en el mismo grupo (RET/F)
    const group = siblings(positionName, stats);
    const hrsMap = billableHoursByEmp(assignments);
    const groupSorted = sortGroupByBillableAsc(group, hrsMap);
    for (const otherId of groupSorted) {
        if (otherId === empId) continue;
        const other = byKey.get(`${otherId}__${dateStr}`);
        if (!other) continue;
        const c = String(other.code || '').toUpperCase();
        if (c !== 'RET' && !FRANCO_CODES.has(c)) continue;
        if (!canTakeShift(otherId, dateStr, shiftCode, assignments, ctx, cfg)) continue;
        setAsShift(other, shiftCode, positionName);
        log.push({
            iteration,
            issueType: 'license_cover',
            empId: otherId,
            dateStr,
            detail: `Cobertura del slot ${shiftCode} (${positionName}) por ${otherId}, antes en ${c}.`,
        });
        return;
    }
}

/**
 * Demanda esperada por banda para un (puesto, día) según el ciclo elegido.
 * Replica la misma lógica que usa el verificador: usa `effectiveShiftsForPositionDay`,
 * que filtra bandas 8h vs 12h según los ciclos seleccionados por el usuario.
 */
function expectedByShiftCode(
    ctx: V2EngineContext,
    positionName: string,
    dateStr: string,
): Record<string, number> {
    const pos = ctx.positions.find((p) => p.positionName === positionName);
    if (!pos) return {};
    const qty = Number(pos.qty) || 0;
    if (qty <= 0) return {};
    const dayLetter = ctx.getDayLetter(dateStr) || '';
    const eff = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
    const out: Record<string, number> = {};
    eff.forEach((sh) => {
        const c = String(sh.code || '').toUpperCase();
        if (!c) return;
        out[c] = (out[c] || 0) + qty;
    });
    return out;
}

/**
 * Rebalanceo dentro del mismo (puesto, día): si hay una banda sobre-cubierta y otra
 * sub-cubierta, intenta mover un empleado de la sobre-cubierta a la sub-cubierta.
 * No cambia la cantidad total de gente trabajando — solo redistribuye bandas.
 */
function fixOverlapRebalance(
    positionName: string,
    dateStr: string,
    underCode: string,
    underMissing: number,
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    cfg: AgreementRestConfig,
    log: FixerLogEntry[],
    iteration: number,
): number {
    if (underMissing <= 0) return 0;
    const expected = expectedByShiftCode(ctx, positionName, dateStr);
    const expectedForUnder = expected[underCode] || 0;
    if (expectedForUnder <= 0) return 0;

    // Bandas reales en este (puesto, día), agrupadas por código.
    const actualByCode: Record<string, V2Assignment[]> = {};
    for (const a of assignments) {
        if (a.dateStr !== dateStr) continue;
        if (a.positionName !== positionName) continue;
        const c = String(a.code || '').toUpperCase();
        if (!c) continue;
        if (FRANCO_CODES.has(c) || c === 'RET') continue;
        (actualByCode[c] ||= []).push(a);
    }

    // Códigos sobre-cubiertos ordenados por mayor excedente (los reasignamos primero).
    const overflows: Array<{ code: string; surplus: number; list: V2Assignment[] }> = [];
    Object.entries(actualByCode).forEach(([c, list]) => {
        if (c === underCode) return;
        const exp = expected[c] || 0;
        const surplus = list.length - exp;
        if (surplus > 0) overflows.push({ code: c, surplus, list });
    });
    overflows.sort((a, b) => b.surplus - a.surplus);

    let filled = 0;
    for (const ov of overflows) {
        if (filled >= underMissing) break;
        const movesAvailable = Math.min(ov.surplus, underMissing - filled);
        let moved = 0;
        for (const candidate of ov.list) {
            if (moved >= movesAvailable) break;
            // Probar in-place: cambiamos a underCode y vemos si pasa descanso/ciclo
            const save = { ...candidate };
            candidate.code = underCode;
            candidate.name = underCode;
            candidate.hours = SHIFT_HRS[underCode] || 8;
            candidate.startTime = DEFAULT_START[underCode] || '07:00';
            // Conserva positionName
            const ok = canTakeShift(candidate.empId, dateStr, underCode, assignments, ctx, cfg);
            if (!ok) {
                Object.assign(candidate, save);
                continue;
            }
            log.push({
                iteration,
                issueType: 'band_rebalance',
                empId: candidate.empId,
                dateStr,
                detail: `Rebalanceo en ${positionName}: ${save.code} → ${underCode} (sobraba ${ov.code}, faltaba ${underCode}).`,
            });
            moved++;
            filled++;
        }
    }
    return filled;
}

/** Intenta cubrir un slot descubierto (positionName, dateStr, shiftCode) con un RET/F del grupo. */
function fixUncoveredSlot(
    positionName: string,
    dateStr: string,
    shiftCode: string,
    qtyMissing: number,
    assignments: V2Assignment[],
    byKey: Map<string, V2Assignment>,
    ctx: V2EngineContext,
    stats: V2GenerateStats,
    cfg: AgreementRestConfig,
    log: FixerLogEntry[],
    iteration: number,
): number {
    let filled = 0;
    const group = siblings(positionName, stats);
    const hrsMap = billableHoursByEmp(assignments);
    const groupSorted = sortGroupByBillableAsc(group, hrsMap);
    for (const otherId of groupSorted) {
        if (filled >= qtyMissing) break;
        const other = byKey.get(`${otherId}__${dateStr}`);
        if (!other) continue;
        const c = String(other.code || '').toUpperCase();
        if (c !== 'RET' && !FRANCO_CODES.has(c)) continue;
        if (!canTakeShift(otherId, dateStr, shiftCode, assignments, ctx, cfg)) continue;
        setAsShift(other, shiftCode, positionName);
        filled++;
        log.push({
            iteration,
            issueType: 'uncovered_fill',
            empId: otherId,
            dateStr,
            detail: `Cubre ${shiftCode} en ${positionName} (estaba ${c}).`,
        });
    }
    return filled;
}

/**
 * Ejecuta el fixer hasta `maxIterations` veces, recalculando el reporte
 * entre cada pasada. Devuelve las nuevas asignaciones y el reporte final.
 */
export function fixScheduleIssues(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    stats: V2GenerateStats,
    initialReport: CoverageVerificationReport,
    maxIterations = 5,
): FixerResult {
    // Trabajamos sobre COPIAS profundas para no mutar lo del UI sin querer.
    const current: V2Assignment[] = assignments.map((a) => ({ ...a }));
    let report = initialReport;
    const log: FixerLogEntry[] = [];
    const cfg = makeFixRestCfg(ctx);

    const initial = {
        rest: initialReport.restViolations.length,
        lic: initialReport.licenseConflicts.length,
        uncov: initialReport.uncovered.reduce((s, u) => s + (u.qtyRequested - u.qtyAssigned), 0),
    };

    let iter = 0;
    let converged = false;
    for (iter = 1; iter <= maxIterations; iter++) {
        const before = {
            rest: report.restViolations.length,
            lic: report.licenseConflicts.length,
            uncov: report.uncovered.reduce((s, u) => s + (u.qtyRequested - u.qtyAssigned), 0),
        };

        const byKey = new Map<string, V2Assignment>();
        current.forEach((a) => byKey.set(`${a.empId}__${a.dateStr}`, a));

        // 1. Licencias: lo más urgente — un turno asignado encima de una ausencia es ilegal.
        for (const lc of report.licenseConflicts) {
            fixLicenseConflict(
                lc.empId, lc.dateStr, lc.shiftCode, lc.absenceCode,
                current, byKey, ctx, stats, cfg, log, iter,
            );
        }

        // 2. Descansos rotos (incluye violaciones de ciclo: más de cL días seguidos)
        for (const rv of report.restViolations) {
            fixRestViolation(
                rv.empId, rv.dateStr, rv.shiftCode,
                current, byKey, ctx, stats, cfg, log, iter,
            );
        }

        // 3. Slots descubiertos — primero probamos rebalancear bandas dentro del
        //    mismo puesto+día (mover gente de una banda sobre-cubierta a la
        //    sub-cubierta), antes de gastar capacidad ociosa (RET/F).
        for (const u of report.uncovered) {
            const missing = u.qtyRequested - u.qtyAssigned;
            if (missing <= 0) continue;
            const rebalanced = fixOverlapRebalance(
                u.positionName, u.dateStr, u.shiftCode, missing,
                current, ctx, cfg, log, iter,
            );
            const remaining = missing - rebalanced;
            if (remaining <= 0) continue;
            fixUncoveredSlot(
                u.positionName, u.dateStr, u.shiftCode, remaining,
                current, byKey, ctx, stats, cfg, log, iter,
            );
        }

        // Re-verificar
        report = verifyScheduleCoverage(ctx, current, stats);

        const after = {
            rest: report.restViolations.length,
            lic: report.licenseConflicts.length,
            uncov: report.uncovered.reduce((s, u) => s + (u.qtyRequested - u.qtyAssigned), 0),
        };

        const progressed = (after.rest + after.lic + after.uncov) < (before.rest + before.lic + before.uncov);
        if (report.ok) { converged = true; break; }
        if (!progressed) break; // estancado: no tiene sentido seguir iterando
    }

    const final = {
        rest: report.restViolations.length,
        lic: report.licenseConflicts.length,
        uncov: report.uncovered.reduce((s, u) => s + (u.qtyRequested - u.qtyAssigned), 0),
    };

    return {
        assignments: current,
        report,
        iterations: iter > maxIterations ? maxIterations : iter,
        converged,
        summary: {
            restViolationsFixed: Math.max(0, initial.rest - final.rest),
            restViolationsRemaining: final.rest,
            licenseConflictsFixed: Math.max(0, initial.lic - final.lic),
            licenseConflictsRemaining: final.lic,
            uncoveredFixed: Math.max(0, initial.uncov - final.uncov),
            uncoveredRemaining: final.uncov,
        },
        log,
    };
}
