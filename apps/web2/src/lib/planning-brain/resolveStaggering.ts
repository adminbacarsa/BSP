import type { WorkBand } from './employeeScheduleState';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type DayCode = 'M' | 'T' | 'N' | 'D12' | 'N12' | 'F' | 'FF' | 'FP' | 'RET';

export interface GuardDayAssignment {
  code: DayCode;
  hours: number;
}

export interface GuardMonthSchedule {
  empId: string;
  puesto: string;
  days: GuardDayAssignment[];
  streakBeforeMonth: number;
  rachaMaxDays: number;
}

export interface PuestoRequirement {
  puesto: string;
  bandRequirements: Partial<Record<WorkBand, number>>;
}

export interface StaggeringAdjustment {
  empId: string;
  puesto: string;
  fromDay: number;
  toDay: number;
  coveredBand: WorkBand;
  reason: string;
}

export interface StaggeringViolation {
  empId: string;
  day: number;
  rule: 'streak_max' | 'streak_min_for_franco';
  message: string;
}

export interface StaggeringResult {
  adjustments: StaggeringAdjustment[];
  violations: StaggeringViolation[];
  coverageAfter: Record<number, Partial<Record<WorkBand, number>>>;
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PURE_BANDS = new Set<DayCode>(['M', 'T', 'N']);
const REST_CODES = new Set<DayCode>(['F', 'FF', 'FP']);
const WORK_CODES = new Set<DayCode>(['M', 'T', 'N', 'D12', 'N12', 'RET']);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isBand(code: DayCode): code is WorkBand {
  return PURE_BANDS.has(code);
}

/** Días de trabajo consecutivos desde el inicio del mes hasta dayIdx (0-indexed, exclusivo). */
function streakFromStart(days: GuardDayAssignment[], dayIdx: number): number {
  let count = 0;
  for (let i = dayIdx - 1; i >= 0; i--) {
    if (WORK_CODES.has(days[i].code)) count++;
    else if (REST_CODES.has(days[i].code)) break;
  }
  return count;
}

/** Cobertura por día 1-indexed → banda → cantidad, usando los schedules dados. */
function buildCoverage(
  schedules: GuardMonthSchedule[],
  daysInMonth: number,
  overrides: Map<string, GuardDayAssignment[]>,
): Record<number, Partial<Record<WorkBand, number>>> {
  const cov: Record<number, Partial<Record<WorkBand, number>>> = {};
  for (let d = 1; d <= daysInMonth; d++) cov[d] = {};

  for (const g of schedules) {
    const days = overrides.get(g.empId) ?? g.days;
    for (let i = 0; i < daysInMonth; i++) {
      const code = days[i]?.code;
      if (!code || !isBand(code)) continue;
      const day = i + 1;
      const band = code as WorkBand;
      cov[day][band] = (cov[day][band] ?? 0) + 1;
    }
  }
  return cov;
}

/** Aplica un offset de días al FF de un guardia, devuelve nuevo array de days. */
function applyOffset(
  days: GuardDayAssignment[],
  ffStartIdx: number,  // 0-indexed, primer día del bloque FF original
  offset: number,      // +1, +2, -1, -2
  workCode: DayCode,
  daysInMonth: number,
): GuardDayAssignment[] | null {
  if (offset > 0) {
    const rebuilt = [...days];
    for (let k = 0; k < offset; k++) {
      rebuilt[ffStartIdx + k] = { code: workCode, hours: 8 };
    }
    for (let k = 0; k < 2; k++) {
      const idx = ffStartIdx + offset + k;
      if (idx >= daysInMonth) return null;
      rebuilt[idx] = { code: 'FF', hours: 0 };
    }
    return rebuilt;
  } else {
    // adelantar FF: el guardia entra al FF |offset| días antes
    const newFFStart = ffStartIdx + offset; // offset es negativo
    if (newFFStart < 0) return null;
    const rebuilt = [...days];
    // los días newFFStart..ffStartIdx-1 pasan a FF (eran trabajo)
    for (let k = newFFStart; k < ffStartIdx; k++) {
      rebuilt[k] = { code: 'FF', hours: 0 };
    }
    // los días que eran FF (ffStartIdx, ffStartIdx+1) ahora son trabajo
    for (let k = 0; k < Math.abs(offset); k++) {
      const idx = ffStartIdx + 2 + k;
      if (idx >= daysInMonth) return null;
      rebuilt[idx] = { code: workCode, hours: 8 };
    }
    return rebuilt;
  }
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────────────────────

export function resolveStaggering(
  schedules: GuardMonthSchedule[],
  requirements: PuestoRequirement[],
  daysInMonth: number,
): StaggeringResult {
  const adjustments: StaggeringAdjustment[] = [];
  const violations: StaggeringViolation[] = [];

  // overrides acumulados: empId → days modificados
  const overrides = new Map<string, GuardDayAssignment[]>();

  // índice rápido puesto → guardias
  const byPuesto = new Map<string, GuardMonthSchedule[]>();
  for (const g of schedules) {
    if (!byPuesto.has(g.puesto)) byPuesto.set(g.puesto, []);
    byPuesto.get(g.puesto)!.push(g);
  }

  for (const req of requirements) {
    const guards = byPuesto.get(req.puesto) ?? [];

    for (let day = 1; day <= daysInMonth; day++) {
      const idx = day - 1;

      for (const [bandStr, needed] of Object.entries(req.bandRequirements)) {
        const band = bandStr as WorkBand;
        if (!needed) continue;

        const cov = buildCoverage(schedules, daysInMonth, overrides);
        const actual = cov[day]?.[band] ?? 0;
        if (actual >= needed) continue;

        // Candidatos para retrasar FF (+1, +2): guardia en banda B el día D, FF en día D
        // es decir: days[idx].code === band y days[idx+1] o days[idx] no... espera:
        // "entra en FF en día D" → days[idx] es el primer día de FF, y el guardia
        // estaba trabajando band el día anterior. Pero necesitamos cubrir día D,
        // así que buscamos guardias cuyo FF empieza en día D y que trabajaban B el día D-1.
        //
        // Ajuste +offset: el guardia trabaja offset días más (días D, D+1,...) antes del FF.
        // Para cubrir el hueco en día D con offset=+1: guardia trabaja día D en banda B → FF se va a D+1.

        let resolved = false;

        // Intento 1: retrasar FF (+1 o +2) en guardias cuyo FF empieza en día D
        for (const delta of [1, 2]) {
          if (resolved) break;
          for (const g of guards) {
            const gDays = overrides.get(g.empId) ?? g.days;
            if (!REST_CODES.has(gDays[idx]?.code)) continue; // no está en FF ese día

            // verificar que es el PRIMER día de un bloque FF (el anterior era trabajo)
            if (idx > 0 && REST_CODES.has(gDays[idx - 1]?.code)) continue;

            // banda del guardia justo antes del FF
            const prevCode = idx > 0 ? gDays[idx - 1]?.code : undefined;
            if (!prevCode || !isBand(prevCode) || prevCode !== band) continue;
            if (!PURE_BANDS.has(gDays[idx]?.code === 'FF' ? 'M' : gDays[idx]?.code ?? 'F')) {
              // solo ajustamos si la banda es pura M/T/N
            }
            if (!PURE_BANDS.has(prevCode)) continue;

            // CCT: racha actual = streakBeforeMonth + días trabajados hasta idx (exclusivo)
            const inMonthStreak = streakFromStart(gDays, idx);
            const totalStreak = g.streakBeforeMonth + inMonthStreak + delta;
            if (totalStreak > g.rachaMaxDays) {
              violations.push({
                empId: g.empId,
                day,
                rule: 'streak_max',
                message: `retrasar FF +${delta} días superaría racha: ${totalStreak} > ${g.rachaMaxDays}`,
              });
              continue;
            }

            // construir nuevo schedule
            const newDays = applyOffset(gDays, idx, delta, prevCode, daysInMonth);
            if (!newDays) continue;

            overrides.set(g.empId, newDays);
            adjustments.push({
              empId: g.empId,
              puesto: g.puesto,
              fromDay: day,
              toDay: day + delta,
              coveredBand: band,
              reason: `cubre déficit de ${band} día ${day} retrasando FF ${delta} día(s)`,
            });
            resolved = true;
            break;
          }
        }

        if (resolved) continue;

        // Intento 2: adelantar FF (-1) en guardias cuyo FF empieza en día D+1
        const nextIdx = idx + 1;
        if (nextIdx < daysInMonth) {
          for (const g of guards) {
            const gDays = overrides.get(g.empId) ?? g.days;
            // FF empieza en día D+1 (nextIdx)
            if (!REST_CODES.has(gDays[nextIdx]?.code)) continue;
            if (nextIdx > 0 && REST_CODES.has(gDays[nextIdx - 1]?.code)) continue;

            // banda del guardia antes del FF
            const prevCode = gDays[nextIdx - 1]?.code;
            if (!prevCode || !isBand(prevCode) || prevCode !== band) continue;
            if (!PURE_BANDS.has(prevCode)) continue;

            // CCT: necesita racha completa para poder adelantar el franco
            const inMonthStreak = streakFromStart(gDays, nextIdx);
            const totalStreak = g.streakBeforeMonth + inMonthStreak;
            if (totalStreak < g.rachaMaxDays) {
              violations.push({
                empId: g.empId,
                day,
                rule: 'streak_min_for_franco',
                message: `adelantar FF -1 día no cumple racha mínima: ${totalStreak} < ${g.rachaMaxDays}`,
              });
              continue;
            }

            const newDays = applyOffset(gDays, nextIdx, -1, prevCode, daysInMonth);
            if (!newDays) continue;

            overrides.set(g.empId, newDays);
            adjustments.push({
              empId: g.empId,
              puesto: g.puesto,
              fromDay: day + 1,
              toDay: day,
              coveredBand: band,
              reason: `cubre déficit de ${band} día ${day} adelantando FF 1 día`,
            });
            resolved = true;
            break;
          }
        }
      }
    }
  }

  const coverageAfter = buildCoverage(schedules, daysInMonth, overrides);

  return { adjustments, violations, coverageAfter };
}
