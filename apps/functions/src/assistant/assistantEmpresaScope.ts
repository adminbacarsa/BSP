/** Alineado a apps/web2/src/lib/multiempresa.ts — Bacarsa sin migrar ve todo; resto filtra por empresaId. */

export function shouldScopeQueriesToEmpresa(empresaId: string, migracionCompleta: boolean): boolean {
  const id = String(empresaId ?? '').trim();
  if (!id) return false;
  if (migracionCompleta) return true;
  return id.toLowerCase() !== 'bacarsa';
}

export function tenantEmpresaIdsMatch(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && x === y;
}

/** Alineado a apps/web2/src/lib/multiempresa.ts belongsToEmpresaView */
export function belongsToEmpresaView(
  data: { empresaId?: unknown },
  empresaId: string,
  migracionCompleta: boolean,
): boolean {
  const id = String(empresaId ?? '').trim();
  const docEmp = String(data?.empresaId ?? '').trim();
  if (shouldScopeQueriesToEmpresa(id, migracionCompleta)) {
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

export function belongsToEmpresa(
  data: { empresaId?: unknown },
  empresaId: string,
  scopeEmpresa: boolean,
  migracionCompleta = false,
): boolean {
  if (!scopeEmpresa) return true;
  return belongsToEmpresaView(data, empresaId, migracionCompleta);
}

export async function resolveAssistantEmpresaScope(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
): Promise<{ scopeEmpresa: boolean; migracionCompleta: boolean }> {
  const id = String(empresaId ?? '').trim();
  if (!id) return { scopeEmpresa: false, migracionCompleta: false };
  try {
    const snap = await db.collection('empresas').doc(id).get();
    const migracionCompleta = snap.exists && snap.data()?.migracionCompleta === true;
    return {
      migracionCompleta,
      scopeEmpresa: shouldScopeQueriesToEmpresa(id, migracionCompleta),
    };
  } catch {
    return {
      migracionCompleta: false,
      scopeEmpresa: shouldScopeQueriesToEmpresa(id, false),
    };
  }
}

export async function queryCollectionDocsScoped(
  db: FirebaseFirestore.Firestore,
  colName: string,
  empresaId: string,
  scopeEmpresa: boolean,
  limit: number,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  if (scopeEmpresa && String(empresaId ?? '').trim()) {
    return (
      await db.collection(colName).where('empresaId', '==', String(empresaId).trim()).limit(limit).get()
    ).docs;
  }
  return (await db.collection(colName).limit(limit).get()).docs;
}

export async function queryClientsDocsScoped(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  scopeEmpresa: boolean,
  limit = 480,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  return queryCollectionDocsScoped(db, 'clients', empresaId, scopeEmpresa, limit);
}

export async function queryEmpleadosDocsScoped(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  scopeEmpresa: boolean,
  limit = 900,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  return queryCollectionDocsScoped(db, 'empleados', empresaId, scopeEmpresa, limit);
}

export async function empresaClientIdsSetScoped(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  scopeEmpresa: boolean,
): Promise<Set<string>> {
  const docs = await queryClientsDocsScoped(db, empresaId, scopeEmpresa, 520);
  return new Set(docs.map((d) => d.id));
}

export function turnoRowBelongsToEmpresa(
  row: Record<string, unknown>,
  empresaId: string,
  scopeEmpresa: boolean,
): boolean {
  return belongsToEmpresa(row, empresaId, scopeEmpresa);
}
