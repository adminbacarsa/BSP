import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import {
  NOVEDAD_TYPE_SEEDS,
  type NovedadType,
  type NovedadTypeStatus,
} from '@/lib/rrhh/novedadTypes';
import type { AbsenceCode } from '@/lib/rrhh/novedadTypeCodes';

const COLLECTION = 'tipos_novedad';

/** Evita doble seed si RRHH + pestaña Tipos llaman a la vez (o Strict Mode). */
const ensureInflight = new Map<string, Promise<NovedadType[]>>();

function normLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

function mapDoc(id: string, data: Record<string, unknown>): NovedadType {
  const daysRaw = data.defaultDays;
  let defaultDays: number | null = null;
  if (typeof daysRaw === 'number' && Number.isFinite(daysRaw) && daysRaw > 0) {
    defaultDays = Math.floor(daysRaw);
  }
  const status = String(data.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  return {
    id,
    empresaId: data.empresaId ? String(data.empresaId) : undefined,
    label: String(data.label || '').trim(),
    code: (String(data.code || 'L').toUpperCase() as AbsenceCode) || 'L',
    defaultDays,
    requiresAuth: data.requiresAuth !== false,
    medicalVerification: data.medicalVerification === true,
    status: status as NovedadTypeStatus,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 999,
    isSystem: data.isSystem === true,
  };
}

function seedPayload(seed: (typeof NOVEDAD_TYPE_SEEDS)[number], empresaId: string) {
  return stampEmpresaId(
    {
      label: seed.label,
      code: seed.code,
      defaultDays: seed.defaultDays,
      requiresAuth: seed.requiresAuth,
      medicalVerification: seed.medicalVerification,
      status: 'ACTIVE',
      sortOrder: seed.sortOrder,
      isSystem: true,
    } as Record<string, unknown>,
    empresaId,
  );
}

/**
 * Deja un solo ACTIVE por label (case-insensitive).
 * Conserva el de menor sortOrder / id; el resto pasa a INACTIVE.
 */
async function deactivateDuplicateActives(rows: NovedadType[]): Promise<number> {
  const byLabel = new Map<string, NovedadType[]>();
  for (const row of rows) {
    if (row.status !== 'ACTIVE' || !row.id) continue;
    const key = normLabel(row.label);
    const bucket = byLabel.get(key) || [];
    bucket.push(row);
    byLabel.set(key, bucket);
  }

  const toDeactivate: string[] = [];
  for (const bucket of byLabel.values()) {
    if (bucket.length < 2) continue;
    bucket.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        String(a.id).localeCompare(String(b.id)),
    );
    for (const dup of bucket.slice(1)) {
      if (dup.id) toDeactivate.push(dup.id);
    }
  }

  if (toDeactivate.length === 0) return 0;

  const CHUNK = 400;
  for (let i = 0; i < toDeactivate.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const id of toDeactivate.slice(i, i + CHUNK)) {
      batch.update(doc(db, COLLECTION, id), { status: 'INACTIVE' });
    }
    await batch.commit();
  }
  return toDeactivate.length;
}

async function ensureSeededOnce(empresaId: string): Promise<NovedadType[]> {
  let existing = await novedadTypeService.listByEmpresa(empresaId);

  // Limpiar duplicados de seeds concurrentes previos
  const deactivated = await deactivateDuplicateActives(existing);
  if (deactivated > 0) {
    existing = await novedadTypeService.listByEmpresa(empresaId);
  }

  const present = new Set(
    existing
      .filter((t) => t.status === 'ACTIVE')
      .map((t) => normLabel(t.label)),
  );

  const missing = NOVEDAD_TYPE_SEEDS.filter((s) => !present.has(normLabel(s.label)));
  if (missing.length === 0) return existing;

  const batch = writeBatch(db);
  for (const seed of missing) {
    const ref = doc(collection(db, COLLECTION));
    batch.set(ref, seedPayload(seed, empresaId));
  }
  await batch.commit();
  return novedadTypeService.listByEmpresa(empresaId);
}

export const novedadTypeService = {
  listByEmpresa: async (empresaId: string): Promise<NovedadType[]> => {
    const id = String(empresaId || '').trim();
    if (!id) return [];
    const snap = await getDocs(query(collection(db, COLLECTION), where('empresaId', '==', id)));
    return snap.docs
      .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
      .filter((t) => t.label)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es'));
  },

  listActiveLabels: async (empresaId: string): Promise<string[]> => {
    const rows = await novedadTypeService.listByEmpresa(empresaId);
    return rows.filter((r) => r.status === 'ACTIVE').map((r) => r.label);
  },

  /**
   * Siembra tipos faltantes del catálogo (incl. MAVIC) y desactiva duplicados ACTIVE
   * por misma etiqueta. Seguro ante llamadas concurrentes.
   */
  ensureSeeded: async (empresaId: string): Promise<NovedadType[]> => {
    const id = String(empresaId || '').trim();
    if (!id) return [];

    const running = ensureInflight.get(id);
    if (running) return running;

    const promise = ensureSeededOnce(id).finally(() => {
      ensureInflight.delete(id);
    });
    ensureInflight.set(id, promise);
    return promise;
  },

  create: async (
    empresaId: string,
    data: {
      label: string;
      code: AbsenceCode;
      defaultDays: number | null;
      requiresAuth: boolean;
      medicalVerification: boolean;
      sortOrder?: number;
    },
  ) => {
    const id = String(empresaId || '').trim();
    const label = String(data.label || '').trim();
    if (!id || !label) throw new Error('Empresa y etiqueta son obligatorios');

    const existing = await novedadTypeService.listByEmpresa(id);
    const dup = existing.find(
      (t) => t.status === 'ACTIVE' && normLabel(t.label) === normLabel(label),
    );
    if (dup) throw new Error('Ya existe un tipo activo con ese nombre');

    return addDoc(
      collection(db, COLLECTION),
      stampEmpresaId(
        {
          label,
          code: data.code,
          defaultDays: data.defaultDays,
          requiresAuth: data.requiresAuth,
          medicalVerification: data.medicalVerification,
          status: 'ACTIVE',
          sortOrder: data.sortOrder ?? 500,
          isSystem: false,
        } as Record<string, unknown>,
        id,
      ),
    );
  },

  update: async (
    docId: string,
    data: Partial<{
      label: string;
      code: AbsenceCode;
      defaultDays: number | null;
      requiresAuth: boolean;
      medicalVerification: boolean;
      sortOrder: number;
      status: NovedadTypeStatus;
    }>,
  ) => {
    const payload: Record<string, unknown> = {};
    if (data.label !== undefined) payload.label = String(data.label).trim();
    if (data.code !== undefined) payload.code = data.code;
    if (data.defaultDays !== undefined) {
      payload.defaultDays =
        data.defaultDays != null && data.defaultDays > 0 ? Math.floor(data.defaultDays) : null;
    }
    if (data.requiresAuth !== undefined) payload.requiresAuth = data.requiresAuth;
    if (data.medicalVerification !== undefined) payload.medicalVerification = data.medicalVerification;
    if (data.sortOrder !== undefined) payload.sortOrder = data.sortOrder;
    if (data.status !== undefined) payload.status = data.status;
    await updateDoc(doc(db, COLLECTION, docId), payload);
  },

  /** Soft delete — no borra el documento. */
  deactivate: async (docId: string) => {
    await updateDoc(doc(db, COLLECTION, docId), { status: 'INACTIVE' });
  },

  reactivate: async (docId: string) => {
    await updateDoc(doc(db, COLLECTION, docId), { status: 'ACTIVE' });
  },
};
