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

/** Usuario con acceso a un subconjunto explícito de empresas (ni allEmpresas ni una sola). */
export function isMultiEmpresaUser(data: {
  allEmpresas?: unknown;
  empresaIds?: unknown;
  role?: unknown;
}): boolean {
  if (isAllEmpresasUser(data)) return false;
  const ids = data?.empresaIds;
  return Array.isArray(ids) && ids.length > 1;
}

/** Mapa empresaId → roleId (multi-empresa con rol distinto por tenant). */
export type RolesByEmpresa = Record<string, string>;

export function parseRolesByEmpresa(raw: unknown): RolesByEmpresa {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: RolesByEmpresa = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const emp = String(k || '').trim();
    const role = String(v ?? '').trim();
    if (emp && role) out[emp] = role;
  }
  return out;
}

/** Empresas a las que el usuario puede entrar (subconjunto o primaria). */
export function listUserEmpresaIds(data: {
  allEmpresas?: unknown;
  empresaIds?: unknown;
  empresaId?: unknown;
  role?: unknown;
}): string[] {
  if (isAllEmpresasUser(data) || isSuperAdminRole(data?.role)) return [];
  if (Array.isArray(data?.empresaIds) && data.empresaIds.length > 0) {
    return [...new Set(data.empresaIds.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  const one = String(data?.empresaId ?? '').trim();
  return one ? [one] : [];
}

export function userCanAccessEmpresa(
  data: {
    allEmpresas?: unknown;
    empresaIds?: unknown;
    empresaId?: unknown;
    role?: unknown;
  },
  empresaId: string,
): boolean {
  const eid = String(empresaId || '').trim();
  if (!eid) return false;
  if (isSuperAdminRole(data?.role) || data?.allEmpresas === true) return true;
  const ids = listUserEmpresaIds(data);
  if (ids.length > 0) return ids.includes(eid);
  return String(data?.empresaId || 'bacarsa').trim() === eid;
}

/**
 * Rol efectivo para una empresa activa.
 * Prioridad: rolesByEmpresa[empresa] → role (primario / legacy).
 */
export function resolveRoleForEmpresa(
  data: {
    role?: unknown;
    rolesByEmpresa?: unknown;
    empresaId?: unknown;
  },
  activeEmpresaId: string,
): string {
  if (isSuperAdminRole(data?.role)) return String(data.role || '').trim();
  const map = parseRolesByEmpresa(data?.rolesByEmpresa);
  const eid = String(activeEmpresaId || '').trim();
  if (eid && map[eid]) return map[eid];
  return String(data?.role || '').trim();
}
