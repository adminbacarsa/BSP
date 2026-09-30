/**
 * Eventual en la app de guardias (docs/EVENTUALES-DISENO.md §7).
 * Reglas puras: claim, legajos por empresa, contratos vigentes/pasados y recorte del QR.
 */

export type EventualLegajo = {
  empresaId: string;
  employeeId: string;
  empresaNombre?: string;
};

export type ContratoEventualEstado =
  | 'BORRADOR'
  | 'DOCUMENTADO'
  | 'CONFIRMADO'
  | 'ACUSE_RECIBIDO'
  | 'ALTA_ARCA'
  | 'VIGENTE'
  | 'FINALIZADO'
  | 'BAJA_ARCA'
  | 'ANULADO'
  | 'SUSTITUIDO'
  | string;

export type JornadaContrato = {
  fecha: string;
  horaInicio?: string;
  horaFin?: string;
  horas?: number;
};

export type ContratoEventualPortal = {
  id: string;
  empresaId?: string;
  employeeId?: string;
  bolsaCuil?: string;
  causa?: string;
  estado?: ContratoEventualEstado;
  fechaAlta?: string;
  fechaBaja?: string;
  jornadas?: JornadaContrato[];
  /** Bruto estimado de la cláusula (§2.8); no es sueldo fijo. */
  brutoEstimado?: number | null;
  acuse?: { at?: unknown; uid?: string; metodo?: string } | null;
  documento?: { storagePath?: string; tipo?: string } | null;
  status?: string;
};

export type ContratoBucket = 'VIGENTE' | 'PASADO' | 'BORRADOR';

const ESTADOS_CERRADOS = new Set(['FINALIZADO', 'BAJA_ARCA', 'ANULADO', 'SUSTITUIDO']);

function normalizeKey(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/_/g, '')
    .trim();
}

/** Claim que deja `crearAccesoEventual`: `{ role: 'EVENTUAL', type: 'eventual', bolsaCuil }`. */
export function isEventualClaims(claims: Record<string, unknown> | null | undefined): boolean {
  if (!claims) return false;
  return normalizeKey(claims.role) === 'eventual' || normalizeKey(claims.type) === 'eventual';
}

export function bolsaCuilFromClaims(claims: Record<string, unknown> | null | undefined): string | null {
  const raw = String(claims?.bolsaCuil ?? '').trim();
  return raw || null;
}

