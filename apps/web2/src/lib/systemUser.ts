import { isSuperAdminRole } from '@/lib/roles';

/** Valor del select en UI para usuarios multi-tenant (no SuperAdmin). */
export const ALL_EMPRESAS_VALUE = '__ALL__';

/** Usuario de panel con acceso a todas las empresas (flag explícito o rol SuperAdmin). */
export function isAllEmpresasUser(data: {
  allEmpresas?: unknown;
  empresaId?: unknown;
  role?: unknown;
}): boolean {
  if (isSuperAdminRole(data?.role)) return true;
  if (data?.allEmpresas === true) return true;
  const emp = String(data?.empresaId ?? '').trim();
  return emp === '*' || emp === ALL_EMPRESAS_VALUE;
}

export function empresaToFormValue(data: {
  allEmpresas?: unknown;
  empresaId?: unknown;
  role?: unknown;
}): string {
  if (isAllEmpresasUser(data) && !isSuperAdminRole(data?.role)) return ALL_EMPRESAS_VALUE;
  return String(data?.empresaId ?? '').trim();
}

export function empresaFromFormValue(
  formEmpresaId: string,
  roleIsSuperAdmin: boolean,
): { empresaId: string; allEmpresas: boolean } {
  if (roleIsSuperAdmin) return { empresaId: '', allEmpresas: false };
  if (formEmpresaId === ALL_EMPRESAS_VALUE) return { empresaId: '', allEmpresas: true };
  return { empresaId: formEmpresaId.trim(), allEmpresas: false };
}
