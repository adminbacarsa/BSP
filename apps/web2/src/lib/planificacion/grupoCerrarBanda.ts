/**
 * Cerrar una banda en la vista agrupada: las bandas abiertas de cada objetivo
 * (la misma cuenta que «Puestos sin cerrar») y a qué objetivo se acredita el cierre.
 */

import { analyzeDayCoverageGaps, flattenDayGapsForUi } from './coverageGapAnalysis';
import type { PlanningPositionLike } from './coverageGapAnalysis';
import { listVacancyGapBandOptions } from './vacancyGapBands';
import type { VacancyPositionSla } from './vacancySplitBands';
import { bandaDeCodigoPuesto, descansoEntre, normalizarCodigo } from './modoRapido';

export type ObjetivoConteoDia = {
  id: string;
  name: string;
  positions: PlanningPositionLike[];
  /** Conteos ya con el crédito Ext/Adel, por puesto. */
  codeCountsByPosition: Record<string, Record<string, number>>;
};

export type BandaAbiertaGrupo = {
  objectiveId: string;
  objectiveName: string;
  positionName: string;
  band: string;
  startTime: string;
  endTime: string;
  horario: string;
  missing: number;
  etiqueta: string;
};

export type AcreditacionCierre = {
  objectiveId: string;
  coversObjectiveId: string;
  coversPositionName: string;
  coversBandCode: string;
  coversDateStr: string;
};

export function claveBandaAbierta(b: Pick<BandaAbiertaGrupo, 'objectiveId' | 'positionName' | 'band'>): string {
  return `${b.objectiveId}|${b.positionName}|${b.band}`;
}

export function etiquetaBandaAbierta(b: {
  objectiveName: string;
  positionName: string;
  band: string;
  horario?: string;
  missing: number;
}): string {
  const banda = [b.band, b.horario].filter(Boolean).join(' ');
  return [b.objectiveName, b.positionName, banda, `falta ${b.missing}`].filter(Boolean).join(' · ');
}

function horarioDeBanda(positions: PlanningPositionLike[], positionName: string, band: string): { startTime: string; endTime: string; horario: string } {
  const opt = listVacancyGapBandOptions(positions as VacancyPositionSla[], positionName)
    .find((o) => String(o.code).toUpperCase() === String(band).toUpperCase());
  const startTime = opt?.startTime || '';
  const endTime = opt?.endTime || '';
  const horario = opt?.scheduleLabel || (startTime && endTime ? `${startTime}–${endTime}` : '');
  return { startTime, endTime, horario };
}

/** Bandas que «Puestos sin cerrar» dejaría abiertas, una fila por objetivo del grupo. */
export function bandasAbiertasDelGrupo(input: {
  objetivos: readonly ObjetivoConteoDia[];
  dateStr: string;
  dayLetter: string;
  cycles?: string[];
}): BandaAbiertaGrupo[] {
  const out: BandaAbiertaGrupo[] = [];
  for (const obj of input.objetivos) {
    const report = analyzeDayCoverageGaps(
      obj.positions,
      input.dateStr,
      input.dayLetter,
      obj.codeCountsByPosition,
      input.cycles,
    );
    for (const row of flattenDayGapsForUi(report)) {
      const band = String(row.gapBand || '').toUpperCase();
      if (!band) continue;
      const horario = horarioDeBanda(obj.positions, row.positionName, band);
      const base = {
        objectiveId: obj.id,
        objectiveName: obj.name,
        positionName: row.positionName,
        band,
        startTime: horario.startTime,
        endTime: horario.endTime,
        horario: horario.horario,
        missing: row.missing,
      };
      out.push({ ...base, etiqueta: etiquetaBandaAbierta(base) });
    }
  }
  return out;
}

/** El cierre queda en el objetivo y la banda elegidos, no en el del guardia. */
export function acreditacionCierreElegido(
  banda: Pick<BandaAbiertaGrupo, 'objectiveId' | 'positionName' | 'band'>,
  dateStr: string,
): AcreditacionCierre {
  return {
    objectiveId: banda.objectiveId,
    coversObjectiveId: banda.objectiveId,
    coversPositionName: banda.positionName,
    coversBandCode: banda.band,
    coversDateStr: dateStr,
  };
}

/**
 * El crédito cierra el objetivo de `coversObjectiveId`.
 * Sin ese campo, sigue el objetivo del turno (vista de un solo objetivo).
 */
export function acreditaCoberturaAlObjetivo(
  shift: { objectiveId?: string | null; coversObjectiveId?: string | null } | null | undefined,
  objectiveId: string,
): boolean {
  if (!shift) return false;
  const cubre = String(shift.coversObjectiveId || '').trim();
  if (cubre) return cubre === String(objectiveId);
  return String(shift.objectiveId || '') === String(objectiveId);
}

