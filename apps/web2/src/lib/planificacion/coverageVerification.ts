/**
 * Verificación post-generación del cronograma automático.
 *
 * Tras correr el motor V2, esta función toma las asignaciones generadas
 * (más las ausencias del contexto) y devuelve un reporte con:
 *   - Cobertura: slots de SLA pedidos vs cubiertos.
 *   - Conflictos: descansos rotos, empleados con turno en día de licencia,
 *     empleados >200 hs por ciclo, empleados sin turno asignado.
 *   - Resumen agregado para mostrar en UI.
 *
 * No modifica nada — solo reporta.
 */

import type {
    V2Assignment,
    V2EngineContext,
    V2GenerateStats,
} from './autoScheduleEngineV2';
import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import { checkRestBetweenShifts, type AgreementRestConfig } from './restBetweenShifts';

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET']);
const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
const DEFAULT_START: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00' };

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // 0=Dom, 1=Lun...

const VERIFY_REST_CFG: AgreementRestConfig = {
    minRestBetweenShiftsHours: 12,
    longRestAfterWorkedHours: 48,
    minLongRestHours: 35,
};

export interface UncoveredSlot {
    dateStr: string;
    dayLetter: string;
    positionName: string;
    shiftCode: string;
    qtyRequested: number;
    qtyAssigned: number;
}

export interface RestViolation {
    empId: string;
    dateStr: string;
    shiftCode: string;
    reason: string;
}

export interface LicenseConflict {
    empId: string;
    dateStr: string;
    shiftCode: string;
    absenceCode: string;
}

export interface OverHoursWarning {
    empId: string;
    cycle: 'current' | 'next';
    hours: number;
}

export interface CoverageVerificationReport {
    /** General OK = sin slots descubiertos ni conflictos. */
    ok: boolean;
    /** Hay slots vacantes o conflictos suaves; el cronograma se puede aplicar pero requiere repaso. */
    warnings: boolean;
    /** Modalidad de turnos pedida por el verificador según el ciclo elegido. */
    modality: {
        cycleType: '8h' | '12h' | 'mixed';
        cycles: string[];
        bandsExpected: string[]; // ej. ['M','T','N'] o ['D12','N12']
        notes: string[];
    };
    coverage: {
        totalSlots: number;
        coveredSlots: number;
        uncoveredSlots: number;
        coverageRatio: number; // 0..1
    };
    hours: {
        billableHoursGenerated: number;
        slaVendidas: number;
        deltaPct: number; // (generadas - vendidas) / vendidas
    };
    uncovered: UncoveredSlot[];
    restViolations: RestViolation[];
    licenseConflicts: LicenseConflict[];
    overHours: OverHoursWarning[];
    /** Empleados sin ningún turno productivo en el mes (solo F/RET). */
    idleEmployees: Array<{ empId: string; reason: string }>;
    summary: string;
}

/**
 * Devuelve la cobertura por día×puesto×turno requerida por las posiciones
 * activas del SLA, ignorando días inactivos.
 *
 * IMPORTANTE: usa `effectiveShiftsForPositionDay` del motor, que filtra
 * bandas según el ciclo elegido por el usuario:
 *   - 6+1 / 5+1 / 6+2  → solo bandas de 8h (M/T/N)
 *   - 4+2              → solo bandas de 12h (D12/N12)
 *   - mixto            → 8h con fallback a 12h cuando el puesto no tiene 8h
 *
 * Así no se "exige" cubrir D12/N12 cuando el usuario eligió 6+1 (los 12h
 * son alternativos a M+T+N, no se suman).
 */
function buildDemandSlots(
    ctx: V2EngineContext,
): Array<{ dateStr: string; positionName: string; shiftCode: string; qty: number; dayLetter: string }> {
    const slots: Array<{ dateStr: string; positionName: string; shiftCode: string; qty: number; dayLetter: string }> = [];
    ctx.daysInMonth.forEach((d) => {
        const dateStr = ctx.getDateKey(d);
        const dayLetter = ctx.getDayLetter(dateStr) || DAY_LETTERS[d.getDay()];
        ctx.positions.forEach((pos) => {
            const qty = Number(pos.qty) || 0;
            if (!qty) return;
            const eff = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
            eff.forEach((sh) => {
                const code = String(sh.code || '').toUpperCase();
                if (!code || NON_BILLABLE.has(code) || ABSENCE_CODES.has(code)) return;
                slots.push({ dateStr, positionName: pos.positionName, shiftCode: code, qty, dayLetter });
            });
        });
    });
    return slots;
}

