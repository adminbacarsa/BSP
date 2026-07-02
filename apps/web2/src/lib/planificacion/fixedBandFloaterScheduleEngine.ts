/**
 * Grupos de ciclo 24d (6M+2F+6T+2F+6N+2F) escalonados — cobertura 4×M/T/N/F.
 * Continuidad desde mayo vía trailing + último código del mes anterior.
 */

import {
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateResult,
    type V2PositionDef,
} from './autoScheduleEngineV2';
import { assignmentBreaksBandTransition } from './rotativeBandGuard';

/** Ciclo 24 días: M→T→N con 2F entre bandas (sin N→M directo). */
export const CYCLE_24_MTN: readonly string[] = [
    ...Array(6).fill('M'),
    ...Array(2).fill('F'),
    ...Array(6).fill('T'),
    ...Array(2).fill('F'),
    ...Array(6).fill('N'),
    ...Array(2).fill('F'),
];

const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

/** Apertura junio (índice 0..23) a partir del cierre de mayo. */
export function inferJune1CycleSlot(
    lastCode: string | undefined,
    trailingWork: number | undefined,
    trailingRest: number | undefined,
    lastWorkBandBeforeRest?: string,
): number | null {
    if (!lastCode) return null;
    const code = lastCode.toUpperCase();
    if (code === 'RET' || code === 'R') {
        // RET es un día de trabajo en el ciclo CCT — usar la banda real del guardia
        const effectiveBand = lastWorkBandBeforeRest?.toUpperCase();
        if (!effectiveBand || !WORK_BANDS.has(effectiveBand)) return null;
        const need = Math.max(1, trailingWork ?? 1);
        for (let june1 = 0; june1 < 24; june1++) {
            const may31 = (june1 - 1 + 24) % 24;
            if (CYCLE_24_MTN[may31] !== effectiveBand) continue;
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== effectiveBand) break;
                ok++;
            }
            if (ok >= need) return june1;
        }
        return null;
    }

    for (let june1 = 0; june1 < 24; june1++) {
        const may31 = (june1 - 1 + 24) % 24;
        if (CYCLE_24_MTN[may31] !== code) continue;

        if (WORK_BANDS.has(code)) {
            const need = Math.max(1, trailingWork ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== code) break;
                ok++;
            }
            if (ok >= need) return june1;
        } else if (FRANCO_CODES.has(code)) {
            const need = Math.max(1, trailingRest ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== 'F') break;
                ok++;
            }
            if (ok < need) continue;
            // need=1 → mayo terminó en el 1er día del bloque franco; junio-1 es el 2do (aún F)
            // need≥2 → bloque completo en mayo; junio-1 es el primer día de trabajo
            if (need === 1) {
                if (CYCLE_24_MTN[june1] !== 'F') continue;
                if (!WORK_BANDS.has(CYCLE_24_MTN[(june1 + 1) % 24])) continue;
            } else {
                if (!WORK_BANDS.has(CYCLE_24_MTN[june1])) continue;
            }
            const beforeBlock = (may31 - need + 24) % 24;
            const bandBefore = lastWorkBandBeforeRest?.toUpperCase();
            if (bandBefore && CYCLE_24_MTN[beforeBlock] !== bandBefore) continue;
            return june1;
        }
    }
    return null;
}

/** Offsets por defecto (día 1: M/T/N/F) si no hay trailing de mayo — regulares, stagger 6 slots. */
const COLD_START_OPENINGS = [4, 10, 16, 22];

/** Offsets cold-start para flotantes: inicio de bloque de trabajo → bloques 6+2 limpios desde día 1. */
const FLOATER_COLD_START_OPENINGS = [0, 8, 16];

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

const BANDS_8H = new Set(['M', 'T', 'N']);
const BANDS_12H = new Set(['D12', 'N12']);

/**
 * Empleados necesarios para cubrir 1 pax de este puesto con el ciclo 6+2 (8h) o 4+2 (12h).
 *
 * 24hs M/T/N (8h, 6+2) : qty × 4  — 3 trabajando + 1 franco rotativo
 * 24hs D12/N12 (12h, 4+2): qty × 3  — 2 trabajando + 1 franco rotativo
 * L-V / custom sin rotación: qty × 1  — 1 empleado por pax (descanso = fin de semana)
 * L-D single banda         : qty × 2  — 2 empleados para cubrir los francos del ciclo
 */
function positionCapacity(pos: V2PositionDef): number {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const sevenDays = !Array.isArray(pos.activeDays) || pos.activeDays.length >= 7;

    if (is24hs(pos) && sevenDays) {
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        const only12h = codes.length > 0 && codes.every(c => BANDS_12H.has(c));
        return qty * (only12h ? 3 : 4);
    }

    // Puestos custom (no 24hs):
    // - Sin bandas M/T/N (shifts propios como EN, RO, etc.): 1 empleado por pax.
    // - Con bandas M/T/N pero no 24hs (rotación L-D): 2 empleados por pax por banda.
    if (sevenDays) {
        const activeBands = (pos.shifts || []).filter(s => WORK_BANDS.has(String(s.code || '').toUpperCase())).length;
        if (activeBands === 0) return qty;
        return qty * Math.max(1, activeBands) * 2;
    }

    return qty;
}