export type PasoCierreBanda<T = undefined> =
  | { via: 'asignar'; empId: string }
  | { via: '12h'; empIds: string[]; extra: T }
  | { via: 'ft'; empId: string };

export type PlanCierreBandas<T = undefined> = {
  banda: string;
  pedidos: number;
  pasos: PasoCierreBanda<T>[];
  quedaron: number;
};

/**
 * Texto del botón de «Puestos sin cerrar».
 * Una banda: «CERRAR BANDA T». Varias: «CERRAR 2 BANDAS T».
 */
export function textoBotonCerrarBanda(missing: number, banda: string): string {
  const n = Math.max(1, Math.floor(Number(missing) || 1));
  const b = String(banda || '').trim().toUpperCase();
  if (n === 1) return `CERRAR BANDA ${b}`.trim();
  return `CERRAR ${n} BANDAS ${b}`;
}

/** Aviso cuando no alcanzan los candidatos para todas las bandas pedidas. */
export function textoResultadoCierreBanda(input: { banda: string; cerradas: number; quedaron: number }): string {
  const b = String(input.banda || '').trim().toUpperCase();
  const c = Math.max(0, Math.floor(Number(input.cerradas) || 0));
  const q = Math.max(0, Math.floor(Number(input.quedaron) || 0));
  const cerradas = c === 1 ? `Se cerró 1 banda ${b}` : `Se cerraron ${c} bandas ${b}`;
  const quedan = q === 1 ? `Quedó 1 banda ${b} sin cerrar.` : `Quedaron ${q} bandas ${b} sin cerrar.`;
  if (q <= 0) return `${cerradas}.`;
  if (c <= 0) return quedan;
  return `${cerradas}. ${quedan}`;
}

/**
 * Cierra `faltante` bandas del mismo código.
 * Por cada una, el llamador ya ordenó asignables (RET → volante → libre → otro objetivo).
 * Si no queda nadie de 8 h, entra el par de 12 h; si no, el franco (FT).
 * Quien ya cerró una no se vuelve a usar. Si no hay candidato, se corta y `quedaron` dice cuántas faltan.
 */
