import { dualSegmentBounds } from './coverageCandidates';
import { formatHmAR } from './retentionDisplay';

/**
 * Un solo estado por ausencia en el Centro de Control (lista, OBJ, mapa y celular).
 *
 * El titular ausente puede arrastrar marcas que se contradicen: `isSinCobertura`
 * (la escalada de la cascada agotada) queda escrita aunque después lo cubran por otro
 * camino (grilla de Planificación, cobertura parcial, operador). Acá manda la cobertura:
 * nunca «DESCUBIERTO» si hay cobertura activa.
 *
 * - SIN_CUBRIR: ausente y nadie lo cubre.
 * - CUBRIENDO: hay convocatoria en curso (PENDING/ESCALATED) para ese hueco.
 * - PARCIAL: Ext + Adel con una sola pata; dice qué tramo falta.
 * - CUBIERTO: cobertura confirmada (`operacionallyCovered` / `COVERED`).
 */
export type EstadoAusenciaKind = 'SIN_CUBRIR' | 'CUBRIENDO' | 'PARCIAL' | 'CUBIERTO';
export type EstadoAusenciaTone = 'rojo' | 'ambar' | 'verde';

export interface EstadoAusenciaCc {
  kind: EstadoAusenciaKind;
  /** «AUSENTE · SIN CUBRIR» / «AUSENTE · CUBIERTO» / «AUSENTE · CUBRIENDO» / «COBERTURA PARCIAL». */
  label: string;
  /** Chip del celular: AUS / CUB / CONV / PARC. */
  corto: string;
  tone: EstadoAusenciaTone;
  /** «Cubre: KOPP Franco Isaias (FT) desde 13:00» / «Convocatoria en curso» / «Falta 14:15–16:00». */
  detalle: string | null;
  cubridor: string | null;
  tipo: string | null;
  /** Cuenta para el rojo del contador AUS. Solo CUBIERTO queda afuera. */
  sinCubrir: boolean;
}

export type EstadoAusenciaShift = Record<string, unknown> & {
  isAbsent?: boolean;
  isPotentialAbsence?: boolean;
  opensCoverageVacancy?: boolean;
  isProvisionalLateAbsence?: boolean;
  operacionallyCovered?: boolean;
  plannedOperativelyCovered?: boolean;
  coverageStatus?: string | null;
  coverageType?: string | null;
  coveredBy?: string | null;
  coveredByEmployeeName?: string | null;
  coveringDisplayName?: string | null;
  coveringTipo?: string | null;
  coveringDesdeMs?: number | null;
  coveredAt?: unknown;
  convocatoriaEnCurso?: boolean;
  code?: string | null;
  vacancyBand?: string | null;
  /** Lo que entrega el monitor: Date, ISO o Timestamp (se lee con `readMs`). */
  shiftDateObj?: unknown;
  endDateObj?: unknown;
};

export interface EstadoAusenciaOpts {
  now?: Date | number;
  /** Convocatoria PENDING/ESCALATED sobre este turno (lo sabe quien escucha `convocatorias_cobertura`). */
  convocatoriaEnCurso?: boolean;
}

const TIPO_LABEL: Record<string, string | null> = {
  FT: 'FT',
  REF: 'REF',
  ESC: 'ESC',
  RET: 'RET',
  RETENCION: 'RET',
  EXTEND: 'Ext',
  EXT: 'Ext',
  ADVANCE: 'Adel',
  ADV: 'Adel',
  EVENTUAL: 'Eventual',
  SIN_TURNO: 'Sin turno',
  COBERTURA: null,
  OPERATIONS_COVERAGE: null,
};

function readMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (value && typeof value === 'object') {
    const o = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
    if (typeof o.toMillis === 'function') return o.toMillis() || 0;
    if (typeof o.toDate === 'function') return o.toDate().getTime() || 0;
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/** El turno es una ausencia que el CC lista en AUS (titular AA, o potencial que ya abrió vacante). */
export function esAusenciaCc(shift: EstadoAusenciaShift | null | undefined): boolean {
  if (!shift) return false;
  if (shift.isProvisionalLateAbsence) return false;
  return !!(shift.isAbsent || (shift.isPotentialAbsence && shift.opensCoverageVacancy));
}

/** Cobertura confirmada sobre el titular ausente (misma lectura en escritorio, mapa y celular). */
export function esAusenciaCubierta(shift: EstadoAusenciaShift | null | undefined): boolean {
  if (!shift) return false;
  const st = String(shift.coverageStatus || '').toUpperCase();
  return shift.operacionallyCovered === true || shift.plannedOperativelyCovered === true || st === 'COVERED';
}

/** Nombre del que cubre, sin el «(FT)» al final. */
export function nombreCubridor(shift: EstadoAusenciaShift | null | undefined): string | null {
  if (!shift) return null;
  const preset = String(shift.coveringDisplayName || '').trim();
  if (preset) return preset;
  const raw = String(shift.coveredByEmployeeName || shift.coveredBy || '').trim();
  if (!raw) return null;
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || raw;
}

export function tipoCoberturaLabel(tipo: unknown): string | null {
  const key = String(tipo || '').trim().toUpperCase();
  if (!key) return null;
  if (key in TIPO_LABEL) return TIPO_LABEL[key];
  return key;
}

/** Tramo que falta en una cobertura parcial Ext + Adel: «14:15–16:00». */
export function tramoFaltanteParcial(shift: EstadoAusenciaShift): string | null {
  const startMs = readMs(shift.shiftDateObj);
  const endMs = readMs(shift.endDateObj);
  if (!startMs || !endMs) return null;
  const { extEndMs, advStartMs } = dualSegmentBounds({
    titularShiftId: String(shift.id || ''),
    objectiveId: String(shift.objectiveId || ''),
    startMs,
    endMs: endMs > startMs ? endMs : endMs + 86400000,
    band: String(shift.vacancyBand || shift.code || ''),
  });
  const tipo = String(shift.coverageType || '').toUpperCase();
  if (tipo === 'EXTEND' || tipo === 'EXT') {
    return advStartMs ? `${formatHmAR(advStartMs)}–${formatHmAR(endMs)}` : null;
  }
  if (tipo === 'ADVANCE' || tipo === 'ADV') {
    return extEndMs ? `${formatHmAR(startMs)}–${formatHmAR(extEndMs)}` : null;
  }
  return null;
}

/** Devuelve `null` si el turno no es una ausencia del CC. */
export function estadoAusenciaCc(
  shift: EstadoAusenciaShift | null | undefined,
  opts: EstadoAusenciaOpts = {},
): EstadoAusenciaCc | null {
  if (!shift || !esAusenciaCc(shift)) return null;

  if (esAusenciaCubierta(shift)) {
    const cubridor = nombreCubridor(shift);
    const tipo = tipoCoberturaLabel(shift.coveringTipo || shift.coverageType);
    const desdeMs = readMs(shift.coveringDesdeMs) || readMs(shift.coveredAt);
    const partes: string[] = [];
    if (cubridor) {
      partes.push(`Cubre: ${cubridor}${tipo ? ` (${tipo})` : ''}`);
      if (desdeMs) partes.push(`desde ${formatHmAR(desdeMs)}`);
    } else {
      partes.push('Cubierto desde el CC');
    }
    return {
      kind: 'CUBIERTO',
      label: 'AUSENTE · CUBIERTO',
      corto: 'CUB',
      tone: 'verde',
      detalle: partes.join(' '),
      cubridor,
      tipo,
      sinCubrir: false,
    };
  }

  const st = String(shift.coverageStatus || '').toUpperCase();
  if (st === 'PARTIAL') {
    const cubridor = nombreCubridor(shift);
    const tipo = tipoCoberturaLabel(shift.coverageType);
    const falta = tramoFaltanteParcial(shift);
    const partes: string[] = [];
    if (cubridor) partes.push(`${tipo || 'Cubre'}: ${cubridor}`);
    partes.push(falta ? `Falta ${falta}` : 'Falta un tramo');
    return {
      kind: 'PARCIAL',
      label: 'COBERTURA PARCIAL',
      corto: 'PARC',
      tone: 'ambar',
      detalle: partes.join(' · '),
      cubridor,
      tipo,
      sinCubrir: true,
    };
  }

  if (opts.convocatoriaEnCurso === true || shift.convocatoriaEnCurso === true) {
    return {
      kind: 'CUBRIENDO',
      label: 'AUSENTE · CUBRIENDO',
      corto: 'CONV',
      tone: 'ambar',
      detalle: 'Convocatoria en curso',
      cubridor: null,
      tipo: null,
      sinCubrir: true,
    };
  }

  return {
    kind: 'SIN_CUBRIR',
    label: 'AUSENTE · SIN CUBRIR',
    corto: 'AUS',
    tone: 'rojo',
    detalle: null,
    cubridor: null,
    tipo: null,
    sinCubrir: true,
  };
}

/** Para el contador: ausencia del CC que todavía no está cubierta. */
export function ausenciaSinCubrir(shift: EstadoAusenciaShift | null | undefined, opts: EstadoAusenciaOpts = {}): boolean {
  const e = estadoAusenciaCc(shift, opts);
  return !!e && e.sinCubrir;
}

/** «2 AUS · 0 sin cubrir» — el rojo del contador sale de `sinCubrir`, no del total. */
export function contadorAusLabel(total: number, sinCubrir: number): string {
  if (total <= 0) return 'AUS';
  return `AUS · ${sinCubrir} sin cubrir`;
}
