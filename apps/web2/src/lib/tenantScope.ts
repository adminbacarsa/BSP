/**
 * Helpers puros de aislamiento por empresa (sin Firebase).
 * Los usan el front y el motor del libro de horas que corre en Functions.
 * `multiempresa.ts` los re-exporta para no romper imports existentes.
 */

/** Legacy bacarsa sin migrar sigue viendo todo; empresas nuevas o migradas se filtran por empresaId. */
export function shouldScopeQueriesToEmpresa(empresaId: string, migracionCompleta: boolean): boolean {
  const id = String(empresaId ?? '').trim();
  if (!id) return false;
  if (migracionCompleta) return true;
  return id.toLowerCase() !== 'bacarsa';
}

/** Comparación de empresaId (case-insensitive; espacios ≡ guiones bajos). */
export function tenantEmpresaIdsMatch(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && x === y;
}

/**
 * Bacarsa legacy: incluye sin empresaId o empresaId=bacarsa; excluye otras empresas (ej. prueba_sa).
 */
export function belongsToEmpresaView(
  data: { empresaId?: unknown },
  empresaId: string,
  migracionCompleta: boolean,
): boolean {
  const id = String(empresaId ?? '').trim();
  const docEmp = String(data?.empresaId ?? '').trim();
  if (shouldScopeQueriesToEmpresa(id, migracionCompleta)) {
    // Bacarsa con migración: turnos/SLA legacy sin empresaId siguen siendo de Bacarsa (no de prueba_sa).
    if (id.toLowerCase() === 'bacarsa') {
      return !docEmp || tenantEmpresaIdsMatch(docEmp, id);
    }
    return tenantEmpresaIdsMatch(docEmp, id);
  }
  if (id.toLowerCase() === 'bacarsa') {
    return !docEmp || docEmp.toLowerCase() === 'bacarsa';
  }
  return !docEmp || tenantEmpresaIdsMatch(docEmp, id);
}

export function filterRowsByEmpresa<T extends { empresaId?: unknown }>(
  rows: T[],
  empresaId: string,
  scopeEmpresa: boolean,
  migracionCompleta = false,
): T[] {
  if (!String(empresaId ?? '').trim()) return rows;
  return rows.filter((r) => belongsToEmpresaView(r, empresaId, migracionCompleta));
}

export function belongsToEmpresa(
  data: { empresaId?: unknown },
  empresaId: string,
  scopeEmpresa: boolean,
  migracionCompleta = false,
): boolean {
  if (!String(empresaId ?? '').trim()) return true;
  if (!scopeEmpresa) return belongsToEmpresaView(data, empresaId, migracionCompleta);
  return tenantEmpresaIdsMatch(data.empresaId, empresaId);
}

/** SLA legacy sin empresaId: incluir si clientId pertenece a un cliente de la empresa (planificación). */
export function slaBelongsToEmpresa(
  row: { empresaId?: unknown; clientId?: unknown },
  empresaId: string,
  scopeEmpresa: boolean,
  clientIds: Set<string>,
): boolean {
  if (!scopeEmpresa) return true;
  const id = String(empresaId ?? '').trim();
  const emp = String(row.empresaId ?? '').trim();
  const cid = String(row.clientId ?? '').trim();
  if (cid && clientIds.has(cid)) return true;
  if (emp) return tenantEmpresaIdsMatch(emp, id);
  return false;
}

export function filterSlaRowsByEmpresa<T extends { empresaId?: unknown; clientId?: unknown }>(
  rows: T[],
  empresaId: string,
  scopeEmpresa: boolean,
  clientIds: Set<string>,
): T[] {
  // Sin scope (Bacarsa legacy): igual se descartan contratos de otras empresas (pruebas_sa, grupos…).
  if (!scopeEmpresa) {
    if (!String(empresaId ?? '').trim()) return rows;
    return rows.filter((r) => belongsToEmpresaView(r, empresaId, false));
  }
  return rows.filter(r => slaBelongsToEmpresa(r, empresaId, true, clientIds));
}

/**
 * IDs de clients borrados en migración Bacarsa → doc actual en Firestore.
 * Solo vale para la empresa `bacarsa`: en otras empresas (pruebas_sa) esos ids viejos no son alias.
 */
export const KNOWN_ORPHAN_CLIENT_IDS: Record<string, string> = {
  '99yqpqc4ppY9rVXymWhx': 'DB8UZxFC4DpqGSQ3o69w',
  p9atJYpcu9oUspQMFta3: 'ujOVMbL9gK8YK6DsiLvs',
  ZlxmWiRw5qGYtIST5uZh: '8rr2FePfgQ6xY2jH0gyk',
  FzAowOV93fHQcxZhHfjN: 'NS0UBtf6zkHsm2iRRo9W',
};

export const KNOWN_ORPHAN_CLIENT_IDS_EMPRESA = 'bacarsa';

/** El mapa de huérfanos aplica sin empresa (legacy) o en bacarsa; nunca cruza a otra empresa. */
export function orphanClientAliasesApply(empresaId?: string | null): boolean {
  const id = String(empresaId ?? '').trim();
  if (!id) return true;
  return tenantEmpresaIdsMatch(id, KNOWN_ORPHAN_CLIENT_IDS_EMPRESA);
}

/**
 * IDs de documento clients + huérfanos legacy que apuntan al mismo cliente.
 * Con `empresaId` de otra empresa que bacarsa devuelve solo el id canónico.
 */
export function getClientIdAliases(canonicalId: string, empresaId?: string | null): string[] {
  const id = String(canonicalId ?? '').trim();
  if (!id) return [];
  if (!orphanClientAliasesApply(empresaId)) return [id];
  const ids = new Set<string>([id]);
  for (const [orphan, target] of Object.entries(KNOWN_ORPHAN_CLIENT_IDS)) {
    if (target === id) ids.add(orphan);
  }
  for (const [orphan, target] of Object.entries(KNOWN_ORPHAN_CLIENT_IDS)) {
    if (orphan === id) ids.add(target);
  }
  return [...ids];
}
