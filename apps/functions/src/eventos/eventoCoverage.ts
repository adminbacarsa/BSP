/**
 * Hueco de evento en el CC. Espejo en functions/src/eventos/eventoCoverage.ts.
 * Un evento es `code === 'EV'` u `origin === 'EVENTO'`. Un eventoId suelto en M/T/N no lo es.
 */

/**
 * Hueco de evento: el eventual va primero (no genera recargo de FT).
 * Hueco de objetivo: RET, REF, ESC, Ext + Adel, eventuales y después FT.
 * Son constantes para poder invertirlas si Mauro confirma otro orden.
 */
export const EVENT_COVERAGE_CASCADE_ORDER = ['EVENTUAL', 'REF', 'ESC', 'EXTEND', 'ADVANCE', 'FT'] as const;

export const OBJECTIVE_COVERAGE_WITH_EVENTUAL = ['RET', 'REF', 'ESC', 'EXTEND', 'ADVANCE', 'EVENTUAL', 'FT'] as const;

export type EventualCandidato = {
  employeeId: string;
  employeeName: string;
  cuil: string;
  uid?: string;
  distanceKm: number | null;
  confiabilidad: number;
  elegible?: boolean;
  motivo?: string;
};

export type EventualBolsaRow = {
  cuil: string;
  nombre?: string;
  disponibilidad?: string;
  empresasHabilitadas?: string[];
  credencialVencimiento?: string;
  aptoPsicofisico?: { estado?: string; vencimiento?: string };
  domicilioGeo?: { lat?: number; lng?: number } | null;
  confiabilidad?: number;
  uid?: string;
  legajos?: { employeeId?: string; empresaId?: string }[];
  marcos?: Record<string, { firmado?: boolean; vencimiento?: string; estado?: string; fechaFirma?: string }>;
};

export type EventualHueco = {
  empresaId: string;
  startMs: number;
  endMs: number;
  lat?: number | null;
  lng?: number | null;
  /** Día AR YYYY-MM-DD para vigencia de credencial y apto. */
  hoyYmd: string;
};

export type EventualJornadaOcupada = {
  cuil: string;
  empresaId?: string;
  startMs: number;
  endMs: number;
};

export type EventualesHuecoInput = {
  bolsa?: EventualBolsaRow[];
  hueco?: EventualHueco;
  otrasJornadas?: EventualJornadaOcupada[];
};

export function isEventoShift(shift: object | null | undefined): boolean {
  if (!shift) return false;
  const row = shift as { code?: unknown; origin?: unknown };
  const code = String(row.code || '').trim().toUpperCase();
  const origin = String(row.origin || '').trim().toUpperCase();
  return code === 'EV' || origin === 'EVENTO';
}

/** Solo si el evento define franjas encadenadas aplica la serie/relevo. Si no, no se retiene. */
export function eventoTieneFranjasEncadenadas(shift: object | null | undefined): boolean {
  if (!shift) return false;
  return (shift as { eventoFranjasEncadenadas?: unknown }).eventoFranjasEncadenadas === true;
}

const REST_MS = 12 * 60 * 60 * 1000;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

function vigente(fecha: string | undefined, hoy: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) && String(fecha) >= hoy;
}

/**
 * Misma regla que `bloqueoCruce`: la jornada nueva se marca como otra empresa,
 * así el descanso de 12 h corre contra cualquier jornada del grupo.
 * Superposición siempre bloquea.
 */
export function bloqueoCruceEventual(
  nueva: { empresaId: string; startMs: number; endMs: number },
  otras: { empresaId?: string; startMs: number; endMs: number }[],
): { ok: boolean; codigo?: 'SUPERPOSICION' | 'DESCANSO_12H' } {
  if (!nueva.startMs || !nueva.endMs || nueva.endMs <= nueva.startMs) return { ok: false, codigo: 'SUPERPOSICION' };
  const todos = [
    ...otras.filter((o) => o.startMs && o.endMs && o.endMs > o.startMs).map((o) => ({ ...o, empresaId: String(o.empresaId || '') })),
    { startMs: nueva.startMs, endMs: nueva.endMs, empresaId: 'NUEVA' },
  ].sort((a, b) => a.startMs - b.startMs);
  for (const o of otras) {
    if (nueva.startMs < o.endMs && o.startMs < nueva.endMs) return { ok: false, codigo: 'SUPERPOSICION' };
  }
  for (let i = 1; i < todos.length; i += 1) {
    const descanso = todos[i].startMs - todos[i - 1].endMs;
    const tocaNueva = todos[i].empresaId === 'NUEVA' || todos[i - 1].empresaId === 'NUEVA';
    if (tocaNueva && descanso >= 0 && descanso < REST_MS && todos[i].empresaId !== todos[i - 1].empresaId) {
      return { ok: false, codigo: 'DESCANSO_12H' };
    }
  }
  return { ok: true };
}

