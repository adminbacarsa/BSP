/**
 * Utilidades para soporte multiempresa.
 * Migración legacy planificacion_estados: `node scripts/migrate-planificacion-estados-tenant.js [--empresa bacarsa] [--stamp-turnos bacarsa]`
 * Segunda empresa lab: `node scripts/seed-empresa-prueba.js` (tras seed-lab).
 */
import {
  collection, getDocs, writeBatch, doc, setDoc, getDoc, deleteDoc, updateDoc,
  query, where, limit, orderBy, Query, CollectionReference, DocumentReference, Timestamp,
} from 'firebase/firestore';
import { auth, db, getDb } from './firebase';
import { objectiveMatchKeys } from './slaPlanningMatch';

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
      COLECCIONES.map(col => getDocs(collection(getDb(), col)))
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
  await auth.currentUser?.getIdToken(true);
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

/**
 * Propiedad para escrituras/borrados. Bacarsa: sin empresaId o empresaId=bacarsa
 * (alineado con belongsToEmpresaView y firestore bacarsaTenantDocMatches).
 * Otras empresas: empresaId debe coincidir exactamente.
 */
export function isTenantWriteOwner(
  data: { empresaId?: unknown },
  empresaId: string,
  _migracionCompleta: boolean,
): boolean {
  const id = String(empresaId ?? '').trim();
  if (!id) return false;
  const docEmp = String(data?.empresaId ?? '').trim();
  if (id.toLowerCase() === 'bacarsa') {
    return !docEmp || docEmp.toLowerCase() === 'bacarsa';
  }
  return tenantEmpresaIdsMatch(docEmp, id);
}

/** Misma regla que borrado/edición: evita listar clientes de otra empresa en CRM. */
export function canManageClientInTenant(
  data: { empresaId?: unknown },
  empresaId: string,
  migracionCompleta: boolean,
  access?: TenantAccessOpts,
): boolean {
  if (canBypassTenantWriteCheck(access)) return true;
  return isTenantWriteOwner(data, empresaId, migracionCompleta);
}

export function buildTenantBlockedMessage(
  docEmp: string,
  empresaId: string,
  action: 'editar' | 'eliminar' | 'guardar' = 'guardar',
  clientId?: string,
): string {
  const docLabel = docEmp || 'sin empresa';
  const idHint = clientId ? ` (ID: ${clientId})` : '';
  const verb =
    action === 'eliminar' ? 'eliminar' : action === 'editar' ? 'editar' : 'guardar cambios en';
  const base =
    `Este cliente pertenece a «${docLabel}». No se puede ${verb} desde «${empresaId}»${idHint}. `;
  if (docLabel.toLowerCase() === 'bacarsa' && empresaId.toLowerCase() !== 'bacarsa') {
    return (
      base +
      'Es el registro original de Bacarsa, no la copia de tu empresa. ' +
      'Usá Configuración → Empresas → «Copiar datos» (IDs nuevos) o cambiá el selector superior a Bacarsa para editar ese cliente.'
    );
  }
  return base + 'Seleccioná la empresa correcta en el selector superior.';
}

/** @deprecated Usar buildTenantBlockedMessage */
export function buildClientDeleteBlockedMessage(
  docEmp: string,
  empresaId: string,
  clientId?: string,
): string {
  return buildTenantBlockedMessage(docEmp, empresaId, 'eliminar', clientId);
}

/** Error cuando una operación CRUD apunta a un documento de otra empresa. */
export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

export type TenantAccessOpts = {
  isSuperAdmin?: boolean;
  allEmpresas?: boolean;
};

export function isTenantIsolationError(e: unknown): e is TenantIsolationError {
  return e instanceof TenantIsolationError
    || (e instanceof Error && e.name === 'TenantIsolationError');
}

