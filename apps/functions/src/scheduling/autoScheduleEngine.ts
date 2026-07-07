/**
 * MOTOR DE PLANIFICACIÓN 6+2 — COSP v1.0
 * Copia embebida del motor del front (fixedBandFloaterScheduleEngine).
 * Al estar dentro de la Cloud Function, la versión desplegada queda congelada:
 * cambios en el front no afectan la función hasta que se redeploy explícito.
 *
 * ─── CICLO 6+2 ────────────────────────────────────────────────────────────
 *  El ciclo fundamental tiene 24 días: 6M + 2F + 6T + 2F + 6N + 2F.
 *  Cada empleado entra al ciclo en un "opening slot" (índice 0..23).
 *  Cuatro empleados por subgrupo cubren las 3 bandas + francos distribuidos.
 *
 *  Ejemplo (4 empleados, offsets 4, 10, 16, 22):
 *   Emp A  slot 4 → día1=M, día2=M … día6=M, día7=F, día8=F, día9=T …
 *   Emp B  slot 10 → día1=T, día2=T … día6=T, día7=F, día8=F, día9=N …
 *   Emp C  slot 16 → día1=N, día2=N … día6=N, día7=F, día8=F, día9=M …
 *   Emp D  slot 22 → día1=F, día2=F, día3=M, día4=M … día8=M, día9=F …
 *
 * ─── PUESTOS CUSTOM (EN, RO, etc.) ────────────────────────────────────────
 *  Puestos sin coverageType='24hs' y con shift propio (Encargada=EN 9h,
 *  Rondín=RO 10h, etc.) reciben exactamente qty empleados vía fill-ratio
 *  y se planifican en modo L-D (turno cada día activo, F en días inactivos).
 *  No participan del ciclo 6+2.
 */

// ──────────────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────────────

export interface EnginePositionDef {
    positionName: string;
    qty?: number;
    shifts?: Array<{ code: string; name?: string; hours?: number; startTime?: string; endTime?: string; days?: string[] }>;
    activeDays?: string[];
    coverageType?: string;
    excludedDates?: string[];
}

export interface EngineEmployeeDef {
    id: string;
    nombre?: string;
}

export interface EngineContext {
    positions: EnginePositionDef[];
    employees: EngineEmployeeDef[];
    daysInMonth: Date[];
    slaVendidas: number;
    autoCycles: string[];
    absences: Record<string, Set<string>>;        // empId → Set<YYYY-MM-DD>
    defaultPositionByEmp?: Record<string, string>; // empId → positionName (asignado manualmente)
    defaultShiftByEmp?: Record<string, string>;    // empId → 'M'|'T'|'N'|'D12'|'N12'
    prevMonthTrailingWorkDays?: Record<string, number>;
    prevMonthTrailingRestDays?: Record<string, number>;
    prevMonthLastShiftByEmp?: Record<string, string>;
    prevMonthLastWorkBandBeforeRest?: Record<string, string>;
    cctCutoffDay?: number;
    codeHoursHint?: Record<string, number>;
}

export interface EngineAssignment {
    empId: string;
    dateStr: string;
    positionName: string;
    code: string;
    name: string;
    hours: number;
    startTime: string;
    endTime?: string;
    isFranco?: boolean;
}

export interface EngineResult {
    assignments: EngineAssignment[];
    stats: {
        totalBillableHours: number;
        targetHours: number;
        slaHoursClosed: boolean;
        slaDeficitRemaining: number;
        employeeMonthlyHours: Record<string, number>;
        idleEmployeeIds: string[];
        positionGroups: Record<string, string[]>;
        openingSlotByEmp: Record<string, number>;
        primaryShiftByEmp: Record<string, string | null>;
    };
}

// ──────────────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────────────

const CYCLE_24_MTN: readonly string[] = [
    ...Array(6).fill('M'), ...Array(2).fill('F'),
    ...Array(6).fill('T'), ...Array(2).fill('F'),
    ...Array(6).fill('N'), ...Array(2).fill('F'),
];

