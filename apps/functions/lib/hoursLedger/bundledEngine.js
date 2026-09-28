var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/hours-ledger/engineEntry.ts
var engineEntry_exports = {};
__export(engineEntry_exports, {
  buildLedgerMonth: () => buildLedgerMonth,
  planHoursOf: () => planHoursOf
});
module.exports = __toCommonJS(engineEntry_exports);

// apps/web2/src/lib/servicios/slaPositionActive.ts
function isPositionActiveOnDate(pos, dateStr2) {
  const st = String(pos?.status || "ACTIVE").toUpperCase();
  if (st !== "INACTIVE" && st !== "INACTIVO") return true;
  const from = String(pos?.inactiveFrom || "").slice(0, 10);
  if (!from) return false;
  return String(dateStr2 || "").slice(0, 10) < from;
}

// apps/web2/src/lib/servicios/encargadoPosition.ts
var ENCARGADO_COVERAGE_TYPE = "encargado";
var ENCARGADO_SHIFT_CODE = "ENC";
function hoursBetweenHm(start, end) {
  const [h1, m1] = (start || "00:00").slice(0, 5).split(":").map(Number);
  const [h2, m2] = (end || "00:00").slice(0, 5).split(":").map(Number);
  let s = (Number(h1) || 0) * 60 + (Number(m1) || 0);
  let e = (Number(h2) || 0) * 60 + (Number(m2) || 0);
  if (e <= s) e += 1440;
  return Math.round((e - s) / 60 * 100) / 100;
}
function isEncargadoCoverageType(coverageType) {
  return String(coverageType || "").toLowerCase().trim() === ENCARGADO_COVERAGE_TYPE;
}
function isEncargadoPosition(pos) {
  if (!pos) return false;
  if (isEncargadoCoverageType(pos.coverageType)) return true;
  return String(pos.code || "").toUpperCase() === ENCARGADO_SHIFT_CODE;
}

// apps/web2/src/lib/servicios/eventosPosition.ts
var EVENTOS_COVERAGE_TYPE = "eventos";
var EVENTOS_SHIFT_CODE = "EVT";
function isEventosCoverageType(coverageType) {
  return String(coverageType || "").toLowerCase().trim() === EVENTOS_COVERAGE_TYPE;
}
function isEventosPosition(pos) {
  if (!pos) return false;
  if (isEventosCoverageType(pos.coverageType)) return true;
  return String(pos.code || "").toUpperCase() === EVENTOS_SHIFT_CODE;
}

