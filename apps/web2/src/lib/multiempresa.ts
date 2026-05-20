/**
 * Utilidades para soporte multiempresa.
 * La migración agrega el campo `empresaId` a todos los documentos
 * existentes y marca la empresa como migrada en su propio documento.
 */
import {
  collection, getDocs, writeBatch, doc, setDoc, getDoc, deleteDoc, updateDoc,
  query, where, Query, CollectionReference, DocumentReference,
} from 'firebase/firestore';
import { db } from './firebase';

/** Colecciones que participan en el aislamiento por empresa */
const COLECCIONES = [
  'empleados',
  'clients',
  'clientes',
  'turnos',
  'ausencias',
  'novedades',
  'swap_requests',
  'contratos_servicio',
  'tipos_turno',
  'servicios_sla',
  'objetivos',
  'audit_logs',
  'user_notifications',
];

export interface ProgresoMigracion {
  mensaje: string;
  procesados: number;
  total: number;
  completa: boolean;
  error?: string;
}

/**
 * Recorre colecciones y agrega `empresaId` solo a documentos legacy sin tenant.
 * Solo Bacarsa puede ejecutar la re-etiqueta masiva (datos históricos sin empresaId).
 * Otras empresas: solo se marca migracionCompleta sin tocar documentos globales.
 */
export async function migrarEmpresa(
  empresaId: string,
  onProgreso: (p: ProgresoMigracion) => void
): Promise<void> {
  try {
    const id = String(empresaId ?? '').trim();
    if (id.toLowerCase() !== 'bacarsa') {
      await marcarMigracionCompleta(id);
      onProgreso({
        mensaje: 'Empresa marcada como migrada (sin re-etiquetar datos de otras empresas).',
        procesados: 0,
        total: 0,
        completa: true,
      });
      return;
    }

    onProgreso({ mensaje: 'Leyendo colecciones legacy de Bacarsa...', procesados: 0, total: 0, completa: false });

    const snapshots = await Promise.allSettled(
      COLECCIONES.map(col => getDocs(collection(db, col)))
    );

    // 2. Filtrar solo docs sin empresaId
    const tareas: Array<{ ref: any }> = [];
    snapshots.forEach(result => {
      if (result.status === 'fulfilled') {
        result.value.docs.forEach(d => {
          if (!d.data().empresaId) tareas.push({ ref: d.ref });
        });
      }
    });

    const total = tareas.length;
    onProgreso({ mensaje: `${total} documentos para migrar`, procesados: 0, total, completa: false });

    if (total === 0) {
      // Nada que migrar — marcar como completa igualmente
      await marcarMigracionCompleta(empresaId);
      onProgreso({ mensaje: '¡Todo ya está migrado!', procesados: 0, total: 0, completa: true });
      return;
    }

    // 3. Procesar en lotes de 490 (límite Firestore: 500)
    let procesados = 0;
    for (let i = 0; i < tareas.length; i += 490) {
      const lote = tareas.slice(i, i + 490);
      const batch = writeBatch(db);
      lote.forEach(({ ref }) => batch.update(ref, { empresaId: id }));
      await batch.commit();
      procesados += lote.length;
      onProgreso({
        mensaje: `Migrando... ${procesados} / ${total}`,
        procesados,
        total,
        completa: false,
      });
    }

    // 4. Crear el doc de la empresa si no existe y marcarla como migrada
    await marcarMigracionCompleta(empresaId);
    onProgreso({ mensaje: '¡Migración completada!', procesados: total, total, completa: true });

  } catch (err: any) {
    onProgreso({
      mensaje: 'Error en la migración',
      procesados: 0,
      total: 0,
      completa: false,
      error: err.message || String(err),
    });
    throw err;
  }
}