const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const BANDS_12H = new Set(['D12', 'N12']);

const COLD_START_OPENINGS = [4, 10, 16, 22];
const FLOATER_COLD_START_OPENINGS = [0, 8, 16];

function getDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getDayLetter(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.getDay()];
}

function is24hs(pos: EnginePositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

function positionIsActiveOn(pos: EnginePositionDef, dayLetter: string): boolean {
    if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) {
        return pos.activeDays.includes(dayLetter);
    }
    return true;
}

/**
 * Empleados necesarios para cubrir 1 pax de este puesto con el ciclo 6+2.
 *
 * - 24hs M/T/N  (8h,  6+2): qty × 4  — 3 trabajando + 1 franco rotativo
 * - 24hs D12/N12(12h, 4+2): qty × 3  — 2 trabajando + 1 franco rotativo
 * - Puestos custom sin M/T/N (EN, RO): qty × 1  — 1 empleado fijo
 * - Custom 7 días con M/T/N: qty × activeBands × 2
 * - Custom L-V: qty × 1
 */
function positionCapacity(pos: EnginePositionDef): number {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const sevenDays = !Array.isArray(pos.activeDays) || pos.activeDays.length >= 7;

    if (is24hs(pos) && sevenDays) {
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        const only12h = codes.length > 0 && codes.every(c => BANDS_12H.has(c));
        return qty * (only12h ? 3 : 4);
    }

    if (sevenDays) {
        const activeBands = (pos.shifts || []).filter(s => WORK_BANDS.has(String(s.code || '').toUpperCase())).length;
        if (activeBands === 0) return qty;                   // puestos custom (EN, RO) → 1 emp/pax
        return qty * Math.max(1, activeBands) * 2;
    }

    return qty;
}

function shiftMeta(pos: EnginePositionDef, code: string, codeHoursHint?: Record<string, number>): Pick<EngineAssignment, 'name' | 'hours' | 'startTime' | 'endTime'> {
    const upper = code.toUpperCase();
    const sh = (pos.shifts || []).find(s => String(s.code || '').toUpperCase() === upper);
    if (sh) {
        const hours = Number(sh.hours) > 0 ? Number(sh.hours) : (codeHoursHint?.[upper] ?? 8);
        return { name: sh.name || upper, hours, startTime: sh.startTime || '07:00', ...(sh.endTime ? { endTime: sh.endTime } : {}) };
    }
    const hint = codeHoursHint?.[upper];
    const defaults: Record<string, { startTime: string; endTime?: string; hours?: number }> = {
        M: { startTime: '07:00', endTime: '15:00' },
        T: { startTime: '15:00', endTime: '23:00' },
        N: { startTime: '23:00', endTime: '07:00' },
        D12: { startTime: '07:00', endTime: '19:00', hours: 12 },
        N12: { startTime: '19:00', endTime: '07:00', hours: 12 },
        F: { startTime: '00:00', hours: 0 },
    };
    const d = defaults[upper] ?? defaults.M;
    return { name: upper === 'F' ? 'Franco' : upper, hours: hint ?? d.hours ?? 8, startTime: d.startTime, ...(d.endTime ? { endTime: d.endTime } : {}) };
}

// ──────────────────────────────────────────────────────
// FASE 1: DISTRIBUCIÓN DE EMPLEADOS A PUESTOS
// Cada empleado se asigna a un puesto según asignación manual o fill-ratio.
// fill-ratio = empleados_en_puesto / positionCapacity(puesto)
// Siempre se elige el puesto con menor ratio → distribución proporcional.
// ──────────────────────────────────────────────────────