// apps/web2/src/lib/servicios/auxiliaryPositionPolicy.ts
var WORK_PATTERN_OPTIONS = [
  { id: "6x2", label: "6\xD72 (6 trabajo + 2 franco)", workDays: 6, cycleDays: 8 },
  { id: "5x1", label: "5\xD71 (5 trabajo + 1 franco)", workDays: 5, cycleDays: 6 },
  { id: "6x1", label: "6\xD71 (6 trabajo + 1 franco)", workDays: 6, cycleDays: 7 },
  { id: "4x12", label: "4\xD712 (4 turnos \xD7 12 h / ciclo)", workDays: 4, cycleDays: 7 }
];
function positionIncludeInSlaTotals(pos) {
  if (!pos) return true;
  if (isEventosCoverageType(pos.coverageType) || isEventosPosition(pos)) return false;
  if (typeof pos.includeInSlaTotals === "boolean") return pos.includeInSlaTotals;
  if (isEncargadoCoverageType(pos.coverageType) || isEncargadoPosition(pos)) {
    const mode = resolveEncargadoScheduleMode(pos);
    return mode === "fixed";
  }
  return true;
}
function resolveEncargadoScheduleMode(pos) {
  if (pos.encargadoScheduleMode === "rotating" || pos.encargadoScheduleMode === "fixed") {
    return pos.encargadoScheduleMode;
  }
  return "fixed";
}
function resolveEncargadoHoursPerDay(pos) {
  const fromField = Number(pos.workPatternHoursPerDay);
  if (Number.isFinite(fromField) && fromField > 0) return fromField;
  const enc = (pos.allowedShiftTypes || []).find((s) => String(s.code || "").toUpperCase() === "ENC");
  if (enc?.hours && Number(enc.hours) > 0) return Number(enc.hours);
  if (enc?.startTime && enc?.endTime) {
    const h = hoursBetweenHm(String(enc.startTime), String(enc.endTime));
    if (h > 0) return h;
  }
  return 8;
}
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function countDaysInRange(start, end) {
  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 864e5) + 1;
}
function parseYmd(s) {
  const raw = String(s || "").trim().slice(0, 10);
  const [y, mo, d] = raw.split("-").map(Number);
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function overlapRange(contractStart, contractEnd, year, month) {
  const mStart = new Date(year, month, 1);
  const mEnd = new Date(year, month + 1, 0);
  const cStart = parseYmd(contractStart);
  const cEnd = parseYmd(contractEnd);
  if (!cStart || !cEnd) return null;
  const from = cStart > mStart ? cStart : mStart;
  const to = cEnd < mEnd ? cEnd : mEnd;
  if (from > to) return null;
  return { from, to, days: countDaysInRange(from, to) };
}
function workShiftsInMonthForPattern(patternId, year, month, effectiveDaysInMonth) {
  const def = WORK_PATTERN_OPTIONS.find((p) => p.id === patternId) || WORK_PATTERN_OPTIONS[0];
  const dim = effectiveDaysInMonth ?? daysInMonth(year, month);
  const cycles = dim / def.cycleDays;
  return Math.round(cycles * def.workDays * 10) / 10;
}
function encargadoRotatingPatternMonthHours(pos, contractStart, contractEnd, year, month) {
  const range = overlapRange(contractStart, contractEnd, year, month);
  if (!range) return 0;
  const pattern = pos.workPattern || "6x2";
  const shifts = workShiftsInMonthForPattern(pattern, year, month, range.days);
  const hDay = resolveEncargadoHoursPerDay(pos);
  return Math.round(shifts * hDay * 10) / 10;
}

// apps/web2/src/lib/servicios/paxBoostRanges.ts
function normalizeYmd(val) {
  return String(val || "").trim().slice(0, 10);
}
function paxBoostDeltaForDate(pos, dateStr2) {
  const d = normalizeYmd(dateStr2);
  if (!d || !pos?.paxBoostRanges?.length) return 0;
  let boost = 0;
  for (const r of pos.paxBoostRanges) {
    const from = normalizeYmd(r.from);
    const to = normalizeYmd(r.to || r.from);
    if (!from) continue;
    if (d >= from && d <= to) boost += Math.max(0, Math.floor(Number(r.delta) || 0));
  }
  return boost;
}

// apps/web2/src/lib/servicios/slaHoursCalculator.ts
var AR_FERIADOS_FIJOS = /* @__PURE__ */ new Set([
  "01-01",
  // Año Nuevo
  "03-24",
  // Día Nacional de la Memoria
  "04-02",
  // Veteranos y Caídos en Malvinas
  "05-01",
  // Día del Trabajador
  "05-25",
  // Revolución de Mayo
  "06-20",
  // Paso a la Inmortalidad del Gral. Belgrano (Día de la Bandera)
  "07-09",
  // Día de la Independencia
  "12-08",
  // Inmaculada Concepción de María
  "12-25"
  // Navidad
]);
var AR_FERIADOS_VARIABLES = {
  "2024": [
    "2024-02-12",
    "2024-02-13",
    // Carnaval
    "2024-03-29",
    // Viernes Santo
    "2024-04-01",
    // Feriado puente
    "2024-06-21",
    // Feriado puente
    "2024-08-19",
    // San Martín (trasladado, 17/8 era sábado)
    "2024-10-11",
    // Diversidad Cultural (trasladado)
    "2024-11-18"
    // Soberanía Nacional (trasladado)
  ],
  "2025": [
    "2025-03-03",
    "2025-03-04",
    // Carnaval
    "2025-03-24",
    // (ya incluido en fijos)
    "2025-04-18",
    // Viernes Santo
    "2025-05-02",
    // Feriado puente
    "2025-08-15",
    // Feriado puente
    "2025-08-18",
    // San Martín (trasladado, 17/8 era domingo)
    "2025-10-13",
    // Diversidad Cultural (trasladado, 12/10 era domingo)
    "2025-11-21",
    // Feriado puente
    "2025-11-24"
    // Soberanía Nacional
  ],
  "2026": [
    "2026-02-16",
    "2026-02-17",
    // Carnaval
    "2026-04-03",
    // Viernes Santo (Pascua 5/4/2026)
    "2026-08-17",
    // San Martín (17/8 es lunes, no se traslada)
    "2026-10-12",
    // Diversidad Cultural (12/10 es lunes, no se traslada)
    "2026-11-23"
    // Soberanía Nacional (cuarto lunes de noviembre)
  ],
  "2027": [
    "2027-02-01",
    "2027-02-02",
    // Carnaval
    "2027-03-26",
    // Viernes Santo (Pascua 28/3/2027)
    "2027-08-16",
    // San Martín (tercer lunes de agosto)
    "2027-10-11",
    // Diversidad Cultural (trasladado)
    "2027-11-22"
    // Soberanía Nacional (cuarto lunes de noviembre)
  ]
};
function isArgentineHoliday(dateStr2) {
  const norm = (dateStr2 || "").trim().slice(0, 10);
  if (norm.length < 10) return false;
  const mmdd = norm.slice(5);
  if (AR_FERIADOS_FIJOS.has(mmdd)) return true;
  const year = norm.slice(0, 4);
  return (AR_FERIADOS_VARIABLES[year] ?? []).includes(norm);
}
var WEEK_DAY_CODES = ["D", "L", "M", "X", "J", "V", "S"];
var STANDARD_SHIFT_VARIANTS = {
  M: { code: "M", name: "Ma\xF1ana", startTime: "07:00", endTime: "15:00", hours: 8 },
  T: { code: "T", name: "Tarde", startTime: "15:00", endTime: "23:00", hours: 8 },
  N: { code: "N", name: "Noche", startTime: "23:00", endTime: "07:00", hours: 8 },
  D12: { code: "D12", name: "Diurno 12h", startTime: "07:00", endTime: "19:00", hours: 12 },
  N12: { code: "N12", name: "Nocturno 12h", startTime: "19:00", endTime: "07:00", hours: 12 }
};
function parseYmdToLocalDate(dateStr2) {
  const norm = (dateStr2 || "").trim().slice(0, 10);
  const [y, m, d] = norm.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}
function analyzeShiftComposition(start, end) {
  const [h1, m1] = start.split(":").map(Number);
  const [h2, m2] = end.split(":").map(Number);
  let s = h1 * 60 + m1;
  let e = h2 * 60 + m2;
  if (e <= s) e += 1440;
  const durationMin = e - s;
  const NIGHT = [[0, 360], [1260, 1440]];
  let nightMin = 0;
  for (const [a, b] of NIGHT) {
    nightMin += Math.max(0, Math.min(e, b) - Math.max(s, a));
    if (e > 1440) {
      const wrap = e - 1440;
      nightMin += Math.max(0, Math.min(wrap, b) - a);
    }
  }
  return {
    total: parseFloat((durationMin / 60).toFixed(2)),
    night: parseFloat((nightMin / 60).toFixed(2)),
    day: parseFloat(((durationMin - nightMin) / 60).toFixed(2))
  };
}
function computePositionDayComposition(pos, dayCode, dateStr2, skipShiftCodes, paxExcludeByCode) {
  let dayTotal = 0;
  let dayNight = 0;
  if (isEventosPosition(pos)) return { dayTotal: 0, dayNight: 0 };
  if (isEncargadoPosition(pos) && !positionIncludeInSlaTotals(pos)) return { dayTotal: 0, dayNight: 0 };
  if (isEncargadoPosition(pos) && resolveEncargadoScheduleMode(pos) === "rotating") {
    return { dayTotal: 0, dayNight: 0 };
  }
  const activeDays = pos.activeDays?.length ? pos.activeDays : [...WEEK_DAY_CODES];
  if (!activeDays.includes(dayCode)) return { dayTotal: 0, dayNight: 0 };
  const skip = skipShiftCodes instanceof Set ? skipShiftCodes : new Set((skipShiftCodes || []).map((c) => String(c || "").toUpperCase()));
  const cutMap = {};
  for (const [code, n] of Object.entries(paxExcludeByCode || {})) {
    const c = String(code || "").toUpperCase();
    const pax = Math.floor(Number(n) || 0);
    if (c && pax > 0) cutMap[c] = pax;
  }
  const hasPaxCuts = Object.keys(cutMap).length > 0;
  const paxBoost = paxBoostDeltaForDate(pos, dateStr2);
  const hasPerShiftQty = (pos.allowedShiftTypes || []).some((s) => s.quantity != null) || hasPaxCuts;
  const addVariant = (v) => {
    const code = String(v.code || "").toUpperCase();
    if (code && skip.has(code)) return;
    const baseQ = hasPerShiftQty ? v.quantity ?? pos.quantity ?? 1 : 1;
    const q = Math.max(0, Math.floor(Number(baseQ) || 1) - (cutMap[code] || 0) + paxBoost);
    if (q <= 0) return;
    const timeBlocks = Array.isArray(v.blocks) && v.blocks.length >= 2 ? v.blocks : [{ startTime: v.startTime, endTime: v.endTime }];
    for (const b of timeBlocks) {
      const comp = analyzeShiftComposition(b.startTime, b.endTime);
      dayTotal += comp.total * q;
      dayNight += comp.night * q;
    }
  };
  if (pos.coverageType === "24hs") {
    const shifts = pos.allowedShiftTypes || [];
    const m = shifts.find((s) => s.code === "M");
    const t = shifts.find((s) => s.code === "T");
    const n = shifts.find((s) => s.code === "N");
    const d12 = shifts.find((s) => s.code === "D12");
    const n12 = shifts.find((s) => s.code === "N12");
    if (m && t && n) {
      addVariant(m);
      addVariant(t);
      addVariant(n);
    } else if (d12 && n12) {
      addVariant(d12);
      addVariant(n12);
    } else {
      addVariant(STANDARD_SHIFT_VARIANTS.D12);
      addVariant(STANDARD_SHIFT_VARIANTS.N12);
    }
  } else if (pos.coverageType === "12hs_diurno") {
    addVariant(STANDARD_SHIFT_VARIANTS.D12);
  } else if (pos.coverageType === "12hs_nocturno") {
    addVariant(STANDARD_SHIFT_VARIANTS.N12);
  } else if (pos.coverageType === "custom" || pos.coverageType === "encargado") {
    (pos.allowedShiftTypes || []).forEach((shift) => {
      const sd = shift.specificDates;
      if (Array.isArray(sd) && sd.length > 0) {
        if (dateStr2 && sd.includes(dateStr2)) addVariant(shift);
        return;
      }
      if (shift.days?.length) {
        if (shift.days.includes(dayCode)) addVariant(shift);
      } else {
        addVariant(shift);
      }
    });
  }
  return { dayTotal, dayNight };
}
function calculateMonthlyBreakdown(positions, startStr, endStr, excludedDates) {
  const startNorm = (startStr || "").trim().slice(0, 10);
  const endNorm = (endStr || "").trim().slice(0, 10);
  if (!startNorm || !endNorm || positions.length === 0) return [];
  let current = parseYmdToLocalDate(startNorm);
  const end = parseYmdToLocalDate(endNorm);
  if (!current || !end) return [];
  const slaExcluded = new Set(excludedDates || []);
  const monthAccumulator = {};
  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthKey2 = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthName = current.toLocaleString("es-ES", { month: "long", year: "numeric" });
    const dayIdx = current.getDay();
    const dayCode = WEEK_DAY_CODES[dayIdx];
    const isWeekend = dayIdx === 0 || dayIdx === 6;
    const dateStr2 = `${year}-${String(month + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
    const isHoliday = isArgentineHoliday(dateStr2);
    if (!monthAccumulator[monthKey2]) {
      monthAccumulator[monthKey2] = {
        monthKey: monthKey2,
        name: monthName.charAt(0).toUpperCase() + monthName.slice(1),
        days: 0,
        totalHours: 0,
        nightHours: 0,
        weekendHours: 0,
        holidayHours: 0
      };
    }
    monthAccumulator[monthKey2].days++;
    if (!slaExcluded.has(dateStr2)) {
      positions.forEach((pos) => {
        if (!isPositionActiveOnDate(pos, dateStr2)) return;
        if (pos.excludedDates?.includes(dateStr2)) return;
        const skipCodes = pos.excludedShiftDates?.[dateStr2] || [];
        const paxCuts = pos.excludedShiftPaxDates?.[dateStr2] || {};
        const { dayTotal, dayNight } = computePositionDayComposition(pos, dayCode, dateStr2, skipCodes, paxCuts);
        const hasPerShiftQty = (pos.allowedShiftTypes || []).some((s) => s.quantity != null) || Object.keys(paxCuts).length > 0;
        const q = hasPerShiftQty ? 1 : pos.quantity || 1;
        monthAccumulator[monthKey2].totalHours += dayTotal * q;
        monthAccumulator[monthKey2].nightHours += dayNight * q;
        if (isWeekend) monthAccumulator[monthKey2].weekendHours += dayTotal * q;
        if (isHoliday) monthAccumulator[monthKey2].holidayHours += dayTotal * q;
      });
    }
    current.setDate(current.getDate() + 1);
  }
  return Object.values(monthAccumulator).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}
function calculateSlaHoursForMonth(positions, startStr, endStr, excludedDates, year, month) {
  const monthKey2 = `${year}-${String(month + 1).padStart(2, "0")}`;
  const breakdown = calculateMonthlyBreakdown(positions, startStr, endStr, excludedDates);
  const row = breakdown.find((m) => m.monthKey === monthKey2);
  let total = row?.totalHours ?? 0;
  for (const pos of positions || []) {
    if (!isEncargadoPosition(pos)) continue;
    if (!positionIncludeInSlaTotals(pos)) continue;
    if (resolveEncargadoScheduleMode(pos) !== "rotating") continue;
    total += encargadoRotatingPatternMonthHours(pos, startStr, endStr, year, month);
  }
  return {
    total: Math.round(total * 10) / 10,
    night: row?.nightHours ?? 0,
    holiday: row?.holidayHours ?? 0,
    weekend: row?.weekendHours ?? 0
  };
}
function calculateSlaHoursForDateRange(positions, startStr, endStr, excludedDates, rangeStart, rangeEnd) {
  if (!positions?.length || !startStr || !endStr) return 0;
  const contractStart = parseYmdToLocalDate(startStr);
  const contractEnd = parseYmdToLocalDate(endStr);
  if (!contractStart || !contractEnd) return 0;
  const from = rangeStart && contractStart > rangeStart ? contractStart : rangeStart || contractStart;
  const to = rangeEnd && contractEnd < rangeEnd ? contractEnd : rangeEnd || contractEnd;
  if (from > to) return 0;
  const pad2 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const breakdown = calculateMonthlyBreakdown(positions, pad2(from), pad2(to), excludedDates);
  return Math.round(breakdown.reduce((acc, m) => acc + m.totalHours, 0));
}

// apps/web2/src/lib/firestoreDates.ts
function toYyyyMmDd(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().slice(0, 10);
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "object" && value !== null) {
    const o = value;
    if (typeof o.toDate === "function") {
      const d = o.toDate();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    const sec = o.seconds ?? o._seconds;
    if (typeof sec === "number") {
      const nanos = o.nanoseconds ?? o._nanoseconds ?? 0;
      const d = new Date(sec * 1e3 + Math.floor(nanos / 1e6));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return String(value).trim().slice(0, 10);
}
function slaCoversCalendarMonth(startDate, endDate, year, month) {
  const startRaw = toYyyyMmDd(startDate);
  const endRaw = toYyyyMmDd(endDate);
  if (!startRaw && !endRaw) return false;
  const start = startRaw || "1970-01-01";
  const end = endRaw || "2099-12-31";
  const viewMonthStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const viewMonthEndStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
  return start <= viewMonthEndStr && end >= viewMonthStr;
}

// apps/web2/src/lib/slaPlanningMatch.ts
function isSlaContractActive(status) {
  const st = String(status ?? "").trim().toLowerCase();
  if (!st) return true;
  return st !== "inactive" && st !== "inactivo" && st !== "cancelled" && st !== "cancelado";
}

// apps/web2/src/lib/crm/slaObjectiveHours.ts
function normObjectiveName(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(new RegExp("\\p{Mn}", "gu"), "");
}
function objectiveKeyForSla(sla) {
  const cid = String(sla.clientId ?? "").trim();
  const oid = String(sla.objectiveId ?? "").trim();
  const name = normObjectiveName(sla.objectiveName);
  return `${cid}::${oid || name || "sin-obj"}`;
}
function objectiveKeyForClientScope(sla, canonicalClientId) {
  const oid = String(sla.objectiveId ?? "").trim();
  const name = normObjectiveName(sla.objectiveName);
  return `${canonicalClientId}::${oid || name || "sin-obj"}`;
}
function normalizeServicePositions(srv) {
  if (Array.isArray(srv.positions)) return srv.positions;
  return Object.values(srv.positions || {});
}
function slaOverlapsDateRange(sla, rangeStart, rangeEnd) {
  const sd = parseYmdToLocalDate(toYyyyMmDd(sla.startDate));
  const ed = parseYmdToLocalDate(toYyyyMmDd(sla.endDate));
  if (!sd || !ed) return false;
  const rs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const re = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  return sd <= re && ed >= rs;
}
function pickVigenteSlasForPeriod(services, rangeStart, rangeEnd, canonicalClientId) {
  const byKey = /* @__PURE__ */ new Map();
  for (const srv of services) {
    if (!isSlaContractActive(srv.status)) continue;
    const key = canonicalClientId ? objectiveKeyForClientScope(srv, canonicalClientId) : objectiveKeyForSla(srv);
    const arr = byKey.get(key) || [];
    arr.push(srv);
    byKey.set(key, arr);
  }
  const result = [];
  for (const group of byKey.values()) {
    const overlapping = group.filter((s) => slaOverlapsDateRange(s, rangeStart, rangeEnd));
    if (overlapping.length === 0) continue;
    const vigente = [...overlapping].sort(
      (a, b) => toYyyyMmDd(b.startDate).localeCompare(toYyyyMmDd(a.startDate))
    )[0];
    result.push(vigente);
  }
  return result;
}
function slaHoursForServiceInRange(srv, rangeStart, rangeEnd) {
  const positions = normalizeServicePositions(srv);
  if (!positions.length || !rangeStart || !rangeEnd) {
    if (!rangeStart && !rangeEnd) {
      return Math.round(
        calculateMonthlyBreakdown(
          positions,
          toYyyyMmDd(srv.startDate),
          toYyyyMmDd(srv.endDate),
          srv.excludedDates
        ).reduce((acc, m) => acc + m.totalHours, 0)
      );
    }
    return 0;
  }
  const rs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const re = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  const lastDayOfMonth = new Date(rs.getFullYear(), rs.getMonth() + 1, 0).getDate();
  const isFullCalendarMonth = rs.getDate() === 1 && re.getDate() === lastDayOfMonth && rs.getMonth() === re.getMonth() && rs.getFullYear() === re.getFullYear();
  if (isFullCalendarMonth && slaCoversCalendarMonth(srv.startDate, srv.endDate, rs.getFullYear(), rs.getMonth())) {
    const calculated = Math.round(
      calculateSlaHoursForMonth(
        positions,
        toYyyyMmDd(srv.startDate),
        toYyyyMmDd(srv.endDate),
        srv.excludedDates,
        rs.getFullYear(),
        rs.getMonth()
      ).total
    );
    if (calculated > 0) return calculated;
    const stored = Math.round(Number(srv.totalMonthlyHours) || 0);
    if (stored > 0) return stored;
  }
  return Math.round(
    calculateSlaHoursForDateRange(
      positions,
      toYyyyMmDd(srv.startDate),
      toYyyyMmDd(srv.endDate),
      srv.excludedDates,
      rangeStart,
      rangeEnd
    )
  );
}

// apps/web2/src/lib/planificacion/suvicoPolicy.ts
var SUVICO_POLICY = {
  REST: {
    /** Descanso mínimo entre fin de un turno e inicio del siguiente (interjornada operativa). */
    DAILY_MIN_HOURS: 10,
    /** Horas trabajadas en racha (con interjornadas de 12h entre medias) que disparan el descanso prolongado. */
    STREAK_HOURS_FOR_LONG_REST: 48,
    /** Equivalente operativo: 6 turnos × 8 h (M/T/N) o 4 turnos × 12 h (D12/N12). */
    STREAK_SHIFTS_8H: 6,
    STREAK_SHIFTS_12H: 4,
    /**
     * Descanso mínimo tras cumplir la racha de `STREAK_HOURS_FOR_LONG_REST` (horas reales
     * entre fin del último turno de la racha e inicio del siguiente). Equivale a la fórmula
     * (24 − H_salida) + 24 + H_entrada ≥ 35 en esquemas de doble franco / cierre de ciclo.
     */
    WEEKLY_MIN_REST_AFTER_STREAK_HOURS: 35,
    /** Objetivo mensual informativo (no tope duro del motor por sí solo). */
    TARGET_MONTHLY: 192,
    /** Tope duro de horas facturables por ciclo CCT (26→25). */
    MAX_MONTHLY_HARD: 200,
    /**
     * Referencia CCT: jornada máxima típica por bloque. No recorta horas en el motor ni en
     * asignaciones persistidas: la liquidación sigue el mismo criterio que siempre (campo `hours`,
     * start/end, lookups). Una capa aparte (avisos / RRHH) puede usar este valor si hace falta.
     */
    MAX_SINGLE_SHIFT_HOURS: 12
  },
  /**
   * Umbrales de alerta post-generación (suma ISO-semana de horas facturables en `writeAssignment`).
   * No sustituyen `checkRestBetweenShifts`; sirven para costo/carga.
   */
  ALERTS: {
    WEEK_BILLABLE_HOURS_DEFAULT: 48,
    /** Tope semanal con extensión 12h (contingencia: 4×8 + 2×12 = 56h). */
    MAX_WEEKLY_BILLABLE_HOURS_WITH_EXTENSION: 56,
    /** Tope operativo absoluto semanal (solo con autorización explícita). */
    MAX_WEEKLY_OPERATIONAL_HARD: 60,
    /** Puestos L–V u otros no 24×7 con jornadas largas estructurales (ej. 5×10h → 50h/semana). */
    WEEK_BILLABLE_HOURS_LIMITED_POSITION: 50,
    /** Sugerencias post-grilla: priorizar “gastar” RET entre quienes llevan menos horas facturables en el mes. */
    LOW_BILLABLE_HOURS_FOR_RET_PRIORITY: 160,
    /**
     * Proyección calendario 2026 (tabla comparativa): aviso antes del tope CCT cuando
     * un esquema típico acumularía muchas horas en ese mes (p. ej. 4+2 ~180h hacia día 20).
     */
    MONTHLY_BILLABLE_SOFT_WARN_HOURS: 180
  },
  /** Días corridos de licencia especial (referencia convenio; validación documental en RRHH). */
  LEAVES_DAYS: {
    DEATH_DIRECT: 4,
    DEATH_EXTENDED: 2,
    DEATH_INDIRECT: 1,
    BIRTH: 3,
    MARRIAGE: 10,
    MOVE: 2,
    BLOOD_DONATION: 1
  },
  STUDY: {
    DAYS_PER_EXAM: 2,
    ANNUAL_MAX_DAYS: 10,
    NOTICE_HOURS: 48
  },
  /** Límites de licencia por enfermedad/accidente (meses de goce); Art. 208 LCT + convenio. */
  SICK_LEAVE_MONTHS_PAID: {
    UNDER_5_YEARS: { withoutDependents: 3, withDependents: 6 },
    FROM_5_YEARS: { withoutDependents: 6, withDependents: 12 }
  },
  /** Tras vencimiento de licencia pagada: reserva de puesto sin goce (referencia 12 meses). */
  SICK_LEAVE_RESERVE_WITHOUT_PAY_MONTHS: 12,
  VACATION: {
    /** Para período completo: debe haberse trabajado la mitad de los días hábiles del año (regla de oro). */
    REQUIRES_HALF_WORKABLE_YEAR_FOR_FULL_BUCKET: true,
    /** Si no cumple, 1 día de vacaciones por cada N días trabajados (proporcional). */
    PRO_RATA_ONE_DAY_PER_WORKED_DAYS: 20,
    /** Días corridos según antigüedad al 31/12 (años exclusivos en el techo). */
    DAYS_BY_SENIORITY_YEARS: [
      { maxYearsExclusive: 5, calendarDays: 14 },
      { maxYearsExclusive: 10, calendarDays: 21 },
      { maxYearsExclusive: 20, calendarDays: 28 },
      { maxYearsExclusive: 999, calendarDays: 35 }
    ]
  },
  /**
   * Matriz de costos / prioridades para evolución del motor (recargos, suplementarias).
   * Los porcentajes son referencia liquidación — el motor aún no asigna por “costo doble” automático.
   */
  COST: {
    SATURDAY_AFTER_13H_SURCHARGE_PCT: 100,
    SUNDAY_SURCHARGE_PCT: 100,
    NATIONAL_HOLIDAY_SURCHARGE_PCT: 100,
    NIGHT_WINDOW: { startHour: 21, endHourExclusive: 6 },
    SUPPLEMENTARY_OVER_MONTHLY_TARGET_PCT: 50
  }
};

// apps/web2/src/lib/planificacion/restBetweenShifts.ts
var DEFAULT_MIN_REST = SUVICO_POLICY.REST.DAILY_MIN_HOURS;
var DEFAULT_STREAK_THRESHOLD = SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST;
var DEFAULT_LONG_REST = SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS;

// apps/web2/src/lib/planificacion/rotativeMtnCycle.ts
var CYCLE_24_MTN = [
  ...Array(6).fill("M"),
  ...Array(2).fill("F"),
  ...Array(6).fill("T"),
  ...Array(2).fill("F"),
  ...Array(6).fill("N"),
  ...Array(2).fill("F")
];

// apps/web2/src/lib/planificacion/autoScheduleEngineV2.ts
var V2_AGREEMENT_REST_BASE = {
  minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
  longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
  minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS
};
var TARGET_AVG_HOURS = SUVICO_POLICY.REST.TARGET_MONTHLY;
var HARD_MAX_HOURS = SUVICO_POLICY.REST.MAX_MONTHLY_HARD;

// apps/web2/src/lib/planificacion/positionCoverageUnits.ts
var PLANNING_NON_BILLABLE_CODES = /* @__PURE__ */ new Set([
  "F",
  "FF",
  "FP",
  "FT",
  "V",
  "L",
  "A",
  "E",
  "AA",
  "PG",
  "RET",
  "REF",
  "ESC",
  "SUS",
  "SGS",
  "EV"
]);

// apps/web2/src/lib/planificacion/deploymentRoles.ts
var DEPLOYMENT_SURPLUS_CODES = /* @__PURE__ */ new Set(["REF", "ESC"]);
var DEPLOYMENT_POOL_CODES = /* @__PURE__ */ new Set(["RET"]);
function isDeploymentSurplusCode(code) {
  return DEPLOYMENT_SURPLUS_CODES.has(String(code || "").toUpperCase());
}
function isDeploymentPoolCode(code) {
  return DEPLOYMENT_POOL_CODES.has(String(code || "").toUpperCase());
}
function deploymentRoleFromCode(code) {
  const c = String(code || "").toUpperCase();
  if (c === "RET") return "POOL";
  if (c === "REF") return "SURPLUS";
  if (c === "ESC") return "TRAINING";
  return "REGULAR";
}
function normalizeDeploymentShiftCode(raw) {
  return String(raw ?? "").trim().toUpperCase();
}
function isDeploymentOrPoolShift(t) {
  if (!t) return false;
  const code = normalizeDeploymentShiftCode(t.code || t.type);
  if (isDeploymentPoolCode(code) || isDeploymentSurplusCode(code)) return true;
  if (code === "RET" || code === "REF" || code === "ESC") return true;
  if (t.isRefuerzo === true || t.isEscuela === true || t.isReten === true) return true;
  const role = String(t.deploymentRole || deploymentRoleFromCode(code)).toUpperCase();
  return role === "POOL" || role === "SURPLUS" || role === "TRAINING";
}
function shiftCountsForEmployeeCronoHours(shift) {
  if (!shift || shift.isDeleted) return false;
  if (String(shift.origin || "").toUpperCase() === "OPERATIONS_COVERAGE") {
    if (shift.coverageHoursOnSource === true) return false;
    const ct = String(shift.coverageType || "").toUpperCase();
    if (ct === "EXTEND" || ct === "ADVANCE") return false;
  }
  if (isDeploymentOrPoolShift(shift)) return false;
  const code = String(shift.code || "").toUpperCase();
  const nonWork = /* @__PURE__ */ new Set(["F", "FF", "FP", "FT", "V", "L", "A", "E", "AA", "PG", "SUS", "SGS", "EV"]);
  return !nonWork.has(code);
}

// packages/ops-core/src/coverageSemantics.ts
function isOpsCoverageHoursOnSourceDoc(data) {
  if (!data) return false;
  if (data.coverageHoursOnSource === true) return true;
  const ct = String(data.coverageType || "").toUpperCase();
  if (String(data.origin || "").toUpperCase() === "OPERATIONS_COVERAGE" && (ct === "EXTEND" || ct === "ADVANCE")) {
    return true;
  }
  return false;
}

// packages/ops-core/src/coverageCandidates.ts
var COVERAGE_JOIN_TOLERANCE_MS = 30 * 60 * 1e3;
var COVERAGE_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1e3;
var AR_OFFSET_MS = 3 * 60 * 60 * 1e3;
var DAY_MS = 24 * 60 * 60 * 1e3;

// apps/web2/src/lib/crm/proformaVacancy.ts
function isSinCoberturaShift(shift) {
  if (!shift) return false;
  if (shift.isSinCobertura === true) return true;
  const eid = String(shift.employeeId ?? "").trim().toUpperCase();
  const empName = String(shift.employeeName ?? "").trim().toUpperCase();
  const status = String(shift.status ?? "").trim().toUpperCase();
  const origin = String(shift.origin ?? "").trim().toUpperCase();
  if (eid === "SIN_COBERTURA") return true;
  if (empName === "SIN COBERTURA") return true;
  if (status === "SIN_COBERTURA") return true;
  if (origin === "SIN_COBERTURA") return true;
  return false;
}
function isProformaVacancyShift(shift) {
  if (!shift) return false;
  if (isSinCoberturaShift(shift)) return true;
  if (shift.isUnassigned === true) return true;
  const eid = String(shift.employeeId ?? "").trim();
  const empName = String(shift.employeeName ?? "").trim().toUpperCase();
  if (empName === "VACANTE" || empName.startsWith("VACANTE:")) return true;
  if (eid === "VACANTE") return true;
  if ((!eid || eid === "unknown") && (empName === "VACANTE" || empName === "SIN NOMBRE")) return true;
  return false;
}

// apps/web2/src/lib/planificacion/planningScheduledHours.ts
var SHIFT_HOURS_LOOKUP = {
  M: 8,
  T: 8,
  N: 8,
  D12: 12,
  N12: 12,
  PU: 12,
  EN: 9,
  F: 0,
  FF: 0,
  FP: 0,
  FT: 0,
  V: 0,
  L: 0,
  A: 0,
  E: 0,
  AA: 0,
  PG: 0,
  RET: 0,
  REF: 0,
  RFZ: 8,
  TURA: 8,
  ESC: 0,
  C: 8,
  GU: 8
};
function parseHHmmToHours(t) {
  if (!t || typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}
function hoursBetweenClockTimes(from, to) {
  const f = parseHHmmToHours(from);
  const t = parseHHmmToHours(to);
  if (f == null || t == null) return null;
  let dur = t - f;
  if (dur <= 0) dur += 24;
  return Math.max(0, Math.min(dur, 24));
}
function shiftCoverageExtensionExtraHours(shift, slaHoursHint) {
  if (!shift || shift.isDeleted) return 0;
  const fromRaw = shift.segmentFromTime || (shift.isEarlyStart ? shift.adjustedStartTime : null);
  const toRaw = shift.segmentToTime || (shift.isExtended ? shift.adjustedEndTime || shift.extensionEndTime : null);
  const hasCoverageSegment = !!(shift.coveragePackageId || shift.coversPositionName || shift.coverageSegmentRole || shift.isExtended || shift.isEarlyStart);
  if (fromRaw && toRaw && hasCoverageSegment) {
    const from = String(fromRaw).slice(0, 5);
    const to = String(toRaw).slice(0, 5);
    const h = hoursBetweenClockTimes(from, to);
    if (h != null && h >= 0.25 && h <= 6) {
      const code = String(shift.code || "").toUpperCase();
      const codeBase = SHIFT_HOURS_LOOKUP[code] ?? slaHoursHint?.[code];
      if (codeBase !== void 0 && h >= codeBase - 0.5) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      return Math.min(h, 12);
    }
  }
  const explicit = Number(shift.extExtraHours ?? shift.extensionExtraHours);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, 12);
  }
  if (!shift.isExtended && !shift.isEarlyStart) return 0;
  if (fromRaw && toRaw) {
    const from = String(fromRaw).slice(0, 5);
    const to = String(toRaw).slice(0, 5);
    const h = hoursBetweenClockTimes(from, to);
    if (h != null && h > 0) {
      if (h < 0.25) return 0;
      const code = String(shift.code || "").toUpperCase();
      const codeBase = SHIFT_HOURS_LOOKUP[code] ?? slaHoursHint?.[code];
      if (codeBase !== void 0 && h >= codeBase - 0.5) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      if (h <= 5 && (shift.isExtended || shift.isEarlyStart)) return h;
      if (codeBase !== void 0) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      return 0;
    }
  }
  return 0;
}
function isOperationalOriginShift2(data) {
  const o = String(data?.origin || "").toUpperCase();
  if (o === "RETEN" || o === "OPERATIONS_COVERAGE" || o === "SLA_VIRTUAL") return true;
  if (data?.resolvedBy === "OPERACIONES") return true;
  return false;
}
function isPlanificadorPlannedHoursShift(t) {
  if (!t) return false;
  if (isSinCoberturaShift(t)) return false;
  if (String(t.type || "").toUpperCase() === "NOVEDAD") return false;
  const status = String(t.status || "").toLowerCase();
  if (status.includes("cancel") || status.includes("delet")) return false;
  if (isOperationalOriginShift2(t)) return false;
  if (!shiftCountsForEmployeeCronoHours(t)) return false;
  return true;
}
function instantFromShiftClock(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") {
    const d = val.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = val.seconds ?? val._seconds;
  if (typeof sec === "number" && sec > 0) return new Date(sec * 1e3);
  if (typeof val === "string") {
    const raw = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function durationHoursFromShiftTimestamps(shift) {
  const startAt = instantFromShiftClock(shift.startTime);
  const endAt = instantFromShiftClock(shift.endTime);
  if (startAt && endAt) {
    let dur = (endAt.getTime() - startAt.getTime()) / 36e5;
    if (dur <= 0) dur += 24;
    if (dur > 0 && dur <= 24) return Math.round(dur * 100) / 100;
  }
  if (typeof shift.startTime === "string" && typeof shift.endTime === "string") {
    const parseH = (t) => {
      const raw = t.trim();
      const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
      if (hm) return +hm[1] + +hm[2] / 60;
      const iso = raw.match(/T(\d{2}):(\d{2})/);
      return iso ? +iso[1] + +iso[2] / 60 : null;
    };
    const s = parseH(shift.startTime);
    const e = parseH(shift.endTime);
    if (s !== null && e !== null) {
      let dur = e - s;
      if (dur <= 0) dur += 24;
      return Math.max(0, Math.min(dur, 24));
    }
  }
  return 0;
}
function calcPlanningBillableShiftHours(shift, slaHoursHint) {
  if (!shift) return 0;
  if (isOpsCoverageHoursOnSourceDoc(shift)) return 0;
  const code = String(shift.code || shift.type || "").toUpperCase();
  if (PLANNING_NON_BILLABLE_CODES.has(code)) return 0;
  const explicitExt = Number(shift.extExtraHours ?? shift.extensionExtraHours);
  const hintBand = slaHoursHint?.[code];
  const cctBand = SHIFT_HOURS_LOOKUP[code];
  const bandHint = hintBand ?? cctBand;
  const hasRealExtension = !!(shift.isExtended || shift.isEarlyStart || shift.coverageSegmentRole === "EXTENSION" || shift.coverageSegmentRole === "EARLY_START" || Number.isFinite(explicitExt) && explicitExt > 0);
  const storedForBase = Number(shift.hours);
  const tsDur = durationHoursFromShiftTimestamps(shift);
  const isClienteRefuerzo = code === "RFZ" || code === "TURA";
  const intrinsic = isClienteRefuerzo && tsDur >= 0.25 ? tsDur : storedForBase >= 0.5 ? Math.min(storedForBase, 24) : tsDur >= 0.5 ? tsDur : 0;
  let codeBase = 0;
  if (intrinsic >= 0.5) {
    codeBase = intrinsic;
  } else if (hintBand !== void 0 && hintBand > 0) {
    codeBase = hintBand;
  } else if (cctBand !== void 0) {
    codeBase = cctBand;
  } else if (bandHint != null && bandHint > 0) {
    codeBase = bandHint;
  } else {
    codeBase = 8;
  }
  const extra = shiftCoverageExtensionExtraHours(shift, slaHoursHint);
  const extensionBillable = hasRealExtension || extra >= 0.25;
  const finish = (base, ext) => Math.round((base + ext) * 100) / 100;
  if (extensionBillable && bandHint != null && bandHint > 0) {
    const baseBand = codeBase >= bandHint - 0.5 ? codeBase : bandHint;
    const extraPart = Math.max(
      extra,
      Number.isFinite(explicitExt) && explicitExt > 0 ? explicitExt : 0
    );
    return finish(baseBand, extraPart);
  }
  if (codeBase < 0.5 && bandHint != null && bandHint > 0) {
    return finish(bandHint, extra);
  }
  const stored = Number(shift.hours);
  if (!extensionBillable && intrinsic >= 0.5) {
    return finish(intrinsic, extra);
  }
  if (!extensionBillable && bandHint != null && bandHint > 0) {
    let base = Math.max(codeBase, bandHint);
    if (stored >= 0.5) {
      if (stored < bandHint && bandHint - stored < 0.75) {
        base = bandHint;
      } else if (stored > bandHint + 0.25) {
        return Math.round(Math.min(stored, 24) * 100) / 100;
      }
    }
    return finish(base, extra);
  }
  if (!extensionBillable && stored > codeBase + 0.25) {
    return Math.round(Math.min(stored, 24) * 100) / 100;
  }
  if (!extensionBillable && bandHint != null && bandHint > 0 && codeBase + extra < bandHint - 0.05) {
    if (bandHint - (codeBase + extra) < 0.75) {
      return finish(bandHint, extra);
    }
  }
  return finish(codeBase, extra);
}
function calcPlanificadorShiftHours(shift, slaHoursHint) {
  return calcPlanningBillableShiftHours(shift, slaHoursHint);
}
function calcPlanningSlaReconciliationHours(shift, slaHoursHint) {
  if (!shift || shift.isDeleted) return 0;
  const total = calcPlanningBillableShiftHours(shift, slaHoursHint);
  const extra = shiftCoverageExtensionExtraHours(shift, slaHoursHint);
  if (extra <= 0) return total;
  return Math.max(0, Math.round((total - extra) * 100) / 100);
}

// apps/web2/src/lib/planificacion/planningTurnoCoalesce.ts
function turnoContributesCoverageMerge(t) {
  if (!t) return false;
  if (t.isExtended || t.isEarlyStart) return true;
  const role = String(t.coverageSegmentRole || "").toUpperCase();
  if (role === "EXTENSION" || role === "EARLY_START") return true;
  const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
  return Number.isFinite(ex) && ex > 0;
}
function coalescePlannedTurnosForCell(turnos, slaCodeHoursHint) {
  if (!turnos.length) return null;
  if (turnos.length === 1) return turnos[0];
  let primary = turnos[0];
  let bestH = calcPlanningBillableShiftHours(primary, slaCodeHoursHint);
  for (const t of turnos) {
    const h = calcPlanningBillableShiftHours(t, slaCodeHoursHint);
    if (h > bestH) {
      primary = t;
      bestH = h;
    }
  }
  const merged = { ...primary };
  for (const t of turnos) {
    if (!turnoContributesCoverageMerge(t)) continue;
    merged.isExtended = merged.isExtended || t.isExtended;
    merged.isEarlyStart = merged.isEarlyStart || t.isEarlyStart;
    merged.coveragePackageId = merged.coveragePackageId || t.coveragePackageId;
    merged.coverageSegmentRole = merged.coverageSegmentRole || t.coverageSegmentRole;
    merged.coversPositionName = merged.coversPositionName || t.coversPositionName;
    merged.segmentFromTime = merged.segmentFromTime || t.segmentFromTime;
    merged.segmentToTime = merged.segmentToTime || t.segmentToTime;
    merged.adjustedEndTime = merged.adjustedEndTime || t.adjustedEndTime;
    merged.extensionEndTime = merged.extensionEndTime || t.extensionEndTime;
    merged.adjustedStartTime = merged.adjustedStartTime || t.adjustedStartTime;
    const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
    if (Number.isFinite(ex) && ex > 0) {
      merged.extExtraHours = Math.max(Number(merged.extExtraHours) || 0, ex);
    }
  }
  return merged;
}

// apps/web2/src/lib/crm/crmDateUtils.ts
var toDateSafe = (val) => {
  if (!val) return null;
  const v = val;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1e3);
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
};
function getDateKeyInTimezone(date) {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const year = parts.find((p) => p.type === "year")?.value;
  return `${year}-${month}-${day}`;
}
function resolveTurnoScheduleDateKey(t) {
  if (!t) return null;
  for (const field of ["scheduleDate", "planningDate", "fecha"]) {
    const raw = String(t[field] ?? "").trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }
  const st = toDateSafe(t.startTime);
  if (!st) return null;
  return getDateKeyInTimezone(st);
}

// apps/web2/src/lib/crm/objectiveIdentity.ts
function fallbackObjectiveKey(clientId, objectiveName) {
  return `${clientId}_${objectiveName}`;
}
function objectiveMatchCandidates(row) {
  const cid = String(row.clientId ?? "").trim();
  const oid = String(row.objectiveId ?? "").trim();
  const name = String(row.objectiveName ?? "").trim();
  const keys = [];
  if (oid) keys.push(oid);
  if (oid) keys.push(oid.toLowerCase());
  if (name) keys.push(name);
  if (cid && name) keys.push(fallbackObjectiveKey(cid, name));
  return keys;
}
function resolveCanonicalObjectiveId(row, aliases) {
  for (const key of objectiveMatchCandidates(row)) {
    if (aliases[key]) return aliases[key].canonicalId;
  }
  const oid = String(row.objectiveId ?? "").trim();
  if (oid) return oid;
  const cid = String(row.clientId ?? "").trim();
  const name = String(row.objectiveName ?? "").trim();
  if (cid && name) return fallbackObjectiveKey(cid, name);
  if (name) return name;
  return null;
}

// apps/web2/src/lib/crm/slaExclusionForPlanned.ts
function normKey(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normPositionName(value) {
  return normKey(value).replace(/^puesto\s+/, "");
}
function positionNamesMatch(turnoPos, slaPos) {
  const a = normPositionName(turnoPos);
  const b = normPositionName(slaPos);
  if (!a || !b) return false;
  return a === b;
}
function registerObjectiveRules(map, keys, rules) {
  for (const key of keys) {
    const k = String(key || "").trim();
    if (!k) continue;
    map.set(k, rules);
    map.set(normKey(k), rules);
  }
}
function buildSlaExclusionContext(services, rangeStart, rangeEnd) {
  const byObjective = /* @__PURE__ */ new Map();
  const vigente = pickVigenteSlasForPeriod(services, rangeStart, rangeEnd);
  for (const srv of vigente) {
    const contractExcluded = new Set(
      Array.isArray(srv.excludedDates) ? srv.excludedDates : []
    );
    const positions = [];
    const rawPositions = Array.isArray(srv.positions) ? srv.positions : Object.values(srv.positions || {});
    for (const raw of rawPositions) {
      const pos = raw;
      const name = String(pos.name ?? pos.positionName ?? "").trim();
      if (!name) continue;
      const dates = Array.isArray(pos.excludedDates) ? pos.excludedDates : [];
      const shiftMap = /* @__PURE__ */ new Map();
      const rawShift = pos.excludedShiftDates;
      if (rawShift && typeof rawShift === "object") {
        for (const [ds, codes] of Object.entries(rawShift)) {
          if (!Array.isArray(codes) || !codes.length) continue;
          shiftMap.set(ds, new Set(codes.map((c) => String(c || "").toUpperCase()).filter(Boolean)));
        }
      }
      if (!dates.length && shiftMap.size === 0) continue;
      positions.push({
        name,
        excludedDates: new Set(dates),
        excludedShiftDates: shiftMap
      });
    }
    const rules = { contractExcluded, positions };
    registerObjectiveRules(byObjective, [
      String(srv.objectiveId ?? "").trim(),
      String(srv.objectiveName ?? "").trim(),
      objectiveKeyForSla(srv)
    ], rules);
  }
  return { byObjective };
}
function resolveObjectiveRules(t, ctx) {
  const candidates = [
    String(t.objectiveId ?? "").trim(),
    String(t.objectiveName ?? "").trim(),
    normKey(t.objectiveId),
    normKey(t.objectiveName)
  ].filter(Boolean);
  for (const key of candidates) {
    const rules = ctx.byObjective.get(key);
    if (rules) return rules;
  }
  return void 0;
}
function resolveScheduleDateKey(t, opts) {
  const fromOpt = String(opts?.scheduleDateKey ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromOpt)) return fromOpt;
  const fromTurno = resolveTurnoScheduleDateKey(t);
  if (fromTurno) return fromTurno;
  const plannedStart = toDateSafe(t.startTime);
  if (!plannedStart) return null;
  return getDateKeyInTimezone(plannedStart);
}
function isTurnoOnSlaExcludedSlot(t, ctx, opts) {
  if (!ctx) return false;
  const rules = resolveObjectiveRules(t, ctx);
  if (!rules) return false;
  const dateKey = resolveScheduleDateKey(t, opts);
  if (!dateKey) return false;
  if (rules.contractExcluded.has(dateKey)) return true;
  const posName = String(opts?.positionName ?? t.positionName ?? "").trim();
  if (!posName) return false;
  const code = String(t.code ?? "").toUpperCase();
  for (const pos of rules.positions) {
    if (!positionNamesMatch(posName, pos.name)) continue;
    if (pos.excludedDates.has(dateKey)) return true;
    if (code && pos.excludedShiftDates.get(dateKey)?.has(code)) return true;
  }
  return false;
}

// apps/web2/src/lib/crm/plannedHours.ts
function parseClockToHours(t) {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] + +m[2] / 60 : null;
}
function shiftVariantsFromPosition(pos) {
  const raw = pos;
  const list = raw.allowedShiftTypes ?? raw.shifts;
  return Array.isArray(list) ? list : [];
}
function applyShiftVariantToHint(hint, sh) {
  const code = String(sh.code || "").trim().toUpperCase();
  if (!code) return;
  const n = Number(sh.hours);
  if (n > 0) {
    hint[code] = n;
    return;
  }
  if (typeof sh.startTime === "string" && typeof sh.endTime === "string") {
    const s = parseClockToHours(sh.startTime);
    const e = parseClockToHours(sh.endTime);
    if (s != null && e != null) {
      let dur = e - s;
      if (dur <= 0) dur += 24;
      if (dur > 0) hint[code] = dur;
    }
  }
}
function buildSlaCodeHoursHintByObjectiveId(services) {
  const out = {};
  for (const srv of services) {
    const objId = String(srv.objectiveId ?? "").trim();
    if (!objId) continue;
    const hint = out[objId] ?? (out[objId] = {});
    const rawPositions = Array.isArray(srv.positions) ? srv.positions : Object.values(srv.positions || {});
    for (const raw of rawPositions) {
      for (const sh of shiftVariantsFromPosition(raw)) {
        applyShiftVariantToHint(hint, sh);
      }
    }
  }
  return out;
}

// apps/web2/src/lib/analisis/analisisQueries.ts
function coverageResultanteHours(d) {
  return Math.round(((d.planHours || 0) + (d.extHours || 0) + (d.adelHours || 0) + (d.opsHours || 0)) * 10) / 10;
}
var LEAVE_CODES = /* @__PURE__ */ new Set(["V", "L", "E", "A", "AA", "PG", "SGS", "SUS"]);
var BAND_HOURS = {
  M: 8,
  T: 8,
  N: 8,
  D12: 12,
  N12: 12,
  PU: 12,
  EN: 9,
  REF: 8,
  RFZ: 8,
  C: 8,
  GU: 8,
  ESC: 8
};
var JORNADA_DEFAULT_HS = 8;
var FULL_CALENDAR_DAY_HS = 23.5;
function isVacantShift(t) {
  const empNameU = String(t?.employeeName || "").trim().toUpperCase();
  return !t?.employeeId || t.employeeId === "VACANTE" || empNameU === "VACANTE" || empNameU.startsWith("VACANTE:") || !!t?.isUnassigned;
}
function isFrancoTrabajadoShift(t) {
  if (t?.isFrancoTrabajado === true) return true;
  const code = String(t?.code || "").trim().toUpperCase();
  if (code === "FT") return true;
  if (t?.type === "EXTRA_FRANCO") return true;
  if (String(t?.coverageType || "").toUpperCase() === "FRANCO") return true;
  return false;
}
function coverageHoursFromShift(t) {
  if (!t) return JORNADA_DEFAULT_HS;
  if (t.coverageHoursOnSource === true || String(t.origin || "").toUpperCase() === "OPERATIONS_COVERAGE" && ["EXTEND", "ADVANCE"].includes(String(t.coverageType || "").toUpperCase())) {
    return 0;
  }
  const code = String(t.code || t.shiftCode || "").toUpperCase();
  const isLeave = LEAVE_CODES.has(code);
  const stored = Number(t.hours);
  if (Number.isFinite(stored) && stored >= 0.5 && stored < FULL_CALENDAR_DAY_HS) {
    return Math.min(stored, isLeave ? 12 : 24);
  }
  if (!isLeave && BAND_HOURS[code] != null) return BAND_HOURS[code];
  if (!isLeave && t.startTime?.seconds && t.endTime?.seconds) {
    const dur = (t.endTime.seconds - t.startTime.seconds) / 3600;
    if (dur >= 0.5 && dur < FULL_CALENDAR_DAY_HS) return Math.min(dur, 24);
  }
  if (BAND_HOURS[code] != null && BAND_HOURS[code] > 0) return BAND_HOURS[code];
  return JORNADA_DEFAULT_HS;
}

// apps/web2/src/lib/analisis/analisisDemanda.ts
function isAdelantoShift(t) {
  return t?.isEarlyStart === true || String(t?.coverageSegmentRole || "").toUpperCase() === "EARLY_START";
}
function isExtensionShift(t) {
  return t?.isExtended === true || String(t?.coverageSegmentRole || "").toUpperCase() === "EXTENSION";
}
function coveragePlannedBillableHours(plan, ext = 0, adel = 0) {
  return Math.round((plan + ext + adel) * 10) / 10;
}
function coveragePlannedFromDemandaRow(row) {
  return coveragePlannedBillableHours(row.planHours, row.extHours, row.adelHours);
}
function buildDemandaByObjective(opts) {
  const { turnos, ausenciasStats, vigenteServices, periodStart, periodEnd, objectiveAliases, slaExclusionCtx } = opts;
  const slaByObj = /* @__PURE__ */ new Map();
  vigenteServices.forEach((srv) => {
    const canonicalId = resolveCanonicalObjectiveId(srv, objectiveAliases) || String(srv.objectiveId ?? "").trim();
    if (!canonicalId) return;
    const hours = slaHoursForServiceInRange(srv, periodStart, periodEnd);
    if (hours <= 0) return;
    const prev = slaByObj.get(canonicalId) || {
      name: srv.objectiveName || canonicalId,
      client: srv.clientName || "Sin Cliente",
      sla: 0
    };
    slaByObj.set(canonicalId, { ...prev, sla: prev.sla + hours });
  });
  const slaCodeHoursHintByObjective = buildSlaCodeHoursHintByObjectiveId(vigenteServices);
  const byObj = /* @__PURE__ */ new Map();
  const touch = (id, name, client) => {
    const row = byObj.get(id) || {
      name,
      client,
      plan: 0,
      ext: 0,
      adel: 0,
      ft: 0,
      ops: 0,
      vacant: 0,
      absence: 0,
      absenceCovered: 0
    };
    byObj.set(id, row);
    return row;
  };
  slaByObj.forEach((info, id) => touch(id, info.name, info.client));
  const planCellGroups = /* @__PURE__ */ new Map();
  turnos.forEach((t) => {
    const plannedStart = t.startTime?.seconds ? new Date(t.startTime.seconds * 1e3) : null;
    const scheduleDateKey = plannedStart ? getDateKeyInTimezone(plannedStart) : "";
    if (scheduleDateKey) {
      const periodStartKey = getDateKeyInTimezone(periodStart);
      const periodEndKey = getDateKeyInTimezone(periodEnd);
      if (scheduleDateKey < periodStartKey || scheduleDateKey > periodEndKey) return;
    } else if (plannedStart) {
      if (plannedStart < periodStart || plannedStart > periodEnd) return;
    } else {
      return;
    }
    if (plannedStart && isTurnoOnSlaExcludedSlot(t, slaExclusionCtx, {
      scheduleDateKey,
      positionName: String(t.positionName ?? "")
    })) {
      return;
    }
    const ok = resolveCanonicalObjectiveId(t, objectiveAliases) || String(t.objectiveId ?? "").trim() || "SIN_OBJETIVO";
    const slaInfo = slaByObj.get(ok);
    const row = touch(ok, slaInfo?.name || t.objectiveName || ok, slaInfo?.client || t.clientName || "Sin Cliente");
    const isFt = isFrancoTrabajadoShift(t) && !isVacantShift(t);
    if (isOperationalOriginShift2(t) && !isVacantShift(t) && !isProformaVacancyShift(t)) {
      const hs = coverageHoursFromShift(t);
      if (hs > 0) row.ops += hs;
      return;
    }
    if (!isPlanificadorPlannedHoursShift(t) && !isFt) return;
    if (isProformaVacancyShift(t)) return;
    const extra = shiftCoverageExtensionExtraHours(t);
    const gross = isPlanificadorPlannedHoursShift(t) ? calcPlanificadorShiftHours(t) : coverageHoursFromShift(t);
    const base = Math.max(0, Math.round((gross - extra) * 100) / 100);
    if (isVacantShift(t)) {
      if (base > 0) row.vacant += base;
      return;
    }
    if (isFt) {
      const ftHs = coverageHoursFromShift(t) || gross;
      if (ftHs > 0) {
        row.ft += ftHs;
        row.plan += ftHs;
      }
      return;
    }
    if (isPlanificadorPlannedHoursShift(t) && t.employeeId && t.employeeId !== "VACANTE" && scheduleDateKey) {
      const empId = String(t.employeeId);
      const cellKey = `${empId}_${scheduleDateKey}`;
      let byCell = planCellGroups.get(ok);
      if (!byCell) {
        byCell = /* @__PURE__ */ new Map();
        planCellGroups.set(ok, byCell);
      }
      const list = byCell.get(cellKey) || [];
      list.push(t);
      byCell.set(cellKey, list);
    }
    if (extra > 0) {
      if (isAdelantoShift(t) && !isExtensionShift(t)) row.adel += extra;
      else if (isAdelantoShift(t) && isExtensionShift(t)) {
        row.adel += extra / 2;
        row.ext += extra / 2;
      } else row.ext += extra;
    }
  });
  planCellGroups.forEach((byCell, objId) => {
    const row = byObj.get(objId);
    if (!row) return;
    const hint = slaCodeHoursHintByObjective[objId];
    byCell.forEach((cellTurnos) => {
      const merged = coalescePlannedTurnosForCell(cellTurnos, hint);
      if (!merged) return;
      const base = calcPlanningSlaReconciliationHours(merged, hint);
      if (base > 0) row.plan += base;
    });
  });
  (ausenciasStats?.detalle || []).forEach((ev) => {
    const ok = ev.objectiveId ? resolveCanonicalObjectiveId({ objectiveId: ev.objectiveId }, objectiveAliases) || ev.objectiveId : "";
    if (!ok) return;
    const slaInfo = slaByObj.get(ok);
    const row = touch(ok, slaInfo?.name || ok, slaInfo?.client || "Sin Cliente");
    row.absence += ev.hs;
    if (ev.covered) row.absenceCovered += ev.hs;
  });
  const round12 = (n) => Math.round(n * 10) / 10;
  const rows = [...byObj.entries()].map(([id, d]) => {
    const slaHours = round12(slaByObj.get(id)?.sla || 0);
    const planHours = round12(d.plan);
    const extHours = round12(d.ext);
    const adelHours = round12(d.adel);
    const ftHours = round12(d.ft);
    const opsHours = round12(d.ops);
    const vacantHours = round12(d.vacant);
    const absenceHours = round12(d.absence);
    const resultante = coverageResultanteHours({ planHours, extHours, adelHours, opsHours });
    return {
      id,
      name: d.name,
      client: d.client,
      slaHours,
      planHours,
      extHours,
      adelHours,
      ftHours,
      opsHours,
      vacantHours,
      absenceHours,
      absenceCoveredHours: round12(d.absenceCovered),
      resultante,
      deltaSla: round12(resultante - slaHours),
      deltaPlan: round12(resultante - planHours)
    };
  }).filter(
    (r) => r.slaHours > 0 || r.planHours > 0 || r.resultante > 0 || r.vacantHours > 0 || r.absenceHours > 0
  ).sort((a, b) => b.slaHours + b.resultante - (a.slaHours + a.resultante));
  const totals = rows.reduce((acc, r) => ({
    id: "_total",
    name: "Total",
    client: "",
    slaHours: acc.slaHours + r.slaHours,
    planHours: acc.planHours + r.planHours,
    extHours: acc.extHours + r.extHours,
    adelHours: acc.adelHours + r.adelHours,
    ftHours: acc.ftHours + r.ftHours,
    opsHours: acc.opsHours + r.opsHours,
    vacantHours: acc.vacantHours + r.vacantHours,
    absenceHours: acc.absenceHours + r.absenceHours,
    absenceCoveredHours: acc.absenceCoveredHours + r.absenceCoveredHours,
    resultante: acc.resultante + r.resultante,
    deltaSla: acc.deltaSla + r.deltaSla,
    deltaPlan: acc.deltaPlan + r.deltaPlan
  }), {
    id: "_total",
    name: "Total",
    client: "",
    slaHours: 0,
    planHours: 0,
    extHours: 0,
    adelHours: 0,
    ftHours: 0,
    opsHours: 0,
    vacantHours: 0,
    absenceHours: 0,
    absenceCoveredHours: 0,
    resultante: 0,
    deltaSla: 0,
    deltaPlan: 0
  });
  const r13 = (n) => Math.round(n * 10) / 10;
  return {
    rows,
    totals: {
      ...totals,
      slaHours: r13(totals.slaHours),
      planHours: r13(totals.planHours),
      extHours: r13(totals.extHours),
      adelHours: r13(totals.adelHours),
      ftHours: r13(totals.ftHours),
      opsHours: r13(totals.opsHours),
      vacantHours: r13(totals.vacantHours),
      absenceHours: r13(totals.absenceHours),
      absenceCoveredHours: r13(totals.absenceCoveredHours),
      resultante: r13(totals.resultante),
      deltaSla: r13(totals.deltaSla),
      deltaPlan: r13(totals.deltaPlan)
    }
  };
}

// apps/web2/src/lib/crm/fichadaHours.ts
var FICHADA_SHIFT_HOURS = {
  M: 8,
  T: 8,
  N: 8,
  D12: 12,
  N12: 12,
  PU: 12,
  C: 8
};
function isShiftAbsent(t) {
  if (!t) return false;
  const st = String(t.status || "").toUpperCase();
  return t.isAbsent === true || st === "ABSENT";
}
function isShiftFichado(t) {
  if (!t || isShiftAbsent(t)) return false;
  const st = String(t.status || "").toUpperCase();
  if (t.isPresent === true || t.isCompleted === true || st === "PRESENT" || st === "COMPLETED") return true;
  const rs = toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime);
  const re = toDateSafe(t.realEndTime) || toDateSafe(t.checkOutTime);
  return !!(rs && re && re.getTime() > rs.getTime());
}

// apps/web2/src/lib/hoursBalance/buildHoursBalance.ts
function buildObjectiveAliasesFromSla(services) {
  const aliases = {};
  const register = (meta, key) => {
    const k = String(key || "").trim();
    if (k) aliases[k] = meta;
  };
  for (const srv of services) {
    const cid = String(srv.clientId ?? "").trim();
    const oid = String(srv.objectiveId ?? "").trim();
    const name = String(srv.objectiveName ?? oid).trim();
    const canonicalId = oid || name;
    if (!canonicalId) continue;
    const meta = { canonicalId, name, clientId: cid, clientName: String(srv.clientName ?? "").trim() };
    register(meta, canonicalId);
    if (oid) register(meta, oid);
    if (name) register(meta, name);
    if (cid && name) register(meta, `${cid}_${name}`);
  }
  return aliases;
}

// apps/web2/src/lib/crm/executedBillableHoursByFranja.ts
var ADICIONAL_CODES = /* @__PURE__ */ new Set(["RFZ", "TURA", "EV"]);
var NON_FRANJA_CODES = /* @__PURE__ */ new Set(["F", "FF", "FP", "RET", "ESC", "REF"]);
var HOUR_MS = 36e5;
var RETENTION_MAX_STINT_MS = (12 * 60 + 59) * 6e4;
function codeOf(t) {
  return String(t.code || t.type || "").trim().toUpperCase();
}
function isCoverageTrace(t) {
  const id = String(t.id || "");
  const origin = String(t.origin || "").toUpperCase();
  return origin === "OPERATIONS_COVERAGE" || id.startsWith("ops_cov_") || t.coverageHoursOnSource === true;
}
function coverageTargetShiftId(cov) {
  return String(cov.absenceShiftId || cov.coveredShiftId || cov.titularShiftId || "").trim();
}
function plannedWindow(t) {
  const s = toDateSafe(t.startTime);
  const e = toDateSafe(t.endTime);
  if (!s || !e) return null;
  const start = s.getTime();
  let end = e.getTime();
  if (end <= start) end += 24 * HOUR_MS;
  const hours = (end - start) / HOUR_MS;
  if (hours <= 0 || hours > 24) return null;
  return { start, end };
}
function hoursOf(pieces) {
  return pieces.reduce((a, p) => a + (p.end - p.start), 0) / HOUR_MS;
}
function mergePieces(pieces) {
  const sorted = pieces.filter((p) => p.end > p.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out;
}
function clipPieces(pieces, w) {
  return pieces.map((p) => ({ start: Math.max(p.start, w.start), end: Math.min(p.end, w.end) })).filter((p) => p.end > p.start);
}
function subtractPieces(pieces, taken) {
  let rest = mergePieces(pieces);
  for (const t of taken) {
    const next = [];
    for (const p of rest) {
      if (t.end <= p.start || t.start >= p.end) {
        next.push(p);
        continue;
      }
      if (t.start > p.start) next.push({ start: p.start, end: t.start });
      if (t.end < p.end) next.push({ start: t.end, end: p.end });
    }
    rest = next;
  }
  return rest;
}
function requestedHours(t, code) {
  const w = plannedWindow(t);
  if (w) return (w.end - w.start) / HOUR_MS;
  if (FICHADA_SHIFT_HOURS[code]) return FICHADA_SHIFT_HOURS[code];
  const stored = Number(t.hours);
  if (Number.isFinite(stored) && stored > 0 && stored <= 24) return stored;
  return 8;
}
function ymdOf(t) {
  for (const field of ["scheduleDate", "planningDate", "fecha", "startDate"]) {
    const direct = String(t[field] || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  }
  const st = toDateSafe(t.startTime);
  if (st) return getDateKeyInTimezone(st);
  return "";
}
function realStartMs(t) {
  const d = toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime);
  return d ? d.getTime() : null;
}
function realExitMs(t) {
  const d = toDateSafe(t.realEndTime) || toDateSafe(t.checkOutTime);
  return d ? d.getTime() : null;
}
function covererPresented(t) {
  if (isShiftAbsent(t)) return false;
  if (t.isPresent === true || t.isCompleted === true) return true;
  const st = String(t.status || "").toUpperCase();
  if (st === "PRESENT" || st === "COMPLETED") return true;
  return realStartMs(t) != null;
}
function titularPresented(t) {
  if (isShiftAbsent(t)) return false;
  return isShiftFichado(t) || t.isPresent === true || t.isCompleted === true;
}
function presenceUntilExit(t, w) {
  const exit = realExitMs(t);
  const end = exit != null && exit < w.end ? Math.max(exit, w.start) : w.end;
  return end > w.start ? [{ start: w.start, end }] : [];
}
function coveragePieces(cov, titWin) {
  if (!covererPresented(cov)) return [];
  const covWin = plannedWindow(cov);
  if (!covWin) {
    const stored = Number(cov.hours);
    if (!Number.isFinite(stored) || stored <= 0) return [];
    return [{ start: titWin.start, end: Math.min(titWin.end, titWin.start + Math.min(stored, 24) * HOUR_MS) }];
  }
  const base = clipPieces([covWin], titWin);
  if (base.length === 0) return [];
  return clipPieces(presenceUntilExit(cov, covWin), titWin);
}
function hasRetentionMark(t) {
  return t.isRetention === true || !!String(t.retentionAbsenceShiftId || "").trim() || !!String(t.retentionKind || "").trim() || toDateSafe(t.retentionReleasedAt) != null;
}
function fillersOf(t) {
  if (!covererPresented(t) || t.coverageHoursOnSource === true) return [];
  const code = codeOf(t);
  if (NON_FRANJA_CODES.has(code) || ADICIONAL_CODES.has(code)) return [];
  const own = plannedWindow(t);
  if (!own) return [];
  const out = [];
  const started = realStartMs(t);
  if (started != null && started < own.start) {
    out.push({ shift: t, kind: "relevo", available: [{ start: started, end: own.start }] });
  }
  if (hasRetentionMark(t)) {
    const retEnd = toDateSafe(t.retentionEndTime);
    const stayedUntil = realExitMs(t) ?? (retEnd ? retEnd.getTime() : null);
    if (stayedUntil != null) {
      const cap = (started ?? own.start) + RETENTION_MAX_STINT_MS;
      const end = Math.min(stayedUntil, cap);
      if (end > own.end) out.push({ shift: t, kind: "retenido", available: [{ start: own.end, end }] });
    }
  }
  return out;
}
function normName(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function positionKey(t) {
  return `${String(t.objectiveId || "").trim()}|${normName(String(t.positionName || "Sin puesto"))}`;
}
function r1(n) {
  return Math.round(n * 10) / 10;
}
function executedBillableHoursByFranja(turnos, opts = {}) {
  const live = turnos.filter((t) => t.isDeleted !== true);
  const coveragesByTarget = /* @__PURE__ */ new Map();
  for (const cov of live) {
    if (!isCoverageTrace(cov) || cov.coverageSuperseded === true) continue;
    const target = coverageTargetShiftId(cov);
    if (!target) continue;
    const list2 = coveragesByTarget.get(target) || [];
    list2.push(cov);
    coveragesByTarget.set(target, list2);
  }
  for (const list2 of coveragesByTarget.values()) {
    list2.sort((a, b) => (plannedWindow(a)?.start ?? 0) - (plannedWindow(b)?.start ?? 0));
  }
  const fillersByPosition = /* @__PURE__ */ new Map();
  for (const t of live) {
    for (const f of fillersOf(t)) {
      const k = positionKey(t);
      const list2 = fillersByPosition.get(k) || [];
      list2.push(f);
      fillersByPosition.set(k, list2);
    }
  }
  for (const list2 of fillersByPosition.values()) {
    list2.sort((a, b) => (a.available[0]?.start ?? 0) - (b.available[0]?.start ?? 0));
  }
  const titulares = live.filter((t) => {
    if (isCoverageTrace(t)) return false;
    const code = codeOf(t);
    return !!code && !ADICIONAL_CODES.has(code) && !NON_FRANJA_CODES.has(code);
  }).sort((a, b) => (plannedWindow(a)?.start ?? 0) - (plannedWindow(b)?.start ?? 0));
  const buckets = /* @__PURE__ */ new Map();
  for (const t of titulares) {
    const code = codeOf(t);
    const date = ymdOf(t);
    if (!date) continue;
    if (opts.startYmd && date < opts.startYmd) continue;
    if (opts.endYmd && date > opts.endYmd) continue;
    const objectiveId = String(t.objectiveId || "").trim();
    const positionName = String(t.positionName || "Sin puesto").trim();
    const requested = requestedHours(t, code);
    const key = `${objectiveId}|${normName(positionName)}|${date}|${code}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        objectiveId,
        objectiveName: String(t.objectiveName || objectiveId || "Objetivo"),
        positionName,
        date,
        code,
        requested: 0,
        covered: 0,
        billable: 0,
        uncovered: 0,
        titulares: []
      };
      buckets.set(key, bucket);
    }
    const shiftId = String(t.id || "");
    const contributions = [];
    const titWin = plannedWindow(t);
    const covs = coveragesByTarget.get(shiftId) || [];
    if (titWin) {
      let taken = [];
      const take = (who, kind, pieces) => {
        const fresh = subtractPieces(clipPieces(pieces, titWin), taken);
        const hours = hoursOf(fresh);
        if (hours <= 0) return [];
        contributions.push({
          shiftId: String(who.id || ""),
          employeeId: String(who.employeeId || ""),
          employeeName: String(who.employeeName || ""),
          kind,
          hours,
          pieces: fresh
        });
        taken = mergePieces([...taken, ...fresh]);
        return fresh;
      };
      if (titularPresented(t)) take(t, "titular", presenceUntilExit(t, titWin));
      for (const cov of covs) take(cov, "cobertura", coveragePieces(cov, titWin));
      if (hoursOf(taken) < requested) {
        for (const f of fillersByPosition.get(positionKey(t)) || []) {
          if (f.shift === t) continue;
          const used = take(f.shift, f.kind, f.available);
          if (used.length) f.available = subtractPieces(f.available, used);
        }
      }
    } else {
      if (titularPresented(t)) {
        contributions.push({
          shiftId,
          employeeId: String(t.employeeId || ""),
          employeeName: String(t.employeeName || ""),
          kind: "titular",
          hours: requested,
          pieces: []
        });
      }
      let room = requested - (contributions[0]?.hours || 0);
      for (const cov of covs) {
        if (room <= 0 || !covererPresented(cov)) continue;
        const stored = Number(cov.hours);
        const hours = Math.min(room, Number.isFinite(stored) && stored > 0 ? stored : room);
        contributions.push({
          shiftId: String(cov.id || ""),
          employeeId: String(cov.employeeId || ""),
          employeeName: String(cov.employeeName || ""),
          kind: "cobertura",
          hours,
          pieces: []
        });
        room -= hours;
      }
    }
    const sumKind = (k) => contributions.filter((c) => k.includes(c.kind)).reduce((a, c) => a + c.hours, 0);
    const fromSelf = sumKind(["titular"]);
    const fromCoverage = sumKind(["cobertura"]);
    const fromFillers = sumKind(["retenido", "relevo"]);
    const covered = Math.min(requested, fromSelf + fromCoverage + fromFillers);
    bucket.titulares.push({
      shiftId,
      employeeId: String(t.employeeId || ""),
      requested,
      covered,
      billable: covered,
      fromSelf,
      fromCoverage,
      fromFillers,
      contributions
    });
    bucket.requested += requested;
    bucket.covered += covered;
    bucket.billable += covered;
    bucket.uncovered = Math.max(0, bucket.requested - bucket.covered);
  }
  const list = [...buckets.values()];
  const byObjectiveId = {};
  const byObjectiveName = {};
  let totalRequested = 0;
  let totalBillable = 0;
  for (const b of list) {
    totalRequested += b.requested;
    totalBillable += b.billable;
    if (b.objectiveId) byObjectiveId[b.objectiveId] = r1((byObjectiveId[b.objectiveId] || 0) + b.billable);
    const nk = normName(b.objectiveName);
    if (nk) byObjectiveName[nk] = r1((byObjectiveName[nk] || 0) + b.billable);
  }
  return {
    buckets: list,
    totalRequested: r1(totalRequested),
    totalBillable: r1(totalBillable),
    totalUncovered: r1(Math.max(0, totalRequested - totalBillable)),
    byObjectiveId,
    byObjectiveName
  };
}