function shiftMeta(pos: V2PositionDef, code: string): Pick<V2Assignment, 'name' | 'hours' | 'startTime' | 'endTime'> {
    const upper = code.toUpperCase();
    const sh = (pos.shifts || []).find(s => String(s.code || '').toUpperCase() === upper);
    if (sh) {
        const hours = Number(sh.hours) > 0 ? Number(sh.hours) : 8;
        return {
            name: sh.name || upper,
            hours,
            startTime: sh.startTime || '07:00',
            ...(sh.endTime ? { endTime: sh.endTime } : {}),
        };
    }
    const defaults: Record<string, { startTime: string; endTime?: string; hours?: number }> = {
        M: { startTime: '07:00', endTime: '15:00' },
        T: { startTime: '15:00', endTime: '23:00' },
        N: { startTime: '23:00', endTime: '07:00' },
        D12: { startTime: '07:00', endTime: '19:00', hours: 12 },
        N12: { startTime: '19:00', endTime: '07:00', hours: 12 },
        F: { startTime: '00:00', hours: 0 },
    };
    const d = defaults[upper] ?? defaults.M;
    return {
        name: upper === 'F' ? 'Franco' : upper,
        hours: d.hours ?? 8,
        startTime: d.startTime,
        ...(d.endTime ? { endTime: d.endTime } : {}),
    };
}

function buildPositionGroups(ctx: V2EngineContext): Record<string, string[]> {
    const positionGroups: Record<string, string[]> = {};
    ctx.positions.forEach(p => { positionGroups[p.positionName] = []; });
    const defaultPos = ctx.defaultPositionByEmp || {};

    const unassigned: string[] = [];
    for (const emp of ctx.employees) {
        // EXT / huéspedes → idle siempre.
        if (ctx.objectiveId && emp.preferredObjectiveId !== ctx.objectiveId) continue;
        const fixed = defaultPos[emp.id];
        if (fixed && positionGroups[fixed] !== undefined) {
            positionGroups[fixed].push(emp.id);
        } else {
            unassigned.push(emp.id);
        }
    }

    // Empleados sin puesto → distribuir a todos los puestos por fill-ratio.
    // positionCapacity() garantiza que puestos custom (EN, RO) reciban qty empleados
    // y puestos 24hs reciban qty×4; el fill-ratio balancea automáticamente.
    if (unassigned.length > 0) {
        const targets = ctx.positions.filter(p => positionGroups[p.positionName] !== undefined);
        if (targets.length > 0) {
            for (const empId of unassigned) {
                const leastFull = targets.reduce((best, p) => {
                    const ratioP = positionGroups[p.positionName].length / positionCapacity(p);
                    const ratioB = positionGroups[best.positionName].length / positionCapacity(best);
                    return ratioP < ratioB ? p : best;
                });
                positionGroups[leastFull.positionName].push(empId);
            }
        }
    }

    return positionGroups;
}

/**
 * Calcula la dotación mínima que necesita cada puesto 24hs para su ciclo completo.
 * 8h (M/T/N): qty × 4 empleados. 12h (D12/N12): qty × 3 empleados.
 */
function neededCountFor24hPos(pos: V2PositionDef): number {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
    const only12h = codes.length > 0 && codes.every(c => BANDS_12H.has(c));
    return qty * (only12h ? 3 : 4);
}

/**
 * Rebalancea la dotación entre puestos 24hs cuando los legajos tienen asignaciones incorrectas.
 * Si un puesto tiene más empleados de los que necesita (qty×subgroupSize) y otro tiene menos,
 * mueve el excedente del sobre-dotado al sub-dotado. Así el engine genera cobertura correcta
 * incluso cuando los legajos están mal asignados.
 * Retorna los IDs movidos para que el wizard los muestre como advertencia.
 */
function rebalance24hPositionGroups(
    ctx: V2EngineContext,
    positionGroups: Record<string, string[]>,
): { groups: Record<string, string[]>; relocatedIds: string[] } {
    const relocatedIds: string[] = [];
    // copia mutable
    const groups: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(positionGroups)) groups[k] = [...v];

    const posInfo = ctx.positions
        .filter(p => is24hs(p) && !(Array.isArray(p.activeDays) && p.activeDays.length < 7))
        .map(p => ({ name: p.positionName, needed: neededCountFor24hPos(p) }));

    // Iteramos hasta que no haya más para mover (máx 200 iteraciones por seguridad)
    for (let iter = 0; iter < 200; iter++) {
        // Puesto con mayor déficit
        let defName = '';
        let defAmt = 0;
        // Puesto con mayor superávit
        let surName = '';
        let surAmt = 0;
        for (const { name, needed } of posInfo) {
            const have = (groups[name] || []).length;
            if (have < needed) {
                const d = needed - have;
                if (d > defAmt) { defAmt = d; defName = name; }
            } else if (have > needed) {
                const s = have - needed;
                if (s > surAmt) { surAmt = s; surName = name; }
            }
        }
        if (!defName || !surName) break;
        // Mueve un empleado del sobre-dotado al sub-dotado.
        // Prioridad: mover a quien NO tiene rotación activa (sin datos del mes anterior).
        // Nunca mover a quien tiene puesto asignado Y turno en ese puesto (prevMonthLastShiftByEmp
        // o prevMonthOpeningSlotByEmp definidos = tiene ciclo activo, no mover si hay alternativa).
        const srcGroup = groups[surName];
        const noActiveRotationIdx = srcGroup.findIndex(id =>
            !ctx.prevMonthLastShiftByEmp?.[id] &&
            ctx.prevMonthOpeningSlotByEmp?.[id] === undefined,
        );
        const pickIdx = noActiveRotationIdx >= 0 ? noActiveRotationIdx : srcGroup.length - 1;
        const movedId = srcGroup.splice(pickIdx, 1)[0];
        (groups[defName] = groups[defName] || []).push(movedId);
        relocatedIds.push(movedId);
    }
    return { groups, relocatedIds };
}