function buildPositionGroups(ctx: EngineContext): Record<string, string[]> {
    const groups: Record<string, string[]> = {};
    ctx.positions.forEach(p => { groups[p.positionName] = []; });
    const defaultPos = ctx.defaultPositionByEmp || {};

    const unassigned: string[] = [];
    for (const emp of ctx.employees) {
        const fixed = defaultPos[emp.id];
        if (fixed && groups[fixed] !== undefined) {
            groups[fixed].push(emp.id);
        } else {
            unassigned.push(emp.id);
        }
    }

    if (unassigned.length > 0) {
        const targets = ctx.positions.filter(p => groups[p.positionName] !== undefined);
        if (targets.length > 0) {
            for (const empId of unassigned) {
                const leastFull = targets.reduce((best, p) => {
                    const rP = groups[p.positionName].length / positionCapacity(p);
                    const rB = groups[best.positionName].length / positionCapacity(best);
                    return rP < rB ? p : best;
                });
                groups[leastFull.positionName].push(empId);
            }
        }
    }

    return groups;
}

// ──────────────────────────────────────────────────────
// FASE 2: SUBGRUPOS DE ROTACIÓN 6+2
// Sólo aplica a puestos 24hs (M/T/N). Cada qty pax del puesto forma
// un subgrupo de 4 empleados regulares; los excedentes son "flotantes"
// (cubren ausencias como RET → luego convertidos a banda real).
// ──────────────────────────────────────────────────────

function buildSubgroupsFor24hs(ctx: EngineContext, groups: Record<string, string[]>): string[][] {
    const result: string[][] = [];
    for (const [posName, groupIds] of Object.entries(groups)) {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos || !is24hs(pos)) continue;
        if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) continue;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        const only12h = codes.length > 0 && codes.every(c => BANDS_12H.has(c));
        const subgroupSize = only12h ? 3 : 4;
        const subgroupCount = Math.min(qty, Math.floor(groupIds.length / subgroupSize));
        if (subgroupCount === 0) continue;
        const subs: string[][] = [];
        for (let i = 0; i < subgroupCount; i++) {
            subs.push(groupIds.slice(i * subgroupSize, i * subgroupSize + subgroupSize));
        }
        const floaters = groupIds.slice(subgroupCount * subgroupSize);
        floaters.forEach((id, fi) => { subs[fi % subs.length].push(id); });
        result.push(...subs);
    }
    return result;
}

// ──────────────────────────────────────────────────────
// FASE 3: RESOLUCIÓN DE OPENING SLOTS
// El "opening slot" (0..23) determina el índice del ciclo CYCLE_24_MTN
// en el día 1 del mes. Se infiere del mes anterior; si no hay trailing,
// se asigna cold-start con stagger de 6 posiciones entre empleados.
// ──────────────────────────────────────────────────────

function inferCycleSlot(
    lastCode: string | undefined,
    trailingWork: number | undefined,
    trailingRest: number | undefined,
    lastWorkBand?: string,
): number | null {
    if (!lastCode) return null;
    const code = lastCode.toUpperCase();
    const candidates: number[] = [];

    if (code === 'RET' || code === 'R') {
        const effectiveBand = lastWorkBand?.toUpperCase();
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
            if (ok >= need) candidates.push(june1);
        }
        return candidates[0] ?? null;
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
            if (ok >= need) candidates.push(june1);
        } else if (FRANCO_CODES.has(code)) {
            const need = Math.max(1, trailingRest ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== 'F') break;
                ok++;
            }
            if (ok < need) continue;
            if (need === 1) {
                if (CYCLE_24_MTN[june1] !== 'F') continue;
            } else {
                if (!WORK_BANDS.has(CYCLE_24_MTN[june1])) continue;
            }
            candidates.push(june1);
        }
    }

    if (candidates.length === 0) return null;

    if (WORK_BANDS.has(code)) {
        const streak = trailingWork ?? 1;
        const continueSameBand = streak < 6;
        if (continueSameBand) {
            const same = candidates.find((d) => CYCLE_24_MTN[d] === code);
            if (same !== undefined) return same;
        } else {
            const franco = candidates.find((d) => CYCLE_24_MTN[d] === 'F');
            if (franco !== undefined) return franco;
        }
    }

    return candidates[0];
}