// packages/hours-core/src/motors/planning/constants.ts
var RET_STANDBY_REFERENCE_HOURS2 = 8;

// packages/hours-core/src/motors/planning/deploymentRoles.ts
var DEPLOYMENT_SURPLUS_CODES2 = /* @__PURE__ */ new Set(["REF", "ESC"]);
var DEPLOYMENT_POOL_CODES2 = /* @__PURE__ */ new Set(["RET"]);
var DEPLOYMENT_BAND_HOURS = {
  M: 8,
  T: 8,
  N: 8,
  D12: 12,
  N12: 12
};
function isDeploymentSurplusCode2(code) {
  return DEPLOYMENT_SURPLUS_CODES2.has(String(code || "").toUpperCase());
}
function isDeploymentPoolCode2(code) {
  return DEPLOYMENT_POOL_CODES2.has(String(code || "").toUpperCase());
}
function deploymentRoleFromCode2(code) {
  const c = String(code || "").toUpperCase();
  if (c === "RET") return "POOL";
  if (c === "REF") return "SURPLUS";
  if (c === "ESC") return "TRAINING";
  return "REGULAR";
}
function normalizeDeploymentShiftCode2(raw) {
  return String(raw ?? "").trim().toUpperCase();
}
function isDeploymentOrPoolShift2(t) {
  if (!t) return false;
  const code = normalizeDeploymentShiftCode2(t.code || t.type);
  if (isDeploymentPoolCode2(code) || isDeploymentSurplusCode2(code)) return true;
  if (code === "RET" || code === "REF" || code === "ESC") return true;
  if (t.isRefuerzo === true || t.isEscuela === true || t.isReten === true) return true;
  const role = String(t.deploymentRole || deploymentRoleFromCode2(code)).toUpperCase();
  return role === "POOL" || role === "SURPLUS" || role === "TRAINING";
}
function deploymentShiftHours(shift) {
  if (!shift) return 0;
  const code = String(shift.code || "").toUpperCase();
  if (code === "RET" || shift.isReten === true) return 0;
  if (isDeploymentSurplusCode2(code) || shift.isRefuerzo === true || shift.isEscuela === true) {
    const band = String(shift.deploymentBand || "M").toUpperCase();
    const h = Number(shift.hours);
    if (h > 0) return h;
    return DEPLOYMENT_BAND_HOURS[band] ?? 8;
  }
  return 0;
}
function isRegularLiquidationWorkShift(t) {
  if (!t || String(t.type || "").toUpperCase() === "NOVEDAD") return false;
  if (isDeploymentOrPoolShift2(t)) return false;
  const code = normalizeDeploymentShiftCode2(t.code || t.type);
  const nonWork = /* @__PURE__ */ new Set(["F", "FF", "FP", "FT", "V", "L", "A", "E", "AA", "PG", "SUS", "SGS", "EV"]);
  return !nonWork.has(code);
}