/**
 * Divide grupos en subgrupos de 4 regulares + sobrantes como flotantes.
 * qty = puestos concurrentes por turno = número de subgrupos de 4.
 * Los primeros qty×4 empleados (o menos si no alcanza) forman los subgrupos regulares.
 * Los sobrantes (más allá de subgroupCount×4) se agregan como flotantes en round-robin:
 * cada uno va a CYCLE_24_MTN trabajo-días como RET (cubre ausencias de regulares).
 * Si hay menos de 4 empleados en el puesto, se omite (sin subgrupos).
 * Puestos no-24hs se omiten — sus empleados no tienen opening slot.
 */
function buildSubgroupsFor24hs(
    ctx: V2EngineContext,
    positionGroups: Record<string, string[]>,
): { subgroups: string[][]; strandedIds: string[] } {
    const result: string[][] = [];
    // Empleados de puestos 24hs con dotación insuficiente para armar subgrupo completo.
    // Se redistribuyen como flotantes al final, en vez de quedar idle.
    const stranded: string[] = [];
    for (const [posName, groupIds] of Object.entries(positionGroups)) {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos || !is24hs(pos)) continue;
        if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) continue;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        const only12h = codes.length > 0 && codes.every(c => BANDS_12H.has(c));
        const subgroupSize = only12h ? 3 : 4; // 4+2 → 3 emp/subgrupo; 6+2 → 4 emp/subgrupo
        const subgroupCount = Math.min(qty, Math.floor(groupIds.length / subgroupSize));
        if (subgroupCount === 0) {
            // Insuficientes para subgrupo propio → redistribuir como flotantes
            stranded.push(...groupIds);
            continue;
        }
        // Subgrupos de N regulares según ciclo
        const subs: string[][] = [];
        for (let i = 0; i < subgroupCount; i++) {
            subs.push(groupIds.slice(i * subgroupSize, i * subgroupSize + subgroupSize));
        }
        // Sobrantes → flotantes en round-robin
        const floaters = groupIds.slice(subgroupCount * subgroupSize);
        floaters.forEach((id, fi) => { subs[fi % subs.length].push(id); });
        result.push(...subs);
    }
    // Redistribuir stranded como flotantes extra en los subgrupos existentes
    if (stranded.length > 0 && result.length > 0) {
        stranded.forEach((id, i) => { result[i % result.length].push(id); });
    }
    return { subgroups: result, strandedIds: stranded };
}

