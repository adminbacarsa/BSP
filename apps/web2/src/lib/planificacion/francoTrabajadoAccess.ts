/** Permiso PLANNING `assign_ft` — asignar/modificar Franco Trabajado (FT). SuperAdmin siempre. */
export function canAssignFrancoTrabajado(
    isSuperAdmin: boolean,
    rolePermissions: Record<string, string[]>,
): boolean {
    if (isSuperAdmin) return true;
    return (rolePermissions.PLANNING || []).includes('assign_ft');
}