// packages/hours-core/src/motors/planning/positionCoverageUnits.ts
var PLANNING_NON_BILLABLE_CODES2 = /* @__PURE__ */ new Set([
  "F",
  "FF",
  "FP",
  "FT",
  "V",
  "L",
  "A",
  "E",
  "AA",
  "PG",
  "RET",
  "REF",
  "ESC",
  "SUS",
  "SGS",
  "EV"
]);

// packages/hours-core/src/motors/planning/coverageSemantics.ts
function isOpsCoverageHoursOnSourceDoc2(data) {
  if (!data) return false;
  if (data.coverageHoursOnSource === true) return true;
  const ct = String(data.coverageType || "").toUpperCase();
  if (String(data.origin || "").toUpperCase() === "OPERATIONS_COVERAGE" && (ct === "EXTEND" || ct === "ADVANCE")) {
    return true;
  }
  return false;
}

// packages/hours-core/src/motors/planning/planningScheduledHours.ts
var SHIFT_HOURS_LOOKUP2 = {
  M: 8,
  T: 8,
  N: 8,
  D12: 12,
  N12: 12,
  PU: 12,
  EN: 9,
  F: 0,
  FF: 0,
  FP: 0,
  FT: 0,
  V: 0,
  L: 0,
  A: 0,
  E: 0,
  AA: 0,
  PG: 0,
  RET: 0,
  REF: 0,
  RFZ: 8,
  TURA: 8,
  ESC: 0,
  C: 8,
  GU: 8
};
function parseHHmmToHours2(t) {
  if (!t || typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}
function hoursBetweenClockTimes2(from, to) {
  const f = parseHHmmToHours2(from);
  const t = parseHHmmToHours2(to);
  if (f == null || t == null) return null;
  let dur = t - f;
  if (dur <= 0) dur += 24;
  return Math.max(0, Math.min(dur, 24));
}
function shiftCoverageExtensionExtraHours2(shift, slaHoursHint) {
  if (!shift || shift.isDeleted) return 0;
  const fromRaw = shift.segmentFromTime || (shift.isEarlyStart ? shift.adjustedStartTime : null);
  const toRaw = shift.segmentToTime || (shift.isExtended ? shift.adjustedEndTime || shift.extensionEndTime : null);
  const hasCoverageSegment = !!(shift.coveragePackageId || shift.coversPositionName || shift.coverageSegmentRole || shift.isExtended || shift.isEarlyStart);
  if (fromRaw && toRaw && hasCoverageSegment) {
    const from = String(fromRaw).slice(0, 5);
    const to = String(toRaw).slice(0, 5);
    const h = hoursBetweenClockTimes2(from, to);
    if (h != null && h >= 0.25 && h <= 6) {
      const code = String(shift.code || "").toUpperCase();
      const codeBase = SHIFT_HOURS_LOOKUP2[code] ?? slaHoursHint?.[code];
      if (codeBase !== void 0 && h >= codeBase - 0.5) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      return Math.min(h, 12);
    }
  }
  const explicit = Number(shift.extExtraHours ?? shift.extensionExtraHours);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, 12);
  }
  if (!shift.isExtended && !shift.isEarlyStart) return 0;
  if (fromRaw && toRaw) {
    const from = String(fromRaw).slice(0, 5);
    const to = String(toRaw).slice(0, 5);
    const h = hoursBetweenClockTimes2(from, to);
    if (h != null && h > 0) {
      if (h < 0.25) return 0;
      const code = String(shift.code || "").toUpperCase();
      const codeBase = SHIFT_HOURS_LOOKUP2[code] ?? slaHoursHint?.[code];
      if (codeBase !== void 0 && h >= codeBase - 0.5) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      if (h <= 5 && (shift.isExtended || shift.isEarlyStart)) return h;
      if (codeBase !== void 0) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      return 0;
    }
  }
  return 0;
}
function instantFromShiftClock2(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") {
    const d = val.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = val.seconds ?? val._seconds;
  if (typeof sec === "number" && sec > 0) return new Date(sec * 1e3);
  if (typeof val === "string") {
    const raw = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function durationHoursFromShiftTimestamps2(shift) {
  const startAt = instantFromShiftClock2(shift.startTime);
  const endAt = instantFromShiftClock2(shift.endTime);
  if (startAt && endAt) {
    let dur = (endAt.getTime() - startAt.getTime()) / 36e5;
    if (dur <= 0) dur += 24;
    if (dur > 0 && dur <= 24) return Math.round(dur * 100) / 100;
  }
  if (typeof shift.startTime === "string" && typeof shift.endTime === "string") {
    const parseH = (t) => {
      const raw = t.trim();
      const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
      if (hm) return +hm[1] + +hm[2] / 60;
      const iso = raw.match(/T(\d{2}):(\d{2})/);
      return iso ? +iso[1] + +iso[2] / 60 : null;
    };
    const s = parseH(shift.startTime);
    const e = parseH(shift.endTime);
    if (s !== null && e !== null) {
      let dur = e - s;
      if (dur <= 0) dur += 24;
      return Math.max(0, Math.min(dur, 24));
    }
  }
  return 0;
}
function calcPlanningBillableShiftHours2(shift, slaHoursHint) {
  if (!shift) return 0;
  if (isOpsCoverageHoursOnSourceDoc2(shift)) return 0;
  const code = String(shift.code || shift.type || "").toUpperCase();
  if (PLANNING_NON_BILLABLE_CODES2.has(code)) return 0;
  const explicitExt = Number(shift.extExtraHours ?? shift.extensionExtraHours);
  const hintBand = slaHoursHint?.[code];
  const cctBand = SHIFT_HOURS_LOOKUP2[code];
  const bandHint = hintBand ?? cctBand;
  const hasRealExtension = !!(shift.isExtended || shift.isEarlyStart || shift.coverageSegmentRole === "EXTENSION" || shift.coverageSegmentRole === "EARLY_START" || Number.isFinite(explicitExt) && explicitExt > 0);
  const storedForBase = Number(shift.hours);
  const tsDur = durationHoursFromShiftTimestamps2(shift);
  const isClienteRefuerzo = code === "RFZ" || code === "TURA";
  const intrinsic = isClienteRefuerzo && tsDur >= 0.25 ? tsDur : storedForBase >= 0.5 ? Math.min(storedForBase, 24) : tsDur >= 0.5 ? tsDur : 0;
  let codeBase = 0;
  if (intrinsic >= 0.5) {
    codeBase = intrinsic;
  } else if (hintBand !== void 0 && hintBand > 0) {
    codeBase = hintBand;
  } else if (cctBand !== void 0) {
    codeBase = cctBand;
  } else if (bandHint != null && bandHint > 0) {
    codeBase = bandHint;
  } else {
    codeBase = 8;
  }
  const extra = shiftCoverageExtensionExtraHours2(shift, slaHoursHint);
  const extensionBillable = hasRealExtension || extra >= 0.25;
  const finish = (base, ext) => Math.round((base + ext) * 100) / 100;
  if (extensionBillable && bandHint != null && bandHint > 0) {
    const baseBand = codeBase >= bandHint - 0.5 ? codeBase : bandHint;
    const extraPart = Math.max(
      extra,
      Number.isFinite(explicitExt) && explicitExt > 0 ? explicitExt : 0
    );
    return finish(baseBand, extraPart);
  }
  if (codeBase < 0.5 && bandHint != null && bandHint > 0) {
    return finish(bandHint, extra);
  }
  const stored = Number(shift.hours);
  if (!extensionBillable && intrinsic >= 0.5) {
    return finish(intrinsic, extra);
  }
  if (!extensionBillable && bandHint != null && bandHint > 0) {
    let base = Math.max(codeBase, bandHint);
    if (stored >= 0.5) {
      if (stored < bandHint && bandHint - stored < 0.75) {
        base = bandHint;
      } else if (stored > bandHint + 0.25) {
        return Math.round(Math.min(stored, 24) * 100) / 100;
      }
    }
    return finish(base, extra);
  }
  if (!extensionBillable && stored > codeBase + 0.25) {
    return Math.round(Math.min(stored, 24) * 100) / 100;
  }
  if (!extensionBillable && bandHint != null && bandHint > 0 && codeBase + extra < bandHint - 0.05) {
    if (bandHint - (codeBase + extra) < 0.75) {
      return finish(bandHint, extra);
    }
  }
  return finish(codeBase, extra);
}

// packages/hours-core/src/motors/legacy/planningTurnoCoalesceF0.ts
function turnoContributesCoverageMerge2(t) {
  if (!t) return false;
  if (t.isExtended || t.isEarlyStart) return true;
  const role = String(t.coverageSegmentRole || "").toUpperCase();
  if (role === "EXTENSION" || role === "EARLY_START") return true;
  const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
  return Number.isFinite(ex) && ex > 0;
}
function coalescePlannedTurnosForCell2(turnos, slaCodeHoursHint) {
  if (!turnos.length) return null;
  if (turnos.length === 1) return turnos[0];
  let primary = turnos[0];
  let bestH = calcPlanningBillableShiftHours2(primary, slaCodeHoursHint);
  for (const t of turnos) {
    const h = calcPlanningBillableShiftHours2(t, slaCodeHoursHint);
    if (h > bestH) {
      primary = t;
      bestH = h;
    }
  }
  const merged = { ...primary };
  for (const t of turnos) {
    if (!turnoContributesCoverageMerge2(t)) continue;
    merged.isExtended = merged.isExtended || t.isExtended;
    merged.isEarlyStart = merged.isEarlyStart || t.isEarlyStart;
    merged.coveragePackageId = merged.coveragePackageId || t.coveragePackageId;
    merged.coverageSegmentRole = merged.coverageSegmentRole || t.coverageSegmentRole;
    merged.coversPositionName = merged.coversPositionName || t.coversPositionName;
    merged.segmentFromTime = merged.segmentFromTime || t.segmentFromTime;
    merged.segmentToTime = merged.segmentToTime || t.segmentToTime;
    merged.adjustedEndTime = merged.adjustedEndTime || t.adjustedEndTime;
    merged.extensionEndTime = merged.extensionEndTime || t.extensionEndTime;
    merged.adjustedStartTime = merged.adjustedStartTime || t.adjustedStartTime;
    const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
    if (Number.isFinite(ex) && ex > 0) {
      merged.extExtraHours = Math.max(Number(merged.extExtraHours) || 0, ex);
    }
  }
  return merged;
}
function coalescePlannedCellBillableHours2(turnos, slaCodeHoursHint) {
  if (!turnos.length) return 0;
  const perTurno = turnos.map((t) => calcPlanningBillableShiftHours2(t, slaCodeHoursHint));
  let maxH = 0;
  for (const h of perTurno) {
    if (h > maxH) maxH = h;
  }
  const merged = coalescePlannedTurnosForCell2(turnos, slaCodeHoursHint);
  if (!merged) return Math.round(maxH * 100) / 100;
  const mergedH = calcPlanningBillableShiftHours2(merged, slaCodeHoursHint);
  const splitCoverage = turnos.length > 1 && turnos.some(turnoContributesCoverageMerge2);
  if (splitCoverage) {
    const sumH = perTurno.reduce((a, b) => a + b, 0);
    return Math.round(Math.max(mergedH, sumH) * 100) / 100;
  }
  return Math.round(Math.max(maxH, mergedH) * 100) / 100;
}

// packages/hours-core/src/motors/planning/leaveCoverage.ts
var RRHH_LEAVE_CODES = /* @__PURE__ */ new Set(["V", "L", "PG", "A", "E", "AA"]);
var RRHH_ABSENCE_TYPES = /* @__PURE__ */ new Set([
  "Vacaciones",
  "Enfermedad",
  "Licencia Esp.",
  "PG Permiso Gremial",
  "ART",
  "Injustificada",
  "MAVIC",
  "Matrimonio",
  "Maternidad",
  "Nacimiento / Paternidad",
  "Fallecimiento Familiar",
  "Examen / Estudio",
  "Mudanza",
  "Donaci\xF3n de Sangre",
  "Sin Goce de Sueldo",
  "Suspensi\xF3n"
]);
var ABSENCE_TYPE_TO_CODE = {
  Vacaciones: "V",
  Enfermedad: "E",
  "Licencia Esp.": "L",
  "PG Permiso Gremial": "PG",
  ART: "A",
  Injustificada: "AA",
  MAVIC: "L",
  Matrimonio: "L",
  Maternidad: "L",
  "Nacimiento / Paternidad": "L",
  "Fallecimiento Familiar": "L",
  "Examen / Estudio": "L",
  Mudanza: "L",
  "Donaci\xF3n de Sangre": "L",
  "Sin Goce de Sueldo": "SGS",
  Suspensi\u00F3n: "SUS"
};
function resolveLeaveCode(shiftCode, absenceType) {
  const code = String(shiftCode ?? "").trim().toUpperCase();
  if (RRHH_LEAVE_CODES.has(code)) return code;
  const t = String(absenceType ?? "").trim();
  return ABSENCE_TYPE_TO_CODE[t] || null;
}
function isEmployeeOnLeave(opts) {
  if (opts.absence?.type && RRHH_ABSENCE_TYPES.has(String(opts.absence.type).trim())) return true;
  return !!resolveLeaveCode(opts.shiftCode, opts.absenceType || opts.absence?.type);
}

// packages/hours-core/src/motors/legacy/reportesLiquidationF0.ts
var PERIOD_ONLY_CODES = /* @__PURE__ */ new Set(["V"]);
var SHIFT_HOURS_LOOKUP3 = {
  "M": 8,
  "T": 8,
  "N": 8,
  "D12": 12,
  "N12": 12,
  "PU": 12,
  "GU": 8,
  "EN": 9,
  "FT": 0,
  "F": 0,
  "V": 0,
  "L": 8,
  "PG": 8,
  "A": 8,
  "E": 8,
  "FF": 0,
  "RET": 0,
  "REF": 8,
  "RFZ": 8,
  "TURA": 8,
  "ESC": 8
};
function parseShiftInstant(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") {
    const d = val.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = val.seconds ?? val._seconds;
  if (typeof sec === "number" && sec > 0) return new Date(sec * 1e3);
  if (typeof val === "string") {
    const raw = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
var shiftHasRealCheckIn = (shift) => {
  const st = String(shift?.status || "").toUpperCase();
  return !!(shift?.isPresent || shift?.isCompleted || shift?.checkInTime?.seconds || shift?.realStartTime?.seconds || st === "COMPLETED" || st === "PRESENT");
};
function isLiquidationWorkCandidate(s) {
  const code = String(s?.code || "").trim().toUpperCase();
  if (["F", "FF", "V", "L", "PG", "A", "E", "AA", "FP"].includes(code)) return false;
  if (isLeaveReportShift(s)) return false;
  return true;
}
function isFrancoTrabajadoShift2(shift) {
  if (shift?.isFrancoTrabajado === true) return true;
  if (shift?._inferredFrancoTrabajado === true) return true;
  const code = String(shift?.code || "").trim().toUpperCase();
  if (code === "FT") return true;
  if (shift?.type === "EXTRA_FRANCO") return true;
  if (String(shift?.coverageType || "").toUpperCase() === "FRANCO") return true;
  if (shift?.francoObjectiveId) return true;
  return false;
}
function resolveFtLiquidationHours(shift, fallback = 8) {
  const startSec = shift.startTime?.seconds ?? shift.startTime?._seconds ?? 0;
  const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
  if (startSec && endSec) {
    const span = Math.max(0, (endSec - startSec) / 3600);
    if (span > 0 && span < 23.5) return span;
  }
  const code = String(shift.code || "").trim().toUpperCase();
  if (code && code !== "F" && code !== "FT") {
    const fromLookup = SHIFT_HOURS_LOOKUP3[code];
    if (fromLookup && fromLookup > 0) return fromLookup;
  }
  return fallback > 0 && fallback < 23.5 ? fallback : 8;
}
function buildFrancoDocLiquidationSkipIds(shifts, opts) {
  const usePlanned = opts?.usePlannedHours ?? false;
  const byDay = /* @__PURE__ */ new Map();
  for (const s of shifts) {
    const dk = shiftCalendarDateKey(s);
    if (!dk || !s.id) continue;
    const bucket = byDay.get(dk) ?? { francoIds: [], hasWorkCheckIn: false };
    const code = String(s.code || "").trim().toUpperCase();
    if (isFrancoTrabajadoShift2(s) && code === "F" && !shiftHasRealCheckIn(s)) {
      bucket.francoIds.push(s.id);
    } else if (isLiquidationWorkCandidate(s) && (usePlanned || shiftHasRealCheckIn(s)) && isFrancoTrabajadoShift2(s)) {
      bucket.hasWorkCheckIn = true;
    }
    byDay.set(dk, bucket);
  }
  const skip = /* @__PURE__ */ new Set();
  for (const { francoIds, hasWorkCheckIn } of byDay.values()) {
    if (hasWorkCheckIn) francoIds.forEach((id) => skip.add(id));
  }
  return skip;
}
var LEAVE_REPORT_CODES = /* @__PURE__ */ new Set(["V", "L", "PG", "E", "A", "AA"]);
function isLeaveReportShift(shift) {
  const code = String(shift?.code || "").trim().toUpperCase();
  if (LEAVE_REPORT_CODES.has(code)) return true;
  if (shift?.type === "NOVEDAD" && (LEAVE_REPORT_CODES.has(code) || PERIOD_ONLY_CODES.has(code))) return true;
  if (shift?._absenceType && RRHH_ABSENCE_TYPES.has(String(shift._absenceType).trim())) return true;
  return false;
}
function shiftCalendarDateKey(shift) {
  const start = shift?.startTime?.toDate?.();
  if (!start) return "";
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}
function collapseShiftsByEmployeeDayForLiquidation(shifts, slaHoursHint = SHIFT_HOURS_LOOKUP3) {
  const singles = [];
  const groups = /* @__PURE__ */ new Map();
  for (const s of shifts) {
    const emp = String(s.employeeId ?? "").trim();
    const dk = shiftCalendarDateKey(s);
    if (!emp || !dk) {
      singles.push(s);
      continue;
    }
    const key = `${emp}__${dk}`;
    const list = groups.get(key) || [];
    list.push(s);
    groups.set(key, list);
  }
  const out = [...singles];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const merged = coalescePlannedTurnosForCell2(group, slaHoursHint);
    const billable = coalescePlannedCellBillableHours2(group, slaHoursHint);
    out.push({
      ...merged,
      id: merged?.id || group.map((g) => g.id).join("_"),
      _liquidationCoalescedIds: group.map((g) => g.id),
      _liquidationBillableHours: billable
    });
  }
  return out;
}
function liquidationBillableHoursForShift(shift, slaHoursHint = SHIFT_HOURS_LOOKUP3) {
  if (typeof shift?._liquidationBillableHours === "number" && shift._liquidationBillableHours > 0) {
    return shift._liquidationBillableHours;
  }
  return calcPlanningBillableShiftHours2(shift, slaHoursHint);
}
function effectiveEndForBillableDuration(start, plannedEnd, billableHours) {
  const plannedDur = Math.max(0, (plannedEnd.getTime() - start.getTime()) / 36e5);
  if (billableHours <= plannedDur + 0.15) return plannedEnd;
  return new Date(start.getTime() + billableHours * 36e5);
}
var getArgentinaDate = (dateInput) => {
  if (!dateInput) return "";
  try {
    const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (e) {
    return "";
  }
};
var getNightDuration = (start, end) => {
  let durationMins = 0;
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  let current = new Date(start.getTime());
  const endTime = end.getTime();
  let safety = 0;
  while (current.getTime() < endTime && safety < 1440) {
    const h = current.getHours();
    if (h >= 21 || h < 6) durationMins++;
    current.setMinutes(current.getMinutes() + 1);
    safety++;
  }
  return durationMins / 60;
};
function calculateLiquidationHoursStats(shifts, holidaysMap = {}, opts) {
  return calculateStatsExact(shifts, holidaysMap, opts);
}
var calculateStatsExact = (shifts, holidaysMap, opts) => {
  const usePlannedHours = opts?.usePlannedHours ?? false;
  const validShifts = shifts.filter((s) => parseShiftInstant(s.startTime) && parseShiftInstant(s.endTime));
  const sortedDocs = collapseShiftsByEmployeeDayForLiquidation(
    [...validShifts].sort((a, b) => (parseShiftInstant(a.startTime)?.getTime() || 0) - (parseShiftInstant(b.startTime)?.getTime() || 0))
  );
  const francoDocSkipIds = buildFrancoDocLiquidationSkipIds(sortedDocs, { usePlannedHours });
  let hoursTotalOperativas = 0;
  let horasDespliegue = 0;
  let totalDiurnas = 0;
  let totalNocturnas = 0;
  let hoursFT = 0;
  let horasFTReal = 0;
  let hoursFeriado = 0;
  let horasRealesTotal = 0;
  let horasRealesCobertura = 0;
  let horasRealesDespliegue = 0;
  let turnosConDatosReales = 0;
  sortedDocs.forEach((d) => {
    try {
      const st = (d.status || "").toLowerCase();
      if (st.includes("cancel") || st.includes("delet")) return;
      if (d.type === "NOVEDAD") return;
      if (d.coverageHoursOnSource === true || String(d.origin || "").toUpperCase() === "OPERATIONS_COVERAGE" && ["EXTEND", "ADVANCE"].includes(String(d.coverageType || "").toUpperCase())) {
        return;
      }
      const rawCode = (d.code || "").trim().toUpperCase();
      const isFT = isFrancoTrabajadoShift2(d);
      if (["FF", "V", "L", "PG", "A", "E", "AA", "EV"].includes(rawCode) && !isFT) return;
      if (rawCode === "F" && !isFT) return;
      if (isFT && rawCode === "F" && !shiftHasRealCheckIn(d) && francoDocSkipIds.has(d.id)) return;
      const rStartFB = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1e3) : d.checkInTime?.seconds ? new Date(d.checkInTime.seconds * 1e3) : null;
      const rEndFB = d.realEndTime?.seconds ? new Date(d.realEndTime.seconds * 1e3) : d.checkOutTime?.seconds ? new Date(d.checkOutTime.seconds * 1e3) : null;
      const start = parseShiftInstant(d.startTime) || rStartFB;
      const end = parseShiftInstant(d.endTime) || rEndFB;
      if (!start || !end) return;
      const isRet = rawCode === "RET" || d.isReten === true;
      const isDespliegue = isRet || isDeploymentOrPoolShift2(d);
      let duration;
      if (isRet) {
        if (!usePlannedHours && end > /* @__PURE__ */ new Date()) return;
        duration = RET_STANDBY_REFERENCE_HOURS2;
      } else if (isDeploymentOrPoolShift2(d)) {
        duration = deploymentShiftHours(d);
        if (duration <= 0) return;
        if (!usePlannedHours && end > /* @__PURE__ */ new Date()) return;
      } else {
        duration = (end.getTime() - start.getTime()) / 36e5;
        if (duration < 0 || duration > 24 || isNaN(duration)) {
          duration = SHIFT_HOURS_LOOKUP3[rawCode] || 8;
        }
        const billable = liquidationBillableHoursForShift(d);
        if (billable > duration + 0.1) duration = billable;
      }
      const statsEnd = effectiveEndForBillableDuration(start, end, duration);
      const night = getNightDuration(start, statsEnd);
      const day = Math.max(0, duration - night);
      const dateKey = getArgentinaDate(d.startTime);
      const isFeriado = holidaysMap[dateKey];
      if (isFT && (duration <= 0 || duration >= 23.5)) {
        duration = resolveFtLiquidationHours(d, duration > 0 && duration < 23.5 ? duration : 8);
      }
      if (isFeriado && !isFT) hoursFeriado += duration;
      const hasPlannedTimes = !!(parseShiftInstant(d.startTime) && parseShiftInstant(d.endTime));
      if (isFT) {
        hoursFT += duration;
      } else if (isDespliegue && hasPlannedTimes) {
        horasDespliegue += duration;
      } else if (hasPlannedTimes) {
        hoursTotalOperativas += duration;
      }
      const isAbsent = d.isAbsent === true || st.includes("absent") || st.includes("ausent");
      if (isAbsent || !usePlannedHours && end > /* @__PURE__ */ new Date()) return;
      const isEarlyStartShift = d.isEarlyStart === true;
      const isRetentionShift = d.isRetention === true || (d.retentionMinutes ?? 0) > 0;
      const clampS = (real, plan) => isEarlyStartShift ? real : plan;
      const clampE = (real, plan) => {
        if (!plan || isNaN(plan.getTime())) return real;
        if (real < plan) return plan;
        if (isRetentionShift) return real;
        return plan;
      };
      const rStartRaw = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1e3) : d.checkInTime?.seconds ? new Date(d.checkInTime.seconds * 1e3) : null;
      const rEndRaw = d.realEndTime?.seconds ? new Date(d.realEndTime.seconds * 1e3) : d.checkOutTime?.seconds ? new Date(d.checkOutTime.seconds * 1e3) : null;
      const rStart = !usePlannedHours && rStartRaw ? clampS(rStartRaw, start) : null;
      const rEnd = !usePlannedHours && rEndRaw ? clampE(rEndRaw, end) : null;
      let worked = 0;
      if (rStart && rEnd) {
        const rDur = (rEnd.getTime() - rStart.getTime()) / 36e5;
        if (rDur >= 0) {
          worked = Math.min(rDur, 24);
          turnosConDatosReales++;
        }
      } else if (isFT && !francoDocSkipIds.has(d.id)) {
        worked = resolveFtLiquidationHours(d, duration);
      } else if (isRet) {
        worked = duration;
      } else if (usePlannedHours) {
        worked = liquidationBillableHoursForShift(d);
        if (worked <= 0) worked = Math.min(Math.max(0, duration), 24);
        turnosConDatosReales++;
      }
      if (isFT && worked > 0) horasFTReal += worked;
      horasRealesTotal += worked;
      if (worked > 0) {
        if (isDespliegue && !isFT) horasRealesDespliegue += worked;
        else horasRealesCobertura += worked;
      }
      if (worked > 0) {
        const effS = rStart || start;
        const effE = rEnd || effectiveEndForBillableDuration(effS, end, worked);
        const nightWorked = getNightDuration(effS, effE);
        totalNocturnas += nightWorked;
        totalDiurnas += Math.max(0, worked - nightWorked);
      }
    } catch (err) {
      console.warn("Saltando turno corrupto:", d.id);
    }
  });
  const baseLimit = 204;
  const regularReal = Math.max(0, horasRealesTotal - horasFTReal);
  const excess = Math.max(0, regularReal - baseLimit);
  const horasSimples = Math.min(Math.max(0, horasRealesTotal), baseLimit);
  const horasCobertura = hoursTotalOperativas + hoursFT;
  const horasTeoricas = horasCobertura + horasDespliegue;
  return {
    totalReal: horasTeoricas,
    // nombre legacy, mantener por compat
    horasTeoricas,
    horasCobertura,
    horasDespliegue,
    horasReales: horasRealesTotal,
    horasRealesCobertura,
    horasRealesDespliegue,
    turnosConDatosReales,
    horasSimples,
    totalDiurnas,
    totalNocturnas,
    extra50: excess,
    extra100: horasFTReal,
    // Fix 1: usar horas FT reales, no teóricas
    plusFeriado: hoursFeriado,
    horasExtra: Math.max(0, horasRealesTotal - horasTeoricas)
  };
};

// packages/hours-core/src/motors/planning/planningTurnoCoalesce.ts
function turnoContributesCoverageMerge3(t) {
  if (!t) return false;
  if (t.isExtended || t.isEarlyStart) return true;
  const role = String(t.coverageSegmentRole || "").toUpperCase();
  if (role === "EXTENSION" || role === "EARLY_START") return true;
  const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
  return Number.isFinite(ex) && ex > 0;
}
function coalescePlannedTurnosForCell3(turnos, slaCodeHoursHint) {
  if (!turnos.length) return null;
  if (turnos.length === 1) return turnos[0];
  let primary = turnos[0];
  let bestH = calcPlanningBillableShiftHours2(primary, slaCodeHoursHint);
  for (const t of turnos) {
    const h = calcPlanningBillableShiftHours2(t, slaCodeHoursHint);
    if (h > bestH) {
      primary = t;
      bestH = h;
    }
  }
  const merged = { ...primary };
  for (const t of turnos) {
    if (!turnoContributesCoverageMerge3(t)) continue;
    merged.isExtended = merged.isExtended || t.isExtended;
    merged.isEarlyStart = merged.isEarlyStart || t.isEarlyStart;
    merged.coveragePackageId = merged.coveragePackageId || t.coveragePackageId;
    merged.coverageSegmentRole = merged.coverageSegmentRole || t.coverageSegmentRole;
    merged.coversPositionName = merged.coversPositionName || t.coversPositionName;
    merged.segmentFromTime = merged.segmentFromTime || t.segmentFromTime;
    merged.segmentToTime = merged.segmentToTime || t.segmentToTime;
    merged.adjustedEndTime = merged.adjustedEndTime || t.adjustedEndTime;
    merged.extensionEndTime = merged.extensionEndTime || t.extensionEndTime;
    merged.adjustedStartTime = merged.adjustedStartTime || t.adjustedStartTime;
    const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
    if (Number.isFinite(ex) && ex > 0) {
      merged.extExtraHours = Math.max(Number(merged.extExtraHours) || 0, ex);
    }
  }
  return merged;
}
function coalescePlannedCellBillableHours3(turnos, slaCodeHoursHint) {
  if (!turnos.length) return 0;
  const perTurno = turnos.map((t) => calcPlanningBillableShiftHours2(t, slaCodeHoursHint));
  let maxH = 0;
  for (const h of perTurno) {
    if (h > maxH) maxH = h;
  }
  const merged = coalescePlannedTurnosForCell3(turnos, slaCodeHoursHint);
  if (!merged) return Math.round(maxH * 100) / 100;
  const mergedH = calcPlanningBillableShiftHours2(merged, slaCodeHoursHint);
  return Math.round(Math.max(maxH, mergedH) * 100) / 100;
}

// packages/hours-core/src/time/ar.ts
var AR_OFFSET_MS2 = 3 * 3600 * 1e3;
function arShifted(d) {
  return new Date(d.getTime() - AR_OFFSET_MS2);
}
function arYmd(d) {
  const ar = arShifted(d);
  return `${ar.getUTCFullYear()}-${String(ar.getUTCMonth() + 1).padStart(2, "0")}-${String(ar.getUTCDate()).padStart(2, "0")}`;
}
function arYearMonth(d) {
  const ar = arShifted(d);
  return { year: ar.getUTCFullYear(), month: ar.getUTCMonth() + 1 };
}
function arMinutesOfDay(d) {
  const ar = arShifted(d);
  return ar.getUTCHours() * 60 + ar.getUTCMinutes();
}
function withArClock(base, hours, minutes) {
  const ar = arShifted(base);
  return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate(), hours, minutes, 0, 0) + AR_OFFSET_MS2);
}

