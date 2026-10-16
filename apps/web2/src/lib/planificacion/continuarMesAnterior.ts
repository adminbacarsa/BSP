/**
 * «Continuar desde el mes anterior»: lee el ciclo de cada guardia en las últimas
 * semanas (solo sus turnos de puesto y francos en este objetivo) y lo sigue en el
 * mes nuevo desde donde quedó. No copia día por número.
 *
 * Lógica pura: la página arma los datos (turnos previos, celdas ocupadas, días
 * bloqueados, estructura del SLA del mes nuevo) y aplica el resultado como borrador.
 */
import { LICENCIA_CODES, ventanaTrabajo } from './bandaLicencia';
import { getEffectiveShiftQuantityOnDate } from '../slaPlanningMatch';
import {
  bandaDe,
  continuarC2,
  nivelarContraCupo,
  punteroAlCierre,
  rasgosDeHistoria,
  type CupoDia,
  type NivelacionC2,
  type PlanC2,
  type ViaC2,
} from './continuarC2';
import { findLctRestGaps, type LctShiftInput } from './lctRestGap';
import { correFeriado } from '@/lib/servicios/turnoFeriados';

export type { CupoDia } from './continuarC2';

export const ORIGEN_CONTINUAR_MES = 'CONTINUAR_MES_ANTERIOR' as const;
export const TOPE_HORAS_MES = 200;

/** Lo que no es parte del ciclo del guardia (puntual o cobertura). El RET planificado se evalúa aparte. */
const NO_CICLO = new Set([
  'REF', 'ESC', 'FT', 'RFZ', 'RFZE', 'TURA', 'EV', 'AVISO', 'AUS', 'VAC', 'SUP', 'COB', 'EXT', 'ADV', 'ADEL',
]);
const FRANCOS = new Set(['F', 'FF', 'FP']);
const ORIGENES_PUNTUALES = new Set(['OPERATIONS_COVERAGE', 'SLA_VIRTUAL', 'RETEN', 'EVENTO']);
/** D12 dentro de un bloque de M (o N12 en uno de N) es una extensión del día, no otro ciclo. */
const FAMILIA: Record<string, string> = { D12: 'M', N12: 'N' };
const MAX_PERIODO = 28;
const CONSISTENCIA_MIN = 0.8;

export type TurnoPrevio = {
  dateStr: string;
  code?: unknown;
  originalCode?: unknown;
  positionName?: unknown;
  originalPositionName?: unknown;
  objectiveId?: unknown;
  origin?: unknown;
  isDeleted?: unknown;
  isSecondBlock?: unknown;
  isExtended?: unknown;
  isEarlyStart?: unknown;
  isFrancoTrabajado?: unknown;
  isVirtual?: unknown;
  isReten?: unknown;
  coverageHoursOnSource?: unknown;
  coverageForShiftId?: unknown;
  /** El turno de origen quedó anulado porque se usó para cubrir. No es el ciclo. */
  coverageUsed?: unknown;
  /** Turno cargado para cubrir a otro (par 12 h de una licencia, RET asignado): no es su ciclo. */
  coversEmployeeId?: unknown;
  coverageMode?: unknown;
  eventoId?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  hours?: unknown;
};

export type DiaCiclo = {
  code: string;
  positionName: string;
  /** Horario del RET que se repite, cuando el SLA del mes nuevo no trae ese turno. */
  startTime?: string;
  endTime?: string;
  hours?: number;
};

export type CicloDetectado = {
  periodo: number;
  /** Fase `i` = día cuyo índice absoluto cumple idx mod periodo = i. null = sin dato. */
  fases: Array<DiaCiclo | null>;
  consistencia: number;
  muestras: number;
  ultimoDia: string;
  /** «N,N,T,T,M,M,F,F» o «M×6 · F×2 · N×6 · F×2 · T×6 · F×2». */
  etiqueta: string;
};

export type PuestoSla = {
  positionName: string;
  qty?: number;
  shifts?: Array<{
    code?: string;
    name?: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
    quantity?: number;
    days?: string[];
    specificDates?: string[];
  }>;
  excludedDates?: string[];
  excludedShiftDates?: Record<string, string[]>;
};

export type CeldaPropuesta = {
  employeeId: string;
  dateStr: string;
  code: string;
  name: string;
  positionName: string;
  startTime: string;
  endTime: string;
  hours: number;
  isFranco: boolean;
  /** El puesto del mes anterior ya no existe y se tomó el único que tiene ese turno. */
  puestoReasignadoDe?: string;
};

export type RevisarPuesto = {
  positionName: string;
  code: string;
  dias: string[];
  motivo: string;
  /** Se propuso igual en otro puesto (único con ese turno). */
  propuestoEn?: string;
};

/**
 * `plantilla` = ciclo del objetivo (c2) en la fase del guardia. `fijo` = el período de todo su historial.
 * `corte` y `bloques` son estimados: el modal los deja destildados.
 */
export type OrigenCiclo = 'plantilla' | 'fijo' | 'corte' | 'bloques';

export type PlantillaGuardia = {
  periodo: number | null;
  grupo: string | null;
  via: ViaC2;
  copiaDe: string | null;
};

/** Cambio de banda para nivelar el cupo del día, o reacomodo del relevante. Se aplica solo si queda tildado. */
export type SugerenciaNivelacion = {
  dateStr: string;
  de: string;
  a: string;
  texto: string;
  celda: CeldaPropuesta;
  /** `relevante` = seguir los francos de los puestos que cubre. Arranca destildada, igual que la nivelación. */
  tipo?: 'nivelacion' | 'relevante' | 'suelto' | 'rotacion';
  /** `rotacion`: puesto al que pertenece el cambio y la frase del grupo (se tilda todo junto). */
  grupo?: string;
  grupoTexto?: string;
  /** `suelto` sobre su franco: se escribe como franco trabajado. */
  francoTrabajado?: boolean;
  /** `suelto` que trabaja su franco: el franco pasa a este día (sigue 6+2, sin FT). */
  francoA?: string;
};

export type ResultadoGuardia = {
  employeeId: string;
  nombre: string;
  ciclo: CicloDetectado | null;
  origenCiclo: OrigenCiclo | null;
  /** true: la casilla del modal arranca destildada. */
  estimado: boolean;
  /** «desde la vuelta del dd/mm» o «ciclo estimado (por bloques)». */
  notaEstimado: string | null;
  /** «continúa en T (2.º de 6)». */
  continuaEn: string;
  motivoSinCiclo: string | null;
  propuestas: CeldaPropuesta[];
  omitidas: { licencia: number; ocupada: number; bloqueada: number; sinDato: number; excluida: number };
  revisar: RevisarPuesto[];
  horasPropuestas: number;
  plantilla: PlantillaGuardia | null;
  sugerencias: SugerenciaNivelacion[];
};

export type EstadoCelda = 'licencia' | 'ocupada' | null;

export type ContinuarInput = {
  objectiveId: string;
  /** Días del mes nuevo (YYYY-MM-DD), en orden. */
  dias: string[];
  guardias: Array<{ id: string; nombre: string; previos: TurnoPrevio[]; puestoPreferido?: string }>;
  estructura: PuestoSla[];
  /** Licencia cargada o celda con algo (turno, borrador). No se pisa. */
  estadoCelda: (employeeId: string, dateStr: string) => EstadoCelda;
  /** Día cerrado, fuera de la vigencia del servicio, etc. */
  diaBloqueado?: (dateStr: string) => boolean;
  /** El SLA habilita ese turno ese día (días de la semana, exclusiones). Default: por la estructura. */
  turnoHabilitado?: (positionName: string, code: string, dateStr: string) => boolean;
  /** Cupo M/T/N del servicio ese día. Sin función (o servicio sin `exigeCobertura`) no se sugiere nivelación. */
  cupoDia?: ((dateStr: string) => CupoDia | null) | null;
  /** Quienes cerraron el mes anterior con un cambio en su último bloque. null = se deriva. */
  punteroPrevio?: string[] | null;
  /** Código de trabajo ya cargado en el mes nuevo: cuenta para el cupo y no se mueve. */
  cargado?: ((employeeId: string, dateStr: string) => string | null) | null;
  /** Trabajaron el mes anterior y ya no están en la dotación: un alta puede heredar su fila. */
  salientes?: Array<{ id: string; nombre: string; previos: TurnoPrevio[] }>;
  /** `anterior` = solo el ciclo de cada guardia (para comparar). Default `c2`. */
  regla?: 'c2' | 'anterior';
};

function up(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function diaIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function ymdDeIndex(idx: number): string {
  const d = new Date(idx * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function familia(code: string): string {
  return FAMILIA[code] || code;
}

function esCodigoPuesto(code: string): boolean {
  if (!code || NO_CICLO.has(code) || LICENCIA_CODES.has(code)) return false;
  if (FRANCOS.has(code)) return false;
  return /^[A-Z][A-Z0-9]{0,4}$/.test(code);
}

/**
 * Código de ciclo de un turno del mes anterior, o null si no sirve para leer el ciclo.
 * Licencia: la banda que conservó (`originalCode`). Francos F/FF/FP → F.
 * RET planificado entra (el suelto se descarta al puntuar la fase). No entra el que vino de
 * una cobertura ni el anulado con `coverageUsed`.
 */
export function codigoDeCiclo(t: TurnoPrevio, objectiveId?: string): string | null {
  if (!t || t.isDeleted === true || t.isSecondBlock === true) return null;
  if (objectiveId && t.objectiveId && String(t.objectiveId) !== String(objectiveId)) return null;
  if (ORIGENES_PUNTUALES.has(up(t.origin))) return null;
  if (t.isVirtual === true || t.coverageHoursOnSource === true || t.eventoId || t.coverageForShiftId) return null;
  if (t.coverageUsed === true) return null;
  if (t.isFrancoTrabajado === true) return null;
  const code = up(t.code);
  // Extensión o adelanto: el turno sigue siendo su banda de siempre; el tramo extra no se copia.
  if (t.isExtended === true || t.isEarlyStart === true) return esCodigoPuesto(code) ? code : null;
  if (up(t.coverageMode) === '12H' || t.coversEmployeeId) return null;
  if (LICENCIA_CODES.has(code) || code === 'AVISO') {
    const orig = up(t.originalCode);
    if (FRANCOS.has(orig)) return 'F';
    return esCodigoPuesto(orig) ? orig : null;
  }
  if (FRANCOS.has(code)) return 'F';
  if (code === 'RET') return 'RET';
  if (t.isReten === true) return null;
  return esCodigoPuesto(code) ? code : null;
}

type Obs = { idx: number; code: string; fam: string; pos: string; start?: unknown; end?: unknown };

/** Un dato por día: el turno de puesto manda sobre el franco y sobre la banda conservada de una licencia. */
export function observacionesDelGuardia(previos: TurnoPrevio[], objectiveId?: string): Obs[] {
  const porDia = new Map<string, { code: string; pos: string; prio: number; start?: unknown; end?: unknown }>();
  for (const t of previos || []) {
    const code = codigoDeCiclo(t, objectiveId);
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.dateStr || ''))) continue;
    const licencia = LICENCIA_CODES.has(up(t.code));
    const prio = licencia ? 1 : code === 'F' ? 2 : 3;
    const pos = String((licencia ? t.originalPositionName : null) || t.positionName || '').trim();
    const prev = porDia.get(t.dateStr);
    if (!prev || prio > prev.prio) porDia.set(t.dateStr, { code, pos, prio, start: t.startTime, end: t.endTime });
  }
  return [...porDia.entries()]
    .map(([dia, v]) => ({ idx: diaIndex(dia), code: v.code, fam: familia(v.code), pos: v.pos, start: v.start, end: v.end }))
    .sort((a, b) => a.idx - b.idx);
}

/** El RET de guardia no tiene ventana (00:00–00:00). Si la tenía, se conserva. */
function horarioRet(o: Obs): { startTime: string; endTime: string; hours: number } {
  const w = ventanaTrabajo(o.start, o.end);
  return w ? { startTime: w.start, endTime: w.end, hours: w.hours } : { startTime: '00:00', endTime: '00:00', hours: 0 };
}