function resolveOpeningSlots(ctx: EngineContext, subgroups: string[][]): Record<string, number> {
    const out: Record<string, number> = {};
    const ZONE_SLOT: Record<string, number> = { M: 4, T: 10, N: 16, F: 22 };

    const bandZone = (slot: number): string => {
        const s = ((slot % 24) + 24) % 24;
        if (s <= 5) return 'M'; if (s <= 7) return 'F';
        if (s <= 13) return 'T'; if (s <= 15) return 'F';
        if (s <= 21) return 'N'; return 'F';
    };

    for (const groupIds of subgroups) {
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);

        // Paso 1: inferir desde trailing del mes anterior
        const withTrail: string[] = [];
        const withoutTrail: string[] = [];
        for (const empId of regularIds) {
            const slot = inferCycleSlot(
                ctx.prevMonthLastShiftByEmp?.[empId],
                ctx.prevMonthTrailingWorkDays?.[empId],
                ctx.prevMonthTrailingRestDays?.[empId],
                ctx.prevMonthLastWorkBandBeforeRest?.[empId],
            );
            if (slot !== null) { out[empId] = slot; withTrail.push(empId); }
            else withoutTrail.push(empId);
        }

        // Paso 2: deduplicar por zona (evitar dos empleados en el mismo bloque F)
        const usedZones = new Map<string, true>();
        for (const empId of [...withTrail]) {
            const zone = bandZone(out[empId]);
            if (!usedZones.has(zone)) usedZones.set(zone, true);
            else { delete out[empId]; withoutTrail.push(empId); }
        }

        // Paso 2b: anclar al conjunto canónico (offsets exactamente 6 apart)
        let anchor = COLD_START_OPENINGS[0];
        let fixedBandFound = false;
        for (const empId of [...withTrail, ...withoutTrail]) {
            const fb = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            if (fb && WORK_BANDS.has(fb) && ZONE_SLOT[fb] !== undefined) {
                anchor = ZONE_SLOT[fb]; fixedBandFound = true; break;
            }
        }
        if (!fixedBandFound) {
            for (const empId of withTrail) { if (out[empId] !== undefined) { anchor = out[empId]; break; } }
        }
        const canonicalForZone: Record<string, number> = {};
        for (let k = 0; k < 4; k++) {
            const s = ((anchor + k * 6) % 24 + 24) % 24;
            const z = bandZone(s);
            if (!(z in canonicalForZone)) canonicalForZone[z] = s;
        }
        for (const empId of withTrail) {
            if (out[empId] !== undefined) {
                const zone = bandZone(out[empId]);
                const c = canonicalForZone[zone];
                if (c !== undefined) out[empId] = c;
            }
        }

        // Paso 2c: empleados con banda fija → mover a su zona canónica
        for (const empId of [...withTrail]) {
            if (out[empId] === undefined) continue;
            const fixedBand = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            if (!fixedBand || !WORK_BANDS.has(fixedBand)) continue;
            const currentZone = bandZone(out[empId]);
            if (currentZone === fixedBand) continue;
            const targetSlot = canonicalForZone[fixedBand];
            if (targetSlot === undefined) continue;
            const displaced = withTrail.find(id => id !== empId && out[id] !== undefined && bandZone(out[id]) === fixedBand);
            if (displaced) { usedZones.delete(fixedBand); delete out[displaced]; withoutTrail.push(displaced); }
            usedZones.delete(currentZone);
            usedZones.set(fixedBand, true);
            out[empId] = targetSlot;
        }

        // Paso 3: cold-start para los que no tienen trailing
        const ALL_ZONES: string[] = ['M', 'T', 'N', 'F'];
        const availableZones = new Set(ALL_ZONES.filter(z => !usedZones.has(z)));
        withoutTrail.sort((a, b) => {
            const fa = ctx.defaultShiftByEmp?.[a]?.toUpperCase();
            const fb = ctx.defaultShiftByEmp?.[b]?.toUpperCase();
            return ((fb && WORK_BANDS.has(fb)) ? 1 : 0) - ((fa && WORK_BANDS.has(fa)) ? 1 : 0);
        });
        withoutTrail.forEach((empId, i) => {
            const fixedBand = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            let zone: string;
            if (fixedBand && WORK_BANDS.has(fixedBand) && availableZones.has(fixedBand)) zone = fixedBand;
            else zone = [...availableZones][0] ?? ALL_ZONES[i % 4];
            availableZones.delete(zone);
            out[empId] = (canonicalForZone[zone] as number | undefined) ?? ZONE_SLOT[zone] ?? COLD_START_OPENINGS[i % 4];
        });

        // Flotantes: opening desde trailing o inicio de bloque de trabajo
        for (const empId of floaterIds) {
            const slot = inferCycleSlot(
                ctx.prevMonthLastShiftByEmp?.[empId],
                ctx.prevMonthTrailingWorkDays?.[empId],
                ctx.prevMonthTrailingRestDays?.[empId],
                ctx.prevMonthLastWorkBandBeforeRest?.[empId],
            );
            out[empId] = slot ?? FLOATER_COLD_START_OPENINGS[floaterIds.indexOf(empId) % FLOATER_COLD_START_OPENINGS.length];
        }
    }

    return out;
}