export function canBypassTenantWriteCheck(opts?: TenantAccessOpts): boolean {
  return opts?.isSuperAdmin === true || opts?.allEmpresas === true;
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
    const msg =
      colName === 'clients' || colName === 'servicios_sla'
        ? buildTenantBlockedMessage(
            docEmp,
            empresaId,
            colName === 'servicios_sla' ? 'editar' : 'guardar',
            colName === 'clients' ? docId : undefined,
          ) +
          (colName === 'servicios_sla'
            ? ' Si el cliente es de tu empresa, usá «Corregir etiquetas» en el detalle del CRM.'
            : '')
        : `Operación bloqueada: el registro pertenece a «${docEmp}», no a «${empresaId}».`;
    throw new TenantIsolationError(msg);
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
  let exists = true;
  try {
    await assertDocBelongsToEmpresa(colName, docId, empresaId, migracionCompleta);
  } catch (e) {
    if (e instanceof Error && e.message === 'Documento no encontrado') {
      exists = false;
    } else {
      throw e;
    }
  }
  const stamped = stampEmpresaId(data, empresaId);
  if (exists) {
    await updateDoc(doc(db, colName, docId), stamped);
  } else {
    // El documento no existe (inconsistencia emulador / cache local). Recrear con setDoc.
    await setDoc(doc(db, colName, docId), stamped);
  }
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

export type SlaDeleteInput = {
  id: string;
  clientId?: string;
  objectiveId?: string;
  objectiveName?: string;
  startDate?: string;
  endDate?: string;
};

function turnoBelongsToSla(
  turno: Record<string, unknown>,
  sla: SlaDeleteInput,
  clientObjetivos?: Array<{ id?: string; name?: string; objectiveId?: string }>,
): boolean {
  const keys = objectiveMatchKeys(
    String(sla.objectiveId ?? sla.objectiveName ?? ''),
    clientObjetivos,
  );
  const candidates = [turno.objectiveId, turno.objectiveName];
  for (const c of candidates) {
    const v = String(c ?? '').trim();
    if (!v) continue;
    if (keys.has(v)) return true;
  }
  const slaOid = String(sla.objectiveId ?? '').trim();
  const slaName = String(sla.objectiveName ?? '').trim();
  if (slaOid && candidates.some((c) => String(c ?? '').trim() === slaOid)) return true;
  if (slaName && candidates.some((c) => String(c ?? '').trim() === slaName)) return true;
  if (sla.id && String(turno.objectiveId ?? '').trim() === sla.id) return true;
  return false;
}

/** Turnos del período del SLA (objectiveId + alias por nombre/clientId). */
export async function collectTurnoIdsForSlaDelete(
  sla: SlaDeleteInput,
  empresaId: string,
  migracionCompleta: boolean,
  clientObjetivos?: Array<{ id?: string; name?: string; objectiveId?: string }>,
): Promise<string[]> {
  const startDate = String(sla.startDate ?? '').trim();
  const endDate = String(sla.endDate ?? '').trim();
  if (!startDate || !endDate) return [];

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return [];

  const rangeStart = Timestamp.fromDate(new Date(sy, sm - 1, sd, 0, 0, 0));
  const rangeEnd = Timestamp.fromDate(new Date(ey, em - 1, ed, 23, 59, 59));
  const ids = new Set<string>();

  const consider = (docs: { id: string; data: () => Record<string, unknown> }[]) => {
    for (const d of docs) {
      if (!isTenantWriteOwner(d.data(), empresaId, migracionCompleta)) continue;
      if (turnoBelongsToSla(d.data(), sla, clientObjetivos)) ids.add(d.id);
    }
  };

  const oid = String(sla.objectiveId ?? '').trim();
  if (oid) {
    const snap = await getDocs(query(
      collection(db, 'turnos'),
      where('objectiveId', '==', oid),
      where('startTime', '>=', rangeStart),
      where('startTime', '<=', rangeEnd),
    ));
    consider(snap.docs);
  }

  const cid = String(sla.clientId ?? '').trim();
  if (cid) {
    const snap = await getDocs(query(
      collection(db, 'turnos'),
      where('clientId', '==', cid),
      where('startTime', '>=', rangeStart),
      where('startTime', '<=', rangeEnd),
    ));
    consider(snap.docs);
  }

  return [...ids];
}

async function collectLinkedDocIds(
  colName: 'ausencias' | 'novedades',
  shiftIds: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < shiftIds.length; i += 30) {
    const chunk = shiftIds.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, colName), where('shiftId', 'in', chunk)));
    snap.docs.forEach((d) => out.push(d.id));
  }
  return out;
}

