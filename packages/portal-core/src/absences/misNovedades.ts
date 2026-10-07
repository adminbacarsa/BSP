/**
 * «Mis novedades» del portal: qué se lista, cómo se dice el estado y quién puede verla.
 * Sirve para el legajo de nómina y para el eventual (varios legajos + bolsaCuil).
 * La vista previa de SuperAdmin no mezcla el uid del admin.
 */

export type NovedadComoDoc = {
  id?: string;
  type?: unknown;
  absenceType?: unknown;
  status?: unknown;
  revisionEstado?: unknown;
  reason?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  hasCertificate?: unknown;
  certificateUrl?: unknown;
  certificateDriveLink?: unknown;
  employeeId?: unknown;
  bolsaCuil?: unknown;
  employeeName?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  historial?: unknown;
  source?: unknown;
  certificadoIa?: { decision?: unknown } | null;
};

export type HistorialLinea = {
  texto: string;
  por: string;
  at: unknown;
};

const CERRADA = new Set(['rechazada', 'rejected', 'cancelada', 'cancelled', 'anulada']);

function texto(value: unknown): string {
  return String(value ?? '').trim();
}

function tieneCertificado(doc: NovedadComoDoc): boolean {
  return doc.hasCertificate === true || !!texto(doc.certificateUrl) || !!texto(doc.certificateDriveLink);
}

function pideCertificado(doc: NovedadComoDoc): boolean {
  const type = texto(doc.type).toLowerCase();
  const code = texto(doc.absenceType).toUpperCase();
  return type.includes('enferm') || type === 'art' || type.includes(' art') || code === 'E';
}

export function diaCorto(value: unknown): string {
  const raw = texto(value).slice(0, 10);
  const [y, m, d] = raw.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

export function rangoDias(doc: Pick<NovedadComoDoc, 'startDate' | 'endDate'>): string {
  const desde = diaCorto(doc.startDate);
  const hasta = diaCorto(doc.endDate) || desde;
  if (!desde) return '';
  return hasta === desde ? desde : `${desde} → ${hasta}`;
}

/** Estados en palabras. El de revisión de RRHH no se muestra como código. */
export function estadoNovedadEnPalabras(doc: NovedadComoDoc): string {
  const status = texto(doc.status);
  const statusLow = status.toLowerCase();
  if (CERRADA.has(statusLow)) return 'Rechazada';
  if (status === 'Justificada') {
    const tipo = texto(doc.type) || 'ausencia';
    return `Justificada (${tipo})`;
  }
  if (status === 'Injustificada' || texto(doc.revisionEstado).toUpperCase() === 'INJUSTIFICADA') {
    return 'Injustificada';
  }
  const decision = texto((doc.certificadoIa as { decision?: unknown } | null)?.decision).toUpperCase();
  if (decision === 'RECIBIDO') return 'Certificado recibido';
  if (status === 'En verificación') return 'Certificado en verificación';
  if (pideCertificado(doc) && !tieneCertificado(doc)) return 'Falta certificado';
  return 'Registrada · RRHH revisando';
}

export function puedeSubirCertificado(doc: NovedadComoDoc): boolean {
  const statusLow = texto(doc.status).toLowerCase();
  if (CERRADA.has(statusLow)) return false;
  if (texto(doc.status) === 'Justificada' && tieneCertificado(doc)) return false;
  return !tieneCertificado(doc) || texto(doc.status) === 'En verificación';
}

export function millisNovedad(doc: NovedadComoDoc): number {
  const created = doc.createdAt as { seconds?: number; _seconds?: number; toMillis?: () => number } | string | number | null;
  if (created && typeof created === 'object') {
    if (typeof created.toMillis === 'function') return created.toMillis();
    const seconds = created.seconds ?? created._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  if (typeof created === 'number') return created;
  if (typeof created === 'string') {
    const ms = Date.parse(created);
    if (Number.isFinite(ms)) return ms;
  }
  const day = Date.parse(texto(doc.startDate));
  return Number.isFinite(day) ? day : 0;
}

export function ordenarNovedades<T extends NovedadComoDoc>(rows: T[]): T[] {
  return [...rows].sort((a, b) => millisNovedad(b) - millisNovedad(a));
}

const INTERNO = /revisionEstado|cascadeLock|AVISO_PORTAL|ausenciaId|\bPOR_REVISAR\b|\bJUSTIFICADA\b|\bINJUSTIFICADA\b/;

export function historialVisible(doc: NovedadComoDoc): HistorialLinea[] {
  const raw = Array.isArray(doc.historial) ? doc.historial : [];
  const lineas: HistorialLinea[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { texto?: unknown; por?: unknown; at?: unknown };
    const label = texto(row.texto);
    if (!label || INTERNO.test(label)) continue;
    lineas.push({ texto: label, por: texto(row.por), at: row.at ?? null });
  }
  if (lineas.length === 0) {
    lineas.push({
      texto: estadoNovedadEnPalabras(doc),
      por: '',
      at: doc.updatedAt || doc.createdAt || null,
    });
  }
  return lineas;
}

export type ClavesLectura = {
  employeeIds: string[];
  bolsaCuil: string | null;
};

/**
 * Consultas de igualdad (employeeId o bolsaCuil). En vista previa no entra el uid
 * del SuperAdmin: solo el legajo y el CUIL de la persona que se está mirando.
 */
export function clavesDeLectura(input: {
  uid?: string | null;
  empDocId?: string | null;
  legajoIds?: Array<string | null | undefined>;
  bolsaCuil?: string | null;
  preview?: boolean;
}): ClavesLectura {
  const ids: string[] = [];
  const push = (value: string | null | undefined) => {
    const id = texto(value);
    if (id && !ids.includes(id)) ids.push(id);
  };
  if (!input.preview) push(input.uid);
  push(input.empDocId);
  for (const id of input.legajoIds || []) push(id);
  const cuil = texto(input.bolsaCuil).replace(/\D/g, '');
  return { employeeIds: ids, bolsaCuil: cuil || null };
}

/** Campos que el portal puede pisar al adjuntar un certificado. Nada de estado ni tipo. */
export const CAMPOS_CERTIFICADO_PORTAL = [
  'certificateUrl',
  'certificateName',
  'certificateStoragePath',
  'certificateUploadedAt',
  'hasCertificate',
] as const;
