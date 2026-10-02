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
  /** Desempate después de la distancia y la confiabilidad. */
  puntaje?: number;
  elegible?: boolean;
  motivo?: string;
  /** Ficha con «Exigir contrato marco y habilitación» en OFF: convocable sin marco ni empresa habilitada. */
  pruebasSinMarco?: boolean;
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
  puntaje?: number;
  uid?: string;
  legajos?: { employeeId?: string; empresaId?: string }[];
  marcos?: Record<string, { firmado?: boolean; vencimiento?: string; estado?: string; fechaFirma?: string }>;
  /** Switch de pruebas de la ficha. Ausente = true. */
  exigirMarco?: boolean;
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
    const exigeMarco = row.exigirMarco !== false;
    if (exigeMarco && !(row.empresasHabilitadas || []).includes(hueco.empresaId)) continue;
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
    const marcoOk = !exigeMarco || (marco?.firmado === true
      && marco.estado !== 'VENCIDO'
      && marco.estado !== 'SIN_MARCO'
      && (!marco.vencimiento || String(marco.vencimiento) >= hoy));
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
      ...(typeof row.puntaje === 'number' ? { puntaje: row.puntaje } : {}),
      elegible: marcoOk,
      ...(marcoOk ? {} : { motivo: 'Sin contrato marco' }),
      ...(exigeMarco ? {} : { pruebasSinMarco: true, motivo: 'Pruebas: sin exigir marco' }),
    });
  }
  out.sort((a, b) => {
    const da = a.distanceKm == null ? Number.POSITIVE_INFINITY : a.distanceKm;
    const db = b.distanceKm == null ? Number.POSITIVE_INFINITY : b.distanceKm;
    if (da !== db) return da - db;
    if (a.confiabilidad !== b.confiabilidad) return b.confiabilidad - a.confiabilidad;
    if (typeof a.puntaje === 'number' && typeof b.puntaje === 'number' && a.puntaje !== b.puntaje) return b.puntaje - a.puntaje;
    return a.employeeName.localeCompare(b.employeeName, 'es');
  });
  return out;
}

/**
 * Qué hacer con ARCA cuando el eventual no va a trabajar.
 * `puedeAnular` lo calcula `plazoAnulacionAlta` (RG 2988/2010 art. 9). La anulación es el
 * módulo de Anulación de Incorporaciones: no lleva código de motivo. Vencida la ventana, baja.
 */
export type EventualAusenteArca = {
  accion: 'CANCELAR_AT' | 'ANULACION' | 'BAJA';
  tipo: 'ANULACION' | 'BAJA_NO_PRESENTACION' | null;
  movimiento: string | null;
  canal: 'URGENTE' | null;
  /** Anulación: sin remuneración. */
  bruto: number | null;
  fechaBaja: string | null;
  revista: string | null;
  motivo: string | null;
  modulo: string | null;
  constanciaInterna: string | null;
};

export type DesempenoEventualTipo = 'CANCELACION_ANTICIPADA' | 'CANCELACION_TARDIA' | 'FALTA_SIN_AVISO';

export type EventualAusentePlan = {
  employeeId: string;
  empresaAltaId: string;
  eventoId: string;
  shiftId: string;
  neverStarted: boolean;
  /** No se paga la jornada (AA / turno cancelado). */
  descuentaLiquidacion: true;
  confiabilidadDelta: -1;
  arcaBajaPendiente: boolean;
  aviso: boolean;
  desempeno: DesempenoEventualTipo;
  arca: EventualAusenteArca;
};

export function planEventualAusente(input: {
  employeeId?: string;
  empresaAltaId?: string;
  eventoId?: string;
  shiftId?: string;
  isEventual?: boolean;
  punched?: boolean;
  /** Avisó que no va (app), antes del inicio. Sin esto es falta sin aviso. */
  aviso?: boolean;
  /** El AT ya se subió (SUBIENDO o CONFIRMADO). */
  atSubido?: boolean;
  inicioMs?: number;
  ahoraMs?: number;
  /** YYYY-MM-DD del inicio fijado. La baja usa este día, no el fin del contrato. */
  fechaInicio?: string;
  /** Resultado de `plazoAnulacionAlta`. Sin este dato no se anula: queda la baja. */
  puedeAnular?: boolean;
  /** Código de revista de la baja por desistimiento. `empresas.arcaEventuales.situacionRevistaDesistimiento`. */
  revistaDesistimiento?: string;
  /** Alias histórico del código de revista. */
  revistaNoInicio?: string;
}): EventualAusentePlan | null {
  if (input.isEventual !== true) return null;
  const employeeId = String(input.employeeId || '').trim();
  const empresaAltaId = String(input.empresaAltaId || '').trim();
  if (!employeeId || !empresaAltaId) return null;
  const neverStarted = input.punched !== true;
  const aviso = input.aviso === true;
  const inicioMs = Number(input.inicioMs) || 0;
  const ahoraMs = Number(input.ahoraMs) || 0;
  const vacio = { modulo: null, constanciaInterna: null };
  const arca: EventualAusenteArca = input.atSubido !== true
    ? { accion: 'CANCELAR_AT', tipo: null, movimiento: null, canal: null, bruto: null, fechaBaja: null, revista: null, motivo: null, ...vacio }
    : input.puedeAnular === true
      ? {
        accion: 'ANULACION', tipo: 'ANULACION', movimiento: null, canal: 'URGENTE', bruto: 0,
        fechaBaja: null, revista: null, motivo: null, modulo: 'ANULACION_INCORPORACIONES', constanciaInterna: 'NO_SE_PRESENTO',
      }
      : {
        accion: 'BAJA',
        tipo: 'BAJA_NO_PRESENTACION',
        movimiento: 'BT',
        canal: 'URGENTE',
        bruto: null,
        fechaBaja: String(input.fechaInicio || ''),
        revista: String(input.revistaDesistimiento || input.revistaNoInicio || '30'),
        motivo: 'desistimiento / sin efectivización de tareas',
        modulo: null,
        constanciaInterna: 'NO_SE_PRESENTO',
      };
  const horasAntes = inicioMs > 0 ? (inicioMs - ahoraMs) / 3600000 : 0;
  const desempeno: DesempenoEventualTipo = aviso
    ? (horasAntes >= 24 ? 'CANCELACION_ANTICIPADA' : 'CANCELACION_TARDIA')
    : 'FALTA_SIN_AVISO';
  return {
    employeeId,
    empresaAltaId,
    eventoId: String(input.eventoId || ''),
    shiftId: String(input.shiftId || ''),
    neverStarted,
    descuentaLiquidacion: true,
    confiabilidadDelta: -1,
    arcaBajaPendiente: neverStarted,
    aviso,
    desempeno,
    arca,
  };
}
