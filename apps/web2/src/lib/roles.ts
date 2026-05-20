/** IDs de rol equivalentes a SuperAdmin (alineado con Functions y backup-auth). */
export function normalizeRoleId(role: unknown): string {
  return String(role ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

export function isSuperAdminRole(role: unknown): boolean {
  const r = normalizeRoleId(role);
  return r === 'SUPERADMIN' || r === 'SUPER_ADMIN' || r === 'SP';
}

export function superAdminRoleLabel(role: unknown): string {
  return isSuperAdminRole(role) ? 'SuperAdmin' : String(role ?? '—');
}