function mod(a: number, p: number): number {
  return ((a % p) + p) % p;
}

function etiquetaCiclo(fases: Array<DiaCiclo | null>): string {
  const p = fases.length;
  const codes = fases.map((f) => f?.code || '?');
  // Arranca en el primer día de trabajo después de un franco.
  let start = 0;
  for (let i = 0; i < p; i += 1) {
    if (codes[mod(i - 1, p)] === 'F' && codes[i] !== 'F') { start = i; break; }
  }
  const seq = Array.from({ length: p }, (_, i) => codes[mod(start + i, p)]);
  if (p <= 10) return seq.join(',');
  const runs: Array<[string, number]> = [];
  for (const c of seq) {
    const last = runs[runs.length - 1];
    if (last && last[0] === c) last[1] += 1;
    else runs.push([c, 1]);
  }
  return runs.map(([c, n]) => (n > 1 ? `${c}×${n}` : c)).join(' · ');
}

/**
 * En un bloque de trabajo (entre francos) de 4 días o más, si una banda tiene 2/3 o más,
 * los días sueltos de otra banda son cambios a mano (un cambio de turno puntual): se toma la del bloque.
 * Solo se corrige una fase cuando lo que se vio ahí lo admite (una sola muestra o alguna de esa banda).
 * Un día distinto en el borde (el primero o el último) se absorbe si el bloque queda del mismo largo
 * que los otros bloques de trabajo y del otro lado hay un franco o un bloque que ya tiene ese largo.
 */
function uniformarBloques(resultado: Array<DiaCiclo | null>, fases: Map<number, Obs[]>): void {
  const p = resultado.length;
  const esF = (i: number) => resultado[mod(i, p)]?.code === 'F';
  const inicio = Array.from({ length: p }, (_, i) => i).find((i) => esF(i - 1) && !esF(i));
  if (inicio == null) return;
  let i = inicio;
  let recorridos = 0;
  while (recorridos < p) {
    if (esF(i)) { i += 1; recorridos += 1; continue; }
    const bloque: number[] = [];
    while (!esF(i) && bloque.length < p) { bloque.push(mod(i, p)); i += 1; recorridos += 1; }
    const conocidos = bloque.filter((ph) => resultado[ph]);
    if (conocidos.length < 3 || bloque.length < 4) continue;
    const cuenta = new Map<string, number>();
    for (const ph of conocidos) {
      const f = familia(resultado[ph]!.code);
      cuenta.set(f, (cuenta.get(f) || 0) + 1);
    }
    const [famBloque, n] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n * 3 < conocidos.length * 2) continue;
    // Código del bloque: el propio de la banda (M antes que D12) si aparece.
    const delBloque = conocidos.map((ph) => resultado[ph]!).filter((d) => familia(d.code) === famBloque);
    const modelo = delBloque.find((d) => d.code === famBloque) || delBloque[0];
    for (const ph of conocidos) {
      const d = resultado[ph]!;
      if (d.code === modelo.code) continue;
      // Un RET que ya ganó la fase es el ciclo (jueves fijo), no un cambio a mano del bloque de al lado.
      if (d.code === 'RET') continue;
      const vistos = fases.get(ph) || [];
      // Un D12 dentro de un bloque de M es una extensión puntual: se sigue con M.
      const extension = familia(d.code) === famBloque && d.code !== famBloque && modelo.code === famBloque;
      const admite = extension || vistos.length <= 1 || vistos.some((o) => o.fam === famBloque);
      if (familia(d.code) !== famBloque || extension) {
        if (admite) resultado[ph] = { code: modelo.code, positionName: d.positionName || modelo.positionName };
      }
    }
    // Días sin dato dentro del bloque (licencia sin banda conservada, RET): la banda del bloque.
    for (const ph of bloque) if (!resultado[ph]) resultado[ph] = { ...modelo };
  }
  absorberBordes(resultado);
}

/** Rachas circulares del mismo código. Un hueco (sin dato) corta la racha. */
function rachas(resultado: Array<DiaCiclo | null>): Array<{ code: string; idxs: number[] }> {
  const p = resultado.length;
  const codeAt = (i: number) => resultado[mod(i, p)]?.code || '';
  if (!p || (codeAt(0) && Array.from({ length: p }, (_, i) => codeAt(i) === codeAt(0)).every(Boolean))) {
    return codeAt(0) ? [{ code: codeAt(0), idxs: Array.from({ length: p }, (_, i) => i) }] : [];
  }
  let start = 0;
  for (let i = 0; i < p; i += 1) {
    if (codeAt(i) !== codeAt(i - 1)) { start = i; break; }
  }
  const runs: Array<{ code: string; idxs: number[] }> = [];
  let k = start;
  let seen = 0;
  while (seen < p) {
    const c = codeAt(k);
    const idxs: number[] = [];
    while (idxs.length < p - seen && codeAt(k) === c) {
      idxs.push(mod(k, p));
      k += 1;
    }
    runs.push({ code: c, idxs });
    seen += idxs.length;
  }
  return runs;
}

/**
 * Día distinto pegado al borde de un bloque de trabajo. Si al sumarlo el bloque queda del largo
 * de los otros (el que más se repite, y en empate el más largo) y del otro lado hay franco o un
 * bloque que ya tiene ese largo, el día es de ese bloque. No toca un D12/N12 de la misma banda:
 * eso ya lo resolvió el paso anterior.
 */
function absorberBordes(resultado: Array<DiaCiclo | null>): void {
  const p = resultado.length;
  if (p < 8) return;
  for (let pass = 0; pass < 4; pass += 1) {
    const runs = rachas(resultado);
    const largos = runs.filter((r) => r.code && r.code !== 'F' && r.idxs.length >= 4).map((r) => r.idxs.length);
    if (!largos.length) return;
    const freq = new Map<number, number>();
    for (const len of largos) freq.set(len, (freq.get(len) || 0) + 1);
    let canon = 0;
    let bestN = -1;
    for (const [len, n] of freq) {
      if (n > bestN || (n === bestN && len > canon)) { bestN = n; canon = len; }
    }
    let changed = false;
    for (let ri = 0; ri < runs.length; ri += 1) {
      const stray = runs[ri];
      if (stray.idxs.length !== 1 || !stray.code || stray.code === 'F') continue;
      const prev = runs[mod(ri - 1, runs.length)];
      const next = runs[mod(ri + 1, runs.length)];
      const candidatos = [prev, next].filter((r) =>
        r.code && r.code !== 'F' && familia(r.code) !== familia(stray.code) && r.idxs.length + 1 === canon);
      for (const dest of candidatos) {
        const otro = dest === prev ? next : prev;
        const otroOk = otro.code === 'F' || (!!otro.code && otro.code !== 'F' && otro.idxs.length === canon);
        if (!otroOk) continue;
        const ph = stray.idxs[0];
        const modelo = resultado[dest.idxs[0]];
        const d = resultado[ph];
        if (!modelo) continue;
        resultado[ph] = { code: modelo.code, positionName: d?.positionName || modelo.positionName };
        changed = true;
        break;
      }
      if (changed) break;
    }
    if (!changed) return;
  }
}

/**
 * Período más corto que explica lo que trabajó (tolerancia 20% por cambios a mano).
 * Usa el índice absoluto de día: un fijo de lunes a viernes queda alineado a la semana.
 */
export function detectarCiclo(obs: Obs[]): CicloDetectado | null {
  if (obs.length < 6) return null;
  const last = obs[obs.length - 1].idx;
  const candidatos: CicloDetectado[] = [];
  for (let p = 1; p <= MAX_PERIODO; p += 1) {
    const c = evaluarPeriodo(obs, last, p);
    if (c) candidatos.push(c);
  }
  if (!candidatos.length) return null;
  // Una racha larga corrida un día (23 en vez de 24) también «encaja» bastante: gana el que mejor explica,
  // y entre los que explican casi igual, el más corto (8 antes que 16 o 24).
  const mejor = Math.max(...candidatos.map((c) => c.consistencia));
  return candidatos.find((c) => c.consistencia >= mejor - 0.05) || null;
}

function evaluarPeriodo(obs: Obs[], last: number, p: number): CicloDetectado | null {
  const span = Math.max(3 * p, 21);
  const sel = obs.filter((o) => o.idx > last - span);
  const fases = new Map<number, Obs[]>();
  for (const o of sel) {
    const ph = mod(o.idx, p);
    const list = fases.get(ph) || [];
    list.push(o);
    fases.set(ph, list);
  }
  if (fases.size < Math.ceil(0.75 * p)) return null;
  const checks = sel.length - fases.size;
  if (checks < Math.max(3, Math.ceil(p / 4))) return null;
  // La última vuelta del ciclo pesa doble para elegir qué toca en cada fase.
  const peso = (o: Obs) => (o.idx > last - p ? 2 : 1);
  const retPorSemana = new Map<number, number>();
  for (const o of sel) {
    if (o.code !== 'RET') continue;
    const wd = mod(o.idx, 7);
    retPorSemana.set(wd, (retPorSemana.get(wd) || 0) + 1);
  }
  let acuerdo = 0;
  let total = 0;
  const resultado: Array<DiaCiclo | null> = Array.from({ length: p }, () => null);
  for (const [ph, list] of fases) {
    const nRet = list.filter((o) => o.code === 'RET').length;
    let votan = list;
    if (nRet > 0 && nRet < 2) {
      const nSemana = p % 7 === 0 ? (retPorSemana.get(mod(list[0].idx, 7)) || 0) : 0;
      const nOtros = list.length - nRet;
      // Un jueves con un solo RET sigue siendo RET si los otros jueves lo son y nadie de esa fase lo supera.
      if (nSemana >= 2 && nOtros <= nRet) votan = list.filter((o) => o.code === 'RET');
      else votan = list.filter((o) => o.code !== 'RET');
    }
    if (!votan.length) continue;
    const porFam = new Map<string, number>();
    const cuentaFam = new Map<string, number>();
    const reciente = new Map<string, number>();
    for (const o of votan) {
      cuentaFam.set(o.fam, (cuentaFam.get(o.fam) || 0) + 1);
      porFam.set(o.fam, (porFam.get(o.fam) || 0) + peso(o));
      reciente.set(o.fam, Math.max(reciente.get(o.fam) ?? -Infinity, o.idx));
    }
    let famGanadora = '';
    let wGanadora = -1;
    for (const [fam, w] of porFam) {
      if (w > wGanadora || (w === wGanadora && (reciente.get(fam) || 0) > (reciente.get(famGanadora) || 0))) {
        famGanadora = fam;
        wGanadora = w;
      }
    }
    // La consistencia se mide sin pesos: el peso solo decide quién gana la fase.
    // El RET suelto que se sacó de la votación no baja el acuerdo.
    if (votan.length >= 2) {
      acuerdo += cuentaFam.get(famGanadora) || 0;
      total += votan.length;
    }
    const deFam = votan.filter((o) => o.fam === famGanadora);
    const ultimoDeFam = deFam[deFam.length - 1];
    const porCode = new Map<string, number>();
    for (const o of deFam) porCode.set(o.code, (porCode.get(o.code) || 0) + peso(o));
    let code = ultimoDeFam.code;
    let wc = -1;
    for (const [c, w] of porCode) {
      // Dentro de la familia (D12 ≈ M), el código propio de la banda antes que la extensión.
      const base = c === famGanadora ? 0.5 : 0;
      if (w + base > wc) { code = c; wc = w + base; }
    }
    const conPos = [...deFam].reverse().find((o) => o.code === code && o.pos);
    const base = { code, positionName: code === 'F' ? 'General' : (conPos?.pos || ultimoDeFam.pos || '') };
    resultado[ph] = code === 'RET' ? { ...base, ...horarioRet(conPos || ultimoDeFam) } : base;
  }
  if (total === 0) return null;
  const consistencia = acuerdo / total;
  if (consistencia < CONSISTENCIA_MIN) return null;
  uniformarBloques(resultado, fases);
  const conocidos = resultado.filter((f): f is DiaCiclo => !!f);
  if (!conocidos.some((f) => f.code === 'F')) return null;
  if (!conocidos.some((f) => f.code !== 'F')) return null;
  return {
    periodo: p,
    fases: resultado,
    consistencia: Math.round(consistencia * 100) / 100,
    muestras: sel.length,
    ultimoDia: ymdDeIndex(last),
    etiqueta: etiquetaCiclo(resultado),
  };
}