async function marcarMigracionCompleta(empresaId: string) {
  await setDoc(
    doc(db, 'empresas', empresaId),
    { migracionCompleta: true, migracionFecha: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Crea o actualiza un documento de empresa en la colección `empresas`.
 */
export async function guardarEmpresa(
  empresaId: string,
  datos: Record<string, unknown>
): Promise<void> {
  await setDoc(
    doc(db, 'empresas', empresaId),
    { ...datos, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function desactivarEmpresa(empresaId: string): Promise<void> {
  await setDoc(doc(db, 'empresas', empresaId), { active: false, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function activarEmpresa(empresaId: string): Promise<void> {
  await setDoc(doc(db, 'empresas', empresaId), { active: true, updatedAt: new Date().toISOString() }, { merge: true });
}

export interface ProgresoEliminacion {
  coleccion: string;
  eliminados: number;
  total: number;
  completa: boolean;
  error?: string;
}

/** Colecciones a purgar al eliminar una empresa (todas tienen campo empresaId). */
const COLECCIONES_A_ELIMINAR = [
  'turnos', 'empleados', 'clients', 'clientes', 'ausencias', 'novedades',
  'servicios_sla', 'planificacion_estados', 'swap_requests', 'contratos_servicio',
  'tipos_turno', 'objetivos', 'audit_logs', 'user_notifications',
];

/**
 * Elimina todos los documentos de una empresa en todas las colecciones y luego el doc de la empresa.
 * No puede ejecutarse sobre 'bacarsa' ni sobre la empresa activa del usuario.
 */
export async function eliminarEmpresaYDatos(
  empresaId: string,
  onProgreso: (p: ProgresoEliminacion) => void
): Promise<void> {
  if (!empresaId) throw new Error('No se puede eliminar esta empresa');

  let totalEliminados = 0;

  for (const col of COLECCIONES_A_ELIMINAR) {
    onProgreso({ coleccion: col, eliminados: totalEliminados, total: -1, completa: false });
    try {
      const snap = await getDocs(query(collection(db, col), where('empresaId', '==', empresaId)));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 490) {
        const batch = writeBatch(db);
        docs.slice(i, i + 490).forEach(d => batch.delete(d.ref));
        await batch.commit();
        totalEliminados += Math.min(490, docs.length - i);
        onProgreso({ coleccion: col, eliminados: totalEliminados, total: -1, completa: false });
      }
    } catch {
      // colección vacía o sin permiso — continuar
    }
  }

  // Finalmente eliminar el doc de la empresa
  const batch = writeBatch(db);
  batch.delete(doc(db, 'empresas', empresaId));
  await batch.commit();
  onProgreso({ coleccion: 'empresas', eliminados: totalEliminados + 1, total: totalEliminados + 1, completa: true });
}

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
    return tenantEmpresaIdsMatch(docEmp, id);
  }
  if (id.toLowerCase() === 'bacarsa') {
    return !docEmp || docEmp.toLowerCase() === 'bacarsa';
  }
  return !docEmp || tenantEmpresaIdsMatch(docEmp, id);
}

/**
 * Propiedad estricta para escrituras/borrados (más estricto que la vista en pantalla).
 * Bacarsa legacy: docs sin empresaId o empresaId=bacarsa.
 * Otras empresas: empresaId debe coincidir exactamente.
 */
export function isTenantWriteOwner(
  data: { empresaId?: unknown },
  empresaId: string,
  migracionCompleta: boolean,
): boolean {
  const id = String(empresaId ?? '').trim();
  if (!id) return false;
  const docEmp = String(data?.empresaId ?? '').trim();
  if (id.toLowerCase() === 'bacarsa' && !migracionCompleta) {
    return !docEmp || docEmp.toLowerCase() === 'bacarsa';
  }
  return tenantEmpresaIdsMatch(docEmp, id);
}

/** Error cuando una operación CRUD apunta a un documento de otra empresa. */
export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

/** Asegura empresaId en altas/escrituras nuevas. */
export function stampEmpresaId<T extends Record<string, unknown>>(
  data: T,
  empresaId: string,
): T {
  const id = String(empresaId ?? '').trim();
  if (!id) return data;
  return { ...data, empresaId: id };
}

export async function assertDocBelongsToEmpresa(
  colName: string,
  docId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<Record<string, unknown>> {
  const snap = await getDoc(doc(db, colName, docId));
  if (!snap.exists()) throw new Error('Documento no encontrado');
  const data = snap.data() as Record<string, unknown>;
  if (!isTenantWriteOwner(data, empresaId, migracionCompleta)) {
    const docEmp = String(data.empresaId ?? '').trim() || 'sin empresa';
    throw new TenantIsolationError(
      `Operación bloqueada: el registro pertenece a «${docEmp}», no a «${empresaId}».`,
    );
  }
  return data;
}

async function deleteRefsInBatches(refs: DocumentReference[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 490) {
    const batch = writeBatch(db);
    refs.slice(i, i + 490).forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += Math.min(490, refs.length - i);
  }
  return deleted;
}

/** Borra solo documentos que pertenecen a la empresa activa. */
export async function queryAndDeleteForEmpresa(
  colName: string,
  q: Query,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<number> {
  const snap = await getDocs(q);
  const refs = snap.docs
    .filter((d) => isTenantWriteOwner(d.data(), empresaId, migracionCompleta))
    .map((d) => d.ref);
  return deleteRefsInBatches(refs);
}

export async function deleteDocsByIdsForEmpresa(
  colName: string,
  docIds: string[],
  empresaId: string,
  migracionCompleta: boolean,
): Promise<number> {
  const refs: DocumentReference[] = [];
  for (const docId of docIds) {
    const snap = await getDoc(doc(db, colName, docId));
    if (!snap.exists()) continue;
    if (!isTenantWriteOwner(snap.data(), empresaId, migracionCompleta)) continue;
    refs.push(snap.ref);
  }
  return deleteRefsInBatches(refs);
}

export async function deleteDocForEmpresa(
  colName: string,
  docId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<void> {
  await assertDocBelongsToEmpresa(colName, docId, empresaId, migracionCompleta);
  await deleteDoc(doc(db, colName, docId));
}

export async function updateDocForEmpresa(
  colName: string,
  docId: string,
  data: Record<string, unknown>,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<void> {
  await assertDocBelongsToEmpresa(colName, docId, empresaId, migracionCompleta);
  await updateDoc(doc(db, colName, docId), stampEmpresaId(data, empresaId));
}

export async function deleteEmployeeForEmpresa(
  employeeId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<void> {
  await deleteDocForEmpresa('empleados', employeeId, empresaId, migracionCompleta);
}

export async function deleteSlaForEmpresa(
  slaId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<void> {
  await deleteDocForEmpresa('servicios_sla', slaId, empresaId, migracionCompleta);
}

async function deleteDocsInBatches(refs: { ref: DocumentReference }[]): Promise<number> {
  return deleteRefsInBatches(refs.map((r) => r.ref));
}

/**
 * Elimina un cliente de la empresa activa y sus turnos/SLA del mismo tenant.
 * Si hay turnos/SLA de otra empresa con el mismo clientId (ID compartido legacy), no los borra.
 */
export async function deleteClientForEmpresa(
  clientId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<{
  deletedTurnos: number;
  deletedSla: number;
  foreignTurnosLeft: number;
  foreignSlaLeft: number;
}> {
  const clientRef = doc(db, 'clients', clientId);
  const clientSnap = await getDoc(clientRef);
  if (!clientSnap.exists()) {
    throw new Error('Cliente no encontrado');
  }
  const clientData = clientSnap.data();
  if (!isTenantWriteOwner(clientData, empresaId, migracionCompleta)) {
    const docEmp = String(clientData.empresaId ?? '').trim() || 'sin empresa';
    throw new TenantIsolationError(
      `Este cliente pertenece a «${docEmp}». No se puede eliminar desde «${empresaId}». ` +
        (docEmp.toLowerCase() === 'bacarsa' && empresaId.toLowerCase() !== 'bacarsa'
          ? 'Es un documento compartido de Bacarsa: no borres desde acá. Tras importación cross-tenant (Full), los clientes de Prueba sa tienen IDs nuevos.'
          : 'Seleccioná la empresa correcta en el selector superior.'),
    );
  }

  const [turnosSnap, slaSnap] = await Promise.all([
    getDocs(query(collection(db, 'turnos'), where('clientId', '==', clientId))),
    getDocs(query(collection(db, 'servicios_sla'), where('clientId', '==', clientId))),
  ]);

  const turnosOwned = turnosSnap.docs.filter((d) =>
    isTenantWriteOwner(d.data(), empresaId, migracionCompleta),
  );
  const slaOwned = slaSnap.docs.filter((d) =>
    isTenantWriteOwner(d.data(), empresaId, migracionCompleta),
  );
  const turnosForeign = turnosSnap.docs.filter((d) =>
    !isTenantWriteOwner(d.data(), empresaId, migracionCompleta),
  );
  const slaForeign = slaSnap.docs.filter((d) =>
    !isTenantWriteOwner(d.data(), empresaId, migracionCompleta),
  );

  const deletedTurnos = await deleteDocsInBatches(turnosOwned.map((d) => ({ ref: d.ref })));
  const deletedSla = await deleteDocsInBatches(slaOwned.map((d) => ({ ref: d.ref })));

  await deleteDoc(clientRef);
  return {
    deletedTurnos,
    deletedSla,
    foreignTurnosLeft: turnosForeign.length,
    foreignSlaLeft: slaForeign.length,
  };
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
  if (emp) return tenantEmpresaIdsMatch(emp, id);
  const cid = String(row.clientId ?? '').trim();
  return !!cid && clientIds.has(cid);
}

export function filterSlaRowsByEmpresa<T extends { empresaId?: unknown; clientId?: unknown }>(
  rows: T[],
  empresaId: string,
  scopeEmpresa: boolean,
  clientIds: Set<string>,
): T[] {
  if (!scopeEmpresa) return rows;
  return rows.filter(r => slaBelongsToEmpresa(r, empresaId, true, clientIds));
}

/** Query Firestore acotada por empresaId cuando corresponde. */
export function empresaScopedQuery(
  colName: string,
  empresaId: string,
  scopeEmpresa: boolean,
): Query | CollectionReference {
  const col = collection(db, colName);
  if (!scopeEmpresa || !String(empresaId ?? '').trim()) return col;
  return query(col, where('empresaId', '==', String(empresaId).trim()));
}

export const SUPERADMIN_EMPRESA_STORAGE_KEY = 'cosp_superadmin_empresa_id';