/** Reconstruye el shift de un empleado para checkRestBetweenShifts. */
function buildGetShift(assignments: V2Assignment[], absences: V2EngineContext['absences']) {
    const byKey = new Map<string, V2Assignment>();
    assignments.forEach((a) => byKey.set(`${a.empId}__${a.dateStr}`, a));
    return (empId: string, dateStr: string): any | null => {
        const absMap = absences[empId];
        if (absMap?.has(dateStr)) {
            return { code: absMap.get(dateStr), hours: 0, startTime: '00:00' };
        }
        const a = byKey.get(`${empId}__${dateStr}`);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        return {
            code: c,
            startTime: a.startTime || DEFAULT_START[c] || '07:00',
            hours: Number(a.hours) || SHIFT_HRS[c] || 8,
        };
    };
}

export function verifyScheduleCoverage(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    stats: V2GenerateStats,
): CoverageVerificationReport {
    // 1. Demanda esperada (filtrada por ciclo elegido)
    const demand = buildDemandSlots(ctx);
    const totalSlots = demand.reduce((s, d) => s + d.qty, 0);
    const bandsExpected = Array.from(new Set(demand.map((d) => d.shiftCode))).sort();

    // 2. Index de asignaciones reales por slot
    const assignKey = (a: V2Assignment) => `${a.dateStr}__${a.positionName}__${String(a.code || '').toUpperCase()}`;
    const realCount: Record<string, number> = {};
    assignments.forEach((a) => {
        const c = String(a.code || '').toUpperCase();
        if (!c || NON_BILLABLE.has(c) || ABSENCE_CODES.has(c)) return;
        if (!a.positionName) return;
        const k = assignKey(a);
        realCount[k] = (realCount[k] || 0) + 1;
    });

    const uncovered: UncoveredSlot[] = [];
    let coveredCount = 0;
    demand.forEach((slot) => {
        const k = `${slot.dateStr}__${slot.positionName}__${slot.shiftCode}`;
        const have = realCount[k] || 0;
        const covered = Math.min(have, slot.qty);
        coveredCount += covered;
        if (have < slot.qty) {
            uncovered.push({
                dateStr: slot.dateStr,
                dayLetter: slot.dayLetter,
                positionName: slot.positionName,
                shiftCode: slot.shiftCode,
                qtyRequested: slot.qty,
                qtyAssigned: have,
            });
        }
    });

    // 3. Horas facturables generadas
    const billableHoursGenerated = assignments.reduce((s, a) => {
        const c = String(a.code || '').toUpperCase();
        if (NON_BILLABLE.has(c) || ABSENCE_CODES.has(c)) return s;
        return s + (Number(a.hours) || SHIFT_HRS[c] || 0);
    }, 0);

    // 4. Conflictos con licencias (asignación + ausencia el mismo día)
    const licenseConflicts: LicenseConflict[] = [];
    assignments.forEach((a) => {
        const c = String(a.code || '').toUpperCase();
        if (NON_BILLABLE.has(c) || ABSENCE_CODES.has(c)) return;
        const abs = ctx.absences[a.empId]?.get(a.dateStr);
        if (abs) {
            licenseConflicts.push({
                empId: a.empId,
                dateStr: a.dateStr,
                shiftCode: c,
                absenceCode: abs,
            });
        }
    });

    // 5. Violaciones de descanso (12h entre turnos / 35h tras 6 días / 48h trabajados)
    const restViolations: RestViolation[] = [];
    const getShift = buildGetShift(assignments, ctx.absences);
    assignments.forEach((a) => {
        const c = String(a.code || '').toUpperCase();
        if (FRANCO_CODES.has(c) || ABSENCE_CODES.has(c) || c === 'RET') return;
        const startResolved = a.startTime || DEFAULT_START[c] || '07:00';
        const hrs = Number(a.hours) || SHIFT_HRS[c] || 8;
        const violation = checkRestBetweenShifts({
            empId: a.empId,
            targetDateStr: a.dateStr,
            proposed: { code: c, startTime: startResolved, hours: hrs },
            getShift,
            cfg: VERIFY_REST_CFG,
        });
        if (violation) {
            restViolations.push({
                empId: a.empId,
                dateStr: a.dateStr,
                shiftCode: c,
                reason: violation,
            });
        }
    });

    // 6. Empleados > 200h por ciclo (ya viene en stats)
    const overHours: OverHoursWarning[] = [];
    const cycCur = stats.employeeCycleHours?.current || {};
    const cycNext = stats.employeeCycleHours?.next || {};
    Object.entries(cycCur).forEach(([empId, h]) => {
        if ((h || 0) > 200) overHours.push({ empId, cycle: 'current', hours: h });
    });
    Object.entries(cycNext).forEach(([empId, h]) => {
        if ((h || 0) > 200) overHours.push({ empId, cycle: 'next', hours: h });
    });

    // 7. Empleados ociosos (sin turno productivo)
    const productiveByEmp: Record<string, number> = {};
    assignments.forEach((a) => {
        const c = String(a.code || '').toUpperCase();
        if (NON_BILLABLE.has(c) || ABSENCE_CODES.has(c)) return;
        productiveByEmp[a.empId] = (productiveByEmp[a.empId] || 0) + 1;
    });
    const idleEmployees: Array<{ empId: string; reason: string }> = [];
    ctx.employees.forEach((e) => {
        if (!productiveByEmp[e.id]) {
            const hasAbs = ctx.absences[e.id]?.size ? `${ctx.absences[e.id].size} día(s) de licencia` : null;
            idleEmployees.push({
                empId: e.id,
                reason: hasAbs ? `Sin turnos productivos (${hasAbs})` : 'Sin turnos productivos asignados',
            });
        }
    });

    const slaVendidas = Number(ctx.slaVendidas) || 0;
    const deltaPct = slaVendidas > 0 ? (billableHoursGenerated - slaVendidas) / slaVendidas : 0;
    const coverageRatio = totalSlots > 0 ? coveredCount / totalSlots : 1;

    // Modalidad: si los ciclos elegidos son todos 8h o todos 12h, lo marcamos.
    const cycles = Array.isArray(ctx.autoCycles) ? ctx.autoCycles.slice() : [];
    const has12 = cycles.some((k) => k === '4+2');
    const has8 = cycles.some((k) => k === '6+1' || k === '5+1' || k === '6+2');
    const cycleType: '8h' | '12h' | 'mixed' = has8 && has12 ? 'mixed' : has12 ? '12h' : '8h';
    const modalityNotes: string[] = [];
    // Detectar puestos sin bandas en la modalidad pedida → fallback forzado.
    ctx.positions.forEach((pos) => {
        const dayShifts = (pos.shifts || []).map((s) => String(s.code || '').toUpperCase());
        const has8Bands = dayShifts.some((c) => c === 'M' || c === 'T' || c === 'N');
        const has12Bands = dayShifts.some((c) => c === 'D12' || c === 'N12');
        if (cycleType === '8h' && !has8Bands && has12Bands) {
            modalityNotes.push(
                `Puesto "${pos.positionName}": elegiste 8h pero el SLA solo tiene D12/N12. El motor se cae a 12h.`,
            );
        }
        if (cycleType === '12h' && !has12Bands && has8Bands) {
            modalityNotes.push(
                `Puesto "${pos.positionName}": elegiste 12h pero el SLA solo tiene M/T/N. El motor se cae a 8h.`,
            );
        }
    });

    const hasHardIssues = uncovered.length > 0 || restViolations.length > 0 || licenseConflicts.length > 0;
    const hasSoftIssues = overHours.length > 0 || Math.abs(deltaPct) > 0.05;
    const ok = !hasHardIssues && !hasSoftIssues;
    const warnings = !ok && !hasHardIssues;

    const summary = ok
        ? `Cobertura ✓ ${totalSlots} slots cubiertos al 100% — ${Math.round(billableHoursGenerated)}h vs ${Math.round(slaVendidas)}h vendidas.`
        : hasHardIssues
            ? `Cobertura con problemas: ${uncovered.length} slots sin cubrir, ${restViolations.length} descansos rotos, ${licenseConflicts.length} conflictos con licencias.`
            : `Cobertura aceptable con avisos: ${overHours.length} empleados sobre 200h, desvío de horas ${(deltaPct * 100).toFixed(1)}%.`;

    return {
        ok,
        warnings,
        modality: { cycleType, cycles, bandsExpected, notes: modalityNotes },
        coverage: { totalSlots, coveredSlots: coveredCount, uncoveredSlots: totalSlots - coveredCount, coverageRatio },
        hours: { billableHoursGenerated, slaVendidas, deltaPct },
        uncovered,
        restViolations,
        licenseConflicts,
        overHours,
        idleEmployees,
        summary,
    };
}
