import { isActiveOpsCoverageDoc, isOpsCoverageHoursOnSourceDoc } from './coverageSemantics';
import { NON_RELIEF_EXTRA_CODES, reliefShiftCode } from './reliefEligibility';

export type ShiftCodeBadgeTone = 'base' | 'extra' | 'coverage' | 'rest' | 'license' | 'other';

export type ShiftCodeBadge = {
  code: string;
  tone: ShiftCodeBadgeTone;
  /** Texto largo para `title` (tooltip). */
  title: string;
};

const BASE_CODES: ReadonlySet<string> = new Set(['M', 'T', 'N', 'D12', 'N12', 'D', 'MT', 'TN']);
const REST_CODES: ReadonlySet<string> = new Set(['F', 'FF', 'FP']);
const LICENSE_CODES: ReadonlySet<string> = new Set([
  'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);

const CODE_TITLES: Record<string, string> = {
  M: 'Mañana',
  T: 'Tarde',
  N: 'Noche',
  D12: 'Diurno 12 h',
  N12: 'Nocturno 12 h',
  ESC: 'Escuela (sobreturno, no releva)',
  REF: 'Refuerzo (extra, no releva)',
  RET: 'Retención pasiva (stand-by, no releva)',
  FT: 'Franco trabajado',
  RFZ: 'Refuerzo de cliente',
  TURA: 'Turno adicional',
  F: 'Franco',
  FF: 'Franco feriado',
  FP: 'Franco permuta',
};

/**
 * Código de turno para mostrar junto al nombre del guardia en Ops
 * (Alertas y Prioridad, tarjetas del CC, popup de objetivo del map view).
 * Distingue de un vistazo titular (M/T/N) de extra (ESC/REF/RET) y de cobertura.
 */
export function opsShiftCodeBadge(
  shift: Record<string, unknown> | null | undefined,
): ShiftCodeBadge | null {
  if (!shift) return null;
  const code = reliefShiftCode(shift);
  if (!code) return null;

  if (isOpsCoverageHoursOnSourceDoc(shift)) {
    const isExt = String(shift.coverageType || '').toUpperCase() === 'EXTEND';
    return {
      code: isExt ? `${code}+EXT` : `${code}+ADEL`,
      tone: 'coverage',
      title: isExt ? 'Extensión de turno (horas en el turno propio)' : 'Adelanto de turno (horas en el turno propio)',
    };
  }

  if (isActiveOpsCoverageDoc(shift)) {
    return {
      code: `${code}·COB`,
      tone: 'coverage',
      title: `Cobertura operativa (${CODE_TITLES[code] || code})`,
    };
  }

  const title = CODE_TITLES[code] || code;
  if (NON_RELIEF_EXTRA_CODES.has(code)) return { code, tone: 'extra', title };
  if (REST_CODES.has(code)) return { code, tone: 'rest', title };
  if (LICENSE_CODES.has(code)) return { code, tone: 'license', title };
  if (BASE_CODES.has(code)) return { code, tone: 'base', title };
  return { code, tone: 'other', title };
}

/** `ESC 16–00` — código + franja horaria corta en hora local del turno. */
export function opsShiftCodeRangeLabel(
  shift: Record<string, unknown> | null | undefined,
  start: Date | null | undefined,
  end: Date | null | undefined,
): string {
  const badge = opsShiftCodeBadge(shift);
  const hh = (d: Date | null | undefined): string =>
    d instanceof Date && !Number.isNaN(d.getTime()) ? String(d.getHours()).padStart(2, '0') : '';
  const from = hh(start);
  const to = hh(end);
  const range = from && to ? `${from}–${to}` : from;
  if (!badge) return range;
  return range ? `${badge.code} ${range}` : badge.code;
}
