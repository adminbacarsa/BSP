import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import {
  STAFF_APP_MODULE_KEYS,
  buildStaffModulesPayload,
  fullStaffModulePermissions,
  resolvePanelUserForUid,
  type StaffAppModuleKey,
} from './staffPermissions';

export type ResolveStaffProfileResponse = {
  isGuard: boolean;
  employeeId?: string;
  isStaff: boolean;
  isSuperAdmin: boolean;
  empresas: { id: string; name: string }[];
  modules: Record<StaffAppModuleKey, string[]>;
};

async function loadEmpresasForUser(
  db: Firestore,
  opts: {
    isSuperAdmin: boolean;
    allEmpresas: boolean;
    empresaId: string;
    empresaIds?: string[];
    guardEmpresaId?: string;
  },
): Promise<{ id: string; name: string }[]> {
  const { isSuperAdmin, allEmpresas, empresaId, empresaIds, guardEmpresaId } = opts;
  if (isSuperAdmin || allEmpresas) {
    const snap = await db.collection('empresas').limit(200).get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({
        id: d.id,
        name: String(d.data()?.name || d.id),
      }));
    }
  }
  const ids = (empresaIds && empresaIds.length > 0)
    ? [...new Set(empresaIds.map((x) => String(x || '').trim()).filter(Boolean))]
    : [String(empresaId || guardEmpresaId || '').trim()].filter(Boolean);
  if (ids.length === 0) return [];
  const out: { id: string; name: string }[] = [];
  for (const id of ids) {
    const doc = await db.collection('empresas').doc(id).get();
    out.push({ id, name: doc.exists ? String(doc.data()?.name || id) : id });
  }
  return out;
}

export async function resolveStaffProfileForUid(
  db: Firestore,
  uid: string,
  tokenRole?: unknown,
): Promise<ResolveStaffProfileResponse> {
  const panel = await resolvePanelUserForUid(db, uid, tokenRole);
  const empSnap = await db.collection('empleados').where('uid', '==', uid).limit(5).get();
  let employeeId: string | undefined;
  let guardEmpresaId = '';
  for (const d of empSnap.docs) {
    const st = String(d.data()?.status || 'ACTIVE').toUpperCase();
    if (st === 'INACTIVE') continue;
    employeeId = d.id;
    guardEmpresaId = String(d.data()?.empresaId || '');
    break;
  }

  const isGuard = !!employeeId;
  const isStaff = !!panel;
  const isSuperAdmin = panel?.isSuperAdmin === true;

  let modules = {} as Record<StaffAppModuleKey, string[]>;
  if (isSuperAdmin) {
    modules = fullStaffModulePermissions();
  } else if (panel) {
    modules = buildStaffModulesPayload(panel.permissions as Record<string, unknown>);
  } else {
    for (const k of STAFF_APP_MODULE_KEYS) modules[k] = [];
  }

  const empresas = await loadEmpresasForUser(db, {
    isSuperAdmin,
    allEmpresas: panel?.allEmpresas === true,
    empresaId: panel?.empresaId || '',
    empresaIds: panel?.empresaIds,
    guardEmpresaId,
  });

  return {
    isGuard,
    ...(employeeId ? { employeeId } : {}),
    isStaff,
    isSuperAdmin,
    empresas,
    modules,
  };
}

export const resolveStaffProfileCallable = functions.https.onCall(async (_data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  return resolveStaffProfileForUid(admin.firestore(), context.auth.uid, context.auth.token?.role);
});

/** Permisos del rol efectivo para la empresa activa (Admin SDK; no depende de rules de `roles/`). */
export const resolvePanelPermissionsCallable = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const empresaId = String((data as { empresaId?: string })?.empresaId ?? '').trim();
  const panel = await resolvePanelUserForUid(
    admin.firestore(),
    context.auth.uid,
    context.auth.token?.role,
    'Operador',
    empresaId || undefined,
  );
  if (!panel) {
    return { permissions: {} as Record<string, string[]>, roleName: null, isSuperAdmin: false };
  }
  return {
    permissions: panel.permissions || {},
    roleName: panel.roleName || null,
    isSuperAdmin: panel.isSuperAdmin === true,
  };
});
