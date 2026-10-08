/**
 * El tramo de Ext/Adel cierra el día del hueco (`coversDateStr`), aunque el turno
 * que se extiende o adelanta esté en otro día.
 * Sin el campo, se deduce el día comparando el segmento con la ventana de la banda.
 */

const VENTANA: Record<string, [number, number]> = {
  M: [7 * 60, 15 * 60],
  T: [15 * 60, 23 * 60],
  N: [23 * 60, 31 * 60],
  D12: [7 * 60, 19 * 60],
  N12: [19 * 60, 31 * 60],
};

export type TurnoAcredita = {
  code?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  coverageSegmentRole?: unknown;
  isExtended?: boolean;
  isEarlyStart?: boolean;
  coversDateStr?: unknown;
  coversBandCode?: unknown;
  segmentFromTime?: unknown;
  segmentToTime?: unknown;
};

export function sumarDiasCalendario(ymd: string, dias: number): string {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function hm(raw: unknown): number | null {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function esExtension(shift: TurnoAcredita): boolean {
  const role = String(shift.coverageSegmentRole || '').toUpperCase();
  if (role === 'EARLY_START') return false;
  if (role === 'EXTENSION') return true;
  return shift.isExtended === true && shift.isEarlyStart !== true;
}

function esAdelanto(shift: TurnoAcredita): boolean {
  const role = String(shift.coverageSegmentRole || '').toUpperCase();
  if (role === 'EXTENSION') return false;
  if (role === 'EARLY_START') return true;
  return shift.isEarlyStart === true && shift.isExtended !== true;
}

/** Día del hueco que cierra este tramo. Null si no se puede saber y hay que usar el día del turno. */
export function deducirDiaHueco(shift: TurnoAcredita, diaDelTurno: string): string | null {
  const banda = String(shift.coversBandCode || '').toUpperCase();
  const ventana = VENTANA[banda];
  if (!ventana) return null;
  const from = hm(shift.segmentFromTime);
  const to = hm(shift.segmentToTime);
  if (from == null || to == null || !diaDelTurno) return null;

  const code = String(shift.code || '').toUpperCase();
  const ini = hm(typeof shift.startTime === 'string' ? shift.startTime : '');
  const fin = hm(typeof shift.endTime === 'string' ? shift.endTime : '');
  const noche = code === 'N' || code === 'N12' || (ini != null && fin != null && fin <= ini);

  let segIni: number;
  let segFin: number;
  if (esAdelanto(shift)) {
    segIni = from;
    segFin = to <= from ? to + 1440 : to;
  } else if (esExtension(shift)) {
    const mananaSiguiente = noche && from < 12 * 60;
    const base = mananaSiguiente ? 1440 : 0;
    segIni = from + base;
    segFin = (to <= from ? to + 1440 : to) + base;
  } else {
    return null;
  }

  const tol = 20;
  let mejor: { dia: string; holgura: number } | null = null;
  for (const off of [-1, 0, 1]) {
    const winIni = ventana[0] + off * 1440;
    const winFin = ventana[1] + off * 1440;
    if (segIni < winIni - tol || segFin > winFin + tol) continue;
    const holgura = (segIni - winIni) + (winFin - segFin);
    if (!mejor || holgura < mejor.holgura) mejor = { dia: sumarDiasCalendario(diaDelTurno, off), holgura };
  }
  return mejor?.dia || null;
}

/** Día en el que el contador, el modal y el modo elegir acreditan el tramo. */
export function diaAcreditacionCobertura(shift: TurnoAcredita, diaDelTurno: string): string {
  const explicito = String(shift.coversDateStr || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicito)) return explicito;
  return deducirDiaHueco(shift, diaDelTurno) || diaDelTurno;
}

export function esTramoCobertura(shift: TurnoAcredita | null | undefined): boolean {
  if (!shift) return false;
  const role = String(shift.coverageSegmentRole || '').toUpperCase();
  return shift.isExtended === true
    || shift.isEarlyStart === true
    || role === 'EXTENSION'
    || role === 'EARLY_START';
}

/** Qué horas de este turno entran en el día consultado: la jornada en su día, el tramo en el del hueco. */
export function aporteDelTurnoAlDia(
  shift: TurnoAcredita,
  diaDelTurno: string,
  diaConsultado: string,
): 'completo' | 'solo-base' | 'solo-tramo' | 'nada' {
  const tramo = esTramoCobertura(shift);
  const acredita = diaAcreditacionCobertura(shift, diaDelTurno);
  if (diaDelTurno === diaConsultado) {
    if (!tramo || acredita === diaConsultado) return 'completo';
    return 'solo-base';
  }
  if (tramo && acredita === diaConsultado) return 'solo-tramo';
  return 'nada';
}

/**
 * El tooltip cabe en el viewport: a la derecha de la celda, o a la izquierda si no entra;
 * abajo, o arriba si no entra (última fila).
 */
export function ubicarTooltipCelda(
  x: number,
  y: number,
  ancho: number,
  alto: number,
  vw: number,
  vh: number,
  gap = 8,
): { left: number; top: number } {
  const m = 8;
  let left = x + gap;
  if (left + ancho > vw - m) left = x - ancho - gap;
  if (left < m) left = Math.max(m, Math.min(x + gap, vw - ancho - m));
  let top = y + gap;
  if (top + alto > vh - m) top = y - alto - gap;
  if (top < m) top = m;
  return { left: Math.round(left), top: Math.round(top) };
}
