const SUPERADMIN_ROLE_KEYS = new Set(['superadmin', 'superadministrator', 'sp']);

export function normalizeAuthRoleKey(role: unknown): string {
  return String(role ?? '')
    .toLowerCase()
    .replace(/_/g, '')
    .trim();
}

export function isSuperAdminRole(role: unknown): boolean {
  return SUPERADMIN_ROLE_KEYS.has(normalizeAuthRoleKey(role));
}

export async function userIsSuperAdmin(user: { getIdTokenResult: (force?: boolean) => Promise<{ claims: Record<string, unknown> }> }): Promise<boolean> {
  const token = await user.getIdTokenResult(true);
  return isSuperAdminRole(token.claims.role) || isSuperAdminRole(token.claims.type);
}