// packages/hours-core/src/motors/liquidation/reportesLiquidation.ts
function planificacionPublishLookupKey(objectiveId, year, month) {
  return `${String(objectiveId ?? "").trim()}_${year}_${month}`;
}
var NON_WORK_CODES = /* @__PURE__ */ new Set(["F", "FF", "V", "L", "PG", "A", "E", "AA", "FP", "RET"]);
var PERIOD_ONLY_CODES2 = /* @__PURE__ */ new Set(["V"]);
var SHIFT_HOURS_LOOKUP4 = {
  "M": 8,
  "T": 8,
  "N": 8,
  "D12": 12,
  "N12": 12,
  "PU": 12,
  "GU": 8,
  "EN": 9,
  "FT": 0,
  "F": 0,
  "V": 0,
  "L": 8,
  "PG": 8,
  "A": 8,
  "E": 8,
  "FF": 0,
  "RET": 0,
  "REF": 8,
  "RFZ": 8,
  "TURA": 8,
  "ESC": 8
};
function parseShiftInstant2(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") {
    const d = val.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = val.seconds ?? val._seconds;
  if (typeof sec === "number" && sec > 0) return new Date(sec * 1e3);
  if (typeof val === "string") {
    const raw = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
var isOperationalOriginShift3 = (shift) => {
  const o = String(shift?.origin || "").toUpperCase();
  if (o === "RETEN" || o === "OPERATIONS_COVERAGE" || o === "SLA_VIRTUAL" || o === "CLIENT_REQUEST") return true;
  if (shift?.resolvedBy === "OPERACIONES") return true;
  if (shift?.isReten === true) return true;
  return false;
};
var shiftHasRealCheckIn2 = (shift) => {
  const st = String(shift?.status || "").toUpperCase();
  return !!(shift?.isPresent || shift?.isCompleted || shift?.checkInTime?.seconds || shift?.realStartTime?.seconds || st === "COMPLETED" || st === "PRESENT");
};
function isPlainFrancoDayOff(s) {
  const code = String(s?.code || "").trim().toUpperCase();
  if (code === "F" || code === "FP") return true;
  return s?.isFranco === true && code !== "FT" && !s?.isFrancoTrabajado;
}
function isLiquidationWorkCandidate2(s) {
  const code = String(s?.code || "").trim().toUpperCase();
  if (["F", "FF", "V", "L", "PG", "A", "E", "AA", "FP"].includes(code)) return false;
  if (isLeaveReportShift2(s)) return false;
  return true;
}
function isCoverageWorkShift(s) {
  return !!(s?._coveringFor || s?.absenceShiftId || s?.francoObjectiveId || s?.francoObjectiveName || s?.type === "EXTRA_FRANCO" || isOperationalOriginShift3(s));
}
function isFrancoTrabajadoShift3(shift) {
  if (shift?.isFrancoTrabajado === true) return true;
  if (shift?._inferredFrancoTrabajado === true) return true;
  const code = String(shift?.code || "").trim().toUpperCase();
  if (code === "FT") return true;
  if (shift?.type === "EXTRA_FRANCO") return true;
  if (String(shift?.coverageType || "").toUpperCase() === "FRANCO") return true;
  if (shift?.francoObjectiveId) return true;
  return false;
}
function propagateFrancoTrabajadoFlags(shifts, opts) {
  const usePlanned = opts?.usePlannedHours ?? false;
  const byDay = /* @__PURE__ */ new Map();
  for (const s of shifts) {
    const dk = shiftCalendarDateKey2(s);
    if (!dk) continue;
    (byDay.get(dk) ?? (byDay.set(dk, []), byDay.get(dk))).push(s);
  }
  const propagateIds = /* @__PURE__ */ new Set();
  for (const dayShifts of byDay.values()) {
    const plainFrancoRest = dayShifts.some((s) => isPlainFrancoDayOff(s) && !shiftHasRealCheckIn2(s));
    const ftMarkedOnFrancoDoc = dayShifts.some((s) => {
      const code = String(s.code || "").toUpperCase();
      return isFrancoTrabajadoShift3(s) && code === "F" && !shiftHasRealCheckIn2(s);
    });
    if (!plainFrancoRest && !ftMarkedOnFrancoDoc) continue;
    const workCandidates = dayShifts.filter(
      (s) => isLiquidationWorkCandidate2(s) && (usePlanned || shiftHasRealCheckIn2(s)) && !isFrancoTrabajadoShift3(s)
    );
    if (workCandidates.length === 0) continue;
    const coverageWork = workCandidates.filter(isCoverageWorkShift);
    const toMark = coverageWork.length > 0 ? coverageWork : workCandidates.length === 1 ? workCandidates : [];
    for (const s of toMark) propagateIds.add(s.id);
  }
  if (propagateIds.size === 0) return shifts;
  return shifts.map((s) => propagateIds.has(s.id) ? { ...s, isFrancoTrabajado: true, _inferredFrancoTrabajado: true, code: s.code || "FT" } : s);
}
var FT_FULL_DAY_HARD_CAP_HOURS = 12 + 59 / 60;
function resolveFtLiquidationHours2(shift, fallback = 8) {
  const startSec = shift.startTime?.seconds ?? shift.startTime?._seconds ?? 0;
  const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
  const rawSpanH = startSec && endSec ? Math.max(0, (endSec - startSec) / 3600) : 0;
  if (rawSpanH > 0 && rawSpanH < 23.5) return rawSpanH;
  const explicitHours = Number(shift.hours);
  if (Number.isFinite(explicitHours) && explicitHours > 0 && explicitHours < 23.5) {
    return Math.min(explicitHours, FT_FULL_DAY_HARD_CAP_HOURS);
  }
  const rStart = shift.realStartTime?.seconds ? new Date(shift.realStartTime.seconds * 1e3) : shift.checkInTime?.seconds ? new Date(shift.checkInTime.seconds * 1e3) : null;
  const rEnd = shift.realEndTime?.seconds ? new Date(shift.realEndTime.seconds * 1e3) : shift.checkOutTime?.seconds ? new Date(shift.checkOutTime.seconds * 1e3) : null;
  if (rStart && rEnd) {
    const fichadaH = (rEnd.getTime() - rStart.getTime()) / 36e5;
    if (fichadaH > 0) return Math.min(fichadaH, FT_FULL_DAY_HARD_CAP_HOURS);
  }
  const code = String(shift.code || "").trim().toUpperCase();
  if (code && code !== "F" && code !== "FT") {
    const fromLookup = SHIFT_HOURS_LOOKUP4[code];
    if (fromLookup && fromLookup > 0) return Math.min(fromLookup, FT_FULL_DAY_HARD_CAP_HOURS);
  }
  return Math.min(fallback > 0 && fallback < 23.5 ? fallback : 8, FT_FULL_DAY_HARD_CAP_HOURS);
}
function buildFrancoDocLiquidationSkipIds2(shifts, opts) {
  const usePlanned = opts?.usePlannedHours ?? false;
  const byDay = /* @__PURE__ */ new Map();
  for (const s of shifts) {
    const dk = shiftCalendarDateKey2(s);
    if (!dk || !s.id) continue;
    const bucket = byDay.get(dk) ?? { francoIds: [], hasWorkCheckIn: false };
    const code = String(s.code || "").trim().toUpperCase();
    if (isFrancoTrabajadoShift3(s) && code === "F" && !shiftHasRealCheckIn2(s)) {
      bucket.francoIds.push(s.id);
    } else if (isLiquidationWorkCandidate2(s) && (usePlanned || shiftHasRealCheckIn2(s)) && isFrancoTrabajadoShift3(s)) {
      bucket.hasWorkCheckIn = true;
    }
    byDay.set(dk, bucket);
  }
  const skip = /* @__PURE__ */ new Set();
  for (const { francoIds, hasWorkCheckIn } of byDay.values()) {
    if (hasWorkCheckIn) francoIds.forEach((id) => skip.add(id));
  }
  return skip;
}
function isShiftPublishedForReports(shift, publishStatusMap) {
  const start = parseShiftInstant2(shift?.startTime);
  if (!start || !shift?.objectiveId) return false;
  const { year, month } = arYearMonth(start);
  const pubKey = planificacionPublishLookupKey(shift.objectiveId, year, month);
  return pubKey ? !!publishStatusMap[pubKey] : false;
}
function isShiftEligibleForReports(shift, publishStatusMap, publishFilter = "published") {
  if (!shift?.startTime || !shift?.endTime) return false;
  const isDraft = shift?.draft === true;
  const isPublished = isShiftPublishedForReports(shift, publishStatusMap);
  const isOps = isOperationalOriginShift3(shift);
  const isNovedad = shift?.type === "NOVEDAD";
  if (publishFilter === "all") return true;
  if (publishFilter === "unpublished") {
    if (isOps || isNovedad) return false;
    if (isDraft) return true;
    if (!shift?.objectiveId) return false;
    return !isPublished;
  }
  if (isOps) return true;
  if (isNovedad) return true;
  if (isDraft) return false;
  if (shiftHasRealCheckIn2(shift)) return true;
  const st = String(shift?.status || "").toUpperCase();
  if (shift?.isAbsent || st === "ABSENT") return isPublished;
  if (!shift?.objectiveId) return false;
  return isPublished;
}
var LEAVE_REPORT_CODES2 = /* @__PURE__ */ new Set(["V", "L", "PG", "E", "A", "AA"]);
function isLeaveReportShift2(shift) {
  const code = String(shift?.code || "").trim().toUpperCase();
  if (LEAVE_REPORT_CODES2.has(code)) return true;
  if (shift?.type === "NOVEDAD" && (LEAVE_REPORT_CODES2.has(code) || PERIOD_ONLY_CODES2.has(code))) return true;
  if (shift?._absenceType && RRHH_ABSENCE_TYPES.has(String(shift._absenceType).trim())) return true;
  return false;
}
function leaveReportShiftScore(s) {
  const code = String(s.code || "").toUpperCase();
  let score = 0;
  if (LEAVE_REPORT_CODES2.has(code)) score += 50;
  if (s.type !== "NOVEDAD") score += 30;
  if (s.coveredBy || s._coveredBy) score += 10;
  if (s.absenceId) score += 5;
  return score;
}
function dedupeShiftsByAbsencePriority(shifts, opts) {
  const usePlanned = opts?.usePlannedHours ?? false;
  const byEmpDate = {};
  for (const s of shifts) {
    const dk = s._dateKey || shiftCalendarDateKey2(s);
    const key = dk ? `${s.employeeId || ""}_${dk}` : `__orphan_${s.id || Math.random()}`;
    (byEmpDate[key] ||= []).push(s);
  }
  const out = [];
  for (const [bucketKey, dayShifts] of Object.entries(byEmpDate)) {
    if (bucketKey.startsWith("__orphan_")) {
      out.push(...dayShifts);
      continue;
    }
    const leaveRows = dayShifts.filter(isLeaveReportShift2);
    const hasLeave = leaveRows.length > 0;
    if (leaveRows.length > 0) {
      const sorted = [...leaveRows].sort((a, b) => leaveReportShiftScore(b) - leaveReportShiftScore(a));
      const primary = { ...sorted[0] };
      const coveredBy = sorted.map((r) => r.coveredBy || r._coveredBy).find(Boolean);
      if (coveredBy && !primary.coveredBy) {
        primary.coveredBy = coveredBy;
        primary._coveredBy = primary._coveredBy || coveredBy;
      }
      out.push(primary);
    }
    for (const s of dayShifts) {
      if (isLeaveReportShift2(s)) continue;
      const code = String(s.code || "").toUpperCase();
      const isWork = !NON_WORK_CODES.has(code);
      const onLeave = isEmployeeOnLeave({ shiftCode: code, absenceType: s._absenceType });
      if (!usePlanned && (hasLeave || onLeave) && isWork && !shiftHasRealCheckIn2(s)) continue;
      out.push(s);
    }
  }
  return out.sort((a, b) => (a.startTime?.seconds || 0) - (b.startTime?.seconds || 0));
}
function shiftCalendarDateKey2(shift) {
  const start = parseShiftInstant2(shift?.startTime);
  if (!start) return "";
  return arYmd(start);
}
function isLiquidationTramoDoc(t) {
  if (!t) return false;
  if (t.isExtended || t.isEarlyStart) return true;
  const role = String(t.coverageSegmentRole || "").toUpperCase();
  if (role === "EXTENSION" || role === "EARLY_START") return true;
  const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
  return Number.isFinite(ex) && ex > 0;
}
function liquidationDocsOverlapInTime(a, b) {
  const sa = parseShiftInstant2(a?.startTime);
  const ea = parseShiftInstant2(a?.endTime);
  const sb = parseShiftInstant2(b?.startTime);
  const eb = parseShiftInstant2(b?.endTime);
  if (!sa || !ea || !sb || !eb) return false;
  return sa.getTime() < eb.getTime() && sb.getTime() < ea.getTime();
}
function shouldMergeLiquidationDocs(a, b) {
  if (liquidationDocsOverlapInTime(a, b)) return true;
  return isLiquidationTramoDoc(a) || isLiquidationTramoDoc(b);
}
function clusterLiquidationDocsForDay(group) {
  const n = group.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldMergeLiquidationDocs(group[i], group[j])) union(i, j);
    }
  }
  const clusters = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    (clusters.get(root) ?? (clusters.set(root, []), clusters.get(root))).push(group[i]);
  }
  return [...clusters.values()];
}
function collapseShiftsByEmployeeDayForLiquidation2(shifts, slaHoursHint = SHIFT_HOURS_LOOKUP4) {
  const singles = [];
  const groups = /* @__PURE__ */ new Map();
  for (const s of shifts) {
    const emp = String(s.employeeId ?? "").trim();
    const dk = shiftCalendarDateKey2(s);
    if (!emp || !dk) {
      singles.push(s);
      continue;
    }
    const key = `${emp}__${dk}`;
    const list = groups.get(key) || [];
    list.push(s);
    groups.set(key, list);
  }
  const out = [...singles];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const clusters = clusterLiquidationDocsForDay(group);
    const clusterHours = clusters.map((cl) => cl.length === 1 ? liquidationBillableHoursForShift2(cl[0], slaHoursHint) : coalescePlannedCellBillableHours3(cl, slaHoursHint));
    const dayTotalHours = clusterHours.reduce((sum, h) => sum + (Number.isFinite(h) ? h : 0), 0);
    const exceeds12h = dayTotalHours > 12 + 0.01;
    clusters.forEach((cl, i) => {
      if (cl.length === 1) {
        out.push(exceeds12h ? { ...cl[0], _liquidationDayExceeds12h: true } : cl[0]);
        return;
      }
      const merged = coalescePlannedTurnosForCell3(cl, slaHoursHint);
      out.push({
        ...merged,
        id: merged?.id || cl.map((g) => g.id).join("_"),
        _liquidationCoalescedIds: cl.map((g) => g.id),
        _liquidationBillableHours: clusterHours[i],
        ...exceeds12h ? { _liquidationDayExceeds12h: true } : {}
      });
    });
  }
  return out;
}
function liquidationBillableHoursForShift2(shift, slaHoursHint = SHIFT_HOURS_LOOKUP4) {
  if (typeof shift?._liquidationBillableHours === "number" && shift._liquidationBillableHours > 0) {
    return shift._liquidationBillableHours;
  }
  return calcPlanningBillableShiftHours2(shift, slaHoursHint);
}
function applyHHmmToShiftDate(base, hhmm) {
  const m = String(hhmm).trim().slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return new Date(base);
  return withArClock(base, Number(m[1]), Number(m[2]));
}
function hhmmToMinutes(hhmm) {
  const m = String(hhmm).trim().slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function coverageSegmentIsPreBandAdelanto(shift, bandStart) {
  const segFrom = shift?.segmentFromTime || (shift?.isEarlyStart ? shift.adjustedStartTime : null);
  const segTo = shift?.segmentToTime || (shift?.isExtended ? shift.adjustedEndTime || shift.extensionEndTime : null);
  if (!segFrom || !segTo) return false;
  const bandMin = arMinutesOfDay(bandStart);
  const fromM = hhmmToMinutes(String(segFrom));
  const toM = hhmmToMinutes(String(segTo));
  if (fromM == null || toM == null) return false;
  const tol = 35;
  if (Math.abs(toM - bandMin) <= tol) return true;
  if (fromM < bandMin && toM <= bandMin && toM > fromM) return true;
  return false;
}
function resolveLiquidationPlannedWindow(shift, plannedStart, plannedEnd, slaHoursHint = SHIFT_HOURS_LOOKUP4) {
  const bandStart = new Date(plannedStart);
  const bandEnd = new Date(plannedEnd);
  let dispStart = new Date(plannedStart);
  let dispEnd = new Date(plannedEnd);
  const role = String(shift?.coverageSegmentRole || "").toUpperCase();
  const preBandAdelanto = coverageSegmentIsPreBandAdelanto(shift, bandStart);
  const isEarly = shift?.isEarlyStart === true || role === "EARLY_START" || preBandAdelanto;
  const isExt = (shift?.isExtended === true || role === "EXTENSION") && !preBandAdelanto;
  if (isEarly) {
    const from = shift.adjustedStartTime || shift.segmentFromTime;
    if (from) dispStart = applyHHmmToShiftDate(plannedStart, String(from));
  }
  if (isExt) {
    const to = shift.adjustedEndTime || shift.extensionEndTime || shift.segmentToTime;
    if (to) {
      dispEnd = applyHHmmToShiftDate(plannedEnd, String(to));
      if (dispEnd.getTime() <= dispStart.getTime()) {
        dispEnd = new Date(dispEnd.getTime() + 24 * 36e5);
      }
    }
  }
  const billable = liquidationBillableHoursForShift2(shift, slaHoursHint);
  let spanH = Math.max(0, (dispEnd.getTime() - dispStart.getTime()) / 36e5);
  if (billable > spanH + 0.1) {
    if (preBandAdelanto || isEarly && !isExt) {
      dispEnd = new Date(bandEnd);
      spanH = Math.max(0, (dispEnd.getTime() - dispStart.getTime()) / 36e5);
    } else {
      dispEnd = new Date(dispStart.getTime() + billable * 36e5);
      spanH = billable;
    }
  }
  const hasCoverageAdjust = isEarly || isExt || Math.abs(dispStart.getTime() - bandStart.getTime()) > 6e4 || Math.abs(dispEnd.getTime() - bandEnd.getTime()) > 6e4 || billable > spanH + 0.1;
  return {
    start: dispStart,
    end: dispEnd,
    bandStart,
    bandEnd,
    hasCoverageAdjust,
    isEarlyDisplay: isEarly,
    isExtDisplay: isExt
  };
}
function effectiveEndForBillableDuration2(start, plannedEnd, billableHours) {
  const plannedDur = Math.max(0, (plannedEnd.getTime() - start.getTime()) / 36e5);
  if (billableHours <= plannedDur + 0.15) return plannedEnd;
  return new Date(start.getTime() + billableHours * 36e5);
}
function prepareShiftsForEmployeeLiquidation(shifts) {
  const byDay = /* @__PURE__ */ new Map();
  for (const s of shifts) {
    const dk = shiftCalendarDateKey2(s) || `__${s.id || Math.random()}`;
    (byDay.get(dk) ?? (byDay.set(dk, []), byDay.get(dk))).push(s);
  }
  const operativeDays = /* @__PURE__ */ new Set();
  for (const [dk, dayShifts] of byDay) {
    if (dk.startsWith("__")) continue;
    if (dayShifts.some(isRegularLiquidationWorkShift)) operativeDays.add(dk);
  }
  return shifts.filter((s) => {
    const code = String(s.code || "").toUpperCase();
    const isRet = code === "RET" || s.isReten === true;
    if (!isRet) return true;
    const dk = shiftCalendarDateKey2(s);
    return !(dk && operativeDays.has(dk));
  });
}
var getArgentinaDate2 = (dateInput) => {
  const d = parseShiftInstant2(dateInput);
  return d ? arYmd(d) : "";
};
var getNightDuration2 = (start, end) => {
  let durationMins = 0;
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  let current = new Date(start.getTime());
  const endTime = end.getTime();
  let safety = 0;
  while (current.getTime() < endTime && safety < 1440) {
    const h = new Date(current.getTime() - 3 * 3600 * 1e3).getUTCHours();
    if (h >= 21 || h < 6) durationMins++;
    current.setMinutes(current.getMinutes() + 1);
    safety++;
  }
  return durationMins / 60;
};
function calculateLiquidationHoursStats2(shifts, holidaysMap = {}, opts) {
  return calculateStatsExact2(shifts, holidaysMap, opts);
}
var calculateStatsExact2 = (shifts, holidaysMap, opts) => {
  const usePlannedHours = opts?.usePlannedHours ?? false;
  const validShifts = shifts.filter((s) => parseShiftInstant2(s.startTime) && parseShiftInstant2(s.endTime));
  const sortedDocs = collapseShiftsByEmployeeDayForLiquidation2(
    [...validShifts].sort((a, b) => (parseShiftInstant2(a.startTime)?.getTime() || 0) - (parseShiftInstant2(b.startTime)?.getTime() || 0))
  );
  const francoDocSkipIds = buildFrancoDocLiquidationSkipIds2(sortedDocs, { usePlannedHours });
  let hoursTotalOperativas = 0;
  let horasDespliegue = 0;
  let totalDiurnas = 0;
  let totalNocturnas = 0;
  let hoursFT = 0;
  let horasFTReal = 0;
  let hoursFeriado = 0;
  let horasRealesTotal = 0;
  let horasRealesCobertura = 0;
  let horasRealesDespliegue = 0;
  let turnosConDatosReales = 0;
  let desglosePlan = 0;
  let desgloseExt = 0;
  let desgloseAdv = 0;
  let desgloseCobertura = 0;
  let desgloseFt = 0;
  let desgloseTura = 0;
  const warnings = [];
  const exceeds12hDaysWarned = /* @__PURE__ */ new Set();
  sortedDocs.forEach((d) => {
    try {
      const st = (d.status || "").toLowerCase();
      if (st.includes("cancel") || st.includes("delet")) return;
      if (d.type === "NOVEDAD") return;
      if (d._liquidationDayExceeds12h) {
        const dk = shiftCalendarDateKey2(d) || "?";
        if (!exceeds12hDaysWarned.has(dk)) {
          exceeds12hDaysWarned.add(dk);
          warnings.push(`D\xEDa ${dk} supera 12 h (jornadas independientes) \u2014 se paga completo, requiere revisi\xF3n.`);
        }
      }
      if (d.coverageHoursOnSource === true || String(d.origin || "").toUpperCase() === "OPERATIONS_COVERAGE" && ["EXTEND", "ADVANCE"].includes(String(d.coverageType || "").toUpperCase())) {
        return;
      }
      const rawCode = (d.code || "").trim().toUpperCase();
      const isFT = isFrancoTrabajadoShift3(d);
      if (["FF", "V", "L", "PG", "A", "E", "AA", "EV"].includes(rawCode) && !isFT) return;
      if (rawCode === "F" && !isFT) return;
      if (isFT && rawCode === "F" && !shiftHasRealCheckIn2(d) && francoDocSkipIds.has(d.id)) return;
      const rStartFB = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1e3) : d.checkInTime?.seconds ? new Date(d.checkInTime.seconds * 1e3) : null;
      const rEndFB = d.realEndTime?.seconds ? new Date(d.realEndTime.seconds * 1e3) : d.checkOutTime?.seconds ? new Date(d.checkOutTime.seconds * 1e3) : null;
      const start = parseShiftInstant2(d.startTime) || rStartFB;
      const end = parseShiftInstant2(d.endTime) || rEndFB;
      if (!start || !end) return;
      const isRet = rawCode === "RET" || d.isReten === true;
      const isDespliegue = isRet || isDeploymentOrPoolShift2(d);
      let duration;
      if (isRet) {
        if (!usePlannedHours && end > /* @__PURE__ */ new Date()) return;
        duration = RET_STANDBY_REFERENCE_HOURS2;
      } else if (isDeploymentOrPoolShift2(d)) {
        duration = deploymentShiftHours(d);
        if (duration <= 0) return;
        if (!usePlannedHours && end > /* @__PURE__ */ new Date()) return;
      } else {
        duration = (end.getTime() - start.getTime()) / 36e5;
        if (duration < 0 || duration > 24 || isNaN(duration)) {
          duration = SHIFT_HOURS_LOOKUP4[rawCode] || 8;
        }
        const billable = liquidationBillableHoursForShift2(d);
        if (billable > duration + 0.1) duration = billable;
      }
      const statsEnd = effectiveEndForBillableDuration2(start, end, duration);
      const night = getNightDuration2(start, statsEnd);
      const day = Math.max(0, duration - night);
      const dateKey = getArgentinaDate2(d.startTime);
      const isFeriado = holidaysMap[dateKey];
      const isFtFullDayPlaceholder = isFT && (duration <= 0 || duration >= 23.5);
      if (isFtFullDayPlaceholder) {
        duration = resolveFtLiquidationHours2(d, duration > 0 && duration < 23.5 ? duration : 8);
      }
      if (isFeriado && !isFT) hoursFeriado += duration;
      const hasPlannedTimes = !!(parseShiftInstant2(d.startTime) && parseShiftInstant2(d.endTime));
      if (isFT) {
        hoursFT += duration;
      } else if (isDespliegue && hasPlannedTimes) {
        horasDespliegue += duration;
      } else if (hasPlannedTimes) {
        hoursTotalOperativas += duration;
      }
      const isAbsent = d.isAbsent === true || st.includes("absent") || st.includes("ausent");
      if (isAbsent || !usePlannedHours && end > /* @__PURE__ */ new Date()) return;
      const isEarlyStartShift = d.isEarlyStart === true;
      const isRetentionShift = d.isRetention === true || (d.retentionMinutes ?? 0) > 0;
      const hasRegisteredRelevo = !!(d.relievedBy || d.relievedByName);
      const clampS = (real, plan) => {
        if (isEarlyStartShift) return real;
        if (real.getTime() > plan.getTime()) return real;
        return plan;
      };
      const plannedWindow2 = resolveLiquidationPlannedWindow(d, start, end);
      const authorizedEnd = plannedWindow2.isExtDisplay ? plannedWindow2.end : null;
      const clampE = (real, plan) => {
        if (!plan || isNaN(plan.getTime())) return real;
        if (real < plan) {
          return hasRegisteredRelevo ? plan : real;
        }
        if (isRetentionShift) return real;
        if (authorizedEnd && authorizedEnd > plan) {
          return real < authorizedEnd ? real : authorizedEnd;
        }
        return plan;
      };
      const rStartRaw = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1e3) : d.checkInTime?.seconds ? new Date(d.checkInTime.seconds * 1e3) : null;
      const rEndRaw = d.realEndTime?.seconds ? new Date(d.realEndTime.seconds * 1e3) : d.checkOutTime?.seconds ? new Date(d.checkOutTime.seconds * 1e3) : null;
      const rStart = !usePlannedHours && rStartRaw ? clampS(rStartRaw, start) : null;
      const rEnd = !usePlannedHours && rEndRaw ? clampE(rEndRaw, end) : null;
      let worked = 0;
      if (rStart && rEnd) {
        const rDur = (rEnd.getTime() - rStart.getTime()) / 36e5;
        if (rDur >= 0) {
          worked = Math.min(rDur, isFtFullDayPlaceholder ? FT_FULL_DAY_HARD_CAP_HOURS : 24);
          turnosConDatosReales++;
        }
      } else if (isFT && !francoDocSkipIds.has(d.id)) {
        worked = resolveFtLiquidationHours2(d, duration);
      } else if (isRet) {
        worked = duration;
      } else if (usePlannedHours) {
        worked = liquidationBillableHoursForShift2(d);
        if (worked <= 0) worked = Math.min(Math.max(0, duration), 24);
        turnosConDatosReales++;
      }
      if (isFT && worked > 0) horasFTReal += worked;
      horasRealesTotal += worked;
      if (worked > 0) {
        const codeUp = rawCode.includes("/") ? rawCode.split("/")[0] : rawCode;
        const band = SHIFT_HOURS_LOOKUP4[codeUp] > 0 ? SHIFT_HOURS_LOOKUP4[codeUp] : Math.max(0, duration);
        const planPart = Math.min(worked, band || worked);
        const extraPart = Math.max(0, Math.round((worked - planPart) * 100) / 100);
        const origin = String(d.origin || "").toUpperCase();
        const isCobertura = origin === "OPERATIONS_COVERAGE" && d.coverageHoursOnSource !== true && !["EXTEND", "ADVANCE"].includes(String(d.coverageType || "").toUpperCase());
        if (isFT) desgloseFt += worked;
        else if (codeUp === "TURA" || codeUp === "RFZ") desgloseTura += worked;
        else if (isCobertura) desgloseCobertura += worked;
        else if (d.isEarlyStart === true) {
          desglosePlan += planPart;
          desgloseAdv += extraPart;
        } else if (d.isExtended === true || d.isRetention === true || String(d.coverageSegmentRole || "").toUpperCase() === "EXTENSION") {
          desglosePlan += planPart;
          desgloseExt += extraPart;
        } else {
          desglosePlan += worked;
        }
      }
      if (worked > 0) {
        if (isDespliegue && !isFT) horasRealesDespliegue += worked;
        else horasRealesCobertura += worked;
      }
      if (worked > 0) {
        const effS = rStart || start;
        const effE = rEnd || effectiveEndForBillableDuration2(effS, end, worked);
        const nightWorked = getNightDuration2(effS, effE);
        totalNocturnas += nightWorked;
        totalDiurnas += Math.max(0, worked - nightWorked);
      }
    } catch (err) {
      console.warn("Saltando turno corrupto:", d.id);
    }
  });
  const baseLimit = 200;
  const regularReal = Math.max(0, horasRealesTotal - horasFTReal);
  const excess = Math.max(0, regularReal - baseLimit);
  const horasSimples = Math.min(Math.max(0, horasRealesTotal), baseLimit);
  const horasCobertura = hoursTotalOperativas + hoursFT;
  const horasTeoricas = horasCobertura + horasDespliegue;
  return {
    totalReal: horasTeoricas,
    // nombre legacy, mantener por compat
    horasTeoricas,
    horasCobertura,
    horasDespliegue,
    horasReales: horasRealesTotal,
    horasRealesCobertura,
    horasRealesDespliegue,
    turnosConDatosReales,
    horasSimples,
    totalDiurnas,
    totalNocturnas,
    extra50: excess,
    extra100: horasFTReal,
    // Fix 1: usar horas FT reales, no teóricas
    plusFeriado: hoursFeriado,
    horasExtra: Math.max(0, horasRealesTotal - horasTeoricas),
    /** Número principal del libro persona (trabajadas, incluye FT). */
    totales: horasRealesTotal,
    /** Columna de seguimiento; no es el número principal. */
    planificadas: horasTeoricas,
    desglose: {
      plan: desglosePlan,
      ext: desgloseExt,
      adv: desgloseAdv,
      cobertura: desgloseCobertura,
      ft: desgloseFt,
      tura: desgloseTura
    },
    /** Decisión Mauro H1 #2: días con jornadas independientes que suman >12 h (revisar, no se recorta el pago). */
    warnings,
    requiresReview: warnings.length > 0
  };
};