/** Elimina SLA y turnos/ausencias/novedades del mismo objetivo en el rango de fechas. */
export async function deleteSlaWithRelatedDataForEmpresa(
  sla: SlaDeleteInput,
  empresaId: string,
  migracionCompleta: boolean,
  clientObjetivos?: Array<{ id?: string; name?: string; objectiveId?: string }>,
): Promise<{ deletedTurnos: number; deletedAusencias: number; deletedNovedades: number }> {
  const shiftIds = await collectTurnoIdsForSlaDelete(sla, empresaId, migracionCompleta, clientObjetivos);
  const [ausIds, novIds] = await Promise.all([
    collectLinkedDocIds('ausencias', shiftIds),
    collectLinkedDocIds('novedades', shiftIds),
  ]);

  const [deletedTurnos, deletedAusencias, deletedNovedades] = await Promise.all([
    deleteDocsByIdsForEmpresa('turnos', shiftIds, empresaId, migracionCompleta),
    deleteDocsByIdsForEmpresa('ausencias', ausIds, empresaId, migracionCompleta),
    deleteDocsByIdsForEmpresa('novedades', novIds, empresaId, migracionCompleta),
  ]);
  await deleteSlaForEmpresa(sla.id, empresaId, migracionCompleta);

  return { deletedTurnos, deletedAusencias, deletedNovedades };
}

async function deleteDocsInBatches(refs: { ref: DocumentReference }[]): Promise<number> {
  return deleteRefsInBatches(refs.map((r) => r.ref));
}

/**
 * Elimina un cliente de la empresa activa y sus turnos/SLA del mismo tenant.
 * Si hay turnos/SLA de otra empresa con el mismo clientId (ID compartido legacy), no los borra.
 */
/**
 * Re-etiqueta turnos y SLA del mismo clientId que aún tienen otra empresaId
 * (p. ej. copia incompleta: cliente prueba_sa, SLA siguen en bacarsa).
 */