// Cold-starts POR SUBGRUPO con deduplicación POR ZONA de banda.
// El ciclo tiene 3 zonas de trabajo (M=0-5, T=8-13, N=16-21) y 3 de franco (F=6-7/14-15/22-23).
// Si dos empleados del mismo subgrupo tienen offsets en la misma zona, coinciden en Franco
// el mismo día → brecha de cobertura. Se mantiene solo uno por zona.
function resolveOpeningSlotByEmp(ctx: V2EngineContext, subgroups: string[][]): Record<string, number> {
    const out: Record<string, number> = {};

    // Zona de banda del slot (día 1 del mes = di=0)
    const bandZone = (slot: number): 'M' | 'T' | 'N' | 'F' => {
        const s = ((slot % 24) + 24) % 24;
        if (s <= 5) return 'M';
        if (s <= 7) return 'F';
        if (s <= 13) return 'T';
        if (s <= 15) return 'F';
        if (s <= 21) return 'N';
        return 'F';
    };
    // Slot preferido para llenar cada zona sin trailing
    const ZONE_SLOT: Record<string, number> = { M: 4, T: 10, N: 16, F: 22 };

    for (const groupIds of subgroups) {
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);

        // Paso 1: inferir offsets desde trailing de mayo
        const withTrail: string[] = [];
        const withoutTrail: string[] = [];
        for (const empId of regularIds) {
            const slot = inferJune1CycleSlot(
                ctx.prevMonthLastShiftByEmp?.[empId],
                ctx.prevMonthTrailingWorkDays?.[empId],
                ctx.prevMonthTrailingRestDays?.[empId],
                ctx.prevMonthLastWorkBandBeforeRest?.[empId],
            );
            if (slot !== null) { out[empId] = slot; withTrail.push(empId); }
            else withoutTrail.push(empId);
        }

        // Paso 2: deduplicar por ZONA — dos empleados en la misma zona comparten franco.
        const usedZones = new Map<string, true>();
        for (const empId of [...withTrail]) {
            const zone = bandZone(out[empId]);
            if (!usedZones.has(zone)) {
                usedZones.set(zone, true);
            } else {
                delete out[empId];
                withoutTrail.push(empId);
            }
        }

        // Paso 2b: anchor = withTrail que minimiza snaps bloqueados por racha cross-month.
        // Para cada candidato, computar cuántos otros withTrail no pueden snapear al canónico
        // generado desde ese candidato sin superar 6 días consecutivos de la misma banda.
        // Tiebreak: menor duf (más cerca del próximo franco) → canónico más "tarde" en el bloque.
        let anchor = COLD_START_OPENINGS[0];
        let anchorId: string | null = null;
        {
            let bestBlocked = Infinity;
            let bestDuf = Infinity;
            for (const candidateId of withTrail) {
                if (out[candidateId] === undefined) continue;
                const cSlot = out[candidateId];
                const cCanon: Partial<Record<string, number>> = {};
                for (let k = 0; k < 4; k++) {
                    const s = ((cSlot + k * 6) % 24 + 24) % 24;
                    const z = bandZone(s);
                    if (!(z in cCanon)) cCanon[z] = s;
                }
                let blocked = 0;
                for (const otherId of withTrail) {
                    if (otherId === candidateId || out[otherId] === undefined) continue;
                    const canon = cCanon[bandZone(out[otherId])];
                    if (canon === undefined || canon === out[otherId]) continue;
                    const tw = ctx.prevMonthTrailingWorkDays?.[otherId] ?? 0;
                    const lastCode = (ctx.prevMonthLastShiftByEmp?.[otherId] ?? '').toUpperCase();
                    if (tw > 0 && WORK_BANDS.has(lastCode)) {
                        let startDays = 0;
                        for (let di = 0; di < 7; di++) {
                            if ((CYCLE_24_MTN[(canon + di) % 24] as string) !== lastCode) break;
                            startDays++;
                        }
                        if (tw + startDays > 6) blocked++;
                    }
                }
                let duf = 0;
                for (let di = 0; di < 7; di++) {
                    if (!WORK_BANDS.has(CYCLE_24_MTN[(cSlot + di) % 24] as string)) break;
                    duf++;
                }
                if (blocked < bestBlocked || (blocked === bestBlocked && duf < bestDuf)) {
                    bestBlocked = blocked; bestDuf = duf;
                    anchor = cSlot; anchorId = candidateId;
                }
            }
        }
        if (anchorId === null) {
            for (const empId of withoutTrail) {
                const fb = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
                if (fb && WORK_BANDS.has(fb) && ZONE_SLOT[fb] !== undefined) { anchor = ZONE_SLOT[fb]; break; }
            }
        }
        const canonicalForZone: Partial<Record<string, number>> = {};
        for (let k = 0; k < 4; k++) {
            const s = ((anchor + k * 6) % 24 + 24) % 24;
            const z = bandZone(s);
            if (!(z in canonicalForZone)) canonicalForZone[z] = s;
        }
        // Snap withTrail no-anchor al canónico de su zona, salvo que generaría racha cross-month.
        for (const empId of withTrail) {
            if (empId === anchorId || out[empId] === undefined) continue;
            const zone = bandZone(out[empId]);
            const canonical = canonicalForZone[zone];
            if (canonical === undefined || canonical === out[empId]) continue;
            const tw = ctx.prevMonthTrailingWorkDays?.[empId] ?? 0;
            const lastCode = (ctx.prevMonthLastShiftByEmp?.[empId] ?? '').toUpperCase();
            if (tw > 0 && WORK_BANDS.has(lastCode)) {
                // Contar solo días de LA MISMA BANDA que el trailing al inicio del mes con el slot canónico.
                // Transiciones de banda (ej. trailing M → canonical T) no generan racha.
                let startDays = 0;
                for (let di = 0; di < 7; di++) {
                    if ((CYCLE_24_MTN[(canonical + di) % 24] as string) !== lastCode) break;
                    startDays++;
                }
                if (tw + startDays > 6) continue;
            }
            out[empId] = canonical;
        }

        // Paso 3: cold-start — empleados con banda fija tienen prioridad de zona.
        const availableZones = new Set((['M', 'T', 'N', 'F'] as const).filter(z => !usedZones.has(z)));
        // Primero los de banda fija (para que reserven su zona), luego el resto ordenado.
        withoutTrail.sort((a, b) => {
            const fa = ctx.defaultShiftByEmp?.[a]?.toUpperCase();
            const fb = ctx.defaultShiftByEmp?.[b]?.toUpperCase();
            const ha = (fa && WORK_BANDS.has(fa)) ? 1 : 0;
            const hb = (fb && WORK_BANDS.has(fb)) ? 1 : 0;
            if (ha !== hb) return hb - ha; // banda fija primero
            return a.localeCompare(b);
        });
        withoutTrail.forEach((empId, i) => {
            const fixedBand = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            let zone: string;
            if (fixedBand && WORK_BANDS.has(fixedBand) && availableZones.has(fixedBand as 'M' | 'T' | 'N' | 'F')) {
                zone = fixedBand;
            } else {
                zone = [...availableZones][0] ?? (['M', 'T', 'N', 'F'] as const)[i % 4];
            }
            availableZones.delete(zone as 'M' | 'T' | 'N' | 'F');
            // Si hay slot del mes anterior y su cantidad de días, continuar el ciclo en lugar de reiniciar.
            if (ctx.prevMonthOpeningSlotByEmp?.[empId] !== undefined && ctx.prevMonthDaysCount) {
                out[empId] = ((ctx.prevMonthOpeningSlotByEmp[empId] + ctx.prevMonthDaysCount) % 24 + 24) % 24;
            } else {
                out[empId] = (canonicalForZone[zone] as number | undefined) ?? ZONE_SLOT[zone] ?? COLD_START_OPENINGS[i % 4];
            }
        });

        // Flotantes (índice ≥4): sin trailing usan inicio de bloque de trabajo para que el
        // primer bloque RET del mes sea siempre de 6 días completos.
        for (const empId of floaterIds) {
            const slot = inferJune1CycleSlot(
                ctx.prevMonthLastShiftByEmp?.[empId],
                ctx.prevMonthTrailingWorkDays?.[empId],
                ctx.prevMonthTrailingRestDays?.[empId],
                ctx.prevMonthLastWorkBandBeforeRest?.[empId],
            );
            // Si hay slot del mes anterior y su cantidad de días, continuar el ciclo exactamente.
            let coldStart: number;
            if (ctx.prevMonthOpeningSlotByEmp?.[empId] !== undefined && ctx.prevMonthDaysCount) {
                coldStart = ((ctx.prevMonthOpeningSlotByEmp[empId] + ctx.prevMonthDaysCount) % 24 + 24) % 24;
            } else {
                const preferredBand = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
                coldStart = (preferredBand && WORK_BANDS.has(preferredBand))
                    ? (ZONE_SLOT[preferredBand] ?? FLOATER_COLD_START_OPENINGS[floaterIds.indexOf(empId) % FLOATER_COLD_START_OPENINGS.length])
                    : FLOATER_COLD_START_OPENINGS[floaterIds.indexOf(empId) % FLOATER_COLD_START_OPENINGS.length];
            }
            out[empId] = slot ?? coldStart;
        }
    }

    return out;
}