/**
 * Candidatos de la bolsa para un hueco. Sin input, lista vacía.
 * Orden: distancia al objetivo (sin geo al final) y después confiabilidad.
 */
export function eventualesParaHueco(input?: EventualesHuecoInput | null): EventualCandidato[] {
  const hueco = input?.hueco;
  const bolsa = input?.bolsa || [];
  if (!hueco?.empresaId || !hueco.startMs || !hueco.endMs) return [];
  const hoy = String(hueco.hoyYmd || '');
  const otras = input?.otrasJornadas || [];
  const out: EventualCandidato[] = [];
  for (const row of bolsa) {
    const cuil = String(row.cuil || '').trim();
    if (!cuil) continue;
    if (String(row.disponibilidad || 'DISPONIBLE').toUpperCase() !== 'DISPONIBLE') continue;
    if (!(row.empresasHabilitadas || []).includes(hueco.empresaId)) continue;
    if (!vigente(row.credencialVencimiento, hoy)) continue;
    const apto = row.aptoPsicofisico || {};
    if (String(apto.estado || '').trim().toUpperCase() !== 'APTO') continue;
    if (!vigente(apto.vencimiento, hoy)) continue;
    const cruce = bloqueoCruceEventual(
      { empresaId: hueco.empresaId, startMs: hueco.startMs, endMs: hueco.endMs },
      otras.filter((j) => j.cuil === cuil),
    );
    if (!cruce.ok) continue;
    const marco = (row.marcos || {})[hueco.empresaId];
    const marcoOk = marco?.firmado === true
      && marco.estado !== 'VENCIDO'
      && marco.estado !== 'SIN_MARCO'
      && (!marco.vencimiento || String(marco.vencimiento) >= hoy);
    const geo = row.domicilioGeo;
    const distanceKm = geo && hueco.lat != null && hueco.lng != null && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)
      ? Math.round(haversineKm(Number(geo.lat), Number(geo.lng), Number(hueco.lat), Number(hueco.lng)) * 10) / 10
      : null;
    const legajo = (row.legajos || []).find((l) => String(l.empresaId || '') === hueco.empresaId && String(l.employeeId || '').trim());
    out.push({
      employeeId: String(legajo?.employeeId || cuil),
      employeeName: String(row.nombre || cuil),
      cuil,
      ...(row.uid ? { uid: String(row.uid) } : {}),
      distanceKm,
      confiabilidad: Number(row.confiabilidad) || 0,
      elegible: marcoOk,
      ...(marcoOk ? {} : { motivo: 'Sin contrato marco' }),
    });
  }
  out.sort((a, b) => {
    const da = a.distanceKm == null ? Number.POSITIVE_INFINITY : a.distanceKm;
    const db = b.distanceKm == null ? Number.POSITIVE_INFINITY : b.distanceKm;
    if (da !== db) return da - db;
    if (a.confiabilidad !== b.confiabilidad) return b.confiabilidad - a.confiabilidad;
    return a.employeeName.localeCompare(b.employeeName, 'es');
  });
  return out;
}

/**
 * Eventual que no se presentó. Diseño, sin alta/baja ARCA.
 * La AA queda en el legajo de la empresa que lo dio de alta, se descuenta de la liquidación
 * y baja su confiabilidad en la bolsa. Si nunca fichó, RRHH tiene pendiente anular el alta.
 */
export type EventualAusentePlan = {
  employeeId: string;
  empresaAltaId: string;
  eventoId: string;
  shiftId: string;
  neverStarted: boolean;
  descuentaLiquidacion: true;
  confiabilidadDelta: -1;
  arcaBajaPendiente: boolean;
};

export function planEventualAusente(input: {
  employeeId?: string;
  empresaAltaId?: string;
  eventoId?: string;
  shiftId?: string;
  isEventual?: boolean;
  punched?: boolean;
}): EventualAusentePlan | null {
  if (input.isEventual !== true) return null;
  const employeeId = String(input.employeeId || '').trim();
  const empresaAltaId = String(input.empresaAltaId || '').trim();
  if (!employeeId || !empresaAltaId) return null;
  const neverStarted = input.punched !== true;
  return {
    employeeId,
    empresaAltaId,
    eventoId: String(input.eventoId || ''),
    shiftId: String(input.shiftId || ''),
    neverStarted,
    descuentaLiquidacion: true,
    confiabilidadDelta: -1,
    arcaBajaPendiente: neverStarted,
  };
}
