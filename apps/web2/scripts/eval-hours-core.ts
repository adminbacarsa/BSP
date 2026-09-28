/**
 * eval:hours-core
 * (a) Paridad consumidor ↔ @cosp/hours-core donde el motor no cambió de intención.
 * (b) Cánones Fase 1 donde el número se movió a propósito (libro persona).
 * Las fixtures F0 de payroll y turnoHoursCalc comparan contra copias F0 congeladas
 * (eval-hours-core-legacy/) y solo exigen paridad en casos que el canon no movió.
 * También verifica las dos formas de período (CCT 26→25 y mes calendario)
 * sobre turnos ya filtrados: calculateLiquidationHoursStats no recorta fechas.
 *
 * useReportes: dateRange inicial = getCctPayrollPeriodByOffset(0);
 * generateReports arma startDate/endDate y fetchReportTurnos filtra startTime en ese rango
 * ANTES de llamar calculateLiquidationHoursStats.
 */
export {};

process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'eval-hours-core';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'eval-hours-core';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= '1:0:web:eval';

type Diff = { consumer: string; fixture: string; legacy: unknown; core: unknown };

const diffs: Diff[] = [];
let ok = 0;
const canonFails: string[] = [];
let canonOk = 0;

function canon(label: string, got: number, expected: number, tol = 0.02) {
  if (Number.isFinite(got) && Math.abs(got - expected) <= tol) {
    canonOk += 1;
    return;
  }
  canonFails.push(`${label}: obtuvo ${got}, canon ${expected}`);
}

function pick<T extends Record<string, unknown>>(obj: T | null, keys: string[]): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    let v = obj[k];
    if (k === 'warnings' && Array.isArray(v)) {
      v = v.map((w) => String(w).replace(/[\u2014\u2013\u00d4\u00c7\u00f6]/g, '-').replace(/—|–|—/g, '-'));
    }
    out[k] = v;
  }
  return out;
}

function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) < 1e-6;
  }
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => near(v, b[i]));
  }
  const ak = Object.keys(a as object).sort();
  const bk = Object.keys(b as object).sort();
  if (ak.join('|') !== bk.join('|')) return false;
  return ak.every((k) => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function check(consumer: string, fixture: string, legacy: unknown, core: unknown) {
  if (near(legacy, core)) {
    ok += 1;
    return;
  }
  diffs.push({ consumer, fixture, legacy, core });
}

function secAt(y: number, m: number, d: number, hh: number, mm: number): { seconds: number } {
  return { seconds: Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000) };
}

