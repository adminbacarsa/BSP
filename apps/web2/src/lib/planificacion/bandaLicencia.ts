/**
 * Banda que tenía el titular el día de una licencia.
 * Si el doc guardó originalCode, esa manda.
 * Si no, la banda del puesto que quedó sin cubrir (la misma cuenta que «Puestos sin cerrar»).
 * Si falta más de una, el ciclo del titular. Nunca se asume M.
 */

export const LICENCIA_CODES = new Set(['V', 'L', 'E', 'A', 'PG', 'ART', 'AA', 'SUS', 'SGS']);
export const BANDA_TRABAJO = new Set(['M', 'T', 'N', 'D12', 'N12']);
const CODIGO_CICLO = new Set(['M', 'T', 'N', 'D12', 'N12', 'F', 'FF', 'FP']);

const CCT: Record<string, { start: string; end: string; hours: number }> = {
  M: { start: '07:00', end: '15:00', hours: 8 },
  T: { start: '15:00', end: '23:00', hours: 8 },
  N: { start: '23:00', end: '07:00', hours: 8 },
  D12: { start: '07:00', end: '19:00', hours: 12 },
  N12: { start: '19:00', end: '07:00', hours: 12 },
};

export type BandaACubrir = {
  code: string;
  positionName: string;
  scheduleLabel: string;
  hours: number;
  startTime: string;
  endTime: string;
  source: 'dia' | 'sla_faltante' | 'ciclo';
  sourceLabel: string;
};

type TurnoLike = {
  code?: unknown;
  originalCode?: unknown;
  positionName?: unknown;
  originalPositionName?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  originalStartTime?: unknown;
  originalEndTime?: unknown;
  hours?: unknown;
  employeeId?: unknown;
  isDeleted?: unknown;
  isSecondBlock?: unknown;
  origin?: unknown;
  isFranco?: unknown;
};

type EstructuraBanda = Array<{
  positionName?: string;
  shifts?: Array<{ code?: string; startTime?: string; endTime?: string; hours?: number }>;
}>;

