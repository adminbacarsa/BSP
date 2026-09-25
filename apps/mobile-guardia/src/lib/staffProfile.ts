import { httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  type Firestore,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
  fullSuperAdminModules,
  normalizeStaffProfile,
  type StaffEmpresa,
  type StaffProfile,
} from '@cosp/ops-core';
import { resolveEmpDocIdWithRetry } from '@cosp/portal-core';
import { getPortalCoreConfig, getPortalFirebase } from './portal';
import { isSuperAdminRole, userIsSuperAdmin } from './superAdmin';

function normalizeRoleDocId(role: string): string {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

function mapCallableError(err: unknown): Error {
  if (err instanceof Error && err.message) {
    const cleaned = err.message
      .replace(/^Firebase:\s*/i, '')
      .replace(/\s*\(functions\/[^)]+\)\.?$/, '')
      .trim();
    return new StaffProfileResolveError(cleaned || err.message);
  }
  return new StaffProfileResolveError('No se pudo resolver el perfil de acceso.');
}

/** Error de resolveStaffProfile en producción (sin stub). */
export class StaffProfileResolveError extends Error {
  readonly name = 'StaffProfileResolveError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Stub local SOLO para lab (emulador) cuando Functions no está disponible.
 * En producción nunca se usa como fallback silencioso.
 */
export async function resolveStaffProfileLocal(
  user: User,
  db: Firestore,
): Promise<StaffProfile> {
  const superAdmin = await userIsSuperAdmin(user);
  let employeeId: string | null = null;
  try {
    employeeId = await resolveEmpDocIdWithRetry(db, user, 2);
  } catch {
    employeeId = null;
  }
  const isGuard = !!employeeId;

  let isStaff = superAdmin;
  let modules: Record<string, string[]> = {};
  const empresas: StaffEmpresa[] = [];

  try {
    const sysSnap = await getDoc(doc(db, 'system_users', user.uid));
    if (sysSnap.exists()) {
      isStaff = true;
      const data = sysSnap.data();
      const role = String(data.role || '').trim();
      const allEmpresas = data.allEmpresas === true;
      const empresaId = String(data.empresaId || '').trim();

      if (superAdmin || isSuperAdminRole(role)) {
        modules = fullSuperAdminModules();
      } else if (role) {
        const roleSnap = await getDoc(doc(db, 'roles', normalizeRoleDocId(role)));
        if (roleSnap.exists()) {
          modules = (roleSnap.data()?.permissions || {}) as Record<string, string[]>;
        }
      }

      if (allEmpresas || superAdmin || isSuperAdminRole(role)) {
        const empSnap = await getDocs(query(collection(db, 'empresas')));
        for (const d of empSnap.docs) {
          const ed = d.data();
          if (ed.status === 'INACTIVE') continue;
          empresas.push({
            id: d.id,
            name: String(ed.nombre || ed.name || d.id),
          });
        }
      } else if (empresaId) {
        const one = await getDoc(doc(db, 'empresas', empresaId));
        if (one.exists()) {
          const ed = one.data();
          empresas.push({
            id: one.id,
            name: String(ed.nombre || ed.name || one.id),
          });
        } else {
          empresas.push({ id: empresaId, name: empresaId });
        }
      }
    }
  } catch {
    /* sin system_users: solo guardia */
  }

  if (superAdmin) {
    isStaff = true;
    modules = fullSuperAdminModules();
    if (empresas.length === 0) {
      try {
        const empSnap = await getDocs(query(collection(db, 'empresas')));
        for (const d of empSnap.docs) {
          const ed = d.data();
          if (ed.status === 'INACTIVE') continue;
          empresas.push({
            id: d.id,
            name: String(ed.nombre || ed.name || d.id),
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  return {
    isGuard,
    employeeId,
    isStaff,
    isSuperAdmin: superAdmin,
    empresas,
    modules,
  };
}

/**
 * Callable Plataforma `resolveStaffProfile`.
 * Stub local únicamente si USE_EMULATOR y la callable falla (Functions apagado).
 * En producción, el error se propaga al UI.
 */
export async function resolveStaffProfileForUser(user: User): Promise<StaffProfile> {
  const { db, functions } = getPortalFirebase();
  const useEmulator = getPortalCoreConfig().useEmulator === true;

  try {
    const callable = httpsCallable<Record<string, never>, unknown>(functions, 'resolveStaffProfile');
    const { data } = await callable({});
    const normalized = normalizeStaffProfile(data);
    if (normalized) return normalized;
    throw new StaffProfileResolveError('Respuesta inválida de resolveStaffProfile.');
  } catch (err) {
    if (err instanceof StaffProfileResolveError) {
      if (useEmulator) return resolveStaffProfileLocal(user, db);
      throw err;
    }
    if (useEmulator) {
      return resolveStaffProfileLocal(user, db);
    }
    throw mapCallableError(err);
  }
}

/** ¿El usuario puede usar la app? Guardia y/o staff. */
export function profileCanEnterApp(profile: StaffProfile): boolean {
  return profile.isGuard || profile.isStaff || profile.isSuperAdmin;
}