export function planCerrarBandas<T>(input: {
  banda: string;
  faltante: number;
  asignables: readonly { empId: string }[];
  francos: readonly { empId: string }[];
  par12: (usados: ReadonlySet<string>) => { empIds: readonly string[]; extra: T } | null;
}): PlanCierreBandas<T> {
  const banda = String(input.banda || '').trim().toUpperCase();
  const pedidos = Math.max(0, Math.floor(Number(input.faltante) || 0));
  const usados = new Set<string>();
  const pasos: PasoCierreBanda<T>[] = [];
  let iAsig = 0;
  let iFt = 0;
  const tomarAsignable = (): PasoCierreBanda<T> | null => {
    while (iAsig < input.asignables.length) {
      const empId = String(input.asignables[iAsig++]?.empId || '').trim();
      if (!empId || usados.has(empId)) continue;
      usados.add(empId);
      return { via: 'asignar', empId };
    }
    return null;
  };
  const tomarFranco = (): PasoCierreBanda<T> | null => {
    while (iFt < input.francos.length) {
      const empId = String(input.francos[iFt++]?.empId || '').trim();
      if (!empId || usados.has(empId)) continue;
      usados.add(empId);
      return { via: 'ft', empId };
    }
    return null;
  };
  while (pasos.length < pedidos) {
    const asig = tomarAsignable();
    if (asig) {
      pasos.push(asig);
      continue;
    }
    const par = input.par12(usados);
    const ids = [...new Set((par?.empIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (par && ids.length >= 2 && ids.every((id) => !usados.has(id))) {
      for (const id of ids) usados.add(id);
      pasos.push({ via: '12h', empIds: ids, extra: par.extra });
      continue;
    }
    const ft = tomarFranco();
    if (ft) {
      pasos.push(ft);
      continue;
    }
    break;
  }
  return { banda, pedidos, pasos, quedaron: Math.max(0, pedidos - pasos.length) };
}

/**
 * Objetivos de las celdas que un cierre reescribe: el hueco y cada donante.
 * Una celda sin objetivo cuenta como el hueco.
 */
export function objetivosCeldasCierre12(input: {
  huecoObjectiveId: string;
  celdas: readonly { objectiveId?: string | null }[];
}): string[] {
  const hueco = String(input.huecoObjectiveId || '').trim();
  const ids: string[] = [];
  const add = (id: string) => {
    const v = String(id || '').trim();
    if (v && !ids.includes(v)) ids.push(v);
  };
  add(hueco);
  for (const c of input.celdas) add(String(c.objectiveId || '').trim() || hueco);
  return ids;
}

/**
 * Si el hueco o algún donante está publicado, o no se pudo leer, ese cierre no se aplica.
 * El primero bloqueado es el que hay que avisar.
 */
export function decisionCierre12Publicado(input: {
  huecoObjectiveId: string;
  celdas: readonly { objectiveId?: string | null }[];
  publicados: ReadonlySet<string>;
  sinLeer: ReadonlySet<string>;
}): { aplicar: true } | { aplicar: false; objectiveId: string; motivo: 'publicado' | 'sin_verificar' } {
  const objetivos = objetivosCeldasCierre12(input);
  if (!objetivos.length) return { aplicar: false, objectiveId: '', motivo: 'sin_verificar' };
  for (const oid of objetivos) {
    if (input.sinLeer.has(oid)) return { aplicar: false, objectiveId: oid, motivo: 'sin_verificar' };
    if (input.publicados.has(oid)) return { aplicar: false, objectiveId: oid, motivo: 'publicado' };
  }
  return { aplicar: true };
}

/**
 * Objetivo del turno que escribe el cierre.
 * El hueco manda: si el guardia prefiere otro objetivo, el turno igual queda en el hueco.
 */
export function objectiveIdEscrituraCierre(gapObjectiveId: string, preferidoDelGuardia?: string): string {
  const gap = String(gapObjectiveId || '').trim();
  if (gap) return gap;
  return String(preferidoDelGuardia || '').trim();
}

/** Cuántas bandas de esa fila quedaron cerradas después de escribir, no cuántos turnos se intentaron. */
export function cierreContado(faltanteAntes: number, faltanteDespues: number): { cerradas: number; quedaron: number } {
  const antes = Math.max(0, Math.floor(Number(faltanteAntes) || 0));
  const despues = Math.max(0, Math.floor(Number(faltanteDespues) || 0));
  return { cerradas: Math.max(0, antes - despues), quedaron: despues };
}

export function faltanteDeBandaAbierta(
  bandas: readonly Pick<BandaAbiertaGrupo, 'objectiveId' | 'positionName' | 'band' | 'missing'>[],
  objetivo: { objectiveId: string; positionName: string; band: string },
): number {
  const band = String(objetivo.band || '').trim().toUpperCase();
  return bandas
    .filter((b) => b.objectiveId === objetivo.objectiveId && b.positionName === objetivo.positionName && b.band === band)
    .reduce((s, b) => s + (Number(b.missing) || 0), 0);
}

const NO_CUENTA_CIERRE = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET', 'REF', 'ESC', 'SUS', 'SGS', 'EV']);

export type TurnoConteoCierre = {
  objectiveId?: string | null;
  positionName?: string | null;
  code?: string | null;
  isDeleted?: boolean;
  isFranco?: boolean;
  isFrancoTrabajado?: boolean;
  isNovedad?: boolean;
  isAbsent?: boolean;
};

/** Códigos del día que viven en ese objetivo. Un turno en el objetivo preferido del guardia no entra. */
export function conteosCierreObjetivo(
  objectiveId: string,
  turnos: readonly TurnoConteoCierre[],
): Record<string, Record<string, number>> {
  const obj = String(objectiveId || '').trim();
  const out: Record<string, Record<string, number>> = {};
  for (const t of turnos) {
    if (!t || t.isDeleted || t.isNovedad || t.isAbsent) continue;
    if (t.isFranco && !t.isFrancoTrabajado) continue;
    if (String(t.objectiveId || '').trim() !== obj) continue;
    const code = String(t.code || '').trim().toUpperCase();
    if (!code || NO_CUENTA_CIERRE.has(code)) continue;
    const pos = String(t.positionName || '').trim() || 'General';
    if (!out[pos]) out[pos] = {};
    out[pos][code] = (out[pos][code] || 0) + 1;
  }
  return out;
}

/**
 * Cupo de cada objetivo del grupo (`objectiveId|PUESTO`).
 * La clave sin objetivo hacía que el número del seleccionado cerrara un hueco en otro.
 */
export function cuposCierrePorObjetivo(
  estructuras: Readonly<Record<string, readonly { positionName?: string; qty?: number }[] | undefined>>,
): Record<string, number> {
  const cupos: Record<string, number> = {};
  for (const [objId, puestos] of Object.entries(estructuras)) {
    const id = String(objId || '').trim();
    if (!id) continue;
    for (const p of puestos || []) {
      const nombre = String(p.positionName || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (!nombre) continue;
      cupos[`${id}|${nombre}`] = Math.max(1, Number(p.qty) || 1);
    }
  }
  return cupos;
}

/** Franja de 8 h del puesto (M, o P5T). No devuelve D12/N12. */
export function franjaBandaDeSla<T extends { code?: string }>(shifts: readonly T[], banda: string): T | undefined {
  const b = normalizarCodigo(banda);
  return shifts.find((s) => {
    const c = normalizarCodigo(s.code || '');
    return !/D12$|N12$/.test(c) && (c === b || bandaDeCodigoPuesto(c) === b);
  });
}

export function jornadaEs12(t: { code?: string; hours?: number } | null | undefined): boolean {
  if (!t) return false;
  const c = normalizarCodigo(t.code || '');
  if (c === 'D12' || c === 'N12' || /(?:^|[^A-Z0-9])(?:D12|N12)$/.test(c) || /D12$|N12$/.test(c)) return true;
  return Number(t.hours) >= 12;
}

function sumarDiasCierre(ds: string, n: number): string {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Ventana de la racha: 6 turnos de 8 h o 4 de 12 h, más el día anterior (descanso). */
export const VENTANA_JORNADA_CIERRE = 6;

/**
 * Días del mes anterior que entran en la ventana al cerrar `dateStr`.
 * El 01/11 con ventana 6 devuelve 26/10..31/10; el 04/11, solo 29/10..31/10.
 */
export function fechasBordeMesAnterior(dateStr: string, ventana = VENTANA_JORNADA_CIERRE): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return [];
  const primero = `${dateStr.slice(0, 7)}-01`;
  const out: string[] = [];
  for (let i = 1; i <= ventana; i++) {
    const d = sumarDiasCierre(dateStr, -i);
    if (d < primero) out.push(d);
  }
  return out;
}

/** Turnos de los últimos `ventana` días del mes anterior al mes en pantalla (1..12). */
export function recortarBordeMesAnterior(
  shifts: Record<string, unknown> | undefined,
  anio: number,
  mes: number,
  ventana = VENTANA_JORNADA_CIERRE,
): Record<string, unknown> {
  const primero = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const desde = sumarDiasCierre(primero, -ventana);
  const out: Record<string, unknown> = {};
  if (!shifts) return out;
  for (const [k, v] of Object.entries(shifts)) {
    const ds = k.slice(-10);
    if (ds >= desde && ds < primero) out[k] = v;
  }
  return out;
}

export type LecturaJornadaCierre = {
  code?: string;
  hours?: number;
  startTime?: string;
  endTime?: string;
};

export type VecinoJornadaCierre = {
  code: string;
  startTime: string;
  endTime: string;
};

function claseJornadaLeida(t: LecturaJornadaCierre | null | undefined): '12' | '8' | null {
  if (!t) return null;
  if (jornadaEs12(t)) return '12';
  const c = normalizarCodigo(t.code || '');
  if (c === 'M' || c === 'T' || c === 'N') return '8';
  const h = Number(t.hours);
  if (h > 0 && h < 12) return '8';
  return null;
}

/**
 * Racha y vecino de descanso. `leer` resuelve el turno de ese día
 * (mes en pantalla, borrador, o borde del mes anterior).
 */
export function ventanaJornadaCierre(input: {
  dateStr: string;
  leer: (ds: string) => LecturaJornadaCierre | null;
  ventana?: number;
}): {
  dias12: string[];
  dias8: string[];
  anterior: VecinoJornadaCierre | null;
  siguiente: VecinoJornadaCierre | null;
} {
  const ventana = input.ventana ?? VENTANA_JORNADA_CIERRE;
  const dias12: string[] = [];
  const dias8: string[] = [];
  const vecino = (d: string): VecinoJornadaCierre | null => {
    const t = input.leer(d);
    if (!t?.startTime || !t.endTime || !claseJornadaLeida(t)) return null;
    return { code: normalizarCodigo(t.code || ''), startTime: t.startTime, endTime: t.endTime };
  };
  for (let i = 1; i <= ventana; i++) {
    for (const signo of [-1, 1] as const) {
      const d = sumarDiasCierre(input.dateStr, signo * i);
      const k = claseJornadaLeida(input.leer(d));
      if (k === '12') dias12.push(d);
      else if (k === '8') dias8.push(d);
    }
  }
  return {
    dias12,
    dias8,
    anterior: vecino(sumarDiasCierre(input.dateStr, -1)),
    siguiente: vecino(sumarDiasCierre(input.dateStr, 1)),
  };
}

function rachaDiasSeguidos(dateStr: string, cuenta: boolean, dias: readonly string[]): number {
  if (!cuenta || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 0;
  const set = new Set(dias);
  set.add(dateStr);
  let n = 1;
  for (let i = 1; i < 8; i++) {
    if (!set.has(sumarDiasCierre(dateStr, -i))) break;
    n++;
  }
  for (let i = 1; i < 8; i++) {
    if (!set.has(sumarDiasCierre(dateStr, i))) break;
    n++;
  }
  return n;
}

/** Días de 12 h seguidos, contando el turno ya pasado a 12 h. */
export function rachaDoceSeguidos(dateStr: string, propuestoEs12: boolean, dias12: readonly string[]): number {
  return rachaDiasSeguidos(dateStr, propuestoEs12, dias12);
}

/**
 * Tope del ciclo CCT 26→25, máx. 4×12 h / 6×8 h y descanso contra el horario nuevo
 * (el D12 ya alargado, no la M de 8 h que estaba). Null si se puede escribir.
 * `diaEnCiclo === false`: el día cae en el ciclo siguiente (26–fin); esas horas no se miden acá.
 */
export function motivoBloqueoJornadaCierre(input: {
  horasMes: number;
  horasAntes: number;
  horasDespues: number;
  tope?: number;
  topeAutorizado?: boolean;
  /** false si el día no cae en el ciclo cuyas horas vienen en horasMes. */
  diaEnCiclo?: boolean;
  dateStr: string;
  propuesto: { code: string; startTime?: string; endTime?: string; hours?: number };
  anterior?: VecinoJornadaCierre | null;
  siguiente?: VecinoJornadaCierre | null;
  /** Otros días que ya son jornada de 12 h. El día propuesto se suma si el turno nuevo lo es. */
  dias12?: readonly string[];
  /** Otros días de 8 h (M/T/N). El día propuesto se suma si el turno nuevo lo es. */
  dias8?: readonly string[];
  descansoMin?: number;
}): string | null {
  const tope = Number(input.tope) > 0 ? Number(input.tope) : 200;
  const total = (Number(input.horasMes) || 0) + (Number(input.horasDespues) || 0) - (Number(input.horasAntes) || 0);
  if (!input.topeAutorizado && input.diaEnCiclo !== false && total > tope + 1e-6) {
    return `${Math.round(total)} h en el mes (tope ${tope} h)`;
  }
  const es12 = jornadaEs12(input.propuesto);
  const racha = rachaDoceSeguidos(input.dateStr, es12, input.dias12 || []);
  if (racha > 4) return `${racha} turnos de 12 h seguidos (máximo 4)`;
  const codeProp = normalizarCodigo(input.propuesto.code);
  const horasProp = Number(input.propuesto.hours);
  const es8 = !es12 && (codeProp === 'M' || codeProp === 'T' || codeProp === 'N' || (horasProp > 0 && horasProp < 12));
  const racha8 = rachaDiasSeguidos(input.dateStr, es8, input.dias8 || []);
  if (racha8 > 6) return `${racha8} turnos de 8 h seguidos (máximo 6)`;
  const min = input.descansoMin ?? 12;
  const prop = input.propuesto;
  if (prop.startTime && prop.endTime) {
    const propuesto = { code: prop.code, startTime: prop.startTime, endTime: prop.endTime, trabajo: true as const };
    if (input.anterior?.startTime && input.anterior.endTime) {
      const h = descansoEntre(
        { code: input.anterior.code, startTime: input.anterior.startTime, endTime: input.anterior.endTime, trabajo: true },
        propuesto,
      );
      if (h != null && h < min) return `descanso ${String(h).replace('.', ',')} h con el turno anterior`;
    }
    if (input.siguiente?.startTime && input.siguiente.endTime) {
      const h = descansoEntre(
        propuesto,
        { code: input.siguiente.code, startTime: input.siguiente.startTime, endTime: input.siguiente.endTime, trabajo: true },
      );
      if (h != null && h < min) return `descanso ${String(h).replace('.', ',')} h con el turno siguiente`;
    }
  }
  return null;
}

/** Un guardia de otro objetivo del grupo puede extender; uno de afuera, no. */
export function objetivoPermitidoParaExtender(
  shiftObjectiveId: string | null | undefined,
  objetivoDelHueco: string,
  objetivosDelGrupo?: readonly string[] | null,
): boolean {
  const id = String(shiftObjectiveId || '').trim();
  if (!id) return true;
  if (id === String(objetivoDelHueco)) return true;
  return !!objetivosDelGrupo?.some((o) => String(o) === id);
}