/**
 * true si hay al menos un puesto 24hs con al menos 4 empleados (1 subgrupo de rotación).
 * Sobrantes más allá de qty×4 se tratan como flotantes (RET); no bloquean el motor.
 * Puestos no-24hs (L-V, custom) se ignoran — no bloquean el floater.
 */
export function canUseFixedBandFloater(ctx: V2EngineContext, positionGroups?: Record<string, string[]>): boolean {
    const groups = positionGroups ?? buildPositionGroups(ctx);
    let counted24 = 0;
    for (const pos of ctx.positions) {
        if (!is24hs(pos)) continue;
        if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) continue;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const g = groups[pos.positionName] || [];
        if (g.length < 4) continue;
        const subgroupCount = Math.min(qty, Math.floor(g.length / 4));
        counted24 += g.length;
    }
    return counted24 > 0;
}

/**
 * Convierte turnos RET en la banda que el empleado ausente habría trabajado.
 * Solo opera sobre RET (ya es "trabajo", solo reetiquetado) — nunca toca F.
 * Los slots que queden sin cubrir los maneja fixScheduleIssues con chequeo de descanso.
 */
function patchRetForAbsences(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    openingSlotByEmp: Record<string, number>,
    subgroups: string[][],
    empToPosition: Record<string, string>,
    employeeMonthlyHours: Record<string, number>,
    employeeCycleHours: { current: Record<string, number>; next: Record<string, number> },
    cutoffDay: number,
): void {
    const aIdx = new Map<string, number>();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));

    // Todos los flotantes (índice >=4 en su subgrupo) para candidatos cross-grupo
    const allFloaterIds = subgroups.flatMap(sub => sub.slice(4));

    for (const groupIds of subgroups) {
        const posName = empToPosition[groupIds[0]] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = ctx.getDateKey(day);
            const absentRegulars = regularIds.filter(id => ctx.absences[id]?.has(dateStr));
            if (!absentRegulars.length) return;

            for (const absentId of absentRegulars) {
                const opening = openingSlotByEmp[absentId];
                if (opening === undefined) continue;
                const neededBand = CYCLE_24_MTN[(opening + di) % 24] as string;
                if (!WORK_BANDS.has(neededBand)) continue; // habría sido F: sin brecha

                // ¿Otro regular ya cubre esa banda ese día?
                const alreadyCovered = regularIds.some(id => {
                    if (id === absentId || ctx.absences[id]?.has(dateStr)) return false;
                    const op = openingSlotByEmp[id];
                    return op !== undefined && CYCLE_24_MTN[(op + di) % 24] === neededBand;
                });
                if (alreadyCovered) continue;

                // RET del mismo subgrupo primero, luego de otros subgrupos
                const allRetCandidates = [
                    ...floaterIds.filter(id => !ctx.absences[id]?.has(dateStr)),
                    ...allFloaterIds.filter(id => !floaterIds.includes(id) && !ctx.absences[id]?.has(dateStr)),
                ];

                for (const retId of allRetCandidates) {
                    const ai = aIdx.get(`${retId}__${dateStr}`);
                    if (ai === undefined) continue;
                    if (assignments[ai].code !== 'RET') continue; // ya cubrió otra brecha
                    if (assignmentBreaksBandTransition(assignments, retId, dateStr, neededBand)) continue;
                    const meta = shiftMeta(pos, neededBand);
                    assignments[ai] = {
                        empId: retId,
                        dateStr,
                        positionName: posName,
                        code: neededBand,
                        name: meta.name,
                        hours: meta.hours,
                        startTime: meta.startTime,
                        ...(meta.endTime ? { endTime: meta.endTime } : {}),
                    };
                    // RET no era facturable → sumar horas completas
                    employeeMonthlyHours[retId] = (employeeMonthlyHours[retId] || 0) + meta.hours;
                    const inCurrent = day.getDate() <= cutoffDay;
                    if (inCurrent) employeeCycleHours.current[retId] = (employeeCycleHours.current[retId] || 0) + meta.hours;
                    else employeeCycleHours.next[retId] = (employeeCycleHours.next[retId] || 0) + meta.hours;
                    break;
                }
            }
        });
    }
}

