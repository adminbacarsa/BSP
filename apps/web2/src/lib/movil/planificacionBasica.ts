/**
 * Vista de los próximos días para el celular.
 * Huecos, candidatos y conflictos salen de las mismas reglas que la grilla:
 * descanso art. 197 (`findLctRestGaps`), tope 12:59, horas de cronograma y tope 200.
 */
import { findLctRestGaps, type LctShiftInput } from '@/lib/planificacion/lctRestGap';
import { shiftCountsForEmployeeCronoHours } from '@/lib/planificacion/deploymentRoles';
import { haversineKm } from '@/lib/operaciones/coverageGeo';
import { calcPlanificadorShiftHours, hoursBetweenClockTimes } from '@/lib/planificacion/planningScheduledHours';
import { planningHourLimits } from '@/lib/planning/planning-rules.runtime';

export const TOPE_JORNADA_MIN = 12 * 60 + 59;
const LICENCIA = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'ART']);
const FRANCO = new Set(['F', 'FF', 'FP']);
const BANDAS: Record<string, { start: string; end: string; hours: number }> = {
  M: { start: '07:00', end: '15:00', hours: 8 },
  T: { start: '15:00', end: '23:00', hours: 8 },
  N: { start: '23:00', end: '07:00', hours: 8 },
  D12: { start: '07:00', end: '19:00', hours: 12 },
  N12: { start: '19:00', end: '07:00', hours: 12 },
};

export type TurnoMovil = {
  id: string;
  employeeId: string;
  employeeName: string;
  code: string;
  objectiveId: string;
  objectiveName: string;
  positionName: string;
  clientId: string;
  clientName: string;
  date: string;
  start: string;
  end: string;
  hours: number;
  vacante: boolean;
  licencia: boolean;
  coveredBy: string;
  franco: boolean;
};

export type FranjaMovil = TurnoMovil & { kind: 'ok' | 'vacante' | 'licencia' };

export type TabCandidato = 'plantel' | 'otros' | 'ft';

export type CandidatoMovil = {
  employeeId: string;
  name: string;
  tab: TabCandidato;
  monthHours: number;
  cap: number;
  km: number | null;
  blocked: boolean;
  reason: string | null;
};

export type EmpleadoMovil = {
  id: string;
  name: string;
  preferredObjectiveId?: string;
  lat?: number | null;
  lng?: number | null;
  monthHours: number;
};

