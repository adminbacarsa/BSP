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
    guardEmpresaId?: string;
  },
): Promise<{ id: string; name: string }[]> {
  const { isSuperAdmin, allEmpresas, empresaId, guardEmpresaId } = opts;
  if (isSuperAdmin || allEmpresas) {
    const snap = await db.collection('empresas').limit(200).get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({
        id: d.id,
        name: String(d.data()?.name || d.id),
      }));
    }
  }
  const primary = String(empresaId || guardEmpresaId || '').trim();
  if (!primary) return [];
  const doc = await db.collection('empresas').doc(primary).get();
  const name = doc.exists ? String(doc.data()?.name || primary) : primary;
  return [{ id: primary, name }];
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