export function diaDelCiclo(ciclo: CicloDetectado, dateStr: string): DiaCiclo | null {
  if (!ciclo.periodo || !ciclo.fases.length) return null;
  return ciclo.fases[mod(diaIndex(dateStr), ciclo.periodo)] || null;
}

/** Hueco de 4+ días entre dos datos de ciclo (licencia, vacaciones, pase de objetivo). */
const HUECO_CORTE = 4;
const VENTANAS_RECIENTES = [42, 28] as const;

function obsDesdeUltimoCorte(obs: Obs[]): { sub: Obs[]; vuelta: string } | null {
  let cut = 0;
  for (let i = 1; i < obs.length; i += 1) {
    if (obs[i].idx - obs[i - 1].idx >= HUECO_CORTE) cut = i;
  }
  if (cut === 0) return null;
  const sub = obs.slice(cut);
  if (sub.length >= obs.length) return null;
  return { sub, vuelta: ymdDeIndex(obs[cut].idx) };
}

function obsVentana(obs: Obs[], dias: number): Obs[] {
  const last = obs[obs.length - 1].idx;
  return obs.filter((o) => o.idx > last - dias);
}

function notaVentana(dias: number): string {
  return dias === 42 ? 'últimas 6 semanas' : 'últimas 4 semanas';
}

type RunCiclo = { kind: 'F' | 'W'; start: number; end: number; codes: string[]; len: number; band: string };

function masVisto(cuenta: Map<string, number>, orden: string[]): string {
  let best = orden[0] || '';
  let n = -1;
  for (const k of orden) {
    const v = cuenta.get(k) || 0;
    if (v > n) { n = v; best = k; }
  }
  return best;
}

function modoLargo(xs: number[]): number {
  const cuenta = new Map<number, number>();
  for (const x of xs) cuenta.set(x, (cuenta.get(x) || 0) + 1);
  let top = 0;
  for (const n of cuenta.values()) if (n > top) top = n;
  let best = -1;
  for (const [k, n] of cuenta) if (n === top && k > best) best = k;
  return best;
}

function rachasDeCiclo(obs: Obs[]): RunCiclo[] {
  const runs: RunCiclo[] = [];
  for (const o of obs) {
    const kind: 'F' | 'W' = o.code === 'F' ? 'F' : 'W';
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === kind && o.idx === prev.end + 1) {
      prev.end = o.idx;
      prev.codes.push(o.code);
    } else {
      runs.push({ kind, start: o.idx, end: o.idx, codes: [o.code], len: 1, band: '' });
    }
  }
  for (const r of runs) {
    r.len = r.end - r.start + 1;
    const cuenta = new Map<string, number>();
    const orden: string[] = [];
    for (const c of r.codes) {
      const b = familia(c);
      if (!cuenta.has(b)) orden.push(b);
      cuenta.set(b, (cuenta.get(b) || 0) + 1);
    }
    r.band = masVisto(cuenta, orden);
  }
  return runs;
}

function puestoDelCodigo(obs: Obs[], code: string): { pos: string; start?: unknown; end?: unknown } {
  for (let i = obs.length - 1; i >= 0; i -= 1) {
    if (obs[i].code === code && obs[i].pos) return { pos: obs[i].pos, start: obs[i].start, end: obs[i].end };
  }
  const fam = familia(code);
  for (let i = obs.length - 1; i >= 0; i -= 1) {
    if (obs[i].fam === fam && obs[i].pos) return { pos: obs[i].pos, start: obs[i].start, end: obs[i].end };
  }
  return { pos: '' };
}

type ProyeccionBloques = {
  ciclo: CicloDetectado;
  porDia: Map<string, DiaCiclo>;
  continuaEn: string;
};

/**
 * Cuando ningún período fijo explica el historial: largo típico del bloque de trabajo,
 * largo del franco y el orden de bandas. Tolera bloques cortados en los bordes.
 */
function detectarCicloPorBloques(obs: Obs[], desdeIdx: number, hastaIdx: number): ProyeccionBloques | null {
  if (obs.length < 10 || hastaIdx < desdeIdx) return null;
  const runs = rachasDeCiclo(obs);
  const comp = runs.filter((r, i) => i > 0 && i < runs.length - 1
    && runs[i - 1].end + 1 === r.start && r.end + 1 === runs[i + 1].start);
  const trabajos = comp.filter((r) => r.kind === 'W').slice(-6).map((r) => r.len);
  const francos = comp.filter((r) => r.kind === 'F').slice(-6).map((r) => r.len);
  if (trabajos.length < 2 || francos.length < 2) return null;
  const largoTrabajo = modoLargo(trabajos);
  const largoFranco = modoLargo(francos);
  const conf = (xs: number[], modo: number) => xs.filter((x) => x === modo).length / xs.length;
  const confianza = Math.min(conf(trabajos, largoTrabajo), conf(francos, largoFranco));
  if (confianza < 0.6 || largoTrabajo > 9 || largoFranco > 4 || largoTrabajo < 1) return null;
  const deTrabajo = runs.filter((r) => r.kind === 'W' && r.len >= 2);
  const bandas = deTrabajo.map((r) => r.band);
  const sigue = new Map<string, Map<string, number>>();
  const sigueOrden = new Map<string, string[]>();
  for (let i = 0; i < bandas.length - 1; i += 1) {
    const a = bandas[i];
    const b = bandas[i + 1];
    if (!sigue.has(a)) { sigue.set(a, new Map()); sigueOrden.set(a, []); }
    const m = sigue.get(a)!;
    const orden = sigueOrden.get(a)!;
    if (!m.has(b)) orden.push(b);
    m.set(b, (m.get(b) || 0) + 1);
  }
  const siguiente = (band: string) => {
    const m = sigue.get(band);
    const orden = sigueOrden.get(band) || [];
    return m && orden.length ? masVisto(m, orden) : band;
  };
  const cuentaCode = new Map<string, Map<string, number>>();
  const ordenCode = new Map<string, string[]>();
  for (const o of obs) {
    if (o.code === 'F') continue;
    const b = familia(o.code);
    if (!cuentaCode.has(b)) { cuentaCode.set(b, new Map()); ordenCode.set(b, []); }
    const m = cuentaCode.get(b)!;
    const orden = ordenCode.get(b)!;
    if (!m.has(o.code)) orden.push(o.code);
    m.set(o.code, (m.get(o.code) || 0) + 1);
  }
  const codigoDe = (band: string) => {
    const m = cuentaCode.get(band);
    const orden = ordenCode.get(band) || [];
    return m && orden.length ? masVisto(m, orden) : band;
  };
  const ultimo = runs[runs.length - 1];
  let kind = ultimo.kind;
  let llevo = ultimo.len;
  let banda = ultimo.band;
  if (kind === 'F' && deTrabajo.length) banda = deTrabajo[deTrabajo.length - 1].band;
  const partes: string[] = [];
  const vistas = new Set<string>();
  let rotulo = kind === 'W' ? banda : siguiente(banda);
  for (let i = 0; i < 6 && !vistas.has(rotulo); i += 1) {
    vistas.add(rotulo);
    const code = codigoDe(rotulo);
    partes.push(largoTrabajo > 1 ? `${code}×${largoTrabajo}` : code);
    partes.push(largoFranco > 1 ? `F×${largoFranco}` : 'F');
    rotulo = siguiente(rotulo);
  }
  const porDia = new Map<string, DiaCiclo>();
  let continuaEn = 'sin dato el primer día';
  let day = ultimo.end + 1;
  let guard = 0;
  while (day <= hastaIdx && guard < 400) {
    guard += 1;
    if (kind === 'W') {
      if (llevo >= largoTrabajo) { kind = 'F'; llevo = 0; continue; }
    } else if (llevo >= largoFranco) {
      kind = 'W';
      llevo = 0;
      banda = siguiente(banda);
      continue;
    }
    const code = kind === 'F' ? 'F' : codigoDe(banda);
    const de = kind === 'F' ? largoFranco : largoTrabajo;
    if (day >= desdeIdx) {
      const puesto = code === 'F' ? { pos: 'General' } : puestoDelCodigo(obs, code);
      const base: DiaCiclo = { code, positionName: code === 'F' ? 'General' : (puesto.pos || '') };
      const dia: DiaCiclo = code === 'RET'
        ? { ...base, ...horarioRet({ idx: day, code, fam: 'RET', pos: base.positionName, start: puesto.start, end: puesto.end }) }
        : base;
      porDia.set(ymdDeIndex(day), dia);
      if (day === desdeIdx) continuaEn = de > 1 ? `${code} (${ordinal(llevo + 1)} de ${de})` : code;
    }
    llevo += 1;
    day += 1;
  }
  if (!porDia.size) return null;
  return {
    porDia,
    continuaEn,
    ciclo: {
      periodo: largoTrabajo + largoFranco,
      fases: [],
      consistencia: Math.round(confianza * 100) / 100,
      muestras: obs.length,
      ultimoDia: ymdDeIndex(obs[obs.length - 1].idx),
      etiqueta: partes.join(' · '),
    },
  };
}

type CicloElegido = {
  ciclo: CicloDetectado;
  origen: OrigenCiclo;
  estimado: boolean;
  nota: string | null;
  continuaEn: string | null;
  diaDe: (dateStr: string) => DiaCiclo | null;
};

/** Período de todo el historial. Si no aparece, el tramo desde el último corte o las últimas semanas, y si tampoco, los bloques. */
function elegirCiclo(obs: Obs[], desdeIdx: number, hastaIdx: number): CicloElegido | null {
  const fijo = detectarCiclo(obs);
  if (fijo) {
    return { ciclo: fijo, origen: 'fijo', estimado: false, nota: null, continuaEn: null, diaDe: (d) => diaDelCiclo(fijo, d) };
  }
  const intentos: Array<{ sub: Obs[]; nota: string }> = [];
  const corte = obsDesdeUltimoCorte(obs);
  if (corte) {
    const [dd, mm] = [corte.vuelta.slice(8), corte.vuelta.slice(5, 7)];
    intentos.push({ sub: corte.sub, nota: `desde la vuelta del ${dd}/${mm}` });
  }
  for (const w of VENTANAS_RECIENTES) {
    const sub = obsVentana(obs, w);
    if (sub.length >= 6 && sub.length < obs.length) intentos.push({ sub, nota: notaVentana(w) });
  }
  for (const it of intentos) {
    const c = detectarCiclo(it.sub);
    if (!c) continue;
    return { ciclo: c, origen: 'corte', estimado: true, nota: it.nota, continuaEn: null, diaDe: (d) => diaDelCiclo(c, d) };
  }
  const bloques = detectarCicloPorBloques(obs, desdeIdx, hastaIdx);
  if (!bloques) return null;
  return {
    ciclo: bloques.ciclo,
    origen: 'bloques',
    estimado: true,
    nota: 'ciclo estimado (por bloques)',
    continuaEn: bloques.continuaEn,
    diaDe: (d) => bloques.porDia.get(d) || null,
  };
}

function ordinal(n: number): string {
  return `${n}.º`;
}

/** «T (2.º de 6)»: qué toca el primer día y en qué parte de la racha. */
export function textoContinuaEn(ciclo: CicloDetectado, primerDia: string): string {
  const hoy = diaDelCiclo(ciclo, primerDia);
  if (!hoy) return 'sin dato el primer día';
  const idx = diaIndex(primerDia);
  let antes = 0;
  while (antes < ciclo.periodo && diaDelCiclo(ciclo, ymdDeIndex(idx - antes - 1))?.code === hoy.code) antes += 1;
  let despues = 0;
  while (despues < ciclo.periodo && diaDelCiclo(ciclo, ymdDeIndex(idx + despues + 1))?.code === hoy.code) despues += 1;
  const largo = antes + 1 + despues;
  return largo > 1 ? `${hoy.code} (${ordinal(antes + 1)} de ${largo})` : hoy.code;
}

const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