export function hoyArgentina(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function proximosDias(hoy: string, cantidad = 4): string[] {
  return Array.from({ length: cantidad }, (_, i) => sumarDias(hoy, i));
}

export function topeHorasMes(): number {
  return planningHourLimits().monthly;
}

function hhmm(raw: unknown): string | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function msDe(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') {
    const d = o.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  const sec = o.seconds ?? o._seconds;
  if (typeof sec === 'number' && sec > 0) return sec * 1000;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function fechaHoraAr(ms: number): { fecha: string; hora: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, hora: `${get('hour')}:${get('minute')}` };
}

export function turnoMovilDesdeDoc(id: string, data: Record<string, unknown>): TurnoMovil | null {
  if (!data || data.isDeleted === true) return null;
  const code = String(data.code || data.type || '').toUpperCase();
  if (!code) return null;
  const schedule = String(data.scheduleDate || data.fecha || '');
  const startMs = msDe(data.startTime);
  const endMs = msDe(data.endTime);
  const startStr = hhmm(data.startTime);
  const endStr = hhmm(data.endTime);
  let date = /^\d{4}-\d{2}-\d{2}/.test(schedule) ? schedule.slice(0, 10) : '';
  let start = startStr || '';
  let end = endStr || '';
  if (startMs != null && !startStr) {
    const ini = fechaHoraAr(startMs);
    date = date || ini.fecha;
    start = ini.hora;
  }
  if (endMs != null && !endStr) end = fechaHoraAr(endMs).hora;
  const banda = BANDAS[code];
  if (!start) start = banda?.start || '';
  if (!end) end = banda?.end || '';
  if (!date || !start || !end) return null;
  const hours = Number(data.hours) > 0 ? Number(data.hours) : (hoursBetweenClockTimes(start, end) ?? banda?.hours ?? 0);
  const employeeId = String(data.employeeId || '');
  const vacante = data.isUnassigned === true || employeeId === 'VACANTE' || employeeId === '';
  return {
    id,
    employeeId,
    employeeName: String(data.employeeName || (vacante ? 'Vacante' : employeeId)),
    code,
    objectiveId: String(data.objectiveId || ''),
    objectiveName: String(data.objectiveName || ''),
    positionName: String(data.positionName || 'General'),
    clientId: String(data.clientId || ''),
    clientName: String(data.clientName || ''),
    date,
    start,
    end,
    hours,
    vacante,
    licencia: LICENCIA.has(code),
    coveredBy: String(data.coveredBy || ''),
    franco: FRANCO.has(code) || data.isFranco === true,
  };
}

export function franjasDe(turnos: TurnoMovil[], dias: string[]): FranjaMovil[] {
  const set = new Set(dias);
  return turnos
    .filter((t) => set.has(t.date) && t.objectiveId)
    .map((t) => ({
      ...t,
      kind: t.vacante && !t.coveredBy ? 'vacante' as const : (t.licencia && !t.coveredBy ? 'licencia' as const : 'ok' as const),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.objectiveName.localeCompare(b.objectiveName, 'es') || a.positionName.localeCompare(b.positionName, 'es') || a.start.localeCompare(b.start));
}

function minutos(hhmmValue: string, fecha: string): number {
  const [h, m] = hhmmValue.split(':').map(Number);
  const [y, mo, d] = fecha.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, h || 0, m || 0) / 60000;
}

function intervalo(fecha: string, start: string, end: string): { desde: number; hasta: number } {
  const desde = minutos(start, fecha);
  let hasta = minutos(end, fecha);
  if (hasta <= desde) hasta += 24 * 60;
  return { desde, hasta };
}

export function conflictosDeAsignacion(input: {
  employeeId: string;
  employeeName?: string;
  fecha: string;
  start: string;
  end: string;
  hours: number;
  code: string;
  objectiveId: string;
  objectiveName?: string;
  monthHours: number;
  otrosTurnos: TurnoMovil[];
}): { blocked: boolean; reason: string | null } {
  const cap = topeHorasMes();
  const span = hoursBetweenClockTimes(input.start, input.end) ?? input.hours;
  if (Math.round(span * 60) > TOPE_JORNADA_MIN) {
    return { blocked: true, reason: `Supera el tope de 12:59 (${span} h).` };
  }
  if (input.monthHours + span > cap + 0.05) {
    return { blocked: true, reason: `Quedaría en ${Math.round(input.monthHours + span)} h. Tope ${cap}.` };
  }
  const propio = intervalo(input.fecha, input.start, input.end);
  for (const otro of input.otrosTurnos) {
    if (otro.employeeId !== input.employeeId || otro.franco || otro.licencia || otro.vacante) continue;
    const o = intervalo(otro.date, otro.start, otro.end);
    if (propio.desde < o.hasta && o.desde < propio.hasta) {
      return { blocked: true, reason: `Se superpone con ${otro.code} ${otro.start}–${otro.end}${otro.objectiveName ? ` en ${otro.objectiveName}` : ''}.` };
    }
  }
  const lct: LctShiftInput[] = input.otrosTurnos
    .filter((t) => t.employeeId === input.employeeId)
    .map((t) => ({
      employeeId: t.employeeId,
      employeeName: t.employeeName,
      code: t.code,
      dateStr: t.date,
      startTime: t.start,
      endTime: t.end,
      hours: t.hours,
      objectiveId: t.objectiveId,
      objectiveName: t.objectiveName,
    }));
  lct.push({
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    code: input.code,
    dateStr: input.fecha,
    startTime: input.start,
    endTime: input.end,
    hours: span,
    objectiveId: input.objectiveId,
    objectiveName: input.objectiveName,
  });
  const descanso = findLctRestGaps(lct).find((g) => g.employeeId === input.employeeId);
  if (descanso) return { blocked: true, reason: descanso.message };
  return { blocked: false, reason: null };
}

export function candidatosParaHueco(input: {
  hueco: FranjaMovil;
  empleados: EmpleadoMovil[];
  turnos: TurnoMovil[];
  objLat?: number | null;
  objLng?: number | null;
}): CandidatoMovil[] {
  const cap = topeHorasMes();
  const banda = bandaParaCubrir(input.hueco);
  const delDia = input.turnos.filter((t) => t.date === input.hueco.date);
  const out: CandidatoMovil[] = [];
  for (const emp of input.empleados) {
    if (!emp.id || emp.id === input.hueco.employeeId) continue;
    const franco = delDia.find((t) => t.employeeId === emp.id && t.franco);
    const enObjetivo = emp.preferredObjectiveId === input.hueco.objectiveId;
    const tab: TabCandidato = franco ? 'ft' : (enObjetivo ? 'plantel' : 'otros');
    if (!franco && delDia.some((t) => t.employeeId === emp.id && !t.licencia && !t.vacante)) continue;
    const conflicto = conflictosDeAsignacion({
      employeeId: emp.id,
      employeeName: emp.name,
      fecha: input.hueco.date,
      start: banda.start,
      end: banda.end,
      hours: banda.hours,
      code: banda.code,
      objectiveId: input.hueco.objectiveId,
      objectiveName: input.hueco.objectiveName,
      monthHours: emp.monthHours,
      otrosTurnos: input.turnos.filter((t) => t.id !== input.hueco.id),
    });
    const km = haversineKm(Number(emp.lat), Number(emp.lng), Number(input.objLat), Number(input.objLng));
    out.push({
      employeeId: emp.id,
      name: emp.name,
      tab,
      monthHours: emp.monthHours,
      cap,
      km: km == null ? null : Math.round(km * 10) / 10,
      blocked: conflicto.blocked,
      reason: conflicto.reason,
    });
  }
  return out.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    if (a.km != null && b.km != null && a.km !== b.km) return a.km - b.km;
    if ((a.km == null) !== (b.km == null)) return a.km == null ? 1 : -1;
    return a.name.localeCompare(b.name, 'es');
  });
}