// packages/hours-core/src/persona/personaBook.ts
function personaCalendarDateStr(val) {
  if (val == null || val === "") return null;
  if (typeof val === "string") {
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const dt = new Date(val);
    return isNaN(dt.getTime()) ? null : arYmd(dt);
  }
  if (typeof val === "object") {
    const rec = val;
    if (typeof rec.toDate === "function") return arYmd(rec.toDate());
    const sec = rec.seconds ?? rec._seconds;
    if (typeof sec === "number") return arYmd(new Date(sec * 1e3));
  }
  return null;
}
function personaIterateDateRange(startStr, endStr) {
  if (String(endStr).slice(0, 10) < String(startStr).slice(0, 10)) return [];
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  if (!sy || !ey) return [];
  const out = [];
  let cur = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  while (cur <= end) {
    const d = new Date(cur);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
    cur += 24 * 36e5;
  }
  return out;
}
function computePersonaEmployeeLiquidation(shifts, holidays, opts) {
  const usePlannedHours = opts?.usePlannedHours ?? false;
  const prepared = prepareShiftsForEmployeeLiquidation(
    dedupeShiftsByAbsencePriority(
      propagateFrancoTrabajadoFlags(shifts, { usePlannedHours }),
      { usePlannedHours }
    )
  );
  return {
    shifts: prepared,
    stats: calculateLiquidationHoursStats2(prepared, holidays, { usePlannedHours })
  };
}
function buildPersonaBook(input) {
  const usePlannedHours = input.usePlannedHours ?? false;
  const publishFilter = input.publishFilter ?? "published";
  const { publishStatusMap, empNameById } = input;
  const ftShiftIds = /* @__PURE__ */ new Set();
  const allByEmp = {};
  for (const s of input.turnos) {
    if (!s.employeeId) continue;
    (allByEmp[s.employeeId] ||= []).push(s);
  }
  for (const empShifts of Object.values(allByEmp)) {
    propagateFrancoTrabajadoFlags(empShifts, { usePlannedHours }).forEach((s) => {
      if (s.isFrancoTrabajado || s._inferredFrancoTrabajado) ftShiftIds.add(s.id);
    });
  }
  const rawShifts = input.turnos.filter((d) => isShiftEligibleForReports(d, publishStatusMap, publishFilter));
  const absenceById = {};
  const absenceByEmpDate = {};
  for (const absDoc of input.ausencias) {
    absenceById[absDoc.id] = absDoc;
    const startStr = personaCalendarDateStr(absDoc.startDate);
    const endStr = personaCalendarDateStr(absDoc.endDate || absDoc.startDate);
    if (!startStr || !endStr) continue;
    for (const dateStr2 of personaIterateDateRange(startStr, endStr)) {
      if (dateStr2 < input.rangeStartYmd || dateStr2 > input.rangeEndYmd) continue;
      absenceByEmpDate[`${absDoc.employeeId}_${dateStr2}`] = absDoc;
    }
  }
  const coverageByEmpDate = {};
  const coveringForByEmpDate = {};
  for (const s of rawShifts) {
    const dk = shiftCalendarDateKey2(s);
    const comments = String(s.comments || "");
    const m = comments.match(/Cubriendo a (.+?) \(/);
    if (m && dk) {
      const titularName = m[1].trim();
      const titularId = Object.keys(empNameById).find((id) => empNameById[id] === titularName);
      if (titularId) {
        const covName = s.employeeName || empNameById[s.employeeId] || "\u2014";
        coverageByEmpDate[`${titularId}_${dk}`] = covName;
        const coverCode = String(s.code || "").trim().toUpperCase();
        coveringForByEmpDate[`${s.employeeId}_${dk}`] = coverCode ? `${titularName} turno ${coverCode}` : titularName;
      }
    }
    if (s.coveredBy && dk) {
      coverageByEmpDate[`${s.employeeId}_${dk}`] = String(s.coveredBy).replace(/\s*\([^)]*\)\s*$/, "").trim();
    }
  }
  const shiftIdToShift = {};
  for (const s of rawShifts) if (s.id) shiftIdToShift[s.id] = s;
  const coveringForByEmpIdDate = {};
  for (const s of rawShifts) {
    if (!s.coveredByEmployeeId) continue;
    const dk = shiftCalendarDateKey2(s);
    if (!dk) continue;
    const key = `${s.coveredByEmployeeId}_${dk}`;
    const isVacancy = !s.employeeId || s.isUnassigned;
    const desc = isVacancy ? `Vacante${s.positionName ? " " + s.positionName : ""}${s.code ? " (" + s.code + ")" : ""}` : s.employeeName || "Guardia";
    if (!coveringForByEmpIdDate[key]) coveringForByEmpIdDate[key] = desc;
  }
  const resolveCoveringFor = (s, dk) => {
    const refId = s.absenceShiftId;
    if (refId && shiftIdToShift[refId]) {
      const ref = shiftIdToShift[refId];
      const isVacancy = !ref.employeeId || ref.employeeId === "VACANTE" || ref.isUnassigned;
      if (isVacancy) {
        const pos = ref.positionName || "";
        const code = (ref.code || "").toUpperCase();
        return `Vacante${pos ? " " + pos : ""}${code ? " (" + code + ")" : ""}`;
      }
      return ref.employeeName || null;
    }
    if (dk && coveringForByEmpIdDate[`${s.employeeId}_${dk}`]) {
      return coveringForByEmpIdDate[`${s.employeeId}_${dk}`];
    }
    if (s.relievedEmployeeName) return s.relievedEmployeeName;
    if (dk && s.objectiveId && s.positionName) {
      const sameSlotAbsent = rawShifts.find(
        (r) => r.id !== s.id && (r.isAbsent || r.status === "ABSENT") && r.objectiveId === s.objectiveId && (r.positionName || "").trim().toLowerCase() === (s.positionName || "").trim().toLowerCase() && shiftCalendarDateKey2(r) === dk
      );
      if (sameSlotAbsent?.employeeName) return sameSlotAbsent.employeeName;
      const isOpsShift = ["RETEN", "EARLY_START", "OPERATIONS_COVERAGE"].includes((s.origin || "").toUpperCase());
      if (isOpsShift) return `Vacante ${s.positionName || ""}`;
    }
    return null;
  };
  const enrichShift = (s) => {
    const dk = shiftCalendarDateKey2(s);
    const abs = s.absenceId ? absenceById[s.absenceId] : dk ? absenceByEmpDate[`${s.employeeId}_${dk}`] : null;
    const coveredByName = s.coveredByEmployeeName || s.coveredBy || (dk ? coverageByEmpDate[`${s.employeeId}_${dk}`] : null) || null;
    const coveringFor = resolveCoveringFor(s, dk) || (dk ? coveringForByEmpDate[`${s.employeeId}_${dk}`] : null) || null;
    return {
      ...s,
      _dateKey: dk,
      _isPublished: isShiftPublishedForReports(s, publishStatusMap),
      _absenceType: abs?.type || null,
      _absenceStatus: abs?.status || null,
      _absenceReason: abs?.reason || null,
      _coveredBy: coveredByName,
      _coveringFor: coveringFor
    };
  };
  const empGroups = {};
  for (const s of rawShifts) {
    if (!s.employeeId || !empNameById[s.employeeId]) continue;
    const sWithFT = ftShiftIds.has(s.id) ? { ...s, isFrancoTrabajado: true, _inferredFrancoTrabajado: true, code: s.code || "FT" } : s;
    (empGroups[s.employeeId] ||= []).push(enrichShift(sWithFT));
  }
  const employees = [];
  const byEmployee = /* @__PURE__ */ new Map();
  for (const [employeeId, group] of Object.entries(empGroups)) {
    const { shifts, stats } = computePersonaEmployeeLiquidation(group, input.holidays, { usePlannedHours });
    const entry = { employeeId, shifts, stats };
    employees.push(entry);
    byEmployee.set(employeeId, entry);
  }
  return { rawShifts, enrichShift, employees, byEmployee };
}