function letraDia(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return LETRAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * La franja del puesto para ese código. Si el ciclo dice M/T/N y el puesto llama a su franja de otra
 * forma (Tadicor: P5M, PLN, P2T), es la única franja de esa banda del puesto.
 */
function turnoDelPuesto(pos: PuestoSla | undefined, code: string) {
  const shifts = pos?.shifts || [];
  const exacto = shifts.find((s) => up(s.code) === code);
  if (exacto || !['M', 'T', 'N'].includes(code)) return exacto || null;
  const deBanda = shifts.filter((s) => {
    const c = up(s.code).replace(/\s+/g, '');
    return !/D12$|N12$/.test(c) && bandaDe(c) === code;
  });
  return deBanda.length === 1 ? deBanda[0] : null;
}

/** 'HH:MM' de un string o de un Timestamp/Date, en hora Argentina. */
function hhmmAR(v: unknown): string {
  if (typeof v === 'string') {
    const m = v.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '';
  }
  const d = v && typeof (v as { toDate?: () => Date }).toDate === 'function'
    ? (v as { toDate: () => Date }).toDate()
    : v instanceof Date ? v : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const x = new Date(d.getTime() - 3 * 3600000);
  return `${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

/** Horario del RET planificado más reciente. Si el SLA no tiene RET, la propuesta usa este. */
function retQueTenia(previos: TurnoPrevio[], objectiveId?: string): { positionName: string; start: string; end: string; hours: number } | null {
  const rets = (previos || [])
    .filter((t) => codigoDeCiclo(t, objectiveId) === 'RET')
    .sort((a, b) => String(a.dateStr).localeCompare(String(b.dateStr)));
  const t = rets[rets.length - 1];
  if (!t) return null;
  const hours = Number(t.hours);
  return {
    positionName: String(t.positionName || 'Retén').trim() || 'Retén',
    start: hhmmAR(t.startTime) || '00:00',
    end: hhmmAR(t.endTime) || '00:00',
    hours: hours > 0 ? hours : 0,
  };
}

/**
 * Cupo M/T/N del servicio ese día (cantidad efectiva del SLA, días y exclusiones). Si el puesto tiene franjas de 8 h,
 * cuentan esas (D12/N12 son la alternativa de 12 h); si solo tiene 12 h, D12 cuenta M + ½ T y N12 N + ½ T.
 * Los puestos con `exigeCobertura === false` no cuentan. null = el servicio no pide nada ese día.
 */
export function cupoDelServicio(
  estructura: PuestoSla[],
  dateStr: string,
  habilitado?: (positionName: string, code: string, dateStr: string) => boolean,
): CupoDia | null {
  const c: CupoDia = { M: 0, T: 0, N: 0 };
  let algo = false;
  for (const pos of estructura) {
    if ((pos as { exigeCobertura?: boolean }).exigeCobertura === false) continue;
    const de8 = (pos.shifts || []).some((s) => {
      const code = up(s.code).replace(/\s+/g, '');
      return !!bandaDe(code) && !/D12$|N12$/.test(code);
    });
    for (const s of pos.shifts || []) {
      const code = up(s.code);
      const banda = bandaDe(code);
      if (!banda || (de8 && (code === 'D12' || code === 'N12'))) continue;
      const ok = habilitado ? habilitado(pos.positionName, code, dateStr) : turnoHabilitadoPorEstructura(estructura, pos.positionName, code, dateStr);
      if (!ok) continue;
      const q = getEffectiveShiftQuantityOnDate(pos, dateStr, code, pos.qty);
      if (!q) continue;
      algo = true;
      if (code === 'D12') { c.M += q; c.T += q / 2; } else if (code === 'N12') { c.N += q; c.T += q / 2; } else c[banda] += q;
    }
  }
  return algo ? c : null;
}

export function turnoHabilitadoPorEstructura(estructura: PuestoSla[], positionName: string, code: string, dateStr: string): boolean {
  const pos = estructura.find((p) => p.positionName === positionName);
  if (!pos) return false;
  if ((pos.excludedDates || []).includes(dateStr)) return false;
  if ((pos.excludedShiftDates?.[dateStr] || []).map(up).includes(code)) return false;
  const sh = turnoDelPuesto(pos, code);
  if (!sh) return false;
  if (Array.isArray(sh.specificDates) && sh.specificDates.length > 0 && !sh.specificDates.includes(dateStr)) return false;
  if (Array.isArray(sh.days) && sh.days.length > 0 && !sh.days.includes(letraDia(dateStr)) && !correFeriado(sh, dateStr)) return false;
  return true;
}

const CCT: Record<string, { start: string; end: string; hours: number }> = {
  M: { start: '07:00', end: '15:00', hours: 8 },
  T: { start: '15:00', end: '23:00', hours: 8 },
  N: { start: '23:00', end: '07:00', hours: 8 },
  D12: { start: '07:00', end: '19:00', hours: 12 },
  N12: { start: '19:00', end: '07:00', hours: 12 },
};

function puestoNorm(name: string): string {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function puestoPreferidoDe(
  g: { puestoPreferido?: string; previos: TurnoPrevio[] },
  estructura: PuestoSla[],
): string {
  const hit = (name: string) => estructura.find((p) => puestoNorm(p.positionName) === puestoNorm(name))?.positionName || '';
  const pref = hit(g.puestoPreferido || '');
  if (pref) return pref;
  const counts = new Map<string, number>();
  for (const t of g.previos) {
    const p = hit(String((t as { positionName?: string }).positionName || ''));
    if (p) counts.set(p, (counts.get(p) || 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [p, c] of counts) if (c > n) { best = p; n = c; }
  return best;
}

/** Puesto del mes nuevo para ese turno. Si el del mes anterior ya no está, el único que lo ofrece. */
function resolverPuesto(estructura: PuestoSla[], positionName: string, code: string):
  { pos: PuestoSla; reasignadoDe?: string } | { motivo: string } {
  const mismo = estructura.find((p) => puestoNorm(p.positionName) === puestoNorm(positionName));
  if (mismo && turnoDelPuesto(mismo, code)) return { pos: mismo };
  const duenos = estructura.filter((p) => turnoDelPuesto(p, code));
  if (mismo) {
    return duenos.length === 1 && !positionName
      ? { pos: duenos[0] }
      : { motivo: `«${positionName}» ya no tiene el turno ${code} en el servicio de este mes` };
  }
  if (duenos.length === 1) return positionName ? { pos: duenos[0], reasignadoDe: positionName } : { pos: duenos[0] };
  if (duenos.length === 0) return { motivo: `El turno ${code} no está en el servicio de este mes` };
  return {
    motivo: positionName
      ? `«${positionName}» ya no está en el servicio de este mes y ${code} lo tienen ${duenos.length} puestos`
      : `${code} lo tienen ${duenos.length} puestos: elegí cuál`,
  };
}

function celdaDeTrabajo(employeeId: string, dateStr: string, pos: PuestoSla, code: string): CeldaPropuesta {
  const sh = turnoDelPuesto(pos, code)!;
  const win = ventanaTrabajo(sh.startTime, sh.endTime) || CCT[code] || { start: '07:00', end: '15:00', hours: 8 };
  const hours = Number(sh.hours) > 0 ? Number(sh.hours) : win.hours;
  // Si la franja se encontró por la banda (M → P5M), el código queda como en el mes que se copia (M):
  // noviembre igual a octubre, con el puesto y el horario del servicio.
  const porBanda = up(sh.code) !== code;
  return {
    employeeId,
    dateStr,
    code: porBanda ? code : String(sh.code || code),
    name: porBanda ? code : String(sh.name || sh.code || code),
    positionName: pos.positionName,
    startTime: win.start,
    endTime: win.end,
    hours,
    isFranco: false,
  };
}

export function proponerGuardia(
  input: ContinuarInput,
  g: ContinuarInput['guardias'][number],
  forzado?: CicloElegido | null,
): ResultadoGuardia {
  const res: ResultadoGuardia = {
    employeeId: g.id,
    nombre: g.nombre,
    ciclo: null,
    origenCiclo: null,
    estimado: false,
    notaEstimado: null,
    continuaEn: '',
    motivoSinCiclo: null,
    propuestas: [],
    omitidas: { licencia: 0, ocupada: 0, bloqueada: 0, sinDato: 0, excluida: 0 },
    revisar: [],
    horasPropuestas: 0,
    plantilla: null,
    sugerencias: [],
  };
  const obs = observacionesDelGuardia(g.previos, input.objectiveId);
  if (obs.length === 0 && !forzado) {
    res.motivoSinCiclo = 'No trabajó en este objetivo en las últimas semanas';
    return res;
  }
  const desdeIdx = input.dias.length ? diaIndex(input.dias[0]) : (obs[obs.length - 1]?.idx ?? 0) + 1;
  const hastaIdx = input.dias.length ? diaIndex(input.dias[input.dias.length - 1]) : desdeIdx;
  const elegido = forzado || elegirCiclo(obs, desdeIdx, hastaIdx);
  if (!elegido) {
    res.motivoSinCiclo = obs.length < 6
      ? `Pocos días para leer el ciclo (${obs.length})`
      : 'El ciclo no se repite (cambios a mano o esquema irregular)';
    return res;
  }
  const ciclo = elegido.ciclo;
  res.ciclo = ciclo;
  res.origenCiclo = elegido.origen;
  res.estimado = elegido.estimado;
  res.notaEstimado = elegido.nota;
  res.continuaEn = elegido.continuaEn ?? (input.dias.length ? textoContinuaEn(ciclo, input.dias[0]) : '');
  const habilitado = input.turnoHabilitado
    || ((pos: string, code: string, ds: string) => turnoHabilitadoPorEstructura(input.estructura, pos, code, ds));
  const revisar = new Map<string, RevisarPuesto>();
  for (const dateStr of input.dias) {
    if (input.diaBloqueado?.(dateStr)) { res.omitidas.bloqueada += 1; continue; }
    const estado = input.estadoCelda(g.id, dateStr);
    if (estado === 'licencia') { res.omitidas.licencia += 1; continue; }
    if (estado === 'ocupada') { res.omitidas.ocupada += 1; continue; }
    const dia = elegido.diaDe(dateStr);
    if (!dia) { res.omitidas.sinDato += 1; continue; }
    if (dia.code === 'F') {
      res.propuestas.push({
        employeeId: g.id, dateStr, code: 'F', name: 'Franco', positionName: 'General',
        startTime: '00:00', endTime: '00:00', hours: 0, isFranco: true,
      });
      continue;
    }
    if (dia.code === 'RET') {
      const sla = resolverPuesto(input.estructura, dia.positionName, 'RET');
      if (!('motivo' in sla) && habilitado(sla.pos.positionName, 'RET', dateStr)) {
        const celda = celdaDeTrabajo(g.id, dateStr, sla.pos, 'RET');
        if (sla.reasignadoDe) celda.puestoReasignadoDe = sla.reasignadoDe;
        res.propuestas.push(celda);
        res.horasPropuestas += celda.hours;
        continue;
      }
      const hist = retQueTenia(g.previos, input.objectiveId);
      if (hist) {
        res.propuestas.push({
          employeeId: g.id, dateStr, code: 'RET', name: 'Retén', positionName: hist.positionName,
          startTime: hist.start, endTime: hist.end, hours: hist.hours, isFranco: false,
        });
        res.horasPropuestas += hist.hours;
        continue;
      }
    }
    const casa = puestoPreferidoDe(g, input.estructura);
    const casaRes = casa ? resolverPuesto(input.estructura, casa, dia.code) : null;
    let r = casaRes && !('motivo' in casaRes)
      ? casaRes
      : resolverPuesto(input.estructura, dia.positionName, dia.code);
    if ('motivo' in r) {
      const k = `${dia.positionName}|${dia.code}`;
      const item = revisar.get(k) || { positionName: dia.positionName, code: dia.code, dias: [], motivo: r.motivo };
      item.dias.push(dateStr);
      revisar.set(k, item);
      continue;
    }
    if (!habilitado(r.pos.positionName, dia.code, dateStr)) { res.omitidas.excluida += 1; continue; }
    const celda = celdaDeTrabajo(g.id, dateStr, r.pos, dia.code);
    if (r.reasignadoDe) {
      celda.puestoReasignadoDe = r.reasignadoDe;
      const k = `${r.reasignadoDe}|${dia.code}`;
      const item = revisar.get(k) || {
        positionName: r.reasignadoDe,
        code: dia.code,
        dias: [],
        motivo: `«${r.reasignadoDe}» ya no está en el servicio de este mes`,
        propuestoEn: r.pos.positionName,
      };
      item.dias.push(dateStr);
      revisar.set(k, item);
    }
    res.propuestas.push(celda);
    res.horasPropuestas += celda.hours;
  }
  res.revisar = [...revisar.values()];
  return res;
}

function etiquetaDeCodigos(dias: string[], codes: Record<string, string>): string {
  const runs: Array<[string, number]> = [];
  for (const d of dias.slice(0, 16)) {
    const c = codes[d] || '?';
    const last = runs[runs.length - 1];
    if (last && last[0] === c) last[1] += 1;
    else runs.push([c, 1]);
  }
  return runs.map(([c, n]) => (n > 1 ? `${c}×${n}` : c)).join(' · ');
}

function continuaEnDeCodes(dias: string[], codes: Record<string, string>): string {
  const hoy = codes[dias[0]];
  if (!hoy) return 'sin dato el primer día';
  let largo = 0;
  while (largo < dias.length && codes[dias[largo]] === hoy) largo += 1;
  return largo > 1 ? `${hoy} (${ordinal(1)} de ${largo}+)` : hoy;
}

/** El plan c2 como ciclo para el resto del armado (puesto, SLA del mes nuevo, licencias, celdas). */
function cicloDesdePlan(plan: PlanC2, fuente: Obs[], dias: string[]): CicloElegido {
  const dia = (code: string, idx: number): DiaCiclo => {
    if (code === 'F') return { code: 'F', positionName: 'General' };
    const p = puestoDelCodigo(fuente, code);
    const base: DiaCiclo = { code, positionName: p.pos || '' };
    return code === 'RET' ? { ...base, ...horarioRet({ idx, code, fam: 'RET', pos: base.positionName, start: p.start, end: p.end }) } : base;
  };
  const previas = fuente.filter((o) => o.idx < diaIndex(dias[0]));
  const ultimoDia = ymdDeIndex(previas.length ? Math.max(...previas.map((o) => o.idx)) : diaIndex(dias[0]) - 1);
  const porDia = new Map<string, DiaCiclo>();
  for (const d of dias) {
    const c = plan.codes[d];
    if (c) porDia.set(d, dia(c, diaIndex(d)));
  }
  if (plan.periodo) {
    const fases = plan.fases.map((c, i) => (c ? dia(c, i) : null));
    const ciclo: CicloDetectado = {
      periodo: plan.periodo,
      fases,
      consistencia: plan.ajuste,
      muestras: fuente.length,
      ultimoDia,
      etiqueta: etiquetaCiclo(fases),
    };
    return { ciclo, origen: 'plantilla', estimado: false, nota: null, continuaEn: null, diaDe: (d) => porDia.get(d) || null };
  }
  const ciclo: CicloDetectado = {
    periodo: 0,
    fases: [],
    consistencia: 0,
    muestras: fuente.length,
    ultimoDia,
    etiqueta: etiquetaDeCodigos(dias, plan.codes),
  };
  return {
    ciclo,
    origen: 'bloques',
    estimado: true,
    nota: 'ciclo estimado (por rachas)',
    continuaEn: continuaEnDeCodes(dias, plan.codes),
    diaDe: (d) => porDia.get(d) || null,
  };
}

function sugerenciasDe(
  input: ContinuarInput,
  res: ResultadoGuardia,
  nivelaciones: NivelacionC2[],
): SugerenciaNivelacion[] {
  const habilitado = input.turnoHabilitado
    || ((pos: string, code: string, ds: string) => turnoHabilitadoPorEstructura(input.estructura, pos, code, ds));
  const out: SugerenciaNivelacion[] = [];
  for (const n of nivelaciones) {
    const actual = res.propuestas.find((c) => c.dateStr === n.dateStr && !c.isFranco);
    if (!actual) continue;
    const r = resolverPuesto(input.estructura, actual.positionName, n.a);
    if ('motivo' in r || !habilitado(r.pos.positionName, n.a, n.dateStr)) continue;
    out.push({ dateStr: n.dateStr, de: n.de, a: n.a, texto: n.texto, celda: celdaDeTrabajo(res.employeeId, n.dateStr, r.pos, n.a) });
  }
  return out;
}

function anclarPorPuesto(input: ContinuarInput, resultados: ResultadoGuardia[]) {
  const porId = new Map(input.guardias.map((g) => [g.id, g]));
  const ocupado = new Map<string, number>();
  const clave = (d: string, p: string, c: string) => `${d}|${puestoNorm(p)}|${up(c)}`;
  const cupo = (pos: PuestoSla, dateStr: string, code: string) =>
    getEffectiveShiftQuantityOnDate(pos, dateStr, code, pos.qty) || pos.qty || 1;
  for (const r of resultados) {
    if (String(porId.get(r.employeeId)?.puestoPreferido || '').trim()) continue;
    for (const c of r.propuestas) {
      if (c.isFranco || c.code === 'F' || c.code === 'RET') continue;
      const k = clave(c.dateStr, c.positionName, c.code);
      ocupado.set(k, (ocupado.get(k) || 0) + 1);
    }
  }
  // Pasada 1: cada uno en su puesto. Los que no entran quedan anotados para la pasada 2.
  const sobrantes: Array<{ r: ResultadoGuardia; i: number; casa: PuestoSla; chip: string }> = [];
  for (const r of resultados) {
    const chip = String(porId.get(r.employeeId)?.puestoPreferido || '').trim();
    if (!chip) continue;
    r.propuestas = r.propuestas.map((c, i) => {
      if (c.isFranco || c.code === 'F' || c.code === 'RET') return c;
      const casa = resolverPuesto(input.estructura, chip, c.code);
      if ('motivo' in casa) return c;
      const k = clave(c.dateStr, casa.pos.positionName, c.code);
      const n = ocupado.get(k) || 0;
      ocupado.set(k, n + 1);
      if (n >= cupo(casa.pos, c.dateStr, c.code)) sobrantes.push({ r, i, casa: casa.pos, chip });
      return celdaDeTrabajo(r.employeeId, c.dateStr, casa.pos, c.code);
    });
  }
  // Pasada 2: el que sobra pasa a otro puesto solo si esa banda quedó libre con todos ya ubicados.
  // Si no hay lugar, queda en su puesto (sobrecobertura a la vista).
  // El que sobra va primero a un puesto donde ya trabajó el mes anterior (BONILLA: Puesto 1 antes que Playa).
  const historial = (empId: string) => {
    const m = new Map<string, number>();
    for (const t of porId.get(empId)?.previos || []) {
      const p = puestoNorm(String(t.positionName || ''));
      if (p) m.set(p, (m.get(p) || 0) + 1);
    }
    return m;
  };
  // El que sobra solo pasa a un puesto donde ya trabajó el mes anterior (BONILLA entre Puesto 1 y 2).
  // A un puesto ajeno no (Obrador: los de Puesto 2 iban a Puesto 1 con otro horario): queda en el suyo,
  // la sobrecobertura se ve en la fila COBERTURA y lo decide el planificador.
  const movidos = new Set<number>();
  for (const [idx, s] of sobrantes.entries()) {
    if (movidos.has(idx)) continue;
    const c = s.r.propuestas[s.i];
    const hist = historial(s.r.employeeId);
    const candidatos = [...input.estructura]
      .filter((p) => (hist.get(puestoNorm(p.positionName)) || 0) > 0)
      .sort((a, b) => (hist.get(puestoNorm(b.positionName)) || 0) - (hist.get(puestoNorm(a.positionName)) || 0));
    const otro = candidatos.find((p) => {
      if (puestoNorm(p.positionName) === puestoNorm(s.casa.positionName)) return false;
      const rr = resolverPuesto(input.estructura, p.positionName, c.code);
      if ('motivo' in rr) return false;
      return (ocupado.get(clave(c.dateStr, p.positionName, c.code)) || 0) < cupo(p, c.dateStr, c.code);
    });
    if (!otro) continue;
    movidos.add(idx);
    const kCasa = clave(c.dateStr, s.casa.positionName, c.code);
    ocupado.set(kCasa, (ocupado.get(kCasa) || 1) - 1);
    const kk = clave(c.dateStr, otro.positionName, c.code);
    ocupado.set(kk, (ocupado.get(kk) || 0) + 1);
    s.r.propuestas[s.i] = celdaDeTrabajo(s.r.employeeId, c.dateStr, otro, c.code);
    const motivo = `${s.chip} lleno: ${c.code} en ${otro.positionName}`;
    const item = s.r.revisar.find((x) => x.positionName === otro.positionName && x.code === c.code && x.motivo === motivo);
    if (item) item.dias.push(c.dateStr);
    else s.r.revisar.push({ positionName: otro.positionName, code: c.code, dias: [c.dateStr], motivo });
  }
  for (const r of resultados) r.horasPropuestas = r.propuestas.reduce((acc, x) => acc + (x.isFranco ? 0 : x.hours), 0);
}

const COMPUESTO_PUESTO = /^(P\d+|PL)(D12|N12|M|T|N)$/;

function siglaDeNombre(nombre: string): string {
  const n = puestoNorm(nombre);
  const num = n.match(/^(?:PUESTO|PTO|PSTO|P)\s*(\d+)$/);
  if (num && /^(?:PUESTO|PTO|PSTO|P)\s*\d+$/.test(n)) return `P${Number(num[1])}`;
  return '';
}

function puestoHabitual(r: ResultadoGuardia): string {
  const counts = new Map<string, number>();
  for (const c of r.propuestas) {
    if (c.isFranco || c.code === 'F' || c.code === 'RET') continue;
    const p = String(c.positionName || '').trim();
    if (!p || puestoNorm(p) === 'GENERAL' || puestoNorm(p) === 'RELEVANTE') continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [p, c] of counts) if (c > n) { best = p; n = c; }
  return best;
}

function esFilaRelevante(r: ResultadoGuardia, preferido?: string): boolean {
  if (puestoNorm(preferido || '') === 'RELEVANTE') return true;
  if (r.propuestas.some((c) => puestoNorm(c.positionName) === 'RELEVANTE')) return true;
  const siglas = new Set<string>();
  for (const c of r.propuestas) {
    const m = up(c.code).replace(/\s+/g, '').match(COMPUESTO_PUESTO);
    if (m) siglas.add(m[1]);
  }
  return siglas.size >= 2;
}

function siglasQueCubre(r: ResultadoGuardia): string[] {
  const counts = new Map<string, number>();
  for (const c of r.propuestas) {
    const m = up(c.code).replace(/\s+/g, '').match(COMPUESTO_PUESTO);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

function codigoParaBanda(pos: PuestoSla, sigla: string, banda: 'M' | 'T' | 'N'): string | null {
  const shifts = pos.shifts || [];
  const want = `${sigla}${banda}`;
  const exact = shifts.find((s) => up(s.code).replace(/\s+/g, '') === want);
  if (exact) return up(exact.code).replace(/\s+/g, '');
  if (shifts.some((s) => up(s.code) === banda)) return banda;
  const porBanda = shifts.filter((s) => bandaDe(up(s.code)) === banda && !/D12$|N12$/.test(up(s.code).replace(/\s+/g, '')));
  return porBanda.length === 1 ? up(porBanda[0].code).replace(/\s+/g, '') : null;
}

function bandasDelPuesto(pos: PuestoSla): Array<'M' | 'T' | 'N'> {
  const out: Array<'M' | 'T' | 'N'> = [];
  for (const s of pos.shifts || []) {
    const code = up(s.code).replace(/\s+/g, '');
    if (/D12$|N12$/.test(code)) continue;
    const b = bandaDe(code);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

/**
 * El relevante cubre la banda que queda libre cuando un titular de Puesto 1 o 2 está de franco.
 * Si el continuar corre esos francos, la sugerencia (destildada) lo sigue. No pisa la racha sola.
 */
export function reacomodoRelevante(
  input: Pick<ContinuarInput, 'guardias' | 'estructura' | 'dias' | 'estadoCelda' | 'diaBloqueado' | 'turnoHabilitado'>,
  resultados: ResultadoGuardia[],
): SugerenciaNivelacion[] {
  const preferido = new Map(input.guardias.map((g) => [g.id, g.puestoPreferido]));
  const relevantes = resultados.filter((r) => esFilaRelevante(r, preferido.get(r.employeeId)));
  if (!relevantes.length) return [];
  const idsRelevantes = new Set(relevantes.map((r) => r.employeeId));
  const habilitado = input.turnoHabilitado
    || ((pos: string, code: string, ds: string) => turnoHabilitadoPorEstructura(input.estructura, pos, code, ds));
  const out: SugerenciaNivelacion[] = [];
  for (const rel of relevantes) {
    const siglas = siglasQueCubre(rel);
    const puestos = siglas
      .map((sigla) => ({ sigla, pos: input.estructura.find((p) => siglaDeNombre(p.positionName) === sigla) }))
      .filter((x): x is { sigla: string; pos: PuestoSla } => !!x.pos);
    if (!puestos.length) continue;
    for (const dateStr of input.dias) {
      if (input.diaBloqueado?.(dateStr)) continue;
      const estado = input.estadoCelda(rel.employeeId, dateStr);
      if (estado === 'licencia' || estado === 'ocupada') continue;
      const actual = rel.propuestas.find((c) => c.dateStr === dateStr);
      let ambiguo = false;
      let cubierto = false;
      const huecos: Array<{ sigla: string; pos: PuestoSla; code: string }> = [];
      for (const { sigla, pos } of puestos) {
        const titulars = resultados.filter((r) => !idsRelevantes.has(r.employeeId) && puestoNorm(puestoHabitual(r)) === puestoNorm(pos.positionName));
        if (!titulars.length) continue;
        const hoy = titulars
          .map((r) => r.propuestas.find((c) => c.dateStr === dateStr))
          .filter((c): c is CeldaPropuesta => !!c);
        if (!hoy.length) continue;
        const francos = hoy.filter((c) => c.isFranco || c.code === 'F');
        const presentes = new Set(hoy.map((c) => bandaDe(c.code)).filter((b): b is 'M' | 'T' | 'N' => !!b));
        const faltan = bandasDelPuesto(pos).filter((b) => !presentes.has(b));
        if (!faltan.length) { cubierto = true; continue; }
        if (francos.length >= 1 && faltan.length === 1) {
          const code = codigoParaBanda(pos, sigla, faltan[0]);
          if (code) huecos.push({ sigla, pos, code });
          else ambiguo = true;
        } else ambiguo = true;
      }
      if (ambiguo) continue;
      const elegido = huecos[0];
      if (elegido) {
        if (!habilitado(elegido.pos.positionName, elegido.code, dateStr)) continue;
        if (actual && up(actual.code).replace(/\s+/g, '') === elegido.code && puestoNorm(actual.positionName) === puestoNorm(elegido.pos.positionName)) continue;
        const sla = resolverPuesto(input.estructura, elegido.pos.positionName, elegido.code);
        if ('motivo' in sla) continue;
        out.push({
          dateStr,
          de: actual?.code || 'F',
          a: elegido.code,
          tipo: 'relevante',
          texto: `${ddmm(dateStr)} · ${elegido.code} (franco en ${elegido.pos.positionName})`,
          celda: celdaDeTrabajo(rel.employeeId, dateStr, sla.pos, elegido.code),
        });
        continue;
      }
      if (cubierto && actual && !actual.isFranco && actual.code !== 'F') {
        out.push({
          dateStr,
          de: actual.code,
          a: 'F',
          tipo: 'relevante',
          texto: `${ddmm(dateStr)} · franco (${puestos.map((p) => p.pos.positionName).join(' y ')} cubiertos)`,
          celda: {
            employeeId: rel.employeeId, dateStr, code: 'F', name: 'Franco', positionName: 'General',
            startTime: '00:00', endTime: '00:00', hours: 0, isFranco: true,
          },
        });
      }
    }
  }
  return out;
}

function aplicarReacomodoRelevante(input: ContinuarInput, resultados: ResultadoGuardia[]) {
  const porId = new Map<string, SugerenciaNivelacion[]>();
  for (const s of reacomodoRelevante(input, resultados)) {
    const list = porId.get(s.celda.employeeId) || [];
    list.push(s);
    porId.set(s.celda.employeeId, list);
  }
  for (const r of resultados) {
    const extra = porId.get(r.employeeId);
    if (extra?.length) r.sugerencias = [...r.sugerencias, ...extra];
  }
}

type BandaR = 'M' | 'T' | 'N';

function bandaCelda(c: CeldaPropuesta | undefined): BandaR | 'F' | null {
  if (!c) return null;
  const code = up(c.code).replace(/\s+/g, '');
  if (c.isFranco || code === 'F' || code === 'FF' || code === 'FP') return 'F';
  if (/D12$|N12$/.test(code)) return null;
  return bandaDe(code);
}

function contarBanda(resultados: ResultadoGuardia[], dateStr: string, positionName: string, banda: BandaR): number {
  let n = 0;
  for (const r of resultados) {
    const c = r.propuestas.find((x) => x.dateStr === dateStr);
    if (c && puestoNorm(c.positionName) === puestoNorm(positionName) && bandaCelda(c) === banda) n += 1;
  }
  return n;
}

function cupoBanda(pos: PuestoSla, dateStr: string, banda: BandaR): number {
  const code = codigoParaBanda(pos, '', banda);
  if (!code || !turnoHabilitadoPorEstructura([pos], pos.positionName, code, dateStr)) return 0;
  return getEffectiveShiftQuantityOnDate(pos, dateStr, code, pos.qty) || pos.qty || 1;
}

/** Último día del mes anterior y cuántos días seguidos venía trabajando. */
function colaPrevia(input: ContinuarInput, employeeId: string): { ultima: BandaR | 'F' | null; racha: number } {
  const g = input.guardias.find((x) => x.id === employeeId);
  const primero = diaIndex(input.dias[0]);
  const porDia = new Map<number, BandaR | 'F'>();
  for (const t of g?.previos || []) {
    const idx = diaIndex(String(t.dateStr || ''));
    if (idx >= primero || idx < primero - 10) continue;
    const code = codigoDeCiclo(t, input.objectiveId);
    if (!code) continue;
    const b: BandaR | 'F' | null = code === 'F' ? 'F' : bandaDe(code);
    if (!b) continue;
    if (b !== 'F' || !porDia.has(idx)) porDia.set(idx, b);
  }
  const ultima = porDia.get(primero - 1) ?? null;
  let racha = 0;
  for (let idx = primero - 1; porDia.has(idx) && porDia.get(idx) !== 'F'; idx--) racha += 1;
  return { ultima, racha };
}

function permutaciones(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * Puesto de 24 h (M, T y N de a uno) con 4 guardias que se pisan: rotación de 24 días
 * (6 + F F por banda) con cada guardia corrido 6 días. Así todos los días hay M, T y N.
 * Se elige la fase que menos cambia lo propuesto y respeta el borde con el mes anterior.
 */
function sugerirRotacionPuesto(input: ContinuarInput, resultados: ResultadoGuardia[]) {
  const chipDe = new Map(input.guardias.map((g) => [g.id, String(g.puestoPreferido || '').trim()]));
  const dias = input.dias;
  const L = 24;
  for (const pos of input.estructura) {
    const bandas = bandasDelPuesto(pos);
    if (bandas.length !== 3) continue;
    const codes = bandas.map((b) => codigoParaBanda(pos, '', b));
    if (codes.some((c) => !c)) continue;
    const gs = resultados.filter((r) => puestoNorm(chipDe.get(r.employeeId) || '') === puestoNorm(pos.positionName) && r.propuestas.length);
    if (gs.length !== 4) continue;
    let choques = 0;
    for (const d of dias) {
      for (const b of bandas) {
        const q = cupoBanda(pos, d, b);
        if (q && contarBanda(gs, d, pos.positionName, b) !== q) choques += 1;
      }
    }
    if (!choques) continue;
    const trans = new Map<string, number>();
    for (const r of gs) {
      let prev: string | null = null;
      for (const d of dias) {
        const b = bandaCelda(r.propuestas.find((c) => c.dateStr === d));
        if (!b || b === 'F') continue;
        if (prev && prev !== b) trans.set(prev + b, (trans.get(prev + b) || 0) + 1);
        prev = b;
      }
    }
    const puntaje = (o: string[]) => (trans.get(o[0] + o[1]) || 0) + (trans.get(o[1] + o[2]) || 0) + (trans.get(o[2] + o[0]) || 0);
    const orden = puntaje(['M', 'N', 'T']) > puntaje(['M', 'T', 'N']) ? ['M', 'N', 'T'] : ['M', 'T', 'N'];
    const C: string[] = [];
    for (const b of orden) C.push(b, b, b, b, b, b, 'F', 'F');
    const prop = gs.map((r) => dias.map((d) => bandaCelda(r.propuestas.find((c) => c.dateStr === d))));
    const costo = gs.map((r, gi) => {
      const f = colaPrevia(input, r.employeeId);
      return Array.from({ length: L }, (_, ph) => {
        let lead = 0;
        while (lead < L && C[(ph + lead) % L] !== 'F') lead += 1;
        const primero = C[ph];
        if (f.ultima && f.ultima !== 'F' && primero !== 'F' && primero !== f.ultima) return Infinity;
        if (primero !== 'F' && f.racha + lead > 6) return Infinity;
        let m = 0;
        prop[gi].forEach((b, i) => { if (b !== null && C[(ph + i) % L] !== b) m += 1; });
        return m;
      });
    });
    let mejor = { c: Infinity, a: 0, perm: [0, 1, 2, 3] };
    for (let a = 0; a < L; a++) {
      for (const perm of permutaciones([0, 1, 2, 3])) {
        let c = 0;
        for (let gi = 0; gi < 4 && c < mejor.c; gi++) c += costo[gi][(a + 6 * perm[gi]) % L];
        if (c < mejor.c) mejor = { c, a, perm };
      }
    }
    if (!Number.isFinite(mejor.c) || mejor.c === 0) continue;
    const nuevas: SugerenciaNivelacion[] = [];
    const cambian: string[] = [];
    gs.forEach((r, gi) => {
      const ph = (mejor.a + 6 * mejor.perm[gi]) % L;
      let n = 0;
      dias.forEach((d, i) => {
        const actual = r.propuestas.find((c) => c.dateStr === d);
        const b = bandaCelda(actual);
        if (!actual || b === null || input.diaBloqueado?.(d)) return;
        const want = C[(ph + i) % L];
        // Misma banda pero en otro puesto (lo movió la pasada de «puesto lleno»): vuelve a este puesto.
        if (b === want && (want === 'F' || puestoNorm(actual.positionName) === puestoNorm(pos.positionName))) return;
        let celda: CeldaPropuesta;
        if (want === 'F') {
          celda = { employeeId: r.employeeId, dateStr: d, code: 'F', name: 'Franco', positionName: 'General', startTime: '00:00', endTime: '00:00', hours: 0, isFranco: true };
        } else {
          const code = codes[bandas.indexOf(want as BandaR)]!;
          if (!turnoHabilitadoPorEstructura([pos], pos.positionName, code, d)) return;
          celda = celdaDeTrabajo(r.employeeId, d, pos, code);
        }
        nuevas.push({ dateStr: d, de: actual.code, a: celda.code, tipo: 'rotacion', grupo: pos.positionName, texto: `${ddmm(d)} · ${r.nombre.split(',')[0].trim()}: ${actual.code} → ${celda.code}`, celda });
        n += 1;
      });
      if (n) cambian.push(r.nombre.split(',')[0].trim());
    });
    const grupoTexto = `${pos.positionName}: ordenar la rotación (24 días, cada guardia corrido 6). Todos los días queda M, T y N. Cambian ${cambian.join(', ')}.`;
    // La nivelación se calculó sobre la copia sin ordenar: con la rotación aplicada ya no tiene sentido y la desarma.
    for (const r of gs) r.sugerencias = r.sugerencias.filter((x) => x.tipo && x.tipo !== 'nivelacion');
    for (const sg of nuevas) {
      sg.grupoTexto = grupoTexto;
      gs.find((r) => r.employeeId === sg.celda.employeeId)?.sugerencias.push(sg);
    }
  }
}

/**
 * Guardia que el mes anterior repartió sus días entre dos puestos (BONILLA entre Puesto 1 y 2):
 * el día que en un puesto falta su banda y en el otro sobra, se sugiere pasarlo.
 */
function sugerirAlternos(input: ContinuarInput, resultados: ResultadoGuardia[]) {
  if (!input.dias.length) return;
  const primero = diaIndex(input.dias[0]);
  for (const g of input.guardias) {
    const r = resultados.find((x) => x.employeeId === g.id);
    if (!r) continue;
    const cuenta = new Map<string, number>();
    for (const t of g.previos || []) {
      const idx = diaIndex(String(t.dateStr || ''));
      if (idx >= primero || idx < primero - 31) continue;
      const code = codigoDeCiclo(t, input.objectiveId);
      if (!code || code === 'F' || code === 'RET') continue;
      const pos = input.estructura.find((x) => puestoNorm(x.positionName) === puestoNorm(String(t.positionName || '')));
      if (!pos) continue;
      cuenta.set(pos.positionName, (cuenta.get(pos.positionName) || 0) + 1);
    }
    const total = [...cuenta.values()].reduce((a, b) => a + b, 0);
    const puestos = [...cuenta.entries()].filter(([, n]) => n >= Math.max(3, total * 0.2)).map(([p]) => p);
    if (puestos.length < 2) continue;
    for (const c of r.propuestas) {
      const b = bandaCelda(c);
      if (!b || b === 'F') continue;
      const A = input.estructura.find((p) => puestoNorm(p.positionName) === puestoNorm(c.positionName));
      if (!A || !puestos.includes(A.positionName)) continue;
      for (const nombreB of puestos) {
        if (nombreB === A.positionName) continue;
        const B = input.estructura.find((p) => p.positionName === nombreB)!;
        const codeB = codigoParaBanda(B, '', b);
        if (!codeB || !turnoHabilitadoPorEstructura([B], nombreB, codeB, c.dateStr)) continue;
        const faltaEnB = contarBanda(resultados, c.dateStr, nombreB, b) < cupoBanda(B, c.dateStr, b);
        const sobraEnA = contarBanda(resultados, c.dateStr, A.positionName, b) - 1 >= cupoBanda(A, c.dateStr, b);
        if (!faltaEnB || !sobraEnA) continue;
        r.sugerencias.push({
          dateStr: c.dateStr,
          de: c.code,
          a: codeB,
          tipo: 'relevante',
          texto: `${ddmm(c.dateStr)} · ${r.nombre.split(',')[0].trim()}: ${c.code} pasa a ${nombreB} (falta ${b}; ${A.positionName} queda cubierto)`,
          celda: celdaDeTrabajo(r.employeeId, c.dateStr, B, codeB),
        });
        break;
      }
    }
  }
}

/**
 * Tope de racha, contando el final del mes anterior. Nunca más de 6 turnos seguidos.
 * Servicio de lunes a lunes: 48 h (6 de 8 h o 4 de 12 h). Franja de lunes a viernes (sin sábado ni domingo):
 * hasta 56 h (lo normal son 50, el RO de 5 × 10 h).
 */
export const MAX_HORAS_SEGUIDAS = 48;
export const MAX_HORAS_SEGUIDAS_LUN_VIE = 56;

function topeHorasDe(input: ContinuarInput, c: CeldaPropuesta): number {
  const pos = input.estructura.find((p) => puestoNorm(p.positionName) === puestoNorm(c.positionName));
  const sh = (pos?.shifts || []).find((x) => up(x.code) === up(c.code));
  const dias = (sh?.days || []).map((d) => up(d));
  const sinFinde = dias.length > 0 && !dias.includes('S') && !dias.includes('D');
  return sinFinde ? MAX_HORAS_SEGUIDAS_LUN_VIE : MAX_HORAS_SEGUIDAS;
}

function horasDeCodigo(code: string, hours?: unknown): number {
  const h = Number(hours);
  if (h > 0) return h;
  return code === 'D12' || code === 'N12' ? 12 : 8;
}

/** El día que pasaría el tope queda de franco (y se anota para revisar). */
function cortarRachas(input: ContinuarInput, resultados: ResultadoGuardia[]) {
  if (!input.dias.length) return;
  const primero = diaIndex(input.dias[0]);
  for (const r of resultados) {
    const g = input.guardias.find((x) => x.id === r.employeeId);
    const antes = new Map<number, number>();
    for (const t of g?.previos || []) {
      const idx = diaIndex(String(t.dateStr || ''));
      if (!(idx < primero && idx >= primero - 8)) continue;
      const code = codigoDeCiclo(t, input.objectiveId);
      if (!code || code === 'F' || code === 'RET') { if (!antes.has(idx)) antes.set(idx, 0); continue; }
      antes.set(idx, Math.max(antes.get(idx) || 0, horasDeCodigo(code, t.hours)));
    }
    const porDia = new Map(r.propuestas.map((c, i) => [c.dateStr, i]));
    let horas = 0;
    let turnos = 0;
    for (let idx = primero - 8; idx < primero + input.dias.length; idx++) {
      let h = 0;
      if (idx < primero) h = antes.get(idx) || 0;
      else {
        const dateStr = input.dias[idx - primero];
        const i = porDia.get(dateStr);
        const c = i == null ? null : r.propuestas[i];
        if (c && !c.isFranco && c.code !== 'RET') {
          h = horasDeCodigo(up(c.code), c.hours);
          if (horas + h > topeHorasDe(input, c) || turnos + 1 > 6) {
            r.propuestas[i!] = { ...c, code: 'F', name: 'Franco', positionName: 'General', isFranco: true, hours: 0, startTime: '00:00', endTime: '' };
            const motivo = `racha de más de ${topeHorasDe(input, c)} h seguidas: queda de franco`;
            const item = r.revisar.find((x) => x.motivo === motivo && x.code === c.code);
            if (item) item.dias.push(dateStr);
            else r.revisar.push({ positionName: c.positionName, code: c.code, dias: [dateStr], motivo });
            h = 0;
          }
        } else if (!c) {
          const cargado = input.cargado?.(r.employeeId, dateStr);
          h = cargado && cargado !== 'F' && cargado !== 'RET' ? horasDeCodigo(up(cargado)) : 0;
        }
      }
      if (h > 0) { horas += h; turnos += 1; } else { horas = 0; turnos = 0; }
    }
    r.horasPropuestas = r.propuestas.reduce((acc, x) => acc + (x.isFranco ? 0 : x.hours), 0);
  }
}

export function proponerContinuacion(input: ContinuarInput): ResultadoGuardia[] {
  if (input.regla === 'anterior') {
    const resultados = input.guardias.map((g) => proponerGuardia(input, g));
    cortarRachas(input, resultados);
    anclarPorPuesto(input, resultados);
    aplicarReacomodoRelevante(input, resultados);
    return resultados;
  }
  const todos = [...input.guardias, ...(input.salientes || [])];
  const obsPor = new Map(todos.map((g) => [g.id, observacionesDelGuardia(g.previos, input.objectiveId)]));
  const nombres = new Map(todos.map((g) => [g.id, g.nombre]));
  const historias = todos.map((g) => ({ id: g.id, nombre: g.nombre, crudo: (obsPor.get(g.id) || []).map((o) => ({ idx: o.idx, code: o.code })) }));
  const planes = continuarC2({
    historias,
    orden: input.guardias.map((g) => g.id),
    salientes: (input.salientes || []).map((s) => s.id),
    dias: input.dias,
  });
  const resultados = input.guardias.map((g) => {
    const plan = planes.get(g.id);
    if (!plan || !input.dias.length || plan.via === 'rachas') return proponerGuardia(input, g);
    const fuente = obsPor.get(plan.copiaDeId || g.id) || [];
    const res = proponerGuardia(input, g, cicloDesdePlan(plan, fuente.length ? fuente : obsPor.get(g.id) || [], input.dias));
    const copiaDe = plan.copiaDeId ? nombres.get(plan.copiaDeId) || plan.copiaDeId : null;
    res.plantilla = { periodo: plan.periodo, grupo: plan.grupo, via: plan.via, copiaDe };
    if (plan.grupo && res.continuaEn) res.continuaEn = `${res.continuaEn} · grupo ${plan.grupo}`;
    if (plan.via === 'herencia' || plan.via === 'compañero') {
      res.estimado = plan.via === 'herencia';
      res.notaEstimado = copiaDe ? `copia de ${copiaDe.split(',')[0].trim()}` : null;
    }
    return res;
  });
  cortarRachas(input, resultados);
  anclarPorPuesto(input, resultados);
  if (input.cupoDia) {
    const nivel = nivelarResultados(input, resultados, historias);
    for (const r of resultados) r.sugerencias = [...r.sugerencias, ...sugerenciasDe(input, r, nivel.get(r.employeeId) || [])];
  }
  sugerirRotacionPuesto(input, resultados);
  sugerirAlternos(input, resultados);
  aplicarReacomodoRelevante(input, resultados);
  codigosComoElMesCopiado(input, resultados);
  return resultados;
}

/**
 * Una sola convención de códigos: la del mes que se copia. Si en un puesto se cargaba M/T/N y el servicio
 * llama a la franja P5M/PLN, todo lo propuesto (ciclo, rotación, nivelación, sueltos) queda en M/T/N.
 */
function codigosComoElMesCopiado(input: ContinuarInput, resultados: ResultadoGuardia[]) {
  const usoLetra = new Map<string, number>();
  const usoFranja = new Map<string, number>();
  for (const g of [...input.guardias, ...(input.salientes || [])]) {
    for (const t of g.previos || []) {
      const pos = puestoNorm(String((t as { positionName?: string }).positionName || ''));
      const c = up(String((t as { code?: string }).code || '')).replace(/\s+/g, '');
      if (!pos || !bandaDe(c) || /D12$|N12$/.test(c)) continue;
      if (['M', 'T', 'N'].includes(c)) usoLetra.set(pos, (usoLetra.get(pos) || 0) + 1);
      else usoFranja.set(pos, (usoFranja.get(pos) || 0) + 1);
    }
  }
  const aLetra = (c: CeldaPropuesta): CeldaPropuesta => {
    const pos = puestoNorm(c.positionName);
    const code = up(c.code).replace(/\s+/g, '');
    if (c.isFranco || ['M', 'T', 'N'].includes(code) || /D12$|N12$/.test(code)) return c;
    const b = bandaDe(code);
    if (!b || (usoLetra.get(pos) || 0) <= (usoFranja.get(pos) || 0)) return c;
    return { ...c, code: b, name: b };
  };
  for (const r of resultados) {
    r.propuestas = r.propuestas.map(aLetra);
    r.sugerencias = r.sugerencias.map((sg) => {
      const celda = aLetra(sg.celda);
      if (celda === sg.celda) return sg;
      const antes = sg.celda.code;
      const cambiar = (x: string) => String(x || '').split(antes).join(celda.code);
      return { ...sg, celda, a: cambiar(sg.a), texto: cambiar(sg.texto) };
    });
  }
}

/** `continuarPuntero` del mes nuevo: quién cierra con un cambio de nivelación aceptado en su último bloque. */
export function punteroParaGuardar(resultados: ResultadoGuardia[], aceptadas: SugerenciaNivelacion[], dias: string[]): string[] {
  return punteroAlCierre(resultados.map((r) => ({
    id: r.employeeId,
    codes: Object.fromEntries(r.propuestas.map((c) => [c.dateStr, c.code])),
    aceptadas: aceptadas
      .filter((s) => s.tipo !== 'relevante' && s.celda.employeeId === r.employeeId)
      .map((s): NivelacionC2 => ({ dateStr: s.dateStr, de: s.de, a: s.a, cubre: (bandaDe(s.a) || 'T') as NivelacionC2['cubre'], texto: s.texto })),
  })), dias);
}

/** Nivelación sobre la propuesta de todos más lo ya cargado en el mes (licencias y celdas cerradas no cuentan). */
function nivelarResultados(
  input: ContinuarInput,
  resultados: ResultadoGuardia[],
  historias: Array<{ id: string; nombre: string; crudo: Array<{ idx: number; code: string }> }>,
): Map<string, NivelacionC2[]> {
  const grid = new Map<string, Map<string, string>>();
  const bloqueadas = new Set<string>();
  for (const r of resultados) {
    const row = new Map<string, string>();
    for (const c of r.propuestas) if (!c.isFranco && c.code !== 'RET') row.set(c.dateStr, c.code);
    if (input.cargado) {
      for (const d of input.dias) {
        const code = input.cargado(r.employeeId, d);
        if (!code) continue;
        row.set(d, code);
        bloqueadas.add(`${r.employeeId}|${d}`);
      }
    }
    grid.set(r.employeeId, row);
  }
  const rasgos = rasgosDeHistoria(historias, input.dias);
  const dia1 = input.dias[0];
  const puntero = input.punteroPrevio
    ?? resultados.filter((r) => rasgos.cierraConCambio.has(r.employeeId) && grid.get(r.employeeId)?.has(dia1)).map((r) => r.employeeId);
  return nivelarContraCupo({
    grid,
    orden: resultados.map((r) => r.employeeId),
    dias: input.dias,
    nombres: new Map(resultados.map((r) => [r.employeeId, r.nombre])),
    fijos: rasgos.fijos,
    cupo: input.cupoDia!,
    punteroPrevio: puntero,
    bloqueadas,
  });
}

/** Forma del borrador de la grilla (`pendingChanges`). Horario del SLA del mes nuevo, nunca el del mes anterior. */
export function cambioPendienteDe(c: CeldaPropuesta, objectiveId: string): Record<string, unknown> {
  if (c.isFranco) {
    return {
      code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true,
      positionName: 'General', objectiveId, isTemp: true, dateStr: c.dateStr,
    };
  }
  return {
    code: c.code,
    name: c.name,
    hours: c.hours,
    startTime: c.startTime,
    endTime: c.endTime,
    positionName: c.positionName,
    objectiveId,
    isFranco: false,
    isTemp: true,
    dateStr: c.dateStr,
  };
}

// ── Alertas de la vista previa ─────────────────────────────────────────────

export type AlertaDescanso = { employeeId: string; nombre: string; texto: string; toDate: string };

/**
 * Art. 197 LCT en el cambio de mes: último turno del mes anterior → primeros días propuestos.
 * `ultimosPrevios` = turnos reales (con startTime/endTime) de los últimos días del mes anterior.
 */
export function alertasDescansoCambioMes(
  ultimosPrevios: LctShiftInput[],
  resultados: ResultadoGuardia[],
  primerDia: string,
): AlertaDescanso[] {
  const nombres = new Map(resultados.map((r) => [r.employeeId, r.nombre]));
  const propuestos: LctShiftInput[] = [];
  const limite = diaIndex(primerDia) + 2;
  for (const r of resultados) {
    for (const c of r.propuestas) {
      if (c.isFranco || diaIndex(c.dateStr) > limite) continue;
      propuestos.push({ employeeId: c.employeeId, code: c.code, startTime: c.startTime, endTime: c.endTime, hours: c.hours, dateStr: c.dateStr });
    }
  }
  const conPropuesta = new Set(propuestos.map((p) => p.employeeId));
  const previos = ultimosPrevios.filter((p) => conPropuesta.has(String(p.employeeId)));
  return findLctRestGaps([...previos, ...propuestos])
    .filter((g) => g.fromDate < primerDia && g.toDate >= primerDia)
    .map((g) => ({
      employeeId: g.employeeId,
      nombre: nombres.get(g.employeeId) || g.employeeName || g.employeeId,
      toDate: g.toDate,
      texto: `${g.fromCode} del ${g.fromDate.slice(8)}/${g.fromDate.slice(5, 7)} → ${g.toCode} del ${g.toDate.slice(8)}/${g.toDate.slice(5, 7)}: ${g.gapLabel} de descanso (mín. 12 h)`,
    }));
}

export type AlertaHoras = { employeeId: string; nombre: string; horas: number };

/** Más de 200 h en el mes: lo propuesto más lo que ya tenía cargado. */
export function alertasTope(
  resultados: ResultadoGuardia[],
  horasYaCargadas: (employeeId: string) => number,
  tope = TOPE_HORAS_MES,
): AlertaHoras[] {
  return resultados
    .map((r) => ({ employeeId: r.employeeId, nombre: r.nombre, horas: Math.round((r.horasPropuestas + horasYaCargadas(r.employeeId)) * 100) / 100 }))
    .filter((a) => a.horas > tope);
}

export type CeldaDia = { dateStr: string; positionName: string; code: string };
export type AlertaCupo = { dateStr: string; positionName: string; code: string; asignados: number; cupo: number };

/** Cupo de cada turno: `quantity` del turno o, si falta, la cantidad del puesto. */
function cupoDe(pos: PuestoSla, code: string): number {
  const sh = turnoDelPuesto(pos, code);
  const q = Number(sh?.quantity);
  if (q > 0) return Math.floor(q);
  return Math.max(1, Number(pos.qty) || 1);
}

/**
 * Turnos con más gente que el cupo del SLA ese día (sobrado).
 * La falta («SLA corto») se mide con la misma cuenta de la fila COBERTURA en la página.
 */
export function sobrantesPorDia(estructura: PuestoSla[], celdas: CeldaDia[]): AlertaCupo[] {
  const cuenta = new Map<string, number>();
  for (const c of celdas) {
    const code = up(c.code);
    if (!esCodigoPuesto(code)) continue;
    const k = `${c.dateStr}|${c.positionName}|${code}`;
    cuenta.set(k, (cuenta.get(k) || 0) + 1);
  }
  const out: AlertaCupo[] = [];
  for (const [k, n] of cuenta) {
    const [dateStr, positionName, code] = k.split('|');
    const pos = estructura.find((p) => p.positionName === positionName);
    if (!pos || !turnoDelPuesto(pos, code)) continue;
    const cupo = cupoDe(pos, code);
    if (n > cupo) out.push({ dateStr, positionName, code, asignados: n, cupo });
  }
  return out.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.positionName.localeCompare(b.positionName));
}

const PALABRA_CANTIDAD = ['', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];

function palabraCantidad(n: number): string {
  return PALABRA_CANTIDAD[n] || String(n);
}

function apellidoDe(nombre: string): string {
  return String(nombre || '').split(',')[0].trim();
}

function juntarNombres(nombres: string[]): string {
  const xs = [...new Set(nombres.map(apellidoDe).filter(Boolean))];
  if (xs.length <= 1) return xs[0] || '';
  if (xs.length === 2) return `${xs[0]} y ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

function ddmm(dateStr: string): string {
  return `${dateStr.slice(8)}/${dateStr.slice(5, 7)}`;
}

export type AvisosCobertura = { lineas: string[]; accion: string; resto: number };

/**
 * Un aviso por día y puesto. Si en la misma banda sobra gente y en otra no hay nadie, es una sola frase.
 * `puestosCortos` son los días-puesto que la fila Cobertura deja abiertos.
 */
export function avisosCoberturaPuesto(
  estructura: PuestoSla[],
  celdas: Array<CeldaDia & { nombre?: string }>,
  puestosCortos: Array<{ dateStr: string; positionName: string }>,
): AvisosCobertura {
  const corto = new Set(puestosCortos.map((p) => `${p.dateStr}|${p.positionName}`));
  const porBanda = new Map<string, { nombres: string[]; n: number }>();
  const diasPos = new Set<string>(corto);
  for (const c of celdas) {
    const code = up(c.code);
    if (!esCodigoPuesto(code)) continue;
    const k = `${c.dateStr}|${c.positionName}|${code}`;
    const g = porBanda.get(k) || { nombres: [], n: 0 };
    g.n += 1;
    if (c.nombre) g.nombres.push(String(c.nombre));
    porBanda.set(k, g);
    diasPos.add(`${c.dateStr}|${c.positionName}`);
  }
  type Fila = { texto: string; accion: string; mixta: boolean };
  const filas: Fila[] = [];
  for (const dp of [...diasPos].sort()) {
    const dateStr = dp.slice(0, 10);
    const positionName = dp.slice(11);
    const pos = estructura.find((p) => p.positionName === positionName);
    if (!pos) continue;
    const codes = [...new Set((pos.shifts || []).map((s) => up(s.code)).filter(Boolean))]
      .filter((code) => turnoHabilitadoPorEstructura([pos], positionName, code, dateStr));
    const sobras: Array<{ code: string; n: number; nombres: string[] }> = [];
    const faltas: string[] = [];
    const tieneOcho = codes.some((c) => c === 'M' || c === 'T' || c === 'N');
    for (const code of codes) {
      // D12/N12 son la alternativa de 12 h: no faltan si el puesto se cubre con M, T y N.
      if (tieneOcho && (code === 'D12' || code === 'N12')) continue;
      const g = porBanda.get(`${dateStr}|${positionName}|${code}`) || { nombres: [], n: 0 };
      const cupo = cupoDe(pos, code);
      if (g.n > cupo) sobras.push({ code, n: g.n, nombres: g.nombres });
      else if (corto.has(dp) && g.n < cupo) faltas.push(code);
    }
    if (!sobras.length && !faltas.length) continue;
    const partes: string[] = [];
    for (const s of sobras) {
      const quien = juntarNombres(s.nombres);
      partes.push(quien ? `${palabraCantidad(s.n)} en ${s.code} (${quien})` : `${palabraCantidad(s.n)} en ${s.code}`);
    }
    if (sobras.length && faltas.length) {
      const ceros = faltas.filter((code) => (porBanda.get(`${dateStr}|${positionName}|${code}`)?.n || 0) === 0);
      const parciales = faltas.filter((code) => !ceros.includes(code));
      if (ceros.length === 1) partes.push(`nadie en ${ceros[0]}`);
      else if (ceros.length > 1) partes.push(`nadie en ${ceros.join(' ni en ')}`);
      if (parciales.length) partes.push(`falta ${parciales.join(' y ')}`);
    } else if (faltas.length) {
      partes.push(`falta ${faltas.join(' y ')}`);
    }
    const texto = `${ddmm(dateStr)} · ${positionName}: ${partes.join(' y ')}`;
    const mixta = sobras.length > 0 && faltas.length > 0;
    const accion = mixta
      ? `Cambiá a mano una de las ${palabraCantidad(sobras[0].n)} ${sobras[0].code} por ${faltas[0]} después de aplicar`
      : faltas.length
        ? `Asigná ${faltas.join(' y ')} a mano después de aplicar`
        : `Dejá el cupo de ${sobras[0].code} a mano después de aplicar`;
    filas.push({ texto, accion, mixta });
  }
  const accion = (filas.find((f) => f.mixta) || filas[0])?.accion || '';
  return { lineas: filas.slice(0, 5).map((f) => f.texto), accion, resto: Math.max(0, filas.length - 5) };
}

/** Días ordenados y compactados: «1, 2, 5–9, 14». */
export function textoDias(dias: string[]): string {
  const nums = [...new Set(dias.map((d) => Number(d.slice(8))))].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < nums.length; i += 1) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    partes.push(j > i + 1 ? `${nums[i]}–${nums[j]}` : j === i + 1 ? `${nums[i]}, ${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return partes.join(', ');
}

/** Resumen de una línea para el pie del modal y el toast. */
export function resumenContinuacion(resultados: ResultadoGuardia[]): {
  guardias: number; conCiclo: number; sinCiclo: number; turnos: number; francos: number; revisar: number;
} {
  let turnos = 0; let francos = 0; let revisar = 0;
  for (const r of resultados) {
    for (const c of r.propuestas) { if (c.isFranco) francos += 1; else turnos += 1; }
    revisar += r.revisar.filter((x) => !x.propuestoEn).length;
  }
  const conCiclo = resultados.filter((r) => r.ciclo).length;
  return { guardias: resultados.length, conCiclo, sinCiclo: resultados.length - conCiclo, turnos, francos, revisar };
}