export function bandaDe(code: string): { start: string; end: string; hours: number } | null {
  return BANDAS[String(code || '').toUpperCase()] || null;
}

/** El hueco a cubrir: la vacante conserva su banda; la licencia usa esa banda si el horario coincide, si no M. */
export function bandaParaCubrir(hueco: FranjaMovil): { code: string; start: string; end: string; hours: number } {
  if (!hueco.licencia && hueco.start && hueco.end) {
    return { code: hueco.code, start: hueco.start, end: hueco.end, hours: hueco.hours };
  }
  const match = Object.entries(BANDAS).find(([, b]) => b.start === hueco.start && b.end === hueco.end);
  if (match) return { code: match[0], start: match[1].start, end: match[1].end, hours: match[1].hours };
  return { code: 'M', ...BANDAS.M };
}

export function horasMesEmpleado(employeeId: string, yyyyMm: string, turnos: TurnoMovil[]): number {
  let total = 0;
  for (const turno of turnos) {
    if (turno.employeeId !== employeeId || !turno.date.startsWith(yyyyMm) || turno.vacante) continue;
    if (!shiftCountsForEmployeeCronoHours(turno)) continue;
    total += calcPlanificadorShiftHours(turno);
  }
  return Math.round(total * 100) / 100;
}

export function instantesJornada(fecha: string, start: string, end: string, franco = false): { start: Date; end: Date } {
  if (franco) {
    return {
      start: new Date(`${fecha}T00:00:00.000-03:00`),
      end: new Date(`${fecha}T23:59:59.000-03:00`),
    };
  }
  const ini = new Date(`${fecha}T${start}:00.000-03:00`);
  let fin = new Date(`${fecha}T${end}:00.000-03:00`);
  if (fin.getTime() <= ini.getTime()) fin = new Date(fin.getTime() + 24 * 3600000);
  return { start: ini, end: fin };
}

export type CambioLocal =
  | { kind: 'asignar'; franjaId: string; employeeId: string; employeeName: string; ft: boolean; bolsaCuil?: string }
  | { kind: 'horario'; franjaId: string; code: string; start: string; end: string; hours: number }
  | { kind: 'franco'; franjaId: string }
  | { kind: 'permuta'; franjaId: string; otroId: string }
  /** Hueco del SLA sin doc (`slot:*`): el turno nace con el guardia. */
  | { kind: 'nuevo'; franja: TurnoMovil; employeeId: string; employeeName: string; ft: boolean; bolsaCuil?: string }
  | { kind: 'borrar'; franjaId: string };