// ──────────────────────────────────────────────────────
// FASE 4: GENERACIÓN DE TURNOS DÍA A DÍA
// Para cada empleado y cada día: CYCLE_24_MTN[(opening + di) % 24].
// Puestos no-24hs: turno en días activos, F en días inactivos.
// Flotantes (índice ≥4 en subgrupo): RET en días de trabajo (cubre ausentes).
// ──────────────────────────────────────────────────────

function patchRetForAbsences(
    ctx: EngineContext,
    assignments: EngineAssignment[],
    openingSlotByEmp: Record<string, number>,
    subgroups: string[][],
    empToPosition: Record<string, string>,
    employeeMonthlyHours: Record<string, number>,
    cutoffDay: number,
): void {
    const aIdx = new Map<string, number>();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));
    const allFloaterIds = subgroups.flatMap(sub => sub.slice(4));

    for (const groupIds of subgroups) {
        const posName = empToPosition[groupIds[0]] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = getDateKey(day);
            const absentRegulars = regularIds.filter(id => ctx.absences[id]?.has(dateStr));
            if (!absentRegulars.length) return;

            for (const absentId of absentRegulars) {
                const opening = openingSlotByEmp[absentId];
                if (opening === undefined) continue;
                const neededBand = CYCLE_24_MTN[(opening + di) % 24] as string;
                if (!WORK_BANDS.has(neededBand)) continue;

                const alreadyCovered = regularIds.some(id => {
                    if (id === absentId || ctx.absences[id]?.has(dateStr)) return false;
                    const op = openingSlotByEmp[id];
                    return op !== undefined && CYCLE_24_MTN[(op + di) % 24] === neededBand;
                });
                if (alreadyCovered) continue;

                const allRetCandidates = [
                    ...floaterIds.filter(id => !ctx.absences[id]?.has(dateStr)),
                    ...allFloaterIds.filter(id => !floaterIds.includes(id) && !ctx.absences[id]?.has(dateStr)),
                ];
                for (const retId of allRetCandidates) {
                    const ai = aIdx.get(`${retId}__${dateStr}`);
                    if (ai === undefined || assignments[ai].code !== 'RET') continue;
                    const meta = shiftMeta(pos, neededBand, ctx.codeHoursHint);
                    assignments[ai] = { empId: retId, dateStr, positionName: posName, code: neededBand, name: meta.name, hours: meta.hours, startTime: meta.startTime, ...(meta.endTime ? { endTime: meta.endTime } : {}) };
                    employeeMonthlyHours[retId] = (employeeMonthlyHours[retId] || 0) + meta.hours;
                    break;
                }
            }
        });
    }
}

