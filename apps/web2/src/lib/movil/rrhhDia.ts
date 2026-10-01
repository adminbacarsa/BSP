export type AusenciaDia = {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  hasCertificate?: boolean;
  certificateUrl?: string | null;
  employeeId?: string;
  /** Código de grilla (`AA`, `E`, `L`…) si el doc lo trae. */
  absenceType?: string;
  /** Turno vinculado (ausencia automática). */
  shiftId?: string | null;
};

function medica(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes('enferm') || t === 'art' || t.includes('art');
}

/** Tarjetas del día: sin KPIs ni plantilla. */
export function resumenDiaRrhh(hoy: string, rows: AusenciaDia[]) {
  const vivas = rows.filter((row) => row.status !== 'Rechazada' && row.startDate <= hoy && row.endDate >= hoy);
  return {
    ausenciasHoy: vivas,
    licencias: vivas.filter((row) => row.startDate === hoy || row.endDate === hoy),
    certificados: vivas.filter((row) => medica(row.type) && !row.hasCertificate && !row.certificateUrl),
  };
}

/**
 * Una AA (ausencia injustificada / no presentación, también la automática T+30) se puede
 * justificar desde el celular: pasa a E/L/A con certificado. Ya justificada o rechazada, no.
 */
export function esAusenciaInjustificada(row: Pick<AusenciaDia, 'type' | 'absenceType' | 'status'>): boolean {
  const status = String(row.status || '').trim();
  if (status === 'Justificada' || status === 'Rechazada' || status === 'Autorizada') return false;
  if (String(row.absenceType || '').toUpperCase() === 'AA') return true;
  const type = String(row.type || '').toLowerCase();
  return type.includes('injustificada') || type.includes('no presentaci') || type.includes('ausencia injustificada');
}

export type TipoJustificacion = { id: string; label: string; code: string };

/** Códigos que justifican una AA (orden fijo: Enfermedad, Licencia, Autorizada/ART). */
export const CODIGOS_JUSTIFICAN = ['E', 'L', 'A'] as const;

/** Del catálogo de la empresa, los tipos con código E/L/A en ese orden; sin catálogo, los defaults. */
export function tiposParaJustificar<T extends TipoJustificacion>(tipos: readonly T[]): T[] {
  const porCodigo = new Map<string, T>();
  for (const t of tipos) {
    const code = String(t.code || '').toUpperCase();
    if ((CODIGOS_JUSTIFICAN as readonly string[]).includes(code) && !porCodigo.has(code)) porCodigo.set(code, t);
  }
  return CODIGOS_JUSTIFICAN.map((c) => porCodigo.get(c)).filter((t): t is T => !!t);
}

export const TIPOS_JUSTIFICAR_DEFAULT: TipoJustificacion[] = [
  { id: 'E', label: 'Enfermedad', code: 'E' },
  { id: 'L', label: 'Licencia', code: 'L' },
  { id: 'A', label: 'Autorizada', code: 'A' },
];

/**
 * Datos que se escriben al justificar (mismo esquema que el escritorio al editar la ausencia):
 * nuevo tipo/código, estado `En verificación` si el tipo pide verificación médica y no hay
 * certificado, si no `Justificada`; se conservan fechas y legajo.
 */
export function patchJustificarAusencia(input: {
  tipo: TipoJustificacion;
  tieneCertificado: boolean;
  requiereVerificacionMedica: boolean;
  nombreReal: string;
  comentarios?: string;
}): { type: string; absenceType: string; status: 'Justificada' | 'En verificación'; hasCertificate: boolean; comments: string } {
  const status = input.requiereVerificacionMedica && !input.tieneCertificado ? 'En verificación' : 'Justificada';
  return {
    type: input.tipo.label,
    absenceType: input.tipo.code,
    status,
    hasCertificate: input.tieneCertificado,
    comments: `${input.comentarios || ''} Justificada desde el celular por ${input.nombreReal}`.trim(),
  };
}