export function aplicarCambios(turnos: TurnoMovil[], cambios: CambioLocal[]): TurnoMovil[] {
  let next = turnos.map((t) => ({ ...t }));
  const byId = (id: string) => next.find((t) => t.id === id);
  for (const cambio of cambios) {
    if (cambio.kind === 'nuevo') {
      next.push({
        ...cambio.franja,
        employeeId: cambio.employeeId,
        employeeName: cambio.employeeName,
        vacante: false,
        licencia: false,
        franco: false,
        coveredBy: '',
      });
    } else if (cambio.kind === 'borrar') {
      next = next.filter((t) => t.id !== cambio.franjaId);
    } else if (cambio.kind === 'asignar') {
      const franja = byId(cambio.franjaId);
      if (!franja) continue;
      const banda = bandaParaCubrir({ ...franja, kind: franja.vacante ? 'vacante' : franja.licencia ? 'licencia' : 'ok' });
      if (franja.licencia) {
        franja.coveredBy = cambio.employeeName;
        next.push({
          ...franja,
          id: `cubre:${franja.id}:${cambio.employeeId}`,
          employeeId: cambio.employeeId,
          employeeName: cambio.employeeName,
          code: banda.code,
          start: banda.start,
          end: banda.end,
          hours: banda.hours,
          vacante: false,
          licencia: false,
          franco: false,
          coveredBy: '',
        });
      } else {
        franja.employeeId = cambio.employeeId;
        franja.employeeName = cambio.employeeName;
        franja.vacante = false;
        franja.code = banda.code;
        franja.start = banda.start;
        franja.end = banda.end;
        franja.hours = banda.hours;
      }
    } else if (cambio.kind === 'horario') {
      const franja = byId(cambio.franjaId);
      if (!franja) continue;
      franja.code = cambio.code;
      franja.start = cambio.start;
      franja.end = cambio.end;
      franja.hours = cambio.hours;
      franja.franco = false;
      franja.licencia = false;
    } else if (cambio.kind === 'franco') {
      const franja = byId(cambio.franjaId);
      if (!franja || franja.franco) continue;
      const banda = { code: franja.code, start: franja.start, end: franja.end, hours: franja.hours };
      franja.code = 'F';
      franja.franco = true;
      franja.hours = 0;
      franja.start = '00:00';
      franja.end = '23:59';
      next.push({
        ...franja,
        id: `vacante:${franja.id}`,
        employeeId: 'VACANTE',
        employeeName: 'Vacante',
        code: banda.code,
        start: banda.start,
        end: banda.end,
        hours: banda.hours,
        vacante: true,
        licencia: false,
        franco: false,
        coveredBy: '',
      });
    } else {
      const a = byId(cambio.franjaId);
      const b = byId(cambio.otroId);
      if (!a || !b) continue;
      const emp = { id: a.employeeId, name: a.employeeName };
      a.employeeId = b.employeeId;
      a.employeeName = b.employeeName;
      b.employeeId = emp.id;
      b.employeeName = emp.name;
    }
  }
  return next;
}

export function conflictosDeHorario(franja: TurnoMovil, code: string, start: string, end: string, hours: number, turnos: TurnoMovil[]) {
  return conflictosDeAsignacion({
    employeeId: franja.employeeId,
    employeeName: franja.employeeName,
    fecha: franja.date,
    start,
    end,
    hours,
    code,
    objectiveId: franja.objectiveId,
    objectiveName: franja.objectiveName,
    monthHours: horasMesEmpleado(franja.employeeId, franja.date.slice(0, 7), turnos.filter((t) => t.id !== franja.id)),
    otrosTurnos: turnos.filter((t) => t.id !== franja.id),
  });
}

export function conflictosDePermuta(a: TurnoMovil, b: TurnoMovil, turnos: TurnoMovil[]): { blocked: boolean; reason: string | null } {
  const resto = turnos.filter((t) => t.id !== a.id && t.id !== b.id);
  const uno = conflictosDeAsignacion({
    employeeId: a.employeeId,
    employeeName: a.employeeName,
    fecha: b.date,
    start: b.start,
    end: b.end,
    hours: b.hours,
    code: b.code,
    objectiveId: b.objectiveId,
    objectiveName: b.objectiveName,
    monthHours: horasMesEmpleado(a.employeeId, b.date.slice(0, 7), resto),
    otrosTurnos: resto,
  });
  if (uno.blocked) return uno;
  return conflictosDeAsignacion({
    employeeId: b.employeeId,
    employeeName: b.employeeName,
    fecha: a.date,
    start: a.start,
    end: a.end,
    hours: a.hours,
    code: a.code,
    objectiveId: a.objectiveId,
    objectiveName: a.objectiveName,
    monthHours: horasMesEmpleado(b.employeeId, a.date.slice(0, 7), resto),
    otrosTurnos: resto,
  });
}
