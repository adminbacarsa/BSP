export function isSinCoberturaShift(shift: {
  employeeId?: string;
  employeeName?: string;
  isSinCobertura?: boolean;
  status?: string;
  origin?: string;
} | null | undefined): boolean {
  if (!shift) return false;
  if (shift.isSinCobertura === true) return true;
  const eid = String(shift.employeeId ?? '').trim().toUpperCase();
  const empName = String(shift.employeeName ?? '').trim().toUpperCase();
  const status = String(shift.status ?? '').trim().toUpperCase();
  const origin = String(shift.origin ?? '').trim().toUpperCase();
  if (eid === 'SIN_COBERTURA') return true;
  if (empName === 'SIN COBERTURA') return true;
  if (status === 'SIN_COBERTURA') return true;
  if (origin === 'SIN_COBERTURA') return true;
  return false;
}

export function isProformaVacancyShift(shift: {
  employeeId?: string;
  employeeName?: string;
  isUnassigned?: boolean;
  isSinCobertura?: boolean;
  status?: string;
  origin?: string;
} | null | undefined): boolean {
  if (!shift) return false;
  if (isSinCoberturaShift(shift)) return true;
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
  const eid = String(row.employeeId || '').trim().toUpperCase();
  if (eid === 'SIN_COBERTURA' || name === 'SIN COBERTURA') return true;
  if (name === 'VACANTE' || name.startsWith('VACANTE:')) return true;
  if (eid === 'VACANTE') return true;
  return false;
}