export async function retagClientRelatedDocsToEmpresa(
  clientId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<{ servicios_sla: number; turnos: number }> {
  const cid = String(clientId ?? '').trim();
  const id = String(empresaId ?? '').trim();
  if (!cid || !id) throw new Error('Cliente y empresa son obligatorios.');

  const resolved = await resolveClientDocument(cid);
  if (!resolved) throw new Error(`Cliente no encontrado (ID: ${cid})`);
  if (!isTenantWriteOwner(resolved.data, id, migracionCompleta)) {
    throw new TenantIsolationError(
      buildTenantBlockedMessage(
        String(resolved.data.empresaId ?? '').trim() || 'sin empresa',
        id,
        'guardar',
        cid,
      ),
    );
  }

  const counts = { servicios_sla: 0, turnos: 0 };
  for (const col of ['servicios_sla', 'turnos'] as const) {
    const snap = await getDocs(query(collection(db, col), where('clientId', '==', cid)));
    const refs = snap.docs.filter((d) => !isTenantWriteOwner(d.data(), id, migracionCompleta));
    for (let i = 0; i < refs.length; i += 490) {
      const batch = writeBatch(db);
      refs.slice(i, i + 490).forEach((d) => batch.update(d.ref, { empresaId: id }));
      await batch.commit();
      counts[col] += Math.min(490, refs.length - i);
    }
  }
  return counts;
}

export async function countClientRelatedDocsOtherTenant(
  clientId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<{ servicios_sla: number; turnos: number }> {
  const cid = String(clientId ?? '').trim();
  const id = String(empresaId ?? '').trim();
  const out = { servicios_sla: 0, turnos: 0 };
  if (!cid || !id) return out;
  for (const col of ['servicios_sla', 'turnos'] as const) {
    const snap = await getDocs(query(collection(db, col), where('clientId', '==', cid)));
    out[col] = snap.docs.filter((d) => !isTenantWriteOwner(d.data(), id, migracionCompleta)).length;
  }
  return out;
}

export const CLIENT_DOC_COLLECTIONS = ['clients', 'clientes'] as const;
export type ClientDocCollection = (typeof CLIENT_DOC_COLLECTIONS)[number];

export type ResolvedClientDocument = {
  collection: ClientDocCollection;
  id: string;
  data: Record<string, unknown>;
};

/** IDs de clients borrados en migración Bacarsa → doc actual en Firestore. */
const KNOWN_ORPHAN_CLIENT_IDS: Record<string, string> = {
  '99yqpqc4ppY9rVXymWhx': 'DB8UZxFC4DpqGSQ3o69w',
  p9atJYpcu9oUspQMFta3: 'ujOVMbL9gK8YK6DsiLvs',
  ZlxmWiRw5qGYtIST5uZh: '8rr2FePfgQ6xY2jH0gyk',
  FzAowOV93fHQcxZhHfjN: 'NS0UBtf6zkHsm2iRRo9W',
};

/** IDs de documento clients + huérfanos legacy que apuntan al mismo cliente. */
export function getClientIdAliases(canonicalId: string): string[] {
  const id = String(canonicalId ?? '').trim();
  if (!id) return [];
  const ids = new Set<string>([id]);
  for (const [orphan, target] of Object.entries(KNOWN_ORPHAN_CLIENT_IDS)) {
    if (target === id) ids.add(orphan);
  }
  for (const [orphan, target] of Object.entries(KNOWN_ORPHAN_CLIENT_IDS)) {
    if (orphan === id) ids.add(target);
  }
  return [...ids];
}

async function loadClientDocById(clientId: string): Promise<ResolvedClientDocument | null> {
  for (const col of CLIENT_DOC_COLLECTIONS) {
    const snap = await getDoc(doc(db, col, clientId));
    if (snap.exists()) {
      return { collection: col, id: snap.id, data: snap.data() as Record<string, unknown> };
    }
  }
  return null;
}

/** Si el doc clients/{id} fue borrado en migración pero turnos siguen con clientId antiguo. */
async function resolveClientFromOrphanClientId(orphanId: string): Promise<ResolvedClientDocument | null> {
  const knownTarget = KNOWN_ORPHAN_CLIENT_IDS[orphanId];
  if (knownTarget) {
    const known = await loadClientDocById(knownTarget);
    if (known) return known;
  }

  const turnoSnap = await getDocs(
    query(collection(db, 'turnos'), where('clientId', '==', orphanId), limit(1)),
  );
  if (turnoSnap.empty) return null;

  const objectiveId = String(turnoSnap.docs[0].data()?.objectiveId ?? '').trim();
  if (!objectiveId) return null;

  const clientsSnap = await getDocs(collection(db, 'clients'));
  for (const c of clientsSnap.docs) {
    const objetivos = (c.data().objetivos || []) as Array<{ id?: string }>;
    if (objetivos.some(o => String(o?.id ?? '') === objectiveId)) {
      return { collection: 'clients', id: c.id, data: c.data() as Record<string, unknown> };
    }
  }
  return null;
}

/** Busca el cliente en `clients` y, si no existe, en `clientes` (legacy NestJS). */
export async function resolveClientDocument(clientId: string): Promise<ResolvedClientDocument | null> {
  const id = String(clientId ?? '').trim();
  if (!id) return null;
  for (const col of CLIENT_DOC_COLLECTIONS) {
    const snap = await getDoc(doc(db, col, id));
    if (snap.exists()) {
      return { collection: col, id: snap.id, data: snap.data() as Record<string, unknown> };
    }
  }
  return resolveClientFromOrphanClientId(id);
}

export function dedupeClientsById<T extends { id?: unknown }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.set(id, row);
  }
  return [...seen.values()];
}