// scripts/hours-ledger/engineEntry.ts
var PAID = /* @__PURE__ */ new Set(["V", "L", "E", "A", "PG"]);
var r12 = (n) => Math.round((Number(n) || 0) * 10) / 10;
function pad(n) {
  return String(n).padStart(2, "0");
}
function monthKey(year, month) {
  return `${year}-${pad(month)}`;
}
function lastDay(year, month) {
  return new Date(year, month, 0).getDate();
}
function ymd(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}
function eachDay(year, month) {
  const n = lastDay(year, month);
  const out = [];
  for (let d = 1; d <= n; d++) out.push(ymd(year, month, d));
  return out;
}
function arRange(year, month) {
  const end = lastDay(year, month);
  return {
    start: /* @__PURE__ */ new Date(`${year}-${pad(month)}-01T00:00:00.000-03:00`),
    end: /* @__PURE__ */ new Date(`${year}-${pad(month)}-${pad(end)}T23:59:59.999-03:00`)
  };
}
function positionsOf(srv) {
  if (Array.isArray(srv?.positions)) return srv.positions;
  return Object.values(srv?.positions || {});
}
function clientActivo(status) {
  const u = String(status ?? "ACTIVO").trim().toUpperCase();
  return u === "ACTIVO" || u === "ACTIVE" || u === "";
}
function contractActive(status) {
  const st = String(status ?? "").trim().toLowerCase();
  if (!st) return true;
  return st !== "inactive" && st !== "inactivo" && st !== "cancelled" && st !== "cancelado";
}
function dateStr(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().slice(0, 10);
  const o = value;
  const d = typeof o.toDate === "function" ? o.toDate() : typeof (o.seconds ?? o._seconds) === "number" ? new Date((o.seconds ?? o._seconds) * 1e3) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
function overlapsMonth(start, end, year, month) {
  const from = `${year}-${pad(month)}-01`;
  const to = ymd(year, month, lastDay(year, month));
  const s = start || "1970-01-01";
  const e = end || "2099-12-31";
  return s <= to && e >= from;
}
function prorate(srv, year, month) {
  const start = dateStr(srv.startDate);
  const end = dateStr(srv.endDate) || "2099-12-31";
  const from = start > ymd(year, month, 1) ? start : ymd(year, month, 1);
  const toM = ymd(year, month, lastDay(year, month));
  const to = end < toM ? end : toM;
  if (!start || from > to) return 0;
  const rows = calculateMonthlyBreakdown(positionsOf(srv), from, to, srv.excludedDates);
  return Math.round(rows.reduce((a, m) => a + m.totalHours, 0));
}
function dayHours(srv, day) {
  const start = dateStr(srv.startDate);
  const end = dateStr(srv.endDate) || "2099-12-31";
  if (!start || day < start || day > end) return 0;
  const rows = calculateMonthlyBreakdown(positionsOf(srv), day, day, srv.excludedDates);
  return rows.reduce((a, m) => a + m.totalHours, 0);
}
function puestoSlug(name, id) {
  const raw = String(id || name || "puesto").trim() || "puesto";
  return raw.replace(/[/\s#?[\]]+/g, "_").slice(0, 80);
}
function blankMetrics() {
  return {
    slaActive: 0,
    slaInactive: 0,
    slaClosed: 0,
    planPublished: 0,
    planDraft: 0,
    worked: 0,
    covered: 0,
    uncovered: 0,
    ft: 0,
    ext: 0,
    adv: 0,
    novedadPaga: 0
  };
}
function addMetrics(a, b) {
  Object.keys(a).forEach((k) => {
    a[k] = r12(a[k] + (Number(b[k]) || 0));
  });
}
function planHoursOf(mode, row) {
  if (mode === "draft") return row.planDraft;
  if (mode === "both") return r12(row.planPublished + row.planDraft);
  return row.planPublished;
}
function buildLedgerMonth(input) {
  const { empresaId, year, month, hoursCoreEnabled, clients, slas, turnos, ausencias, publishStatusMap, empNameById } = input;
  const periodKey = monthKey(year, month);
  const { start, end } = arRange(year, month);
  const clientById = new Map(clients.map((c) => [String(c.id), c]));
  const normName2 = (v) => String(v ?? "").trim().toLowerCase().normalize("NFD").replace(new RegExp("\\p{Mn}", "gu"), "");
  const ownerByObjective = /* @__PURE__ */ new Map();
  const ownerByObjName = /* @__PURE__ */ new Map();
  for (const c of clients) {
    const objs = c.objetivos || c.objectives || [];
    const meta = { clientId: String(c.id), clientName: String(c.name || c.razonSocial || "") };
    for (const o of objs) {
      const id = String(o?.id || o?.objectiveId || "").trim();
      const name = normName2(o?.name || o?.nombre);
      if (id && !ownerByObjective.has(id)) ownerByObjective.set(id, meta);
      if (name && !ownerByObjName.has(name)) ownerByObjName.set(name, meta);
    }
  }
  const clientByName = /* @__PURE__ */ new Map();
  for (const c of clients) {
    const n = normName2(c.name || c.razonSocial);
    if (n && !clientByName.has(n)) clientByName.set(n, c);
  }
  const resolveClient = (objectiveId, sla) => {
    const fromSla = String(sla?.clientId || "").trim();
    const direct = fromSla ? clientById.get(fromSla) : void 0;
    if (direct) {
      return { clientId: fromSla, clientName: String(direct.name || direct.razonSocial || sla?.clientName || ""), client: direct };
    }
    const owner = ownerByObjective.get(objectiveId) || ownerByObjName.get(normName2(sla?.objectiveName));
    if (owner) {
      return { ...owner, client: clientById.get(owner.clientId) };
    }
    const byName = clientByName.get(normName2(sla?.clientName));
    if (byName) {
      return { clientId: String(byName.id), clientName: String(byName.name || byName.razonSocial || ""), client: byName };
    }
    return { clientId: fromSla, clientName: String(sla?.clientName || ""), client: void 0 };
  };
  const chosen = /* @__PURE__ */ new Map();
  const consider = (srv, bucket) => {
    const oid = String(srv.objectiveId || "").trim();
    if (!oid) return;
    const startS = dateStr(srv.startDate);
    const endS = dateStr(srv.endDate);
    if (!overlapsMonth(startS, endS, year, month)) return;
    const prev = chosen.get(`${bucket}:${oid}`);
    if (!prev || startS.localeCompare(dateStr(prev.srv.startDate)) > 0) {
      chosen.set(`${bucket}:${oid}`, { srv, bucket, hours: 0 });
    }
  };
  for (const srv of slas) {
    const closed = srv.closed === true;
    const active = contractActive(srv.status);
    const who = resolveClient(String(srv.objectiveId || ""), srv);
    const activoCli = who.client ? clientActivo(who.client.status) : clientActivo(void 0);
    if (closed && active) consider(srv, "closed");
    else if (!active) consider(srv, "inactive");
    else if (!activoCli) consider(srv, "inactive");
    else consider(srv, "active");
  }
  for (const row of chosen.values()) row.hours = prorate(row.srv, year, month);
  const prepared = slas.map((s) => ({ ...s, positions: positionsOf(s) }));
  const vigente = pickVigenteSlasForPeriod(prepared, start, end);
  const aliases = buildObjectiveAliasesFromSla(vigente);
  const slaExclusionCtx = buildSlaExclusionContext(prepared, start, end);
  const activeTurnos = turnos.filter((t) => {
    const st = String(t.status || "");
    return st !== "Canceled" && st !== "CANCELED";
  });
  const suffix = `_${year}_${month}`;
  const publishedObj = /* @__PURE__ */ new Set();
  for (const [k, v] of Object.entries(publishStatusMap)) {
    if (v && k.endsWith(suffix)) publishedObj.add(k.slice(0, -suffix.length));
  }
  const publishedTurnos = activeTurnos.filter((t) => t.draft !== true && publishedObj.has(String(t.objectiveId || "")));
  const draftTurnos = activeTurnos.filter((t) => t.draft === true || !publishedObj.has(String(t.objectiveId || "")));
  const demandaOf = (list) => buildDemandaByObjective({
    turnos: list,
    ausenciasStats: null,
    vigenteServices: vigente,
    periodStart: start,
    periodEnd: end,
    objectiveAliases: aliases,
    slaExclusionCtx
  });
  const demPub = demandaOf(publishedTurnos);
  const demDraft = demandaOf(draftTurnos);
  let worked = 0;
  if (hoursCoreEnabled) {
    const persona = buildPersonaBook({
      turnos: activeTurnos,
      ausencias,
      publishStatusMap,
      rangeStartYmd: ymd(year, month, 1),
      rangeEndYmd: ymd(year, month, lastDay(year, month)),
      empNameById,
      holidays: {},
      usePlannedHours: false,
      publishFilter: "published"
    });
    for (const e of persona.employees) worked += Number(e.stats?.horasReales) || 0;
  } else {
    const byEmp = /* @__PURE__ */ new Map();
    for (const t of activeTurnos) {
      const id = String(t.employeeId || "").trim();
      if (!id || id === "VACANTE" || !empNameById[id]) continue;
      const list = byEmp.get(id) || [];
      list.push(t);
      byEmp.set(id, list);
    }
    for (const shifts of byEmp.values()) {
      const stats = calculateLiquidationHoursStats(shifts, {}, { usePlannedHours: false });
      worked += Number(stats?.horasReales) || 0;
    }
  }
  worked = r12(worked);
  const franja = executedBillableHoursByFranja(activeTurnos);
  const daysMap = /* @__PURE__ */ new Map();
  const touch = (objectiveId, puestoId, puestoName, date, sla) => {
    const key = `${objectiveId}|${puestoId}|${date}`;
    let row = daysMap.get(key);
    if (row) return row;
    const who = resolveClient(objectiveId, sla);
    row = {
      empresaId,
      periodKey,
      date,
      clientId: who.clientId,
      clientName: who.clientName,
      objectiveId,
      objectiveName: String(sla?.objectiveName || objectiveId),
      puestoId,
      puestoName,
      ...blankMetrics()
    };
    daysMap.set(key, row);
    return row;
  };
  for (const item of chosen.values()) {
    const oid = String(item.srv.objectiveId || "").trim();
    const positions = positionsOf(item.srv);
    const list = positions.length ? positions : [{ id: "puesto", name: "Puesto" }];
    for (const day of eachDay(year, month)) {
      const h = dayHours({ ...item.srv, positions: list }, day);
      if (!(h > 0)) continue;
      const share = list.length ? h / list.length : h;
      list.forEach((p, i) => {
        const pid = puestoSlug(String(p?.name || p?.code || ""), String(p?.id || i));
        const row = touch(oid, pid, String(p?.name || p?.code || pid), day, item.srv);
        const part = i === list.length - 1 ? r12(h - share * (list.length - 1)) : r12(share);
        if (item.bucket === "active") row.slaActive = r12(row.slaActive + part);
        else if (item.bucket === "inactive") row.slaInactive = r12(row.slaInactive + part);
        else row.slaClosed = r12(row.slaClosed + part);
      });
    }
  }
  const planOn = (list, field) => {
    for (const t of list) {
      const oid = String(t.objectiveId || "").trim();
      if (!oid) continue;
      const hs = calcPlanificadorShiftHours(t);
      if (!(hs > 0)) continue;
      const code = String(t.code || t.type || "").toUpperCase();
      if (PAID.has(code)) {
        const day2 = dateStr(t.startTime) || ymd(year, month, 1);
        const row2 = touch(oid, "novedad", "Novedad", day2.slice(0, 10) > periodKey ? ymd(year, month, 1) : (dateStr(t.scheduleDate) || day2).slice(0, 10), null);
        row2.novedadPaga = r12(row2.novedadPaga + hs);
        continue;
      }
      const when = dateStr(t.startTime);
      const day = when && when.startsWith(periodKey) ? when : ymd(year, month, 1);
      const pid = puestoSlug(String(t.positionName || ""), String(t.positionId || t.positionName || "puesto"));
      const row = touch(oid, pid, String(t.positionName || pid), day, null);
      row[field] = r12(row[field] + hs);
      const codeU = code;
      if (codeU === "FT" || t.isFrancoTrabajado) row.ft = r12(row.ft + hs);
    }
  };
  planOn(publishedTurnos, "planPublished");
  planOn(draftTurnos, "planDraft");
  for (const b of franja.buckets) {
    const oid = String(b.objectiveId || "").trim();
    if (!oid || !b.date?.startsWith(periodKey)) continue;
    const pid = puestoSlug(b.positionName, b.positionName);
    const row = touch(oid, pid, b.positionName || pid, b.date, null);
    row.covered = r12(row.covered + b.covered);
    row.uncovered = r12(row.uncovered + b.uncovered);
    row.objectiveName = b.objectiveName || row.objectiveName;
  }
  for (const r of demPub.rows) {
    if (r.ftHours) {
      const row = touch(r.id, "ft", "FT", ymd(year, month, 1), null);
      row.ft = r12(r.ftHours);
      row.objectiveName = r.name || row.objectiveName;
      row.clientName = r.client || row.clientName;
    }
    if (r.extHours) {
      const row = touch(r.id, "ext", "EXT", ymd(year, month, 1), null);
      row.ext = r12(r.extHours);
    }
    if (r.adelHours) {
      const row = touch(r.id, "adv", "ADV", ymd(year, month, 1), null);
      row.adv = r12(r.adelHours);
    }
  }
  const days = [...daysMap.values()].filter(
    (d) => d.slaActive || d.slaInactive || d.slaClosed || d.planPublished || d.planDraft || d.covered || d.uncovered || d.ft || d.ext || d.adv || d.novedadPaga
  );
  const byObj = /* @__PURE__ */ new Map();
  const ensureObj = (d) => {
    let m = byObj.get(d.objectiveId);
    if (!m) {
      m = {
        empresaId,
        periodKey,
        level: "objetivo",
        clientId: d.clientId,
        clientName: d.clientName,
        objectiveId: d.objectiveId,
        objectiveName: d.objectiveName,
        hoursCoreEnabled,
        ...blankMetrics()
      };
      byObj.set(d.objectiveId, m);
    }
    if (!m.clientId && d.clientId) {
      m.clientId = d.clientId;
      m.clientName = d.clientName;
    }
    return m;
  };
  for (const item of chosen.values()) {
    const oid = String(item.srv.objectiveId || "");
    const who = resolveClient(oid, item.srv);
    const stub = {
      empresaId,
      periodKey,
      date: ymd(year, month, 1),
      clientId: who.clientId,
      clientName: who.clientName,
      objectiveId: oid,
      objectiveName: String(item.srv.objectiveName || oid),
      puestoId: "_",
      puestoName: "_",
      ...blankMetrics()
    };
    const m = ensureObj(stub);
    if (item.bucket === "active") m.slaActive = r12(item.hours);
    else if (item.bucket === "inactive") m.slaInactive = r12(m.slaInactive + item.hours);
    else m.slaClosed = r12(m.slaClosed + item.hours);
  }
  for (const r of demPub.rows) {
    const m = ensureObj({
      empresaId,
      periodKey,
      date: ymd(year, month, 1),
      clientId: "",
      clientName: r.client || "",
      objectiveId: r.id,
      objectiveName: r.name || r.id,
      puestoId: "_",
      puestoName: "_",
      ...blankMetrics()
    });
    m.planPublished = r12(coveragePlannedFromDemandaRow(r));
    m.ft = r12(r.ftHours);
    m.ext = r12(r.extHours);
    m.adv = r12(r.adelHours);
    const who = resolveClient(r.id, null);
    if (who.clientId) {
      m.clientId = who.clientId;
      m.clientName = who.clientName || m.clientName;
    }
  }
  for (const r of demDraft.rows) {
    const m = ensureObj({
      empresaId,
      periodKey,
      date: ymd(year, month, 1),
      clientId: "",
      clientName: r.client || "",
      objectiveId: r.id,
      objectiveName: r.name || r.id,
      puestoId: "_",
      puestoName: "_",
      ...blankMetrics()
    });
    m.planDraft = r12(coveragePlannedFromDemandaRow(r));
    const who = resolveClient(r.id, null);
    if (who.clientId) {
      m.clientId = who.clientId;
      m.clientName = who.clientName || m.clientName;
    }
  }
  let fichadaWeight = 0;
  const weights = /* @__PURE__ */ new Map();
  for (const t of activeTurnos) {
    const oid = String(t.objectiveId || "").trim();
    if (!oid) continue;
    const hs = Number(t.hours) || 0;
    if (!(hs > 0)) continue;
    weights.set(oid, (weights.get(oid) || 0) + hs);
    fichadaWeight += hs;
  }
  if (worked > 0 && fichadaWeight > 0) {
    for (const [oid, w] of weights) {
      const m = byObj.get(oid);
      if (!m) continue;
      m.worked = r12(worked * (w / fichadaWeight));
    }
    const assigned = [...byObj.values()].reduce((s, m) => s + m.worked, 0);
    const drift = r12(worked - assigned);
    const first = byObj.values().next().value;
    if (first && drift) first.worked = r12(first.worked + drift);
  }
  for (const d of days) {
    const m = byObj.get(d.objectiveId);
    if (!m) continue;
    m.covered = r12(m.covered + d.covered);
    m.uncovered = r12(m.uncovered + d.uncovered);
    m.novedadPaga = r12(m.novedadPaga + d.novedadPaga);
  }
  for (const m of byObj.values()) {
    if (!(m.worked > 0)) continue;
    const objDays = days.filter((d) => d.objectiveId === m.objectiveId);
    const weight = objDays.reduce((s, d) => s + d.planPublished + d.planDraft + d.covered, 0);
    if (!objDays.length || !(weight > 0)) continue;
    let acc = 0;
    objDays.forEach((d, i) => {
      const part = i === objDays.length - 1 ? r12(m.worked - acc) : r12(m.worked * ((d.planPublished + d.planDraft + d.covered) / weight));
      d.worked = part;
      acc = r12(acc + part);
    });
  }
  const monthlyObjs = [...byObj.values()].filter(
    (m) => m.slaActive || m.slaInactive || m.slaClosed || m.planPublished || m.planDraft || m.worked || m.covered || m.uncovered || m.ft || m.ext || m.adv || m.novedadPaga
  );
  const empresa = blankMetrics();
  for (const m of monthlyObjs) addMetrics(empresa, m);
  empresa.worked = worked;
  const empresaDoc = {
    empresaId,
    periodKey,
    level: "empresa",
    clientId: "",
    clientName: "",
    objectiveId: "",
    objectiveName: "",
    hoursCoreEnabled,
    ...empresa
  };
  const byClient = /* @__PURE__ */ new Map();
  for (const m of monthlyObjs) {
    const cid = m.clientId || "_sin_cliente";
    let c = byClient.get(cid);
    if (!c) {
      c = {
        empresaId,
        periodKey,
        level: "cliente",
        clientId: m.clientId,
        clientName: m.clientName || (cid === "_sin_cliente" ? "Sin cliente" : cid),
        objectiveId: "",
        objectiveName: "",
        hoursCoreEnabled,
        ...blankMetrics()
      };
      byClient.set(cid, c);
    }
    addMetrics(c, m);
  }
  return {
    days,
    monthly: [empresaDoc, ...byClient.values(), ...monthlyObjs],
    totals: empresa
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildLedgerMonth,
  planHoursOf
});
