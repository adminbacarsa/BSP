/**
 * «Continuar desde el mes anterior»: lee el ciclo de cada guardia en las últimas
 * semanas (solo sus turnos de puesto y francos en este objetivo) y lo sigue en el
 * mes nuevo desde donde quedó. No copia día por número.
 *
 * Lógica pura: la página arma los datos (turnos previos, celdas ocupadas, días
 * bloqueados, estructura del SLA del mes nuevo) y aplica el resultado como borrador.
 */
import { LICENCIA_CODES, ventanaTrabajo } from './bandaLicencia';
import { findLctRestGaps, type LctShiftInput } from './lctRestGap';

export const ORIGEN_CONTINUAR_MES = 'CONTINUAR_MES_ANTERIOR' as const;
export const TOPE_HORAS_MES = 200;

/** Lo que no es parte del ciclo del guardia (puntual o cobertura). El RET planificado se evalúa aparte. */
const NO_CICLO = new Set([
  'REF', 'ESC', 'FT', 'RFZ', 'TURA', 'EV', 'AVISO', 'AUS', 'VAC', 'SUP', 'COB', 'EXT', 'ADV', 'ADEL',
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

export type ResultadoGuardia = {
  employeeId: string;
  nombre: string;
  ciclo: CicloDetectado | null;
  /** «continúa en T (2.º de 6)». */
  continuaEn: string;
  motivoSinCiclo: string | null;
  propuestas: CeldaPropuesta[];
  omitidas: { licencia: number; ocupada: number; bloqueada: number; sinDato: number; excluida: number };
  revisar: RevisarPuesto[];
  horasPropuestas: number;
};

export type EstadoCelda = 'licencia' | 'ocupada' | null;

export type ContinuarInput = {
  objectiveId: string;
  /** Días del mes nuevo (YYYY-MM-DD), en orden. */
  dias: string[];
  guardias: Array<{ id: string; nombre: string; previos: TurnoPrevio[] }>;
  estructura: PuestoSla[];
  /** Licencia cargada o celda con algo (turno, borrador). No se pisa. */
  estadoCelda: (employeeId: string, dateStr: string) => EstadoCelda;
  /** Día cerrado, fuera de la vigencia del servicio, etc. */
  diaBloqueado?: (dateStr: string) => boolean;
  /** El SLA habilita ese turno ese día (días de la semana, exclusiones). Default: por la estructura. */
  turnoHabilitado?: (positionName: string, code: string, dateStr: string) => boolean;
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
  if (t.isExtended === true || t.isEarlyStart === true || t.isFrancoTrabajado === true) return null;
  const code = up(t.code);
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
  return ciclo.fases[mod(diaIndex(dateStr), ciclo.periodo)] || null;
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

function turnoDelPuesto(pos: PuestoSla | undefined, code: string) {
  return (pos?.shifts || []).find((s) => up(s.code) === code) || null;
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

export function turnoHabilitadoPorEstructura(estructura: PuestoSla[], positionName: string, code: string, dateStr: string): boolean {
  const pos = estructura.find((p) => p.positionName === positionName);
  if (!pos) return false;
  if ((pos.excludedDates || []).includes(dateStr)) return false;
  if ((pos.excludedShiftDates?.[dateStr] || []).map(up).includes(code)) return false;
  const sh = turnoDelPuesto(pos, code);
  if (!sh) return false;
  if (Array.isArray(sh.specificDates) && sh.specificDates.length > 0 && !sh.specificDates.includes(dateStr)) return false;
  if (Array.isArray(sh.days) && sh.days.length > 0 && !sh.days.includes(letraDia(dateStr))) return false;
  return true;
}

const CCT: Record<string, { start: string; end: string; hours: number }> = {
  M: { start: '07:00', end: '15:00', hours: 8 },
  T: { start: '15:00', end: '23:00', hours: 8 },
  N: { start: '23:00', end: '07:00', hours: 8 },
  D12: { start: '07:00', end: '19:00', hours: 12 },
  N12: { start: '19:00', end: '07:00', hours: 12 },
};

/** Puesto del mes nuevo para ese turno. Si el del mes anterior ya no está, el único que lo ofrece. */
function resolverPuesto(estructura: PuestoSla[], positionName: string, code: string):
  { pos: PuestoSla; reasignadoDe?: string } | { motivo: string } {
  const mismo = estructura.find((p) => p.positionName === positionName);
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
  return {
    employeeId,
    dateStr,
    code: String(sh.code || code),
    name: String(sh.name || sh.code || code),
    positionName: pos.positionName,
    startTime: win.start,
    endTime: win.end,
    hours,
    isFranco: false,
  };
}

export function proponerGuardia(input: ContinuarInput, g: ContinuarInput['guardias'][number]): ResultadoGuardia {
  const res: ResultadoGuardia = {
    employeeId: g.id,
    nombre: g.nombre,
    ciclo: null,
    continuaEn: '',
    motivoSinCiclo: null,
    propuestas: [],
    omitidas: { licencia: 0, ocupada: 0, bloqueada: 0, sinDato: 0, excluida: 0 },
    revisar: [],
    horasPropuestas: 0,
  };
  const obs = observacionesDelGuardia(g.previos, input.objectiveId);
  if (obs.length === 0) {
    res.motivoSinCiclo = 'No trabajó en este objetivo en las últimas semanas';
    return res;
  }
  const ciclo = detectarCiclo(obs);
  if (!ciclo) {
    res.motivoSinCiclo = obs.length < 6
      ? `Pocos días para leer el ciclo (${obs.length})`
      : 'El ciclo no se repite (cambios a mano o esquema irregular)';
    return res;
  }
  res.ciclo = ciclo;
  res.continuaEn = input.dias.length ? textoContinuaEn(ciclo, input.dias[0]) : '';
  const habilitado = input.turnoHabilitado
    || ((pos: string, code: string, ds: string) => turnoHabilitadoPorEstructura(input.estructura, pos, code, ds));
  const revisar = new Map<string, RevisarPuesto>();
  for (const dateStr of input.dias) {
    if (input.diaBloqueado?.(dateStr)) { res.omitidas.bloqueada += 1; continue; }
    const estado = input.estadoCelda(g.id, dateStr);
    if (estado === 'licencia') { res.omitidas.licencia += 1; continue; }
    if (estado === 'ocupada') { res.omitidas.ocupada += 1; continue; }
    const dia = diaDelCiclo(ciclo, dateStr);
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
    const r = resolverPuesto(input.estructura, dia.positionName, dia.code);
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

export function proponerContinuacion(input: ContinuarInput): ResultadoGuardia[] {
  return input.guardias.map((g) => proponerGuardia(input, g));
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
    for (const code of codes) {
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
