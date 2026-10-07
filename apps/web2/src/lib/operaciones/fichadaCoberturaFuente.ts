const FUENTE = new Set(['REF', 'ESC', 'RET']);

function startMs(s: Record<string, any>): number {
  if (s.shiftDateObj instanceof Date) return s.shiftDateObj.getTime();
  return s.startTime?.toMillis?.() ?? (s.startTime?.seconds ? s.startTime.seconds * 1000 : 0);
}

function endMs(s: Record<string, any>): number {
  if (s.endDateObj instanceof Date) return s.endDateObj.getTime();
  return s.endTime?.toMillis?.() ?? (s.endTime?.seconds ? s.endTime.seconds * 1000 : 0);
}

function mismoHorario(a: Record<string, any>, b: Record<string, any>): boolean {
  const as = startMs(a);
  const bs = startMs(b);
  if (as <= 0 || bs <= 0) return false;
  return Math.abs(as - bs) <= 60_000 && Math.abs(endMs(a) - endMs(b)) <= 60_000;
}

function yaFicho(s: Record<string, any>): boolean {
  if (s.isPresent === true) return true;
  if (String(s.status || '').toUpperCase() === 'PRESENT') return true;
  const cin = s.checkInAt?.toMillis?.() ?? (s.checkInAt?.seconds ? s.checkInAt.seconds * 1000 : 0);
  const rst = s.realStartTime?.toMillis?.() ?? (s.realStartTime?.seconds ? s.realStartTime.seconds * 1000 : 0);
  return cin > 0 || rst > 0;
}

/**
 * Si el REF/ESC/RET fuente y el ops_cov del mismo horario están los dos en el CC,
 * se muestra la cobertura. Si la fichada quedó en la fuente, la cobertura se ve presente.
 * Devuelve los ids de la fuente para sacarlos de la lista.
 */
export function heredarFichadaDeFuente(shifts: Array<Record<string, any>>): Set<string> {
  const byId = new Map(shifts.map((s) => [String(s.id || ''), s]));
  const ocultar = new Set<string>();
  for (const cov of shifts) {
    if (String(cov.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') continue;
    const ct = String(cov.coverageType || '').toUpperCase();
    if (!FUENTE.has(ct)) continue;
    const src = byId.get(String(cov.sourceShiftId || '').trim());
    if (!src || src === cov) continue;
    if (String(src.employeeId || '') !== String(cov.employeeId || '')) continue;
    if (!mismoHorario(src, cov)) continue;
    ocultar.add(String(src.id));
    if (!yaFicho(cov) && yaFicho(src)) {
      cov.isPresent = true;
      cov.status = 'PRESENT';
      cov.checkInAt = src.checkInAt;
      cov.realStartTime = src.realStartTime;
      cov.checkInTime = src.checkInTime;
      cov.isAwaitingCoverageCheckIn = false;
    }
  }
  return ocultar;
}