/** Fecha AR `YYYY-MM-DD` del instante dado. */
export function todayKeyAr(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function contratoEstadoLabel(estado: ContratoEventualEstado | undefined): string {
  switch (String(estado || '').toUpperCase()) {
    case 'BORRADOR':
      return 'Borrador';
    case 'DOCUMENTADO':
      return 'Documentado';
    case 'CONFIRMADO':
      return 'Confirmado';
    case 'ACUSE_RECIBIDO':
      return 'Acuse recibido';
    case 'ALTA_ARCA':
      return 'Alta ARCA confirmada';
    case 'VIGENTE':
      return 'Vigente';
    case 'FINALIZADO':
      return 'Finalizado';
    case 'BAJA_ARCA':
      return 'Baja ARCA';
    case 'ANULADO':
      return 'Anulado';
    case 'SUSTITUIDO':
      return 'Sustituido';
    default:
      return estado ? String(estado) : '—';
  }
}

/**
 * Vigente = no cerrado y con `fechaBaja` ≥ hoy (o sin baja). Borrador queda aparte.
 * Pasado = cerrado o con `fechaBaja` anterior a hoy.
 */
export function clasificarContratoEventual(
  c: Pick<ContratoEventualPortal, 'estado' | 'fechaAlta' | 'fechaBaja' | 'status'>,
  hoyKey: string,
): ContratoBucket {
  const estado = String(c.estado || '').toUpperCase();
  if (String(c.status || '').toUpperCase() === 'INACTIVE') return 'PASADO';
  if (ESTADOS_CERRADOS.has(estado)) return 'PASADO';
  if (estado === 'BORRADOR') return 'BORRADOR';
  const baja = String(c.fechaBaja || '').slice(0, 10);
  if (baja && baja < hoyKey) return 'PASADO';
  return 'VIGENTE';
}

export function acuseRecibido(c: Pick<ContratoEventualPortal, 'acuse' | 'estado'>): boolean {
  if (c.acuse && (c.acuse.at != null || c.acuse.uid)) return true;
  return String(c.estado || '').toUpperCase() === 'ACUSE_RECIBIDO';
}

/** El acuse se pide una vez, sobre un contrato que ya existe como documento y no está cerrado. */
export function puedeAcusarRecibo(
  c: Pick<ContratoEventualPortal, 'acuse' | 'estado' | 'fechaAlta' | 'fechaBaja' | 'status'>,
  hoyKey: string,
): boolean {
  if (acuseRecibido(c)) return false;
  const bucket = clasificarContratoEventual(c, hoyKey);
  if (bucket !== 'VIGENTE') return false;
  return String(c.estado || '').toUpperCase() !== 'BORRADOR';
}

export function horasContrato(c: Pick<ContratoEventualPortal, 'jornadas'>): number {
  return (c.jornadas || []).reduce((acc, j) => acc + (Number(j.horas) || 0), 0);
}

function fmtKey(key: string | undefined): string {
  const k = String(key || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  if (!m) return k || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function periodoContratoLabel(c: Pick<ContratoEventualPortal, 'fechaAlta' | 'fechaBaja'>): string {
  const alta = fmtKey(c.fechaAlta);
  const baja = fmtKey(c.fechaBaja);
  if (alta === baja) return alta;
  return `${alta} – ${baja}`;
}

export function formatBrutoArs(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

/** Contrato vigente que manda en el QR: el que empieza antes entre los vigentes. */
export function contratoVigenteParaCredencial(
  contratos: ContratoEventualPortal[],
  hoyKey: string,
): ContratoEventualPortal | null {
  const vigentes = contratos
    .filter((c) => clasificarContratoEventual(c, hoyKey) === 'VIGENTE')
    .sort((a, b) => String(a.fechaAlta || '').localeCompare(String(b.fechaAlta || '')));
  return vigentes[0] ?? null;
}

export type CredencialContratoPublica = {
  empresaId: string | null;
  empresaNombre: string;
  fechaAlta: string | null;
  fechaBaja: string | null;
  estado: string;
};

/**
 * Recorte para `credenciales_publicas` (§0.5.4 / §3.5): empresa prestadora y vigencia.
 * Nunca domicilio, remuneración ni datos médicos.
 */
export function credencialContratoPublico(
  c: ContratoEventualPortal | null,
  empresaNombre: string | undefined,
): CredencialContratoPublica | null {
  if (!c) return null;
  return {
    empresaId: c.empresaId ?? null,
    empresaNombre: (empresaNombre || c.empresaId || 'Empresa').trim(),
    fechaAlta: c.fechaAlta ? String(c.fechaAlta).slice(0, 10) : null,
    fechaBaja: c.fechaBaja ? String(c.fechaBaja).slice(0, 10) : null,
    estado: contratoEstadoLabel(c.estado),
  };
}

const CAMPOS_SENSIBLES = new Set([
  'domicilio',
  'direccion',
  'address',
  'telefono',
  'phone',
  'email',
  'mail',
  'sueldo',
  'bruto',
  'brutoEstimado',
  'remuneracion',
  'salario',
  'cbu',
  'obraSocial',
  'obraSocialRnos',
  'aptoDetalle',
]);

/** Deja fuera del doc público cualquier dato sensible (Ley 25.326). */
export function sinDatosSensibles<T extends Record<string, unknown>>(doc: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (CAMPOS_SENSIBLES.has(k)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Legajo del eventual para la empresa del turno; sin empresa, el primero. */
export function legajoParaEmpresa(
  legajos: EventualLegajo[],
  empresaId: string | null | undefined,
): EventualLegajo | null {
  const id = String(empresaId || '').trim();
  if (id) {
    const match = legajos.find((l) => l.empresaId === id);
    if (match) return match;
  }
  return legajos[0] ?? null;
}

/** Etiqueta de empresa para la tarjeta del turno (por `empresaId` o por el legajo dueño). */
export function empresaLabelDeTurno(
  shift: { empresaId?: string | null; employeeId?: string | null },
  legajos: EventualLegajo[],
  nombres: Record<string, string> = {},
): string | null {
  const emp = String(shift.employeeId || '').trim();
  const id =
    String(shift.empresaId || '').trim() ||
    (emp ? String(legajos.find((l) => l.employeeId === emp)?.empresaId || '') : '');
  if (!id) return null;
  const nombre = nombres[id] || legajos.find((l) => l.empresaId === id)?.empresaNombre;
  return (nombre || id).trim() || null;
}

/** El turno pertenece a alguno de los legajos del eventual (o al uid). */
export function turnoEsDelEventual(
  shift: { employeeId?: string | null },
  legajos: EventualLegajo[],
  authUid: string | null | undefined,
): boolean {
  const emp = String(shift.employeeId || '').trim();
  if (!emp) return false;
  if (authUid && emp === authUid) return true;
  return legajos.some((l) => l.employeeId === emp);
}
