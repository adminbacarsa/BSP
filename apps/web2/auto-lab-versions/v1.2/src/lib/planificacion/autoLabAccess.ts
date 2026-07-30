/** Permiso PLANNING `auto_lab` — ver y usar /admin/planificacion/auto-lab. SuperAdmin siempre. */
export function canAccessAutoLab(
    isSuperAdmin: boolean,
    rolePermissions: Record<string, string[]>,
): boolean {
    if (isSuperAdmin) return true;
    return (rolePermissions.PLANNING || []).includes('auto_lab');
}
