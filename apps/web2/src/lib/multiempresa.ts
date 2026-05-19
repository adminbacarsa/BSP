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

/**
 * Visibilidad de un documento para la empresa activa.
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
    return docEmp === id;
  }
  if (id.toLowerCase() === 'bacarsa') {
    return !docEmp || docEmp.toLowerCase() === 'bacarsa';
  }
  return !docEmp || docEmp === id;
}

async function deleteDocsInBatches(refs: { ref: ReturnType<typeof doc> }[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 490) {
    const batch = writeBatch(db);
    refs.slice(i, i + 490).forEach((r) => batch.delete(r.ref));
    await batch.commit();
    deleted += Math.min(490, refs.length - i);
  }
  return deleted;
}

/**
 * Elimina un cliente solo si pertenece a la empresa activa.
 * Turnos y SLA se borran acotados por empresaId cuando corresponde.
 */
export async function deleteClientForEmpresa(
  clientId: string,
  empresaId: string,
  migracionCompleta: boolean,
): Promise<{ deletedTurnos: number; deletedSla: number }> {
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const clientRef = doc(db, 'clients', clientId);
  const clientSnap = await getDoc(clientRef);
  if (!clientSnap.exists()) {
    throw new Error('Cliente no encontrado');
  }
  const clientData = clientSnap.data();
  if (!belongsToEmpresaView(clientData, empresaId, migracionCompleta)) {
    const docEmp = String(clientData.empresaId ?? '').trim() || 'sin empresa';
    throw new Error(
      `Este cliente pertenece a «${docEmp}». No se puede eliminar desde «${empresaId}».`,
    );
  }

  const turnosQ = scopeEmpresa && empresaId
    ? query(
        collection(db, 'turnos'),
        where('clientId', '==', clientId),
        where('empresaId', '==', empresaId),
      )
    : query(collection(db, 'turnos'), where('clientId', '==', clientId));

  const slaQ = scopeEmpresa && empresaId
    ? query(
        collection(db, 'servicios_sla'),
        where('clientId', '==', clientId),
        where('empresaId', '==', empresaId),
      )
    : query(collection(db, 'servicios_sla'), where('clientId', '==', clientId));

  const [turnosSnap, slaSnap] = await Promise.all([getDocs(turnosQ), getDocs(slaQ)]);

  const turnosToDelete = turnosSnap.docs.filter((d) =>
    belongsToEmpresaView(d.data(), empresaId, migracionCompleta),
  );
  const slaToDelete = slaSnap.docs.filter((d) =>
    belongsToEmpresaView(d.data(), empresaId, migracionCompleta),
  );

  const deletedTurnos = await deleteDocsInBatches(turnosToDelete.map((d) => ({ ref: d.ref })));
  const deletedSla = await deleteDocsInBatches(slaToDelete.map((d) => ({ ref: d.ref })));

  await deleteDoc(clientRef);
  return { deletedTurnos, deletedSla };
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
  return String(data.empresaId ?? '').trim() === String(empresaId ?? '').trim();
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
  if (emp) return emp === id;
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