function artIso(ymd: string, hhmm: string): { seconds: number } {
  return { seconds: Math.floor(new Date(`${ymd}T${hhmm}:00-03:00`).getTime() / 1000) };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function main() {
  const legacyPlan = await import('../src/lib/planificacion/planningScheduledHours');
  const legacyCoalesce = await import('../src/lib/planificacion/planningTurnoCoalesce');
  const legacyFichada = await import('../src/lib/crm/fichadaHours');
  const legacyAnalisis = await import('../src/lib/analisis/analisisQueries');
  const legacyReportes = await import('../src/hooks/useReportes');
  const legacyTurnoF0 = await import('./eval-hours-core-legacy/turnoHoursCalcF0');
  const legacyPayroll = await import('./eval-hours-core-legacy/payrollTurnoFromCalc');
  const proformaGridLib = await import('../src/lib/crm/proformaGrid');
  const periodLib = await import('../src/lib/cctPayrollPeriod');
  const core = await import('@cosp/hours-core');

  const slaHint = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };

  const planShifts: Array<{ name: string; shift: Record<string, unknown> }> = [
    { name: 'M-hours-8', shift: { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' } },
    { name: 'T-hours-8', shift: { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' } },
    { name: 'N-hours-8', shift: { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' } },
    { name: 'D12', shift: { code: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' } },
    { name: 'franco-F', shift: { code: 'F', hours: 0 } },
    { name: 'borrado', shift: { code: 'M', hours: 8, isDeleted: true } },
    {
      name: 'ext-15-19',
      shift: {
        code: 'M',
        hours: 8,
        isExtended: true,
        segmentFromTime: '15:00',
        segmentToTime: '19:00',
        extExtraHours: 4,
        startTime: '07:00',
        endTime: '15:00',
      },
    },
    {
      name: 'adelanto',
      shift: {
        code: 'M',
        hours: 8,
        isEarlyStart: true,
        segmentFromTime: '03:00',
        segmentToTime: '07:00',
        adjustedStartTime: '03:00',
        startTime: '07:00',
        endTime: '15:00',
      },
    },
    { name: 'RFZ', shift: { code: 'RFZ', hours: 8, startTime: '07:00', endTime: '15:00' } },
    { name: 'TURA', shift: { code: 'TURA', hours: 6 } },
    {
      name: 'ops-cov-en-fuente',
      shift: { code: 'M', hours: 8, coverageHoursOnSource: true, origin: 'OPERATIONS_COVERAGE', coverageType: 'EXTEND' },
    },
    { name: 'vacio', shift: null as unknown as Record<string, unknown> },
  ];

  for (const { name, shift } of planShifts) {
    check('planning.calcPlanningBillableShiftHours', name,
      legacyPlan.calcPlanningBillableShiftHours(shift, slaHint),
      core.calcPlanningBillableShiftHours(shift, slaHint));
    check('planning.calcPlanificadorShiftHours', name,
      legacyPlan.calcPlanificadorShiftHours(shift, slaHint),
      core.calcPlanificadorShiftHours(shift, slaHint));
    check('planning.calcPlanningSlaReconciliationHours', name,
      legacyPlan.calcPlanningSlaReconciliationHours(shift, slaHint),
      core.calcPlanningSlaReconciliationHours(shift, slaHint));
    check('planning.shiftCoverageExtensionExtraHours', name,
      legacyPlan.shiftCoverageExtensionExtraHours(shift, slaHint),
      core.shiftCoverageExtensionExtraHours(shift, slaHint));
  }

  const cells: Array<{ name: string; turnos: any[] }> = [
    {
      name: 'un-solo-M',
      turnos: [{ code: 'M', hours: 8, employeeId: 'e1', startTime: '07:00', endTime: '15:00' }],
    },
    {
      name: 'duplicada-8-mas-8-extendida',
      turnos: [
        { id: 'a', code: 'M', hours: 8, employeeId: 'e1', startTime: '07:00', endTime: '15:00' },
        {
          id: 'b',
          code: 'M',
          hours: 8,
          employeeId: 'e1',
          isExtended: true,
          startTime: '07:00',
          endTime: '15:00',
        },
      ],
    },
    {
      name: 'base-8-mas-tramo-4',
      turnos: [
        { id: 'a', code: 'M', hours: 8, employeeId: 'e1', startTime: '07:00', endTime: '15:00' },
        {
          id: 'b',
          code: 'M',
          hours: 4,
          employeeId: 'e1',
          isExtended: true,
          segmentFromTime: '15:00',
          segmentToTime: '19:00',
          extExtraHours: 4,
          coverageSegmentRole: 'EXTENSION',
        },
      ],
    },
  ];

  const coalesceMovedByCanon = new Set(['duplicada-8-mas-8-extendida', 'base-8-mas-tramo-4']);
  for (const cell of cells) {
    if (coalesceMovedByCanon.has(cell.name)) {
      // Canon F1: celda una vez. Paridad F0 vs copia congelada.
      check('planning.coalescePlannedCellBillableHours (F0)', cell.name,
        legacyCoalesce.coalescePlannedCellBillableHours(cell.turnos, slaHint),
        core.coalescePlannedCellBillableHoursF0(cell.turnos, slaHint));
      continue;
    }
    check('planning.coalescePlannedCellBillableHours', cell.name,
      legacyCoalesce.coalescePlannedCellBillableHours(cell.turnos, slaHint),
      core.coalescePlannedCellBillableHours(cell.turnos, slaHint));
  }

  const fichadas: Array<{ name: string; shift: any }> = [
    { name: 'M-presente', shift: { code: 'M', isPresent: true, hours: 8 } },
    { name: 'D12-completado', shift: { code: 'D12', isCompleted: true } },
    { name: 'N12-presente', shift: { code: 'N12', status: 'PRESENT' } },
    { name: 'sin-fichar', shift: { code: 'M', hours: 8 } },
    { name: 'ausente', shift: { code: 'M', isAbsent: true, isPresent: true } },
    { name: 'franco', shift: { code: 'F', isPresent: true } },
    {
      name: 'reloj-sin-banda',
      shift: {
        code: 'C',
        isCompleted: true,
        realStartTime: artIso('2026-05-10', '07:04'),
        realEndTime: artIso('2026-05-10', '15:10'),
      },
    },
    {
      name: 'ops-cov-fuente',
      shift: { code: 'M', isPresent: true, coverageHoursOnSource: true },
    },
  ];
  for (const f of fichadas) {
    check('crm.fichadaHoursForShift', f.name,
      legacyFichada.fichadaHoursForShift(f.shift),
      core.fichadaHoursForShift(f.shift));
  }

  const analisisShifts: any[] = [
    null,
    { code: 'M', hours: 8 },
    { code: 'D12' },
    { code: 'V', hours: 24 },
    { code: 'AA' },
    { code: 'M', hours: 8, coverageHoursOnSource: true },
    { code: 'X', startTime: { seconds: 1_700_000_000 }, endTime: { seconds: 1_700_000_000 + 8 * 3600 } },
    { code: 'REF', hours: 8 },
  ];
  analisisShifts.forEach((t, i) => {
    check('analisis.coverageHoursFromShift', `f${i}`,
      legacyAnalisis.coverageHoursFromShift(t),
      core.coverageHoursFromShift(t));
  });

  const holidays = new Set<string>(['2026-05-01']);
  const holidayMap: Record<string, boolean> = { '2026-05-01': true };

  function liqShift(partial: Record<string, unknown>) {
    const start = (partial.startTime as { seconds: number }) || secAt(2026, 5, 10, 7, 0);
    const end = (partial.endTime as { seconds: number }) || { seconds: start.seconds + 8 * 3600 };
    return {
      id: partial.id ?? 'liq-1',
      employeeId: 'emp-liq',
      code: 'M',
      status: 'completed',
      startTime: start,
      endTime: end,
      realStartTime: start,
      realEndTime: end,
      ...partial,
    };
  }

  const liqFixtures: Array<{ name: string; shifts: any[]; opts?: { usePlannedHours?: boolean } }> = [
    { name: 'M-8-fichado', shifts: [liqShift({ id: 'm8' })] },
    {
      name: 'adelanto-autorizado',
      shifts: [liqShift({
        id: 'adv',
        isEarlyStart: true,
        startTime: secAt(2026, 5, 11, 7, 0),
        endTime: secAt(2026, 5, 11, 15, 0),
        realStartTime: secAt(2026, 5, 11, 6, 0),
        realEndTime: secAt(2026, 5, 11, 15, 0),
      })],
    },
    {
      name: 'retencion-3min',
      shifts: [liqShift({
        id: 'ret',
        isRetention: true,
        retentionMinutes: 3,
        startTime: secAt(2026, 5, 12, 7, 0),
        endTime: secAt(2026, 5, 12, 15, 0),
        realStartTime: secAt(2026, 5, 12, 7, 0),
        realEndTime: secAt(2026, 5, 12, 15, 3),
      })],
    },
    {
      name: 'salida-4min-sin-retencion',
      shifts: [liqShift({
        id: 'late4',
        startTime: secAt(2026, 5, 13, 7, 4),
        endTime: secAt(2026, 5, 13, 15, 0),
        realStartTime: secAt(2026, 5, 13, 7, 4),
        realEndTime: secAt(2026, 5, 13, 15, 2),
      })],
    },
    {
      // Decisión Mauro H1 #3: CON relevo registrado (relievedBy) se completa la jornada.
      name: 'relevo-anticipado',
      shifts: [liqShift({
        id: 'early-out',
        startTime: secAt(2026, 5, 14, 7, 0),
        endTime: secAt(2026, 5, 14, 15, 0),
        realStartTime: secAt(2026, 5, 14, 7, 0),
        realEndTime: secAt(2026, 5, 14, 14, 30),
        relievedBy: 'emp-relevo',
        relievedByName: 'Guardia Relevo',
      })],
    },
    {
      // Decisión Mauro H1 #3: SIN relevo registrado, la salida anticipada paga lo real.
      name: 'salida-anticipada-sin-relevo',
      shifts: [liqShift({
        id: 'early-out-sin-relevo',
        startTime: secAt(2026, 5, 23, 7, 0),
        endTime: secAt(2026, 5, 23, 15, 0),
        realStartTime: secAt(2026, 5, 23, 7, 0),
        realEndTime: secAt(2026, 5, 23, 14, 30),
      })],
    },
    {
      name: 'FT',
      shifts: [liqShift({
        id: 'ft',
        code: 'FT',
        isFrancoTrabajado: true,
        startTime: secAt(2026, 5, 15, 7, 0),
        endTime: secAt(2026, 5, 15, 15, 0),
        realStartTime: secAt(2026, 5, 15, 7, 0),
        realEndTime: secAt(2026, 5, 15, 15, 0),
      })],
    },
    {
      name: 'feriado',
      shifts: [liqShift({
        id: 'fer',
        startTime: secAt(2026, 5, 1, 7, 0),
        endTime: secAt(2026, 5, 1, 15, 0),
        realStartTime: secAt(2026, 5, 1, 7, 0),
        realEndTime: secAt(2026, 5, 1, 15, 0),
      })],
    },
    {
      name: 'planificadas',
      shifts: [liqShift({ id: 'plan', realStartTime: undefined, realEndTime: undefined })],
      opts: { usePlannedHours: true },
    },
  ];

  for (const fx of liqFixtures) {
    const legacy = legacyReportes.calculateLiquidationHoursStats(fx.shifts, holidayMap, fx.opts) as Record<string, unknown>;
    const coreF0 = core.calculateLiquidationHoursStatsF0(fx.shifts, holidayMap, fx.opts) as Record<string, unknown>;
    const liqKeys = [
      'horasTeoricas', 'horasReales', 'horasSimples', 'extra50', 'extra100',
      'totalDiurnas', 'totalNocturnas', 'plusFeriado',
    ];
    check('liquidation.calculateLiquidationHoursStats (F0 parity)', fx.name,
      pick(legacy, liqKeys),
      pick(coreF0, liqKeys));
  }

  const techoShifts = Array.from({ length: 26 }, (_, i) => {
    const day = i + 1;
    const start = secAt(2026, 1, day, 7, 0);
    const end = { seconds: start.seconds + 8 * 3600 };
    return liqShift({
      id: `techo-${day}`,
      employeeId: 'emp-techo',
      startTime: start,
      endTime: end,
      realStartTime: start,
      realEndTime: end,
    });
  });
  // Techo 204→200: sin paridad F0; se verifica como canon F1 abajo.
  check('liquidation.liquidacion200FromWorkedHours', '208',
    legacyReportes.liquidacion200FromWorkedHours(208),
    core.liquidacion200FromWorkedHours(208));

  const turnoFixtures: Array<{ name: string; data: Record<string, unknown>; holidays?: Set<string> }> = [
    {
      name: 'M-completado',
      data: {
        employeeId: 'e1',
        isCompleted: true,
        code: 'M',
        startTime: artIso('2026-05-10', '07:00'),
        endTime: artIso('2026-05-10', '15:00'),
        realStartTime: artIso('2026-05-10', '07:04'),
        realEndTime: artIso('2026-05-10', '15:02'),
      },
    },
    {
      name: 'draft',
      data: {
        employeeId: 'e1',
        draft: true,
        isCompleted: true,
        code: 'M',
        startTime: artIso('2026-05-10', '07:00'),
        endTime: artIso('2026-05-10', '15:00'),
      },
    },
    {
      name: 'sin-completar',
      data: {
        employeeId: 'e1',
        isCompleted: false,
        code: 'M',
        startTime: artIso('2026-05-10', '07:00'),
        endTime: artIso('2026-05-10', '15:00'),
        realStartTime: artIso('2026-05-10', '07:00'),
        realEndTime: artIso('2026-05-10', '15:00'),
      },
    },
    {
      name: 'FT',
      data: {
        employeeId: 'e1',
        isCompleted: true,
        code: 'FT',
        isFrancoTrabajado: true,
        startTime: artIso('2026-05-11', '07:00'),
        endTime: artIso('2026-05-11', '15:00'),
        realStartTime: artIso('2026-05-11', '07:00'),
        realEndTime: artIso('2026-05-11', '15:00'),
      },
    },
    {
      name: 'noche-22-06',
      data: {
        employeeId: 'e1',
        isCompleted: true,
        code: 'N',
        startTime: artIso('2026-05-12', '22:00'),
        endTime: artIso('2026-05-13', '06:00'),
        realStartTime: artIso('2026-05-12', '22:00'),
        realEndTime: artIso('2026-05-13', '06:00'),
      },
    },
    {
      name: 'feriado',
      data: {
        employeeId: 'e1',
        isCompleted: true,
        code: 'M',
        startTime: artIso('2026-05-01', '07:00'),
        endTime: artIso('2026-05-01', '15:00'),
        realStartTime: artIso('2026-05-01', '07:00'),
        realEndTime: artIso('2026-05-01', '15:00'),
      },
      holidays,
    },
  ];

  const turnoKeys = ['hsTeoricas', 'hsReales', 'diurnas', 'nocturnas', 'al100FT', 'plusFeriado', 'isFT', 'monthKey'];
  const turnoMovedByCanon = new Set(['FT', 'noche-22-06']);
  for (const fx of turnoFixtures) {
    if (turnoMovedByCanon.has(fx.name)) continue;
    const h = fx.holidays ?? new Set<string>();
    check('server.calcTurnoHoursContrib (F0 vs persona, sin delta)', fx.name,
      pick(legacyTurnoF0.calcTurnoHoursContrib(fx.data, h) as Record<string, unknown> | null, turnoKeys),
      pick(core.calcTurnoHoursContribF0(fx.data, h) as Record<string, unknown> | null, turnoKeys));
  }

  const payrollFixtures: Array<{ name: string; data: Record<string, unknown>; ctx: { hoursMode: 'planned' | 'real'; holidays: Set<string>; turnoId?: string } }> = [
    {
      name: 'real-M-4min',
      data: {
        id: 'p1',
        code: 'M',
        startTime: artIso('2026-05-10', '07:00'),
        endTime: artIso('2026-05-10', '15:00'),
        realStartTime: artIso('2026-05-10', '07:04'),
        realEndTime: artIso('2026-05-10', '15:02'),
      },
      ctx: { hoursMode: 'real', holidays: new Set(), turnoId: 'p1' },
    },
    {
      name: 'real-sin-fichada',
      data: {
        id: 'p2',
        code: 'M',
        startTime: artIso('2026-05-10', '07:00'),
        endTime: artIso('2026-05-10', '15:00'),
      },
      ctx: { hoursMode: 'real', holidays: new Set(), turnoId: 'p2' },
    },
    {
      name: 'planned-M',
      data: {
        code: 'M',
        hours: 8,
        startTime: artIso('2026-05-10', '07:00'),
        endTime: artIso('2026-05-10', '15:00'),
      },
      ctx: { hoursMode: 'planned', holidays: new Set(), turnoId: 'p3' },
    },
    {
      name: 'FT-real',
      data: {
        code: 'FT',
        isFrancoTrabajado: true,
        startTime: artIso('2026-05-11', '07:00'),
        endTime: artIso('2026-05-11', '15:00'),
        realStartTime: artIso('2026-05-11', '07:00'),
        realEndTime: artIso('2026-05-11', '15:00'),
      },
      ctx: { hoursMode: 'real', holidays: new Set(), turnoId: 'p4' },
    },
    {
      name: 'adelanto-real-06',
      data: {
        code: 'M',
        isEarlyStart: true,
        startTime: artIso('2026-05-11', '07:00'),
        endTime: artIso('2026-05-11', '15:00'),
        realStartTime: artIso('2026-05-11', '06:00'),
        realEndTime: artIso('2026-05-11', '15:00'),
      },
      ctx: { hoursMode: 'real', holidays: new Set(), turnoId: 'p5' },
    },
    {
      name: 'retencion-3min',
      data: {
        code: 'M',
        isRetention: true,
        startTime: artIso('2026-05-12', '07:00'),
        endTime: artIso('2026-05-12', '15:00'),
        realStartTime: artIso('2026-05-12', '07:00'),
        realEndTime: artIso('2026-05-12', '15:03'),
      },
      ctx: { hoursMode: 'real', holidays: new Set(), turnoId: 'p6' },
    },
    {
      name: 'relevo-14-30',
      data: {
        code: 'M',
        startTime: artIso('2026-05-14', '07:00'),
        endTime: artIso('2026-05-14', '15:00'),
        realStartTime: artIso('2026-05-14', '07:00'),
        realEndTime: artIso('2026-05-14', '14:30'),
      },
      ctx: { hoursMode: 'real', holidays: new Set(), turnoId: 'p7' },
    },
    {
      name: 'noche',
      data: {
        code: 'N',
        startTime: artIso('2026-05-12', '22:00'),
        endTime: artIso('2026-05-13', '06:00'),
        realStartTime: artIso('2026-05-12', '22:00'),
        realEndTime: artIso('2026-05-13', '06:00'),
      },
      ctx: { hoursMode: 'real', holidays: new Set(), turnoId: 'p8' },
    },
    {
      name: 'M/RA',
      data: {
        code: 'M/RA',
        hours: 8,
        scheduleDate: '2026-05-16',
      },
      ctx: { hoursMode: 'planned', holidays: new Set(), turnoId: 'p9' },
    },
    {
      name: 'feriado',
      data: {
        code: 'M',
        startTime: artIso('2026-05-01', '07:00'),
        endTime: artIso('2026-05-01', '15:00'),
        realStartTime: artIso('2026-05-01', '07:00'),
        realEndTime: artIso('2026-05-01', '15:00'),
      },
      ctx: { hoursMode: 'real', holidays, turnoId: 'p10' },
    },
    {
      name: 'cancelado',
      data: { code: 'M', status: 'CANCELED', startTime: artIso('2026-05-10', '07:00'), endTime: artIso('2026-05-10', '15:00') },
      ctx: { hoursMode: 'planned', holidays: new Set(), turnoId: 'p11' },
    },
  ];

  const payrollKeys = ['hsTeoricas', 'hsReales', 'diurnas', 'nocturnas', 'al100FT', 'plusFeriado', 'warnings', 'skipped'];
  const payrollMovedByCanon = new Set(['adelanto-real-06', 'retencion-3min', 'relevo-14-30']);
  for (const fx of payrollFixtures) {
    if (payrollMovedByCanon.has(fx.name)) continue;
    check('server.accumulatePayrollTurnoContribution (F0 vs persona, sin delta)', fx.name,
      pick(legacyPayroll.accumulatePayrollTurnoContributionLegacy(fx.data, fx.ctx) as unknown as Record<string, unknown>, payrollKeys),
      pick(core.accumulatePayrollTurnoContributionF0(fx.data, fx.ctx) as unknown as Record<string, unknown>, payrollKeys));
  }

  const periodFails: string[] = [];
  const cct = periodLib.cctPayrollPeriodForClosingMonth(2026, 5);
  if (cct.start !== '2026-04-26' || cct.end !== '2026-05-25') {
    periodFails.push(`CCT cierre mayo 2026 esperado 2026-04-26..2026-05-25, obtuvo ${cct.start}..${cct.end}`);
  }
  const containing = periodLib.getCctPayrollPeriodContaining(new Date(2026, 4, 10));
  if (containing.start !== cct.start || containing.end !== cct.end) {
    periodFails.push(`getCctPayrollPeriodContaining(2026-05-10) = ${containing.start}..${containing.end}`);
  }

  const poolDays = ['2026-04-25', '2026-04-26', '2026-05-10', '2026-05-25', '2026-05-26', '2026-05-31', '2026-06-01'];
  const pool = poolDays.map((ymd, i) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const start = secAt(y, m, d, 7, 0);
    const end = { seconds: start.seconds + 8 * 3600 };
    return liqShift({
      id: `per-${ymd}`,
      employeeId: 'emp-per',
      scheduleDate: ymd,
      startTime: start,
      endTime: end,
      realStartTime: start,
      realEndTime: end,
      _ymd: ymd,
      _i: i,
    });
  });

  function ymdOf(shift: { startTime: { seconds: number } }): string {
    return periodLib.toLocalYmd(new Date(shift.startTime.seconds * 1000));
  }
  function inInclusive(shift: { startTime: { seconds: number } }, startYmd: string, endYmd: string): boolean {
    const ymd = ymdOf(shift);
    return ymd >= startYmd && ymd <= endYmd;
  }

  const calStart = '2026-05-01';
  const calEnd = '2026-05-31';
  const cctShifts = pool.filter((s) => inInclusive(s, cct.start, cct.end));
  const calShifts = pool.filter((s) => inInclusive(s, calStart, calEnd));
  const cctDays = cctShifts.map((s) => String((s as { _ymd?: string })._ymd)).sort();
  const calDays = calShifts.map((s) => String((s as { _ymd?: string })._ymd)).sort();
  const expectCct = ['2026-04-26', '2026-05-10', '2026-05-25'];
  const expectCal = ['2026-05-10', '2026-05-25', '2026-05-26', '2026-05-31'];
  if (cctDays.join(',') !== expectCct.join(',')) {
    periodFails.push(`filtro CCT días ${cctDays.join(',')} ≠ ${expectCct.join(',')}`);
  }
  if (calDays.join(',') !== expectCal.join(',')) {
    periodFails.push(`filtro calendario días ${calDays.join(',')} ≠ ${expectCal.join(',')}`);
  }
  const onlyCct = cctDays.filter((d) => !calDays.includes(d));
  const onlyCal = calDays.filter((d) => !cctDays.includes(d));
  if (!onlyCct.includes('2026-04-26') || !onlyCal.includes('2026-05-26')) {
    periodFails.push(`las dos ventanas deben diferir (solo CCT=${onlyCct.join(',')} solo cal=${onlyCal.join(',')})`);
  }

  const strip = (rows: any[]) => rows.map(({ _ymd, _i, ...rest }) => rest);
  const periodLiqKeys = ['horasTeoricas', 'horasReales', 'horasSimples', 'extra50', 'extra100'];
  check('liquidation.periodo-CCT-26-25', 'cierre-2026-05',
    pick(legacyReportes.calculateLiquidationHoursStats(strip(cctShifts), {}) as Record<string, unknown>, periodLiqKeys),
    pick(core.calculateLiquidationHoursStatsF0(strip(cctShifts), {}) as Record<string, unknown>, periodLiqKeys));
  check('liquidation.periodo-calendario', '2026-05-01-a-31',
    pick(legacyReportes.calculateLiquidationHoursStats(strip(calShifts), {}) as Record<string, unknown>, periodLiqKeys),
    pick(core.calculateLiquidationHoursStatsF0(strip(calShifts), {}) as Record<string, unknown>, periodLiqKeys));

  const statsCct = core.calculateLiquidationHoursStats(strip(cctShifts), {});
  const statsCal = core.calculateLiquidationHoursStats(strip(calShifts), {});
  const statsAll = core.calculateLiquidationHoursStats(strip(pool), {});
  if (!(statsAll.horasReales > statsCct.horasReales && statsAll.horasReales > statsCal.horasReales)) {
    periodFails.push(
      `calculateLiquidationHoursStats no recorta solo: pool=${statsAll.horasReales} cct=${statsCct.horasReales} cal=${statsCal.horasReales}`,
    );
  }
  if (Math.abs(statsCct.horasReales - expectCct.length * 8) > 0.05) {
    periodFails.push(`CCT horasReales=${statsCct.horasReales} esperado ${expectCct.length * 8}`);
  }
  if (Math.abs(statsCal.horasReales - expectCal.length * 8) > 0.05) {
    periodFails.push(`calendario horasReales=${statsCal.horasReales} esperado ${expectCal.length * 8}`);
  }

  const dup = cells.find((c) => c.name === 'duplicada-8-mas-8-extendida')!;
  const tramo = cells.find((c) => c.name === 'base-8-mas-tramo-4')!;
  const coalesceDup = core.coalescePlannedCellBillableHours(dup.turnos, slaHint);
  const coalesceTramo = core.coalescePlannedCellBillableHours(tramo.turnos, slaHint);
  const billableExt = core.calcPlanningBillableShiftHours(planShifts.find((p) => p.name === 'ext-15-19')!.shift, slaHint);
  const slaReconExt = core.calcPlanningSlaReconciliationHours(planShifts.find((p) => p.name === 'ext-15-19')!.shift, slaHint);
  const fichadaM = core.fichadaHoursForShift({ code: 'M', isPresent: true });
  const fichadaD12 = core.fichadaHoursForShift({ code: 'D12', isCompleted: true });
  const fichadaClock = core.fichadaHoursForShift({
    code: 'M',
    isPresent: true,
    realStartTime: artIso('2026-05-10', '07:04'),
    realEndTime: artIso('2026-05-10', '15:10'),
  });
  const clockH = (new Date('2026-05-10T15:10:00-03:00').getTime() - new Date('2026-05-10T07:04:00-03:00').getTime()) / 3600000;

  const liqFixtureByName = (name: string) => liqFixtures.find((f) => f.name === name)!;
  const liqAdv = core.calculateLiquidationHoursStats(liqFixtureByName('adelanto-autorizado').shifts, {});
  const liqRet = core.calculateLiquidationHoursStats(liqFixtureByName('retencion-3min').shifts, {});
  const liqEarly = core.calculateLiquidationHoursStats(liqFixtureByName('relevo-anticipado').shifts, {});
  const liqEarlySinRelevo = core.calculateLiquidationHoursStats(liqFixtureByName('salida-anticipada-sin-relevo').shifts, {});
  const payAdv = core.accumulatePayrollTurnoContribution(payrollFixtures[4].data, payrollFixtures[4].ctx);
  const payRet = core.accumulatePayrollTurnoContribution(payrollFixtures[5].data, payrollFixtures[5].ctx);
  const payEarly = core.accumulatePayrollTurnoContribution(payrollFixtures[6].data, payrollFixtures[6].ctx);
  const turnoNight = core.calcTurnoHoursContrib(turnoFixtures[4].data, new Set());
  const payNight = core.accumulatePayrollTurnoContribution(payrollFixtures[7].data, payrollFixtures[7].ctx);
  const turnoFt = core.calcTurnoHoursContrib(turnoFixtures[3].data, new Set());
  const payFt = core.accumulatePayrollTurnoContribution(payrollFixtures[3].data, payrollFixtures[3].ctx);
  const techoStats = core.calculateLiquidationHoursStats(techoShifts, {});
  const bolsa200 = core.liquidacion200FromWorkedHours(techoStats.horasReales);

  const nightStart = new Date('2026-05-12T22:00:00-03:00');
  const nightEnd = new Date('2026-05-13T06:00:00-03:00');
  let utcNightMins = 0;
  {
    const cur = new Date(nightStart.getTime());
    while (cur.getTime() < nightEnd.getTime()) {
      const h = cur.getUTCHours();
      if (h >= 21 || h < 6) utcNightMins++;
      cur.setMinutes(cur.getMinutes() + 1);
    }
  }

  console.log('--- períodos (calculateLiquidationHoursStats recibe turnos ya filtrados) ---');
  console.log(`CCT cierre 2026-05: ${cct.start} → ${cct.end}  turnos=${cctShifts.length} horasReales=${statsCct.horasReales}`);
  console.log(`calendario 2026-05: ${calStart} → ${calEnd}  turnos=${calShifts.length} horasReales=${statsCal.horasReales}`);
  console.log(`pool sin recorte: turnos=${pool.length} horasReales=${statsAll.horasReales} (el motor no aplica el período)`);
  console.log(`solo CCT: ${onlyCct.join(', ')} | solo calendario: ${onlyCal.join(', ')}`);
  console.log('useReportes: dateRange inicial = getCctPayrollPeriodByOffset(0); fetch por startTime entre esas fechas.');
  const payAdvF0 = legacyPayroll.accumulatePayrollTurnoContributionLegacy(payrollFixtures[4].data, payrollFixtures[4].ctx);
  const payRetF0 = legacyPayroll.accumulatePayrollTurnoContributionLegacy(payrollFixtures[5].data, payrollFixtures[5].ctx);
  const payEarlyF0 = legacyPayroll.accumulatePayrollTurnoContributionLegacy(payrollFixtures[6].data, payrollFixtures[6].ctx);
  const turnoFtF0 = legacyTurnoF0.calcTurnoHoursContrib(turnoFixtures[3].data, new Set());

  const extPlan = {
    employeeId: 'emp-ext',
    code: 'M',
    hours: 8,
    isExtended: true,
    adjustedEndTime: '19:00',
    segmentFromTime: '15:00',
    segmentToTime: '19:00',
    extExtraHours: 4,
    coverageSegmentRole: 'EXTENSION',
  };
  const extWorked = liqShift({
    ...extPlan,
    id: 'ext-base',
    startTime: secAt(2026, 5, 18, 7, 0),
    endTime: secAt(2026, 5, 18, 15, 0),
    realStartTime: secAt(2026, 5, 18, 7, 0),
    realEndTime: secAt(2026, 5, 18, 19, 0),
  });
  const extOpsCov = liqShift({
    id: 'ops_cov_titular_emp-ext',
    employeeId: 'emp-ext',
    code: 'T',
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'EXTEND',
    coverageHoursOnSource: true,
    startTime: secAt(2026, 5, 18, 15, 0),
    endTime: secAt(2026, 5, 18, 19, 0),
    realStartTime: secAt(2026, 5, 18, 15, 0),
    realEndTime: secAt(2026, 5, 18, 19, 0),
  });
  const extLeftAtBand = { ...extWorked, id: 'ext-left', realEndTime: secAt(2026, 5, 18, 15, 0) };
  // Decisión Mauro H1 #2: doble jornada el mismo día, sin pisarse en horario ni ser tramo EXT/ADV → se pagan las DOS.
  const dblM = liqShift({
    id: 'dbl-m',
    employeeId: 'emp-dbl-jornada',
    code: 'M',
    startTime: secAt(2026, 5, 20, 7, 0),
    endTime: secAt(2026, 5, 20, 15, 0),
    realStartTime: secAt(2026, 5, 20, 7, 0),
    realEndTime: secAt(2026, 5, 20, 15, 0),
  });
  const dblN = liqShift({
    id: 'dbl-n',
    employeeId: 'emp-dbl-jornada',
    code: 'N',
    startTime: secAt(2026, 5, 20, 23, 0),
    endTime: secAt(2026, 5, 21, 7, 0),
    realStartTime: secAt(2026, 5, 20, 23, 0),
    realEndTime: secAt(2026, 5, 21, 7, 0),
  });
  const liqDoubleJornada = core.calculateLiquidationHoursStats([dblM, dblN], {});

  // Docs que SÍ se pisan en horario (mismo legajo/día, sin flags EXT/ADV): una sola jornada billable.
  const ovlA = liqShift({
    id: 'ovl-a',
    employeeId: 'emp-ovl-jornada',
    code: 'M',
    startTime: secAt(2026, 5, 21, 7, 0),
    endTime: secAt(2026, 5, 21, 15, 0),
    realStartTime: secAt(2026, 5, 21, 7, 0),
    realEndTime: secAt(2026, 5, 21, 15, 0),
  });
  const ovlB = liqShift({
    id: 'ovl-b',
    employeeId: 'emp-ovl-jornada',
    code: 'M',
    startTime: secAt(2026, 5, 21, 9, 0),
    endTime: secAt(2026, 5, 21, 17, 0),
    realStartTime: secAt(2026, 5, 21, 9, 0),
    realEndTime: secAt(2026, 5, 21, 17, 0),
  });
  const liqOverlapJornada = core.calculateLiquidationHoursStats([ovlA, ovlB], {});

  // Decisión Mauro H1 #5: llegada tarde SÍ descuenta — cobra desde realStartTime (T+5 ya la aplicó el
  // servidor al fichar). Plan 07:00-15:00, fichó 07:20 → 7h40 (no 8h planas).
  const lateArrival = liqShift({
    id: 'llegada-tarde',
    employeeId: 'emp-llegada-tarde',
    startTime: secAt(2026, 5, 22, 7, 0),
    endTime: secAt(2026, 5, 22, 15, 0),
    realStartTime: secAt(2026, 5, 22, 7, 20),
    realEndTime: secAt(2026, 5, 22, 15, 0),
  });
  const liqLateArrival = core.calculateLiquidationHoursStats([lateArrival], {});

  const liqExt = core.calculateLiquidationHoursStats([extWorked], {});
  const liqExtWithOpsCov = core.calculateLiquidationHoursStats([extWorked, extOpsCov], {});
  const liqExtLeft = core.calculateLiquidationHoursStats([extLeftAtBand], {});
  const liqFt = core.calculateLiquidationHoursStats(liqFixtureByName('FT').shifts, {});

  const payExt = core.accumulatePayrollTurnoContribution({
    ...extPlan,
    startTime: artIso('2026-05-18', '07:00'),
    endTime: artIso('2026-05-18', '15:00'),
    realStartTime: artIso('2026-05-18', '07:00'),
    realEndTime: artIso('2026-05-18', '19:00'),
  }, { hoursMode: 'real', holidays: new Set(), turnoId: 'pay-ext' });

  canon('planning coalesce celda duplicada (antes 16)', coalesceDup, 8);
  canon('planning coalesce base 8 + tramo 4 (antes 20)', coalesceTramo, 12);
  canon('planning billable M + ext 15-19', billableExt, 12);
  canon('SLA recon franja vendida sin extra', slaReconExt, 8);
  canon('persona techo 26×8 horasSimples (antes 204)', techoStats.horasSimples, 200);
  canon('persona techo 26×8 extra50 (antes 4)', techoStats.extra50, 8);
  canon('persona TOTALES M 07-15 + ext hasta 19', liqExt.totales, 12);
  canon('persona desglose plan', liqExt.desglose.plan, 8);
  canon('persona desglose ext', liqExt.desglose.ext, 4);
  canon('persona celda turno + ops_cov (nunca 16)', liqExtWithOpsCov.totales, 12);
  canon('persona ext autorizada pero salió 15:00', liqExtLeft.totales, 8);
  canon('persona FT desglose.ft', liqFt.desglose.ft, 8);
  canon('persona doble jornada M+N sin pisarse: se pagan las dos', liqDoubleJornada.horasReales, 16);
  if (!liqDoubleJornada.requiresReview) {
    canonFails.push('persona doble jornada >12h debe marcar requiresReview (sin recortar el pago)');
  } else {
    canonOk += 1;
  }
  canon('persona llegada tarde descuenta (07:20 de 07:00, sale a horario)', liqLateArrival.horasReales, 7 + 40 / 60);
  canon('persona docs que se pisan en horario: una sola jornada', liqOverlapJornada.horasReales, 8);
  if (liqOverlapJornada.requiresReview) {
    canonFails.push('persona jornada única de 8h no debería marcar requiresReview');
  } else {
    canonOk += 1;
  }
  canon('liquidación adelanto', liqAdv.horasReales, 9);
  canon('liquidación retención 3 min', liqRet.horasReales, 8.05);
  canon('liquidación relevo anticipado (con relevo registrado)', liqEarly.horasReales, 8);
  canon('liquidación salida anticipada sin relevo (paga lo real)', liqEarlySinRelevo.horasReales, 7.5);
  canon('payrollApi adelanto (F0 8)', payAdv.hsReales, 9);
  canon('payrollApi desglose adv', payAdv.desglose.adv, 1);
  canon('payrollApi retención 3 min (F0 8)', payRet.hsReales, 8.05);
  canon('payrollApi relevo anticipado (F0 7,5)', payEarly.hsReales, 8);
  canon('payrollApi ext autorizada 07-19', payExt.hsReales, 12);
  canon('payrollApi desglose ext', payExt.desglose.ext, 4);
  canon('payrollApi FT al100', payFt.al100FT, 8);
  canon('calcTurnoHoursContrib FT al100 (F0 0)', turnoFt?.al100FT ?? NaN, 8);
  canon('calcTurnoHoursContrib nocturnas ART', turnoNight?.nocturnas ?? NaN, 8);
  canon('payroll nocturnas ART', payNight.nocturnas, 8);
  canon('fichada CRM banda M sigue 8', fichadaClock, 8);
  console.log('--- cánones Fase 1 (F0 → F1) ---');
  console.log(`celda duplicada 16 → ${coalesceDup} | base+tramo 20 → ${coalesceTramo} | billable ext = ${billableExt} | SLA recon = ${slaReconExt}`);
  console.log(`techo 26×8: horasSimples 204 → ${techoStats.horasSimples} | extra50 4 → ${techoStats.extra50} | liquidacion200 simples=${bolsa200.horasSimples}`);
  console.log(`persona M+ext: totales=${liqExt.totales} plan=${liqExt.desglose.plan} ext=${liqExt.desglose.ext} | +ops_cov=${liqExtWithOpsCov.totales} | salió 15:00=${liqExtLeft.totales}`);
  console.log(`payrollApi adelanto ${payAdvF0.hsReales} → ${payAdv.hsReales} | retención ${payRetF0.hsReales} → ${round4(payRet.hsReales)} | relevo ${payEarlyF0.hsReales} → ${payEarly.hsReales} | ext ${round4(payExt.hsReales)}`);
  console.log(`calcTurnoHoursContrib FT al100 ${turnoFtF0 ? turnoFtF0.al100FT : 'null'} → ${turnoFt ? turnoFt.al100FT : 'null'} | nocturnas ART ${turnoNight ? round4(turnoNight.nocturnas) : 'null'} (F0 en proceso UTC ≈ ${round4(utcNightMins / 60)})`);
  console.log(`fichada CRM M=${fichadaM} D12=${fichadaD12} reloj 07:04-15:10=${fichadaClock} (reloj ${round4(clockH)})`);

  if (canonFails.length) {
    console.error(`eval:hours-core FALLO cánones (${canonFails.length}):`);
    for (const c of canonFails) console.error(`  - ${c}`);
  }
  if (periodFails.length) {
    console.error('eval:hours-core FALLO períodos:');
    for (const p of periodFails) console.error(`  - ${p}`);
  }
  if (diffs.length) {
    console.error(`eval:hours-core FALLO — ${diffs.length} diferencias (checks ok=${ok})`);
    for (const d of diffs) {
      console.error(`  [${d.consumer}] ${d.fixture}`);
      console.error(`    legacy=${JSON.stringify(d.legacy)}`);
      console.error(`    core  =${JSON.stringify(d.core)}`);
    }
  }
  if (periodFails.length || diffs.length || canonFails.length) process.exit(1);

  console.log(`eval:hours-core OK — 0 diferencias (${ok} checks de paridad, ${canonOk} cánones F1)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
