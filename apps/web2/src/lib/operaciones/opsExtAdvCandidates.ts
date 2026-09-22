const EXT_JOIN_TOLERANCE_MS = 20 * 60 * 1000;

const toDate = (d: unknown): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) {
    return new Date((d as { seconds: number }).seconds * 1000);
  }
  return new Date(d as string | number);
};

const dedupeShiftsByEmployee = (rows: any[]): any[] => {
  const byEmp = new Map<string, any>();
  for (const sh of rows) {
    const eid = String(sh.employeeId || '').trim();
    if (!eid) continue;
    const prev = byEmp.get(eid);
    if (!prev) {
      byEmp.set(eid, sh);
      continue;
    }
    const preferPresent = (a: any, b: any) => {
      if (a.isPresent && !a.isCompleted && !(b.isPresent && !b.isCompleted)) return a;
      if (b.isPresent && !b.isCompleted && !(a.isPresent && !a.isCompleted)) return b;
      return a;
    };
    byEmp.set(eid, preferPresent(prev, sh));
  }
  return [...byEmp.values()];
};

/**
 * EXT: guardia ya en el puesto cuyo turno **termina** cuando arranca la vacante
 * (ej. M 08–16 para cubrir 1ª mitad de T 16–00). Excluye quien co-inicia con la vacante.
 */
export function listOpsExtCandidatesForVacancy(
  processedData: any[],
  absenceShift: any,
  now: Date,
  crossSessionBusy: Set<string>,
): any[] {
  const vacancyStartMs = toDate(absenceShift.shiftDateObj).getTime();
  if (!vacancyStartMs) return [];

  const rows = (processedData || []).filter((sh: any) => {
    if (!sh.isPresent || sh.isCompleted || sh.isAbsent) return false;
    if (sh.objectiveId !== absenceShift.objectiveId) return false;
    if (sh.id === absenceShift.id) return false;
    if (crossSessionBusy.has(sh.employeeId)) return false;
    if (sh.isVirtual === true) return false;

    const shiftStartMs = toDate(sh.shiftDateObj).getTime();
    const shiftEndMs = toDate(sh.endDateObj).getTime();
    if (!shiftStartMs || !shiftEndMs) return false;
    if (now.getTime() < shiftStartMs) return false;
    if (shiftStartMs >= vacancyStartMs) return false;
    if (Math.abs(shiftEndMs - vacancyStartMs) > EXT_JOIN_TOLERANCE_MS) return false;
    return true;
  });

  return dedupeShiftsByEmployee(rows).sort(
    (a, b) => Math.abs(toDate(a.endDateObj).getTime() - vacancyStartMs)
      - Math.abs(toDate(b.endDateObj).getTime() - vacancyStartMs),
  );
}

/** ADV: próximo turno en el mismo objetivo (hasta 12 h), aún no iniciado — puede ser otro puesto. */
export function listOpsAdvCandidatesForVacancy(
  processedData: any[],
  absenceShift: any,
  now: Date,
  crossSessionBusy: Set<string>,
): any[] {
  const advWindowEnd = new Date(now.getTime() + 12 * 3600 * 1000);
  return (processedData || [])
    .filter((sh: any) => {
      const shStart = toDate(sh.shiftDateObj);
      return (
        !sh.isPresent
        && !sh.isCompleted
        && !sh.isAbsent
        && !sh.isUnassigned
        && !sh.isFranco
        && sh.objectiveId === absenceShift.objectiveId
        && !crossSessionBusy.has(sh.employeeId)
        && shStart > now
        && shStart <= advWindowEnd
      );
    })
    .sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime())
    .slice(0, 8);
}