// ──────────────────────────────────────────────────────
// PUNTO DE ENTRADA DEL MOTOR
// ──────────────────────────────────────────────────────

export function generateSchedule(ctx: EngineContext): EngineResult {
    const positionGroups = buildPositionGroups(ctx);
    const subgroups = buildSubgroupsFor24hs(ctx, positionGroups);
    const empToPosition: Record<string, string> = {};
    for (const [posName, ids] of Object.entries(positionGroups)) ids.forEach(id => { empToPosition[id] = posName; });
    const openingSlotByEmp = resolveOpeningSlots(ctx, subgroups);
    const empSubgroup = new Map<string, string[]>();
    subgroups.forEach(sub => sub.forEach(id => empSubgroup.set(id, sub)));

    // Rotadores ceden bandas fijas de otros del subgrupo (1M+1T+1N+1F por día).
    type FixedBandRef = { fixedEmpId: string; fixedBand: string; fixedOpening: number };
    const rotatorFixedBands = new Map<string, FixedBandRef[]>();
    for (const subGroup of subgroups) {
        const fixedList: FixedBandRef[] = [];
        for (const empId of subGroup) {
            const fb = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            if (fb && WORK_BANDS.has(fb) && openingSlotByEmp[empId] !== undefined) {
                fixedList.push({
                    fixedEmpId: empId,
                    fixedBand: fb,
                    fixedOpening: openingSlotByEmp[empId],
                });
            }
        }
        if (fixedList.length === 0) continue;
        for (const empId of subGroup) {
            if (fixedList.some((f) => f.fixedEmpId === empId)) continue;
            rotatorFixedBands.set(empId, fixedList);
        }
    }

    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31 ? ctx.cctCutoffDay : 25;
    const assignments: EngineAssignment[] = [];
    const employeeMonthlyHours: Record<string, number> = {};
    const primaryShiftByEmp: Record<string, string | null> = {};
    ctx.employees.forEach(e => { employeeMonthlyHours[e.id] = 0; });

    for (const emp of ctx.employees) {
        const opening = openingSlotByEmp[emp.id];
        const posName = empToPosition[emp.id] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;

        // ── Puestos no-24hs (EN, RO, L-V): turno fijo cada día activo ──
        if (opening === undefined) {
            if (is24hs(pos)) continue; // 24hs sin subgrupo → idle (no alcanza qty)
            primaryShiftByEmp[emp.id] = null;
            ctx.daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                if (ctx.absences[emp.id]?.has(dateStr)) return;
                const dayLetter = getDayLetter(dateStr);
                if (positionIsActiveOn(pos, dayLetter)) {
                    const shiftCode = String(pos.shifts?.[0]?.code || 'M').toUpperCase();
                    const meta = shiftMeta(pos, shiftCode, ctx.codeHoursHint);
                    assignments.push({ empId: emp.id, dateStr, positionName: posName, code: shiftCode, name: meta.name, hours: meta.hours, startTime: meta.startTime, ...(meta.endTime ? { endTime: meta.endTime } : {}) });
                    employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
                } else {
                    assignments.push({ empId: emp.id, dateStr, positionName: '', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true });
                }
            });
            continue;
        }

        // ── Puestos 24hs: ciclo CYCLE_24_MTN desde opening slot ──
        const subGroup = empSubgroup.get(emp.id) ?? [];
        const isRetFloater = subGroup.indexOf(emp.id) >= 4;

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = getDateKey(day);
            if (ctx.absences[emp.id]?.has(dateStr)) return;
            const dayLetter = getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) return;

            const rawCode = CYCLE_24_MTN[(opening + di) % 24] as string;
            const ownFixedBand = ctx.defaultShiftByEmp?.[emp.id]?.toUpperCase();
            let rawCodeFinal: string;

            if (ownFixedBand && WORK_BANDS.has(ownFixedBand) && WORK_BANDS.has(rawCode)) {
                rawCodeFinal = ownFixedBand;
            } else {
                const fixedList = rotatorFixedBands.get(emp.id) ?? [];
                let displaced = false;
                for (const f of fixedList) {
                    if (rawCode !== f.fixedBand || !WORK_BANDS.has(rawCode)) continue;
                    const naturalOfFixed = CYCLE_24_MTN[(f.fixedOpening + di) % 24] as string;
                    rawCodeFinal = WORK_BANDS.has(naturalOfFixed) ? naturalOfFixed : rawCode;
                    displaced = true;
                    break;
                }
                if (!displaced) rawCodeFinal = rawCode;
            }

            const isExcludedDay = !isRetFloater && WORK_BANDS.has(rawCodeFinal) && !!pos.excludedDates?.includes(dateStr);
            const code = isExcludedDay ? 'RET' : (isRetFloater && WORK_BANDS.has(rawCodeFinal)) ? 'RET' : rawCodeFinal;
            if (di === 0) primaryShiftByEmp[emp.id] = (!isRetFloater && WORK_BANDS.has(rawCodeFinal)) ? rawCodeFinal : null;

            const meta = shiftMeta(pos, isExcludedDay ? rawCode : code, ctx.codeHoursHint);
            const isFranco = code === 'F';
            assignments.push({
                empId: emp.id, dateStr, positionName: (isFranco || code === 'RET') ? '' : posName,
                code, name: meta.name, hours: meta.hours, startTime: meta.startTime,
                ...(code !== 'RET' && meta.endTime ? { endTime: meta.endTime } : {}),
                ...(isFranco ? { isFranco: true } : {}),
            });

            if (BILLABLE.has(code)) {
                employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
            }
        });
    }

    patchRetForAbsences(ctx, assignments, openingSlotByEmp, subgroups, empToPosition, employeeMonthlyHours, cutoffDay);

    // RETs que no cubrieron ausencias → mostrar banda natural (cronograma limpio)
    for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        if (a.code !== 'RET') continue;
        const opening = openingSlotByEmp[a.empId];
        if (opening === undefined) continue;
        const di = ctx.daysInMonth.findIndex(d => getDateKey(d) === a.dateStr);
        if (di < 0) continue;
        const naturalCode = CYCLE_24_MTN[(opening + di) % 24] as string;
        if (!WORK_BANDS.has(naturalCode)) continue;
        const posNameR = empToPosition[a.empId] ?? '';
        const posR = ctx.positions.find(p => p.positionName === posNameR);
        if (!posR) continue;
        const meta = shiftMeta(posR, naturalCode, ctx.codeHoursHint);
        assignments[i] = { empId: a.empId, dateStr: a.dateStr, positionName: posNameR, code: naturalCode, name: meta.name, hours: meta.hours, startTime: meta.startTime, ...(meta.endTime ? { endTime: meta.endTime } : {}) };
        employeeMonthlyHours[a.empId] = (employeeMonthlyHours[a.empId] || 0) + meta.hours;
    }

    const totalBillableHours = Object.values(employeeMonthlyHours).reduce((s, h) => s + h, 0);
    const slaTarget = Math.max(0, ctx.slaVendidas || 0);
    const slaDeficitRemaining = Math.max(0, Math.round((slaTarget - totalBillableHours) * 10) / 10);

    return {
        assignments,
        stats: {
            totalBillableHours,
            targetHours: slaTarget,
            slaHoursClosed: slaDeficitRemaining <= 0.5,
            slaDeficitRemaining,
            employeeMonthlyHours,
            idleEmployeeIds: ctx.employees.filter(e => openingSlotByEmp[e.id] === undefined && !ctx.positions.some(p => p.positionName === (empToPosition[e.id] ?? '') && !is24hs(p))).map(e => e.id),
            positionGroups,
            openingSlotByEmp,
            primaryShiftByEmp,
        },
    };
}

