export function isProformaVacancyShift(shift: {
  employeeId?: string;
  employeeName?: string;
  isUnassigned?: boolean;
} | null | undefined): boolean {
  if (!shift) return false;
  if (shift.isUnassigned === true) return true;
  const eid = String(shift.employeeId ?? '').trim();
  const empName = String(shift.employeeName ?? '').trim().toUpperCase();
  if (empName === 'VACANTE' || empName.startsWith('VACANTE:')) return true;
  if (eid === 'VACANTE') return true;
  if ((!eid || eid === 'unknown') && (empName === 'VACANTE' || empName === 'SIN NOMBRE')) return true;
  return false;
}

export function isProformaVacancyEmployee(row: { employeeId: string; name: string }): boolean {
  const name = String(row.name || '').trim().toUpperCase();
  const eid = String(row.employeeId || '').trim();
  if (name === 'VACANTE' || name.startsWith('VACANTE:')) return true;
  if (eid === 'VACANTE') return true;
  return false;
}