function up(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

export function esLicencia(code: unknown): boolean {
  return LICENCIA_CODES.has(up(code));
}

export function esBandaTrabajo(code: unknown): boolean {
  return BANDA_TRABAJO.has(up(code));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hmDe(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return `${pad(Number(m[1]))}:${m[2]}`;
  }
  const d = fechaDe(v);
  if (!d) return null;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fechaDe(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (v && typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') {
      const d = o.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof o.seconds === 'number') {
      const d = new Date(o.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

/** Ventana de trabajo. El placeholder 00:00–23:59 de una novedad no cuenta. */
export function ventanaTrabajo(start: unknown, end: unknown): { start: string; end: string; hours: number } | null {
  const a = hmDe(start);
  const b = hmDe(end);
  if (!a || !b) return null;
  if (a === '00:00' && (b === '00:00' || b === '23:59')) return null;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  let mins = (bh * 60 + bm) - (ah * 60 + am);
  if (mins <= 0) mins += 24 * 60;
  if (mins >= 20 * 60) return null;
  return { start: a, end: b, hours: Math.round((mins / 60) * 100) / 100 };
}

function ymdDeFecha(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ymdLocalDeValor(v: unknown): string | null {
  const d = fechaDe(v);
  return d ? ymdDeFecha(d) : null;
}

function diaIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function sumarDias(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  cur.setDate(cur.getDate() + delta);
  return ymdDeFecha(cur);
}

function horarioSla(
  code: string,
  positionName: string,
  structure?: EstructuraBanda,
): { start: string; end: string; hours: number } {
  const pos = structure?.find((p) => String(p.positionName || '') === positionName) || structure?.[0];
  const sh = pos?.shifts?.find((s) => up(s.code) === code);
  const ventana = ventanaTrabajo(sh?.startTime, sh?.endTime);
  if (ventana) return ventana;
  const cct = CCT[code];
  if (cct) return cct;
  const hours = Number(sh?.hours) > 0 ? Number(sh?.hours) : 8;
  return { start: '07:00', end: '15:00', hours };
}

function armar(
  code: string,
  positionName: string,
  ventana: { start: string; end: string; hours: number } | null,
  structure: EstructuraBanda | undefined,
  source: BandaACubrir['source'],
  sourceLabel: string,
): BandaACubrir {
  const win = ventana || horarioSla(code, positionName, structure);
  return {
    code,
    positionName: positionName || 'General',
    scheduleLabel: `${win.start}–${win.end}`,
    hours: win.hours,
    startTime: win.start,
    endTime: win.end,
    source,
    sourceLabel,
  };
}

function codigoDelDoc(doc: TurnoLike | null | undefined): string | null {
  if (!doc || doc.isDeleted) return null;
  const orig = up(doc.originalCode);
  if (CODIGO_CICLO.has(orig)) return orig;
  const code = up(doc.code);
  if (CODIGO_CICLO.has(code)) return code;
  return null;
}

function bandaDelDoc(
  doc: TurnoLike | null | undefined,
  positionHint: string,
  structure: EstructuraBanda | undefined,
  source: BandaACubrir['source'],
  sourceLabel: string,
): BandaACubrir | null {
  if (!doc || doc.isDeleted) return null;
  const orig = up(doc.originalCode);
  const code = esBandaTrabajo(orig) ? orig : (esBandaTrabajo(doc.code) ? up(doc.code) : '');
  if (!code) return null;
  const propia = esBandaTrabajo(doc.code);
  const ventana = ventanaTrabajo(doc.originalStartTime, doc.originalEndTime)
    || (propia ? ventanaTrabajo(doc.startTime, doc.endTime) : null);
  const pos = String(doc.originalPositionName || doc.positionName || positionHint || 'General');
  return armar(code, pos, ventana, structure, source, sourceLabel);
}

/** Campos que viajan con la licencia para no perder la banda del turno de trabajo. */
export function camposBandaConservada(turno: TurnoLike | null | undefined): Record<string, string> {
  const banda = bandaDelDoc(turno, '', undefined, 'dia', '');
  if (!banda) return {};
  const pos = String(turno?.originalPositionName || turno?.positionName || '').trim();
  return {
    originalCode: banda.code,
    ...(pos ? { originalPositionName: pos } : {}),
    originalStartTime: banda.startTime,
    originalEndTime: banda.endTime,
  };
}

function docDelDia(
  empId: string,
  dateStr: string,
  shiftsMap: Record<string, TurnoLike | null | undefined>,
  pendingChanges: Record<string, TurnoLike | null | undefined>,
): TurnoLike | null {
  const key = `${empId}_${dateStr}`;
  const pending = pendingChanges[key];
  if (pending?.isDeleted) return null;
  return pending || shiftsMap[key] || null;
}

/**
 * La licencia y el turno de trabajo pueden convivir en la misma celda.
 * La grilla muestra la licencia y se queda con la banda del turno.
 */
export function elegirVistaCelda<T extends TurnoLike>(docs: T[] | null | undefined): T | null {
  const vivos = (docs || []).filter((d) => d && d.isDeleted !== true && d.isSecondBlock !== true);
  if (!vivos.length) return null;
  const licencia = [...vivos].reverse().find((d) => esLicencia(d.code));
  const trabajo = [...vivos].reverse().find((d) => esBandaTrabajo(d.code));
  if (licencia && trabajo) {
    const banda = camposBandaConservada(esBandaTrabajo(licencia.originalCode) ? licencia : trabajo);
    return { ...licencia, ...banda, code: licencia.code };
  }
  return vivos[vivos.length - 1];
}

function conocidosDelTitular(
  empId: string,
  dateStr: string,
  shiftsMap: Record<string, TurnoLike | null | undefined>,
  pendingChanges: Record<string, TurnoLike | null | undefined>,
  turnosDelDia: TurnoLike[] | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  const tomar = (dia: string, doc: TurnoLike | null | undefined) => {
    if (!doc || dia === dateStr) return;
    const code = codigoDelDoc(doc);
    if (code) out.set(dia, code);
  };
  for (let delta = -45; delta <= 45; delta++) {
    const dia = sumarDias(dateStr, delta);
    tomar(dia, docDelDia(empId, dia, shiftsMap, pendingChanges));
  }
  for (const t of turnosDelDia || []) {
    if (String(t.employeeId || '') !== empId) continue;
    const dia = ymdLocalDeValor(t.startTime);
    if (dia) tomar(dia, t);
  }
  return out;
}

/** Día equivalente del ciclo (N,N,T,T,M,M,F,F…). Null si el patrón no cierra. */
export function proyectarCiclo(conocidos: Map<string, string>, dateStr: string): string | null {
  const entries = [...conocidos.entries()].filter(([, code]) => CODIGO_CICLO.has(code));
  if (entries.length < 4) return null;
  const target = diaIndex(dateStr);
  let elegido: { p: number; code: string } | null = null;
  for (let p = 1; p <= 16; p++) {
    const buckets = new Map<number, string>();
    let ok = true;
    let checks = 0;
    for (const [dia, code] of entries) {
      const phase = ((diaIndex(dia) % p) + p) % p;
      const prev = buckets.get(phase);
      if (prev && prev !== code) { ok = false; break; }
      if (prev === code) checks++;
      buckets.set(phase, code);
    }
    if (!ok) continue;
    const phase = ((target % p) + p) % p;
    const code = buckets.get(phase);
    if (!code) continue;
    const completo = buckets.size === p || checks >= 2;
    if (!completo) continue;
    if (!elegido || p < elegido.p) elegido = { p, code };
  }
  return elegido?.code ?? null;
}

export function resolverBandaACubrir(input: {
  titularId: string;
  dateStr: string;
  shiftsMap?: Record<string, TurnoLike | null | undefined>;
  pendingChanges?: Record<string, TurnoLike | null | undefined>;
  turnosDelDia?: TurnoLike[] | null;
  positionName?: string | null;
  positionStructure?: EstructuraBanda;
  /** Bandas del puesto que «Puestos sin cerrar» marca faltantes ese día. */
  bandasFaltantes?: string[] | null;
}): BandaACubrir | null {
  const shiftsMap = input.shiftsMap || {};
  const pending = input.pendingChanges || {};
  const pos = String(input.positionName || '').trim();
  const structure = input.positionStructure;
  const doc = docDelDia(input.titularId, input.dateStr, shiftsMap, pending);
  const delDia = bandaDelDoc(doc, pos, structure, 'dia', 'Turno planificado ese día (antes de la licencia)');
  const hermano = (input.turnosDelDia || []).find((t) => {
    if (!t || t.isDeleted || t.isSecondBlock) return false;
    if (String(t.origin || '') === 'OPERATIONS_COVERAGE') return false;
    const emp = String(t.employeeId || input.titularId);
    if (emp !== input.titularId) return false;
    return esBandaTrabajo(t.code);
  });
  const delHermano = bandaDelDoc(hermano, pos, structure, 'dia', 'Turno de trabajo que quedó junto a la licencia');
  const guardada = delDia || delHermano;

  const faltantes = [...new Set((input.bandasFaltantes || []).map(up).filter((c) => esBandaTrabajo(c)))];
  if (faltantes.length === 1) {
    const code = faltantes[0];
    if (guardada && up(guardada.code) === code) return guardada;
    return armar(code, pos || guardada?.positionName || 'General', null, structure, 'sla_faltante', 'Banda del puesto que quedó sin cubrir');
  }

  if (faltantes.length > 1) {
    if (guardada && faltantes.includes(up(guardada.code))) return guardada;
    const conocidos = conocidosDelTitular(input.titularId, input.dateStr, shiftsMap, pending, input.turnosDelDia || undefined);
    const ciclo = proyectarCiclo(conocidos, input.dateStr);
    if (ciclo && esBandaTrabajo(ciclo) && faltantes.includes(ciclo)) {
      return armar(ciclo, pos || 'General', null, structure, 'ciclo', 'Ciclo del titular');
    }
    // Mismo bloque de licencia: la banda que conservaron los días vecinos (10 y 11 en N → el 12 es N).
    for (let paso = 1; paso <= 7; paso++) {
      for (const delta of [-paso, paso]) {
        const vecino = docDelDia(input.titularId, sumarDias(input.dateStr, delta), shiftsMap, pending);
        if (!vecino || !esLicencia(vecino.code)) continue;
        const banda = bandaDelDoc(vecino, pos, structure, 'ciclo', 'Misma banda que los otros días de la licencia');
        if (banda && faltantes.includes(up(banda.code))) {
          return armar(up(banda.code), pos || banda.positionName || 'General', null, structure, 'ciclo', 'Misma banda que los otros días de la licencia');
        }
      }
    }
    return null;
  }

  return guardada;
}

export function textoTurnoQueTenia(
  banda: { code?: string | null; positionName?: string | null; scheduleLabel?: string | null } | null | undefined,
): string {
  if (!banda || !esBandaTrabajo(banda.code)) return '';
  const pos = String(banda.positionName || '').trim();
  const horario = String(banda.scheduleLabel || '').trim();
  return [up(banda.code), pos, horario && horario !== '—' ? horario : ''].filter(Boolean).join(' · ');
}