export async function assertClientWritableForEmpresa(
  clientId: string,
  empresaId: string,
  migracionCompleta: boolean,
  action: 'guardar' | 'eliminar' = 'guardar',
  access?: TenantAccessOpts,
): Promise<{ id: string; collection: ClientDocCollection; [key: string]: unknown }> {
  const resolved = await resolveClientDocument(clientId);
  if (!resolved) {
    throw new Error(
      `Cliente no encontrado (ID: ${clientId}). El registro pudo haberse eliminado en una migración. ` +
      'Refrescá el listado (F5). Si persiste, avisá a soporte para re-vincular turnos huérfanos.',
    );
  }
  if (!canManageClientInTenant(resolved.data, empresaId, migracionCompleta, access)) {
    const docEmp = String(resolved.data.empresaId ?? '').trim() || 'sin empresa';
    throw new TenantIsolationError(buildTenantBlockedMessage(docEmp, empresaId, action, resolved.id));
  }
  // El spread al final: algunos docs legacy traen `id` distinto al docId de Firestore.
  return { ...resolved.data, id: resolved.id, collection: resolved.collection };
}

function stripClientMetaFromPatch(data: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, collection: _col, ...patch } = data;
  return patch;
}

export async function updateClientForEmpresa(
  clientId: string,
  data: Record<string, unknown>,
  empresaId: string,
  migracionCompleta: boolean,
  access?: TenantAccessOpts,
): Promise<ClientDocCollection> {
  const resolved = await assertClientWritableForEmpresa(
    clientId,
    empresaId,
    migracionCompleta,
    'guardar',
    access,
  );
  await updateDocForEmpresa(
    resolved.collection,
    resolved.id,
    stripClientMetaFromPatch(data),
    empresaId,
    migracionCompleta,
  );
  return resolved.collection;
}

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
  const resolved = await resolveClientDocument(clientId);
  if (!resolved) {
    throw new Error(
      `Cliente no encontrado (ID: ${clientId}). Refrescá el listado o verificá que el registro exista en Firestore.`,
    );
  }
  const clientData = resolved.data;
  if (!isTenantWriteOwner(clientData, empresaId, migracionCompleta)) {
    const docEmp = String(clientData.empresaId ?? '').trim() || 'sin empresa';
    throw new TenantIsolationError(
      buildClientDeleteBlockedMessage(docEmp, empresaId, clientId),
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

  await deleteDoc(doc(db, resolved.collection, clientId));
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
  if (!scopeEmpresa) return rows;
  return rows.filter(r => slaBelongsToEmpresa(r, empresaId, true, clientIds));
}

/** Query Firestore acotada por empresaId cuando corresponde. */
export function empresaScopedQuery(
  colName: string,
  empresaId: string,
  scopeEmpresa: boolean,
): Query | CollectionReference {
  if (typeof window === 'undefined') {
    throw new Error('empresaScopedQuery: solo disponible en el cliente');
  }
  const path = String(colName ?? '').trim();
  if (!path) {
    throw new Error('empresaScopedQuery: colName inválido');
  }
  const col = collection(getDb(), path);
  if (!scopeEmpresa || !String(empresaId ?? '').trim()) return col;
  return query(col, where('empresaId', '==', String(empresaId).trim()));
}

/**
 * Query tenant: Bacarsa incluye documentos legacy sin empresaId (no aparecen en equality filter).
 * El filtro belongsToEmpresaView descarta otras empresas en memoria.
 */
export function empresaCollectionQuery(
  colName: string,
  empresaId: string,
  scopeEmpresa: boolean,
): Query | CollectionReference {
  const col = collection(getDb(), String(colName ?? '').trim());
  const id = String(empresaId ?? '').trim();
  if (!scopeEmpresa || !id) return col;
  if (id.toLowerCase() === 'bacarsa') return col;
  return query(col, where('empresaId', '==', id));
}

/** Timestamp de audit_logs → ms (ordenamiento en cliente). */
export function auditLogTimestampMs(data: { timestamp?: unknown }): number {
  const ts = data?.timestamp as { toDate?: () => Date; seconds?: number } | undefined;
  if (ts?.toDate) return ts.toDate().getTime();
  if (typeof ts?.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

/**
 * Query de audit_logs acotada por tenant.
 * Empresas con scope: equality en empresaId (+ orderBy timestamp si hay índice).
 * Bacarsa legacy: últimos N globales; filtrar con belongsToEmpresaView en memoria.
 */
export function buildAuditLogsRecentQuery(
  empresaId: string,
  scopeEmpresa: boolean,
  opts?: { limit?: number; since?: Date },
): Query {
  const limitN = opts?.limit ?? 80;
  const id = String(empresaId ?? '').trim();
  const tenantScoped = scopeEmpresa && !!id && id.toLowerCase() !== 'bacarsa';

  if (tenantScoped) {
    const base = empresaCollectionQuery('audit_logs', empresaId, true);
    if (opts?.since) {
      return query(
        base as Query,
        where('timestamp', '>=', Timestamp.fromDate(opts.since)),
        orderBy('timestamp', 'desc'),
        limit(limitN),
      );
    }
    return query(base as Query, orderBy('timestamp', 'desc'), limit(limitN));
  }

  const col = collection(db, 'audit_logs');
  if (opts?.since) {
    return query(
      col,
      where('timestamp', '>=', Timestamp.fromDate(opts.since)),
      orderBy('timestamp', 'desc'),
      limit(limitN),
    );
  }
  return query(col, orderBy('timestamp', 'desc'), limit(limitN));
}

/** Ordena y limita filas de audit ya filtradas por tenant. */
export function sortAuditLogRows<T extends { timestamp?: number }>(rows: T[], max = 20): T[] {
  return [...rows].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, max);
}

export const SUPERADMIN_EMPRESA_STORAGE_KEY = 'cosp_superadmin_empresa_id';

/** ID Firestore: `${empresaId}_${objectiveId}_${year}_${month}` (legacy sin empresaId: `${objectiveId}_${year}_${month}`).
 *  Migración: al publicar de nuevo se crea doc con prefijo tenant; lecturas usan fetchPlanificacionEstadoDoc (fallback legacy). */
export function buildPlanificacionEstadoDocId(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): string {
  const e = String(empresaId ?? '').trim();
  const o = String(objectiveId ?? '').trim();
  if (e) return `${e}_${o}_${year}_${month}`;
  return `${o}_${year}_${month}`;
}

/** Clave interna para mapas UI (sin tenant): `${objectiveId}_${year}_${month}`. */
export function planificacionPublishLookupKey(objectiveId: string, year: number, month: number): string {
  return `${String(objectiveId ?? '').trim()}_${year}_${month}`;
}

export function parsePlanificacionEstadoDocId(docId: string): {
  empresaId?: string;
  objectiveId: string;
  year: number;
  month: number;
} | null {
  const parts = String(docId ?? '').split('_');
  if (parts.length < 3) return null;
  const month = parseInt(parts[parts.length - 1], 10);
  const year = parseInt(parts[parts.length - 2], 10);
  if (!Number.isFinite(month) || !Number.isFinite(year) || year < 2000) return null;
  if (parts.length === 3) {
    return { objectiveId: parts[0], year, month };
  }
  if (parts.length === 4) {
    return { empresaId: parts[0], objectiveId: parts[1], year, month };
  }
  return {
    empresaId: parts[0],
    objectiveId: parts.slice(1, -2).join('_'),
    year,
    month,
  };
}

/** Resuelve doc id tenant-aware; prueba formato nuevo y legacy `${objectiveId}_${year}_${month}`. */
export async function fetchPlanificacionEstadoDoc(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const primaryId = buildPlanificacionEstadoDocId(empresaId, objectiveId, year, month);
  const primary = await getDoc(doc(db, 'planificacion_estados', primaryId));
  if (primary.exists()) {
    return { id: primary.id, data: primary.data() as Record<string, unknown> };
  }
  const legacyId = buildPlanificacionEstadoDocId('', objectiveId, year, month);
  if (legacyId === primaryId) return null;
  const legacy = await getDoc(doc(db, 'planificacion_estados', legacyId));
  if (legacy.exists()) {
    return { id: legacy.id, data: legacy.data() as Record<string, unknown> };
  }
  return null;
}

/** Fusiona tenant + legacy: puestos/bandas de ambos docs; trailing del primero que lo tenga.
 *  publishedAt: si existe doc tenant, manda ese (aunque no tenga publishedAt = borrador).
 *  No heredar publishedAt legacy si el doc tenant ya existe sin publicar. */
export async function fetchMergedPlanificacionEstadoData(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): Promise<Record<string, unknown>> {
  const primaryId = buildPlanificacionEstadoDocId(empresaId, objectiveId, year, month);
  const legacyId = buildPlanificacionEstadoDocId('', objectiveId, year, month);
  const ids = [primaryId, legacyId].filter((id, index, arr) => arr.indexOf(id) === index);

  let merged: Record<string, unknown> = {};
  let trailingFrom: Record<string, unknown> | null = null;
  let primaryExists = false;
  let primaryPublishedAt: unknown = undefined;
  let primaryPublishedBy: unknown = undefined;
  let legacyPublishedAt: unknown = undefined;
  let legacyPublishedBy: unknown = undefined;

  for (const id of ids) {
    const snap = await getDoc(doc(db, 'planificacion_estados', id));
    if (!snap.exists()) continue;
    const d = snap.data() as Record<string, unknown>;
    const isPrimary = id === primaryId;
    if (isPrimary) {
      primaryExists = true;
      primaryPublishedAt = d.publishedAt;
      primaryPublishedBy = d.publishedBy;
    } else {
      legacyPublishedAt = d.publishedAt;
      legacyPublishedBy = d.publishedBy;
    }
    merged = {
      ...merged,
      defaultPositionByEmp: {
        ...((merged.defaultPositionByEmp as Record<string, string>) || {}),
        ...((d.defaultPositionByEmp as Record<string, string>) || {}),
      },
      defaultShiftByEmp: {
        ...((merged.defaultShiftByEmp as Record<string, string>) || {}),
        ...((d.defaultShiftByEmp as Record<string, string>) || {}),
      },
    };
    if (!trailingFrom && (d.lastShiftByEmp || d.trailingWorkDays)) {
      trailingFrom = d;
    }
  }

  if (primaryExists) {
    if (primaryPublishedAt != null && primaryPublishedAt !== '') {
      merged.publishedAt = primaryPublishedAt;
      merged.publishedBy = primaryPublishedBy;
    }
  } else if (legacyPublishedAt != null && legacyPublishedAt !== '') {
    merged.publishedAt = legacyPublishedAt;
    merged.publishedBy = legacyPublishedBy;
  }

  if (trailingFrom) {
    merged = {
      ...merged,
      trailingWorkDays: trailingFrom.trailingWorkDays,
      trailingRestDays: trailingFrom.trailingRestDays,
      lastShiftByEmp: trailingFrom.lastShiftByEmp,
      lastWorkBandBeforeRest: trailingFrom.lastWorkBandBeforeRest,
    };
  }

  return merged;
}
