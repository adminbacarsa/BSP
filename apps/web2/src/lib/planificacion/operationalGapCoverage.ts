/**
 * Cierre de hueco SLA sin titular en licencia (ext + cierre desde pie de cobertura).
 */

import { dualSegmentBounds } from '@cosp/ops-core';
import type { RecompositionPackage } from './planningRecomposition.types';
import {
  buildRecompositionPendingUpdates,
  clasificarTurnoContraHueco,
  hoursBetweenTimes,
  isPlannedFrancoShift,
  nextCalendarDayStr,
  previousCalendarDayStr,
  resolveEmployeeShift,
} from './planningRecompositionApply';
import { defaultSplitTimesForVacancyGap } from './vacancySplitBands';
import { listVacancyGapBandOptions } from './vacancyGapBands';
import type { VacancyPositionSla } from './vacancySplitBands';

export type OperationalGapCloseInput = {
  objectiveId: string;
  clientId?: string;
  dateStr: string;
  gapPosition: string;
  gapBand: string;
  extEmpId: string;
  secondEmpId: string;
  extHomePosition?: string;
  extBaseCode?: string;
  secondBaseCode?: string;
  extExtraHours?: number | null;
  secondExtExtraHours?: number | null;
  positionStructure?: VacancyPositionSla[];
  authorizeFrancoTrabajado?: boolean;
  /** Día de la celda del guardia de extensión (default: dateStr del hueco). */
  extApplyDateStr?: string;
  /** Día de la celda del adelanto (default: dateStr del hueco; hueco N = día siguiente). */
  adelApplyDateStr?: string;
  /** Horario real del hueco. Si falta, se toma del SLA del puesto y si no, del CCT. */
  gapFrom?: string;
  gapTo?: string;
};

export function buildOperationalGapRecompositionPackage(
  input: OperationalGapCloseInput,
  splitTimes: {
    ext: { from: string; to: string };
    adel: { from: string; to: string };
    extExtraHours?: number;
    adelExtraHours?: number;
  },
): RecompositionPackage {
  const gapBand = String(input.gapBand || '').toUpperCase();
  return {
    id: `sla_gap_${input.dateStr}_${gapBand}_${Date.now()}`,
    type: 'ABSENCE_COVERAGE',
    mode: 'operational_gap',
    objectiveId: input.objectiveId,
    dateStr: input.dateStr,
    target: {
      employeeId: '',
      dateStr: input.dateStr,
      positionName: input.gapPosition,
      code: gapBand,
      label: `${input.gapPosition} · ${gapBand}`,
      kind: 'sla_gap',
    },
    gapFrom: splitTimes.ext.from,
    gapTo: splitTimes.adel.to,
    gapPositionName: input.gapPosition,
    extension: {
      employeeId: input.extEmpId,
      role: 'EXTENSION',
      positionName: input.gapPosition,
      fromTime: splitTimes.ext.from,
      toTime: splitTimes.ext.to,
      homePositionName: input.extHomePosition,
      baseCode: input.extBaseCode,
      extraHours: splitTimes.extExtraHours,
      applyDateStr: input.extApplyDateStr && input.extApplyDateStr !== input.dateStr
        ? input.extApplyDateStr
        : undefined,
    },
    earlyStart: {
      employeeId: input.secondEmpId,
      role: 'EARLY_START',
      positionName: input.gapPosition,
      fromTime: splitTimes.adel.from,
      toTime: splitTimes.adel.to,
      baseCode: input.secondBaseCode,
      extraHours: splitTimes.adelExtraHours,
      applyDateStr: input.adelApplyDateStr && input.adelApplyDateStr !== input.dateStr
        ? input.adelApplyDateStr
        : undefined,
    },
  };
}