export function generateFixedBandFloaterSchedule(ctx: V2EngineContext): V2GenerateResult {
    const rawPositionGroups = buildPositionGroups(ctx);
    // Corregir asignaciones incorrectas: mover excedentes de puestos sobre-dotados a sub-dotados
    const { groups: positionGroups, relocatedIds } = rebalance24hPositionGroups(ctx, rawPositionGroups);
    // Subgrupos independientes por slot concurrente (qty>1 → N subgrupos de 4-5 c/u)
    const { subgroups, strandedIds } = buildSubgroupsFor24hs(ctx, positionGroups);
    // empToPosition: usado para L-V y patchRetForAbsences
    const empToPosition: Record<string, string> = {};
    for (const [posName, ids] of Object.entries(positionGroups)) {
        ids.forEach(id => { empToPosition[id] = posName; });
    }
    const openingSlotByEmp = resolveOpeningSlotByEmp(ctx, subgroups);
    // empSubgroup: cada guardia apunta a su subgrupo de 4-5 (para isRetFloater correcto)
    const empSubgroup = new Map<string, string[]>();
    subgroups.forEach(sub => sub.forEach(id => empSubgroup.set(id, sub)));

    // subgroupDisplacement: para cada empleado en un subgrupo que contiene un fijo-N/M/T,
    // registra la banda fija y el opening del fijo. En el loop de asignación, cuando el
    // empleado "choca" con la banda fija (su ciclo natural daría N pero N ya la cubre el fijo),
    // se sustituye por el código que el fijo "resignó" (su ciclo sin override).
    // Esto mantiene la garantía matemática 1M+1T+1N+1F por subgrupo en todos los días.
    const subgroupDisplacement = new Map<string, { fixedBand: string; fixedOpening: number }>();
    for (const subGroup of subgroups) {
        const fixedEmpId = subGroup.find(id => {
            const fb = ctx.defaultShiftByEmp?.[id]?.toUpperCase();
            return fb && WORK_BANDS.has(fb) && openingSlotByEmp[id] !== undefined;
        });
        if (!fixedEmpId) continue;
        const fixedBand = ctx.defaultShiftByEmp![fixedEmpId].toUpperCase();
        const fixedOpening = openingSlotByEmp[fixedEmpId];
        for (const empId of subGroup) {
            if (empId === fixedEmpId) continue;
            subgroupDisplacement.set(empId, { fixedBand, fixedOpening });
        }
    }

    const primaryShiftByEmp: Record<string, string | null> = {};

    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31
        ? ctx.cctCutoffDay
        : 25;
    const assignments: V2Assignment[] = [];
    const employeeMonthlyHours: Record<string, number> = {};
    const employeeCycleHours = { current: {} as Record<string, number>, next: {} as Record<string, number> };
    ctx.employees.forEach(e => {
        employeeMonthlyHours[e.id] = 0;
        employeeCycleHours.current[e.id] = 0;
        employeeCycleHours.next[e.id] = 0;
    });

    for (const emp of ctx.employees) {
        const opening = openingSlotByEmp[emp.id];

        if (opening === undefined) {
            // Puesto L-V / custom: turno en días activos, Franco en días inactivos
            const posName = empToPosition[emp.id] ?? '';
            const pos = ctx.positions.find(p => p.positionName === posName);
            if (!pos) continue;
            // Empleados 24hs sin opening = extras descartados por buildSubgroupsFor24hs → idle
            if (is24hs(pos)) continue;
            primaryShiftByEmp[emp.id] = null;
            ctx.daysInMonth.forEach(day => {
                const dateStr = ctx.getDateKey(day);
                if (ctx.absences[emp.id]?.has(dateStr)) return;
                const dayLetter = ctx.getDayLetter(dateStr);
                if (positionIsActiveOn(pos, dayLetter)) {
                    const shiftCode = String(pos.shifts?.[0]?.code || 'M').toUpperCase();
                    const meta = shiftMeta(pos, shiftCode);
                    assignments.push({
                        empId: emp.id,
                        dateStr,
                        positionName: posName,
                        code: shiftCode,
                        name: meta.name,
                        hours: meta.hours,
                        startTime: meta.startTime,
                        ...(meta.endTime ? { endTime: meta.endTime } : {}),
                    });
                    employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
                    const inCurrent = day.getDate() <= cutoffDay;
                    if (inCurrent) employeeCycleHours.current[emp.id] = (employeeCycleHours.current[emp.id] || 0) + meta.hours;
                    else employeeCycleHours.next[emp.id] = (employeeCycleHours.next[emp.id] || 0) + meta.hours;
                } else {
                    assignments.push({ empId: emp.id, dateStr, positionName: '', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true });
                }
            });
            continue;
        }

        const posName = empToPosition[emp.id] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;

        // isRetFloater: índice ≥ 4 dentro del subgrupo (no en el grupo completo del puesto)
        const subGroup = empSubgroup.get(emp.id) ?? [];
        const isRetFloater = subGroup.indexOf(emp.id) >= 4;

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = ctx.getDateKey(day);
            if (ctx.absences[emp.id]?.has(dateStr)) return;
            const dayLetter = ctx.getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) return;

            const rawCode = CYCLE_24_MTN[(opening + di) % 24] as string;
            const ownFixedBand = ctx.defaultShiftByEmp?.[emp.id]?.toUpperCase();
            let rawCodeFinal: string;
            if (ownFixedBand && WORK_BANDS.has(ownFixedBand) && WORK_BANDS.has(rawCode)) {
                // Empleado con banda fija: siempre trabaja su banda en días laborales.
                rawCodeFinal = ownFixedBand;
            } else {
                const disp = subgroupDisplacement.get(emp.id);
                if (disp && rawCode === disp.fixedBand && WORK_BANDS.has(rawCode)) {
                    // El ciclo natural da la misma banda que el fijo del subgrupo.
                    // Sustituir por lo que el fijo "resignó" para mantener 1M+1T+1N+1F.
                    const naturalOfFixed = CYCLE_24_MTN[(disp.fixedOpening + di) % 24] as string;
                    rawCodeFinal = WORK_BANDS.has(naturalOfFixed) ? naturalOfFixed : rawCode;
                } else {
                    rawCodeFinal = rawCode;
                }
            }
            const isExcludedDay = !isRetFloater && WORK_BANDS.has(rawCodeFinal) && !!pos.excludedDates?.includes(dateStr);
            const code = isExcludedDay ? 'RET' : (isRetFloater && WORK_BANDS.has(rawCodeFinal)) ? 'RET' : rawCodeFinal;
            if (di === 0) primaryShiftByEmp[emp.id] = (!isRetFloater && WORK_BANDS.has(rawCodeFinal)) ? rawCodeFinal : null;

            const meta = shiftMeta(pos, isExcludedDay ? rawCode : code);
            const isFranco = code === 'F';
            const isRet = code === 'RET';
            assignments.push({
                empId: emp.id,
                dateStr,
                positionName: (isFranco || isRet) ? '' : posName,
                code,
                name: meta.name,
                hours: meta.hours,
                startTime: meta.startTime,
                ...(!isRet && meta.endTime ? { endTime: meta.endTime } : {}),
                ...(isFranco ? { isFranco: true } : {}),
            });

            if (BILLABLE.has(code)) {
                employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
                const inCurrent = day.getDate() <= cutoffDay;
                if (inCurrent) {
                    employeeCycleHours.current[emp.id] = (employeeCycleHours.current[emp.id] || 0) + meta.hours;
                } else {
                    employeeCycleHours.next[emp.id] = (employeeCycleHours.next[emp.id] || 0) + meta.hours;
                }
            }
        });
    }

    patchRetForAbsences(
        ctx, assignments, openingSlotByEmp, subgroups, empToPosition,
        employeeMonthlyHours, employeeCycleHours, cutoffDay,
    );

    // Retorna true si el puesto ya tiene `qty` empleados con esa banda ese día (cupo completo).
    const bandQuotaFull = (posName: string, dateStr: string, code: string): boolean => {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) return false;
        const quota = Math.max(1, Number(pos.qty) || 1);
        const count = assignments.filter(
            a => a.positionName === posName && a.dateStr === dateStr && a.code === code && (a.hours ?? 0) > 0,
        ).length;
        return count >= quota;
    };

    // RET que patchRetForAbsences no convirtió: mostrar banda natural del ciclo (con corrección de zona).
    for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        if (a.code !== 'RET') continue;
        const opening = openingSlotByEmp[a.empId];
        if (opening === undefined) continue;
        const di = ctx.daysInMonth.findIndex(d => ctx.getDateKey(d) === a.dateStr);
        if (di < 0) continue;
        const rawNaturalCode = CYCLE_24_MTN[(opening + di) % 24] as string;
        if (!WORK_BANDS.has(rawNaturalCode)) continue;
        let naturalCode = rawNaturalCode;
        if (assignmentBreaksBandTransition(assignments, a.empId, a.dateStr, naturalCode)) {
            let detectedBand: string | null = null;
            for (let k = di - 1; k >= 0 && k >= di - 14; k--) {
                const dateK = ctx.getDateKey(ctx.daysInMonth[k]!);
                const prev = assignments.find(x =>
                    x.empId === a.empId && x.dateStr === dateK &&
                    (x.hours ?? 0) > 0 && WORK_BANDS.has(x.code),
                );
                if (prev) { detectedBand = prev.code; break; }
            }
            if (!detectedBand) continue;
            naturalCode = detectedBand;
            if (assignmentBreaksBandTransition(assignments, a.empId, a.dateStr, naturalCode)) continue;
        }
        const posName = empToPosition[a.empId] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;
        const meta = shiftMeta(pos, naturalCode);
        assignments[i] = {
            empId: a.empId,
            dateStr: a.dateStr,
            positionName: posName,
            code: naturalCode,
            name: meta.name,
            hours: meta.hours,
            startTime: meta.startTime,
            ...(meta.endTime ? { endTime: meta.endTime } : {}),
        };
        employeeMonthlyHours[a.empId] = (employeeMonthlyHours[a.empId] || 0) + meta.hours;
        const day = ctx.daysInMonth[di];
        if (day) {
            const inCurrent = day.getDate() <= cutoffDay;
            if (inCurrent) employeeCycleHours.current[a.empId] = (employeeCycleHours.current[a.empId] || 0) + meta.hours;
            else employeeCycleHours.next[a.empId] = (employeeCycleHours.next[a.empId] || 0) + meta.hours;
        }
    }

    // Pase final: cualquier transición N→T/M o T→M que sobrevivió revierte a RET.
    for (const emp of ctx.employees) {
        for (let di = 0; di < ctx.daysInMonth.length; di++) {
            const dateStr = ctx.getDateKey(ctx.daysInMonth[di]);
            const ai = assignments.findIndex(x =>
                x.empId === emp.id && x.dateStr === dateStr && (x.hours ?? 0) > 0 && !x.isFranco,
            );
            if (ai < 0) continue;
            if (assignmentBreaksBandTransition(assignments, emp.id, dateStr, String(assignments[ai].code))) {
                employeeMonthlyHours[emp.id] = Math.max(0, (employeeMonthlyHours[emp.id] || 0) - (Number(assignments[ai].hours) || 0));
                assignments[ai] = {
                    empId: emp.id,
                    dateStr,
                    positionName: '',
                    code: 'RET',
                    name: 'Retén',
                    hours: 0,
                    startTime: '00:00',
                };
            }
        }
    }

    // Continuidad de banda: si ayer tuvo banda X (con horas) y el ciclo indica X hoy y hoy es RET → asignar X.
    // Cubre secuencias N/T/M interrumpidas por el hard-cleanup cuando el primer día fue asignado por patchRetForAbsences.
    for (let di = 1; di < ctx.daysInMonth.length; di++) {
        const dateStr = ctx.getDateKey(ctx.daysInMonth[di]);
        const prevDateStr = ctx.getDateKey(ctx.daysInMonth[di - 1]!);
        for (const emp of ctx.employees) {
            const opening = openingSlotByEmp[emp.id];
            if (opening === undefined) continue;
            const ai = assignments.findIndex(x => x.empId === emp.id && x.dateStr === dateStr);
            if (ai < 0 || assignments[ai].code !== 'RET') continue;
            const cycleCode = CYCLE_24_MTN[(opening + di) % 24] as string;
            if (!WORK_BANDS.has(cycleCode)) continue;
            const prevAi = assignments.findIndex(x => x.empId === emp.id && x.dateStr === prevDateStr);
            if (prevAi < 0 || assignments[prevAi].code !== cycleCode || (assignments[prevAi].hours ?? 0) <= 0) continue;
            const posName = empToPosition[emp.id] ?? '';
            const pos = ctx.positions.find(p => p.positionName === posName);
            if (!pos) continue;
            const meta = shiftMeta(pos, cycleCode);
            assignments[ai] = {
                empId: emp.id, dateStr, positionName: posName,
                code: cycleCode, name: meta.name, hours: meta.hours, startTime: meta.startTime,
                ...(meta.endTime ? { endTime: meta.endTime } : {}),
            };
            employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
            const day = ctx.daysInMonth[di]!;
            const inCurrent = day.getDate() <= cutoffDay;
            if (inCurrent) employeeCycleHours.current[emp.id] = (employeeCycleHours.current[emp.id] || 0) + meta.hours;
            else employeeCycleHours.next[emp.id] = (employeeCycleHours.next[emp.id] || 0) + meta.hours;
        }
    }

    // Pase de rebalanceo: puestos qty>1 con bandas sobre-representadas redirigen el excedente
    // a la banda más deficitaria, solo si el CCT lo permite (sin forzar transiciones prohibidas).
    for (const pos of ctx.positions) {
        const posName = pos.positionName;
        const qty = Math.max(1, Number(pos.qty) || 1);
        if (qty < 2) continue;
        const posShifts = Array.isArray(pos.shifts) ? pos.shifts : [];
        const SKIP_CODES = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'REF', 'ESC', 'V', 'L', 'A', 'E', 'AA', 'PG']);
        const schemeBands = (() => {
            const b8 = [...new Set(posShifts
                .filter((s: any) => (Number(s.hours) || 8) < 12)
                .map((s: any) => String(s.code || '').toUpperCase())
                .filter((c: string) => c && !SKIP_CODES.has(c)),
            )];
            if (b8.length) return b8;
            const b12 = [...new Set(posShifts
                .filter((s: any) => (Number(s.hours) || 8) >= 12)
                .map((s: any) => String(s.code || '').toUpperCase())
                .filter((c: string) => !!c && !SKIP_CODES.has(c)),
            )];
            return b12.length ? b12 : ['M', 'T', 'N'];
        })();

        for (let di = 0; di < ctx.daysInMonth.length; di++) {
            const dateStr = ctx.getDateKey(ctx.daysInMonth[di]);
            const bandCounts: Record<string, number> = {};
            for (const b of schemeBands) bandCounts[b] = 0;
            assignments
                .filter(a => a.positionName === posName && a.dateStr === dateStr && (a.hours ?? 0) > 0)
                .forEach(a => { if (bandCounts[a.code] !== undefined) bandCounts[a.code]++; });

            const overBands = schemeBands.filter(b => bandCounts[b] > qty);
            const underBands = schemeBands.filter(b => bandCounts[b] < qty);
            if (!overBands.length || !underBands.length) continue;

            for (const overBand of overBands) {
                for (const underBand of underBands) {
                    while (bandCounts[overBand] > qty && bandCounts[underBand] < qty) {
                        const ai = assignments.findIndex(a =>
                            a.positionName === posName && a.dateStr === dateStr &&
                            a.code === overBand && (a.hours ?? 0) > 0 &&
                            !WORK_BANDS.has((ctx.defaultShiftByEmp?.[a.empId] ?? '').toUpperCase()) &&
                            !assignmentBreaksBandTransition(assignments, a.empId, dateStr, underBand),
                        );
                        if (ai < 0) break;
                        const empId = assignments[ai].empId;
                        const oldHours = Number(assignments[ai].hours) || 0;
                        const meta = shiftMeta(pos, underBand);
                        employeeMonthlyHours[empId] = Math.max(0, (employeeMonthlyHours[empId] || 0) - oldHours) + meta.hours;
                        assignments[ai] = {
                            empId, dateStr, positionName: posName,
                            code: underBand, name: meta.name, hours: meta.hours, startTime: meta.startTime,
                            ...(meta.endTime ? { endTime: meta.endTime } : {}),
                        };
                        const day = ctx.daysInMonth[di]!;
                        const inCurrent = day.getDate() <= cutoffDay;
                        if (inCurrent) employeeCycleHours.current[empId] = Math.max(0, (employeeCycleHours.current[empId] || 0) - oldHours) + meta.hours;
                        else employeeCycleHours.next[empId] = Math.max(0, (employeeCycleHours.next[empId] || 0) - oldHours) + meta.hours;
                        bandCounts[overBand]--;
                        bandCounts[underBand]++;
                    }
                }
            }
        }
    }

    const totalBillableHours = Object.values(employeeMonthlyHours).reduce((s, h) => s + h, 0);
    const slaTarget = Math.max(0, ctx.slaVendidas || 0);
    const slaDeficitRemaining = Math.max(0, Math.round((slaTarget - totalBillableHours) * 10) / 10);

    return {
        assignments,
        capOverflowSlots: [],
        coverageViolations: 0,
        feasibility: null as any,
        stats: {
            totalAssignments: assignments.length,
            totalBillableHours,
            targetHours: slaTarget,
            uncoveredSlots: 0,
            employeeMonthlyHours,
            employeeCycleHours,
            employeesOver200: [],
            positionGroups,
            idleEmployeeIds: ctx.employees.filter(e => openingSlotByEmp[e.id] === undefined).map(e => e.id),
            strandedEmployeeIds: strandedIds.length > 0 ? strandedIds : undefined,
            relocatedEmployeeIds: relocatedIds.length > 0 ? relocatedIds : undefined,
            primaryShiftByEmp,
            slaDeficitRemaining,
            slaHoursClosed: slaDeficitRemaining <= 0.5,
            fixedBandSchemeByEmp: Object.fromEntries(
                ctx.employees.map(e => [e.id, `6+2@${openingSlotByEmp[e.id] ?? '?'}`]),
            ),
            openingSlotByEmp,
        },
    };
}

// Tests unitarios lógicos (sin Firestore)
export function _debugCycleSlots(
    cases: Array<{ last: string; tw?: number; tr?: number; expect: number }>,
): boolean {
    return cases.every(c => inferJune1CycleSlot(c.last, c.tw, c.tr) === c.expect);
}