// ──────────────────────────────────────────────────────
// FASE 5: VERIFICACIÓN DE COBERTURA
// Compara slots requeridos por el SLA vs slots generados.
// Un slot = (día, puesto, banda). El resultado es cuántos quedaron sin cubrir.
// ──────────────────────────────────────────────────────

export interface CoverageReport {
    totalSlots: number;
    coveredSlots: number;
    uncoveredSlots: number;
    coverageRatio: number;
    slaHoursClosed: boolean;
    billableHours: number;
    slaVendidas: number;
    uncoveredByDay: Record<string, Array<{ positionName: string; shiftCode: string; missing: number }>>;
}

const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'NR']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);

export function verifyCoverage(ctx: EngineContext, assignments: EngineAssignment[]): CoverageReport {
    // Construir demanda: por cada día × puesto × banda requerida
    const demand: Array<{ dateStr: string; positionName: string; shiftCode: string; qty: number }> = [];
    ctx.daysInMonth.forEach(d => {
        const dateStr = getDateKey(d);
        const dayLetter = getDayLetter(dateStr);
        ctx.positions.forEach(pos => {
            if (pos.excludedDates?.includes(dateStr)) return;
            const qty = Number(pos.qty) || 0;
            if (!qty) return;
            if (!positionIsActiveOn(pos, dayLetter)) return;
            const shifts = (pos.shifts || []).filter(s => {
                const c = String(s.code || '').toUpperCase();
                return c && !NON_BILLABLE.has(c) && !ABSENCE_CODES.has(c) &&
                    (!Array.isArray(s.days) || s.days.length === 0 || s.days.includes(dayLetter));
            });
            for (const sh of shifts) {
                demand.push({ dateStr, positionName: pos.positionName, shiftCode: String(sh.code || '').toUpperCase(), qty });
            }
        });
    });

    // Contar asignaciones reales (D12≡M, N12≡N para matching)
    const normCode = (c: string) => c === 'D12' ? 'M' : c === 'N12' ? 'N' : c;
    const realCount: Record<string, number> = {};
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (!c || NON_BILLABLE.has(c) || ABSENCE_CODES.has(c) || !a.positionName) continue;
        const k = `${a.dateStr}__${a.positionName}__${normCode(c)}`;
        realCount[k] = (realCount[k] || 0) + 1;
    }

    let totalSlots = 0, coveredSlots = 0;
    const uncoveredByDay: Record<string, Array<{ positionName: string; shiftCode: string; missing: number }>> = {};
    for (const { dateStr, positionName, shiftCode, qty } of demand) {
        totalSlots += qty;
        const k = `${dateStr}__${positionName}__${normCode(shiftCode)}`;
        const assigned = realCount[k] || 0;
        const covered = Math.min(assigned, qty);
        coveredSlots += covered;
        if (covered < qty) {
            if (!uncoveredByDay[dateStr]) uncoveredByDay[dateStr] = [];
            uncoveredByDay[dateStr].push({ positionName, shiftCode, missing: qty - covered });
        }
    }

    const totalBillableHours = assignments.reduce((s, a) => {
        const c = String(a.code || '').toUpperCase();
        return s + (NON_BILLABLE.has(c) || ABSENCE_CODES.has(c) ? 0 : (a.hours || 0));
    }, 0);

    return {
        totalSlots, coveredSlots, uncoveredSlots: totalSlots - coveredSlots,
        coverageRatio: totalSlots > 0 ? coveredSlots / totalSlots : 1,
        slaHoursClosed: totalBillableHours >= ctx.slaVendidas - 0.5,
        billableHours: totalBillableHours,
        slaVendidas: ctx.slaVendidas,
        uncoveredByDay,
    };
}
