import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { isSuperAdminRole, normalizeRoleId } from '../common/role.util';

/** Módulos expuestos a la app staff multi-rol (alineado con config/modules.ts). */
export const STAFF_APP_MODULE_KEYS = ['OPERATIONS', 'SUPERVISION', 'RRHH', 'PLANNING'] as const;
export type StaffAppModuleKey = (typeof STAFF_APP_MODULE_KEYS)[number];

const BASE_ACTIONS = ['read', 'create', 'update', 'delete'] as const;
const MODULE_ONLY_ACTIONS: Record<string, readonly string[]> = {
  PLANNING: ['publish', 'correct', 'auto_lab', 'assign_ft'],
  RRHH: ['adjust'],
};

export function fullStaffModulePermissions(): Record<StaffAppModuleKey, string[]> {
  const out = {} as Record<StaffAppModuleKey, string[]>;
  for (const key of STAFF_APP_MODULE_KEYS) {
    const extra = MODULE_ONLY_ACTIONS[key] ?? [];
    out[key] = [...BASE_ACTIONS, ...extra];
  }
  return out;
}

export function moduleActionsFromRolePermissions(
  permissions: Record<string, unknown>,
  moduleKey: StaffAppModuleKey,
): string[] {
  const raw = permissions[moduleKey];
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>([...BASE_ACTIONS, ...(MODULE_ONLY_ACTIONS[moduleKey] ?? [])]);
  return raw.filter((a): a is string => typeof a === 'string' && allowed.has(a));
}

export function buildStaffModulesPayload(
  permissions: Record<string, unknown>,
): Record<StaffAppModuleKey, string[]> {
  const out = {} as Record<StaffAppModuleKey, string[]>;
  for (const key of STAFF_APP_MODULE_KEYS) {
    out[key] = moduleActionsFromRolePermissions(permissions, key);
  }
  return out;
}

export type ResolvedPanelUser = {
  isSuperAdmin: boolean;
  allEmpresas: boolean;
  empresaId: string;
  roleName: string;
  permissions: Record<string, string[]>;
  operatorName: string;
};

export async function resolvePanelUserForUid(
  db: Firestore,
  uid: string,
  tokenRoleRaw?: unknown,
  operatorNameFallback = 'Operador',
): Promise<ResolvedPanelUser | null> {
  const tokenRole = String(tokenRoleRaw ?? '').trim();
  const sys = await db.collection('system_users').doc(uid).get();
  // Igual que AuthContext de web2: SuperAdmin por claim aunque no tenga doc en system_users.
  if (!sys.exists) {
    if (!isSuperAdminRole(tokenRole)) return null;
    return {
      isSuperAdmin: true,
      allEmpresas: true,
      empresaId: '',
      roleName: tokenRole,
      permissions: fullStaffModulePermissions() as unknown as Record<string, string[]>,
      operatorName: operatorNameFallback,
    };
  }

  const data = sys.data() ?? {};
  const role = String(data.role || '').trim();
  const allEmpresas = data.allEmpresas === true;
  let isSuper = isSuperAdminRole(role) || isSuperAdminRole(tokenRole);
  let permissions: Record<string, string[]> = {};

  if (isSuper) {
    permissions = fullStaffModulePermissions() as unknown as Record<string, string[]>;
    const superKeys = [
      'DASHBOARD', 'OPERATIONS', 'PLANNING', 'PLANNING_AI', 'RRHH', 'CLIENTS',
      'SERVICES', 'REPORTS', 'ANALYSIS', 'ASSISTANT', 'CONFIG', 'SUPERVISION',
    ];
    for (const k of superKeys) {
      if (!permissions[k]) {
        permissions[k] = [...BASE_ACTIONS, ...(MODULE_ONLY_ACTIONS[k] ?? [])];
      }
    }
    permissions.PLANNING = [...BASE_ACTIONS, ...MODULE_ONLY_ACTIONS.PLANNING];
    permissions.RRHH = [...BASE_ACTIONS, ...MODULE_ONLY_ACTIONS.RRHH];
  } else if (role) {
    const roleSnap = await db.collection('roles').doc(normalizeRoleId(role)).get();
    if (roleSnap.exists) {
      const roleData = roleSnap.data() ?? {};
      const roleEmp = String(roleData.empresaId ?? '').trim();
      const userEmp = String(data.empresaId || 'bacarsa').trim();
      if (!allEmpresas && roleEmp && userEmp && roleEmp.toLowerCase() !== userEmp.toLowerCase()) {
        permissions = {};
      } else {
        permissions = (roleData.permissions ?? {}) as Record<string, string[]>;
      }
    }
  }

  if (!isSuper && isSuperAdminRole(tokenRole)) {
    isSuper = true;
    permissions = fullStaffModulePermissions() as unknown as Record<string, string[]>;
  }

  const operatorName =
    String(data.displayName || data.name || data.email || '').trim()
    || String(data.email || '').split('@')[0]
    || 'Operador';

  const empresaId = isSuper || allEmpresas
    ? String(data.empresaId ?? '').trim()
    : String(data.empresaId || 'bacarsa').trim();

  return {
    isSuperAdmin: isSuper,
    allEmpresas,
    empresaId,
    roleName: role || tokenRole,
    permissions,
    operatorName,
  };
}

export async function assertOperationsUpdatePermission(
  db: Firestore,
  uid: string,
  empresaId: string,
  tokenRoleRaw?: unknown,
  operatorNameFallback?: string,
): Promise<ResolvedPanelUser> {
  const panel = await resolvePanelUserForUid(db, uid, tokenRoleRaw, operatorNameFallback);
  if (!panel) {
    throw new functions.https.HttpsError('permission-denied', 'Usuario no autorizado en el panel.');
  }
  const eid = String(empresaId || '').trim();
  if (!eid) {
    throw new functions.https.HttpsError('invalid-argument', 'empresaId requerido.');
  }
  if (!panel.isSuperAdmin && !panel.allEmpresas) {
    const userEmp = String(panel.empresaId || 'bacarsa').trim();
    if (userEmp && eid.toLowerCase() !== userEmp.toLowerCase()) {
      throw new functions.https.HttpsError('permission-denied', 'Empresa no permitida para este usuario.');
    }
  }
  if (panel.isSuperAdmin) return panel;
  const ops = panel.permissions.OPERATIONS;
  if (!Array.isArray(ops) || !ops.includes('update')) {
    throw new functions.https.HttpsError('permission-denied', 'Se requiere permiso OPERATIONS:update.');
  }
  return panel;
}