function hmCorto(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function minDe(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function hmDeMinutos(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Medianoche Argentina del día calendario, en ms. */
function msMedianocheAR(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 3, 0, 0);
}

/** Ext = inicio→mitad, Adel = mitad→fin. El mismo corte que `dualSegmentBounds`. Nunca 0 h. */
export function segmentosMitadHueco(dateStr: string, from: string, to: string): {
  ext: { from: string; to: string };
  adel: { from: string; to: string };
} {
  if (from === to) throw new Error('El tramo no puede ser de 0 h');
  const start = minDe(from);
  let end = minDe(to);
  if (end <= start) end += 24 * 60;
  if (end - start < 30) throw new Error('El tramo no puede ser de 0 h');
  const midnight = msMedianocheAR(dateStr);
  const { extEndMs, advStartMs } = dualSegmentBounds({
    titularShiftId: 'sla_gap',
    objectiveId: 'gap',
    startMs: midnight + start * 60_000,
    endMs: midnight + end * 60_000,
  });
  const extTo = hmDeMinutos(Math.round((extEndMs - midnight) / 60_000));
  const adelFrom = hmDeMinutos(Math.round((advStartMs - midnight) / 60_000));
  const gapTo = hmDeMinutos(end);
  if (from === extTo || adelFrom === gapTo) throw new Error('El tramo no puede ser de 0 h');
  return { ext: { from, to: extTo }, adel: { from: adelFrom, to: gapTo } };
}

export function ventanaHuecoSla(input: Pick<OperationalGapCloseInput, 'gapBand' | 'gapPosition' | 'positionStructure' | 'gapFrom' | 'gapTo'>): { from: string; to: string } {
  const desde = hmCorto(input.gapFrom);
  const hasta = hmCorto(input.gapTo);
  if (desde && hasta && desde !== hasta) return { from: desde, to: hasta };
  const band = String(input.gapBand || '').toUpperCase();
  const opt = listVacancyGapBandOptions(input.positionStructure, input.gapPosition)
    .find((o) => o.code === band);
  if (opt?.startTime && opt?.endTime && opt.startTime !== opt.endTime) {
    return { from: opt.startTime.slice(0, 5), to: opt.endTime.slice(0, 5) };
  }
  const split = defaultSplitTimesForVacancyGap(input.positionStructure, input.gapPosition, band);
  return split.gap;
}

function apellidoDe(employeesById: Record<string, any>, empId: string): string {
  return String(employeesById[empId]?.name || empId).split(',')[0].trim().split(/\s+/)[0];
}

type LadoEncontrado = { empId: string; lado: 'ext' | 'adel'; dateStr: string; shift: Record<string, any> };

function ladoDePersona(
  empId: string,
  dateStr: string,
  gap: { from: string; to: string },
  gapPosition: string,
  shiftsMap: Record<string, any>,
  pending: Record<string, any>,
  positionStructure: VacancyPositionSla[] | undefined,
): LadoEncontrado | null {
  const prev = previousCalendarDayStr(dateStr);
  const next = nextCalendarDayStr(dateStr);
  const dias = [
    { dia: dateStr, offset: 0 },
    { dia: prev, offset: -1 },
    { dia: next, offset: 1 },
  ];
  let ext: LadoEncontrado | null = null;
  let adel: LadoEncontrado | null = null;
  for (const { dia, offset } of dias) {
    const shift = resolveEmployeeShift(empId, dia, shiftsMap, pending);
    if (!shift) continue;
    const lado = clasificarTurnoContraHueco(shift, gap.from, gap.to, positionStructure, {
      offsetDays: offset,
      gapPositionName: gapPosition,
    });
    if (lado === 'ext' && !ext) ext = { empId, lado, dateStr: dia, shift };
    if (lado === 'adel' && !adel) adel = { empId, lado, dateStr: dia, shift };
  }
  if (ext && !adel) return ext;
  if (adel && !ext) return adel;
  return null;
}

function motivoNoContiguo(nombre: string, shift: Record<string, any> | null, gap: { from: string; to: string }): string {
  const fin = hmCorto(shift?.endTime) || 'sin hora';
  const ini = hmCorto(shift?.startTime) || 'sin hora';
  const desde = hmDeMinutos(minDe(gap.from) - 30);
  const hasta = hmDeMinutos(minDe(gap.to) + 30);
  return `${nombre}: para extender tiene que terminar entre las ${desde} y las ${gap.from} (termina ${fin}); para adelantar tiene que arrancar entre las ${gap.to} y las ${hasta} (arranca ${ini})`;
}

export function applyOperationalGapCloseToChanges(
  baseChanges: Record<string, any>,
  input: OperationalGapCloseInput,
  ctx: {
    shiftsMap: Record<string, any>;
    employeesById: Record<string, any>;
  },
): Record<string, any> {
  const gap = ventanaHuecoSla(input);
  const segmentos = segmentosMitadHueco(input.dateStr, gap.from, gap.to);
  const extH = hoursBetweenTimes(segmentos.ext.from, segmentos.ext.to);
  const adelH = hoursBetweenTimes(segmentos.adel.from, segmentos.adel.to);
  if (extH <= 0 || adelH <= 0) throw new Error('El tramo no puede ser de 0 h');

  const a = ladoDePersona(input.extEmpId, input.dateStr, gap, input.gapPosition, ctx.shiftsMap, baseChanges, input.positionStructure);
  const b = ladoDePersona(input.secondEmpId, input.dateStr, gap, input.gapPosition, ctx.shiftsMap, baseChanges, input.positionStructure);
  const extP = a?.lado === 'ext' ? a : b?.lado === 'ext' ? b : null;
  const adelP = a?.lado === 'adel' ? a : b?.lado === 'adel' ? b : null;
  if (!extP || !adelP || extP.empId === adelP.empId) {
    const na = apellidoDe(ctx.employeesById, input.extEmpId);
    const nb = apellidoDe(ctx.employeesById, input.secondEmpId);
    const sa = resolveEmployeeShift(input.extEmpId, input.extApplyDateStr || input.dateStr, ctx.shiftsMap, baseChanges)
      || resolveEmployeeShift(input.extEmpId, previousCalendarDayStr(input.dateStr), ctx.shiftsMap, baseChanges);
    const sb = resolveEmployeeShift(input.secondEmpId, input.adelApplyDateStr || input.dateStr, ctx.shiftsMap, baseChanges)
      || resolveEmployeeShift(input.secondEmpId, nextCalendarDayStr(input.dateStr), ctx.shiftsMap, baseChanges)
      || resolveEmployeeShift(input.secondEmpId, previousCalendarDayStr(input.dateStr), ctx.shiftsMap, baseChanges);
    const partes = [motivoNoContiguo(na, sa, gap)];
    if (input.secondEmpId !== input.extEmpId) partes.push(motivoNoContiguo(nb, sb, gap));
    if (a?.lado === 'adel' && a.empId === input.extEmpId) {
      partes.unshift(`${na} arranca al cierre del hueco: es un adelanto, no una extensión`);
    }
    throw new Error(partes.join('. '));
  }

  const splitTimes = {
    ext: segmentos.ext,
    adel: segmentos.adel,
    extExtraHours: extH,
    adelExtraHours: adelH,
  };
  const pkg = buildOperationalGapRecompositionPackage({
    ...input,
    extEmpId: extP.empId,
    secondEmpId: adelP.empId,
    extHomePosition: String(extP.shift.positionName || input.gapPosition),
    extBaseCode: String(extP.shift.code || ''),
    secondBaseCode: String(adelP.shift.code || ''),
    extApplyDateStr: extP.dateStr !== input.dateStr ? extP.dateStr : undefined,
    adelApplyDateStr: adelP.dateStr !== input.dateStr ? adelP.dateStr : undefined,
    extExtraHours: extH,
    secondExtExtraHours: adelH,
  }, splitTimes);
  const updates = buildRecompositionPendingUpdates(pkg, {
    shiftsMap: ctx.shiftsMap,
    pendingChanges: baseChanges,
    employeesById: ctx.employeesById,
    objectiveId: input.objectiveId,
    clientId: input.clientId,
    authorizeFrancoTrabajado: input.authorizeFrancoTrabajado,
  });
  return { ...baseChanges, ...updates };
}

export type SingleWorkerGapCloseInput = {
  objectiveId: string;
  clientId?: string;
  dateStr: string;
  gapPosition: string;
  gapBand: string;
  employeeId: string;
  applyDateStr?: string;
  positionStructure?: VacancyPositionSla[];
};

/** Una sola persona cubre toda la banda del hueco (extiende M o adelanta N). */
export function applySingleWorkerFullGapCloseToChanges(
  baseChanges: Record<string, any>,
  input: SingleWorkerGapCloseInput,
  ctx: {
    shiftsMap: Record<string, any>;
    employeesById: Record<string, any>;
  },
): Record<string, any> {
  const empId = String(input.employeeId || '').trim();
  if (!empId) throw new Error('Elegí un guardia para cubrir la banda completa.');
  const applyDate = input.applyDateStr || input.dateStr;
  const base = resolveEmployeeShift(empId, applyDate, ctx.shiftsMap, baseChanges);
  if (!base || base.isDeleted) {
    throw new Error('El guardia no tiene turno laboral ese día.');
  }
  if (isPlannedFrancoShift(base)) {
    throw new Error('Para un franco usá la opción Franco trabajado (FT).');
  }

  const band = String(input.gapBand || '').toUpperCase();
  const gap = ventanaHuecoSla({
    gapBand: band,
    gapPosition: input.gapPosition,
    positionStructure: input.positionStructure,
  });
  const hours = hoursBetweenTimes(gap.from, gap.to) || 8;
  const from = gap.from;
  const to = gap.to;
  const hoursLabel = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  const offsetDays = applyDate === input.dateStr
    ? 0
    : applyDate === nextCalendarDayStr(input.dateStr)
      ? 1
      : -1;
  const lado = clasificarTurnoContraHueco(base, from, to, input.positionStructure, {
    offsetDays,
    gapPositionName: input.gapPosition,
  });
  if (lado !== 'ext' && lado !== 'adel') {
    const quien = String(ctx.employeesById[empId]?.name || empId).split(',')[0].trim().split(/\s+/)[0];
    throw new Error(motivoNoContiguo(quien, base, gap));
  }
  const isExt = lado === 'ext';
  const isAdel = lado === 'adel';

  const emp = ctx.employeesById[empId];
  const shortName = String(emp?.name || empId).split(',')[0];
  const key = `${empId}_${applyDate}`;
  const roleLabel = isExt ? 'extiende' : 'adelanta';
  const pkgId = `sla_full_${input.dateStr}_${band}_${empId}_${Date.now()}`;

  return {
    ...baseChanges,
    [key]: {
      ...base,
      isFranco: false,
      isExtended: isExt,
      isEarlyStart: isAdel && !isExt,
      extExtraHours: hours,
      isTemp: true,
      coveragePackageId: pkgId,
      coverageType: 'ABSENCE_COVERAGE',
      coverageMode: 'FULL_BAND',
      coverageSegmentRole: isExt ? 'EXTENSION' : 'EARLY_START',
      coverageStatus: 'COVERED',
      coversPositionName: input.gapPosition,
      coversBandCode: band,
      adjustedEndTime: isExt ? to : base.adjustedEndTime,
      adjustedStartTime: isAdel && !isExt ? from : base.adjustedStartTime,
      segmentFromTime: from,
      segmentToTime: to,
      coverageNote: `${shortName} ${roleLabel} ${from}–${to} · cubre ${input.gapPosition} ${band} (${hoursLabel} h)`,
      comments: `Cubre hueco SLA completo · ${input.gapPosition} ${band} ${from}–${to}`,
    },
  };
}

export type FrancoTrabajadoGapCloseInput = {
  objectiveId: string;
  clientId?: string;
  dateStr: string;
  gapPosition: string;
  gapBand: string;
  employeeId: string;
  positionStructure?: VacancyPositionSla[];
  authorizeFrancoTrabajado?: boolean;
};

/** Cubre el hueco SLA completo con un guardia de franco → FT (costo extra CCT). */
export function applyFrancoTrabajadoGapCloseToChanges(
  baseChanges: Record<string, any>,
  input: FrancoTrabajadoGapCloseInput,
  ctx: {
    shiftsMap: Record<string, any>;
    employeesById: Record<string, any>;
  },
): Record<string, any> {
  const empId = String(input.employeeId || '').trim();
  if (!empId) throw new Error('Elegí un guardia de franco.');
  const base = resolveEmployeeShift(empId, input.dateStr, ctx.shiftsMap, baseChanges);
  if (!base || base.isDeleted) {
    throw new Error('El guardia no tiene celda ese día.');
  }
  if (!isPlannedFrancoShift(base)) {
    throw new Error('El guardia no está de franco planificado ese día.');
  }
  if (!input.authorizeFrancoTrabajado) {
    const emp = ctx.employeesById[empId];
    const name = emp?.name || empId;
    throw new Error(
      `FRANCO_COVERAGE:${name} tiene franco planificado (${String(base.code || 'F').toUpperCase()}) el ${input.dateStr} — requiere PIN de supervisor (FT / costo extra).`,
    );
  }

  const band = String(input.gapBand || '').toUpperCase();
  const opt = listVacancyGapBandOptions(input.positionStructure, input.gapPosition)
    .find((o) => o.code === band);
  const hours = opt?.hours || 8;
  const startTime = opt?.startTime || '15:00';
  const endTime = opt?.endTime || '23:00';
  const key = `${empId}_${input.dateStr}`;
  const emp = ctx.employeesById[empId];
  const name = emp?.name || empId;
  const pkgId = `sla_ft_${input.dateStr}_${band}_${empId}_${Date.now()}`;

  return {
    ...baseChanges,
    [key]: {
      ...base,
      code: band,
      name: `Franco trabajado · ${band}`,
      hours,
      startTime,
      endTime,
      positionName: input.gapPosition,
      objectiveId: input.objectiveId,
      clientId: input.clientId || base.clientId,
      isFranco: false,
      isFrancoTrabajado: true,
      isExtended: false,
      isEarlyStart: false,
      isTemp: true,
      coveragePackageId: pkgId,
      coverageType: 'ABSENCE_COVERAGE',
      coverageMode: 'FRANCO_TRABAJADO',
      coverageSegmentRole: 'SUBSTITUTE',
      coverageStatus: 'COVERED',
      coversPositionName: input.gapPosition,
      coversBandCode: band,
      coverageNote: `FT cubre hueco SLA ${input.gapPosition} · ${band} ${startTime}–${endTime}`,
      comments: `Franco trabajado — ${name.split(',')[0]} cubre ${input.gapPosition} ${band}`,
    },
  };
}
