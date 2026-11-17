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
  HOURS_BANK: ['rebuild'],
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

function parseRolesByEmpresa(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const emp = String(k || '').trim();
    const role = String(v ?? '').trim();
    if (emp && role) out[emp] = role;
  }
  return out;
}

function listUserEmpresaIds(data: Record<string, unknown>): string[] {
  if (Array.isArray(data.empresaIds) && data.empresaIds.length > 0) {
    return [...new Set(data.empresaIds.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  const one = String(data.empresaId ?? '').trim();
  return one ? [one] : [];
}

function resolveRoleForEmpresa(
  data: Record<string, unknown>,
  activeEmpresaId: string,
): string {
  const primary = String(data.role || '').trim();
  if (isSuperAdminRole(primary)) return primary;
  const map = parseRolesByEmpresa(data.rolesByEmpresa);
  const eid = String(activeEmpresaId || '').trim();
  if (eid && map[eid]) return map[eid];
  return primary;
}

export type ResolvedPanelUser = {
  isSuperAdmin: boolean;
  allEmpresas: boolean;
  empresaId: string;
  empresaIds: string[];
  roleName: string;
  permissions: Record<string, string[]>;
  operatorName: string;
};

export async function resolvePanelUserForUid(
  db: Firestore,
  uid: string,
  tokenRoleRaw?: unknown,
  operatorNameFallback = 'Operador',
  activeEmpresaId?: string,
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
      empresaIds: [],
      roleName: tokenRole,
      permissions: fullStaffModulePermissions() as unknown as Record<string, string[]>,
      operatorName: operatorNameFallback,
    };
  }

  const data = (sys.data() ?? {}) as Record<string, unknown>;
  const allEmpresas = data.allEmpresas === true;
  const empresaIds = listUserEmpresaIds(data);
  const primaryEmpresa = String(data.empresaId || (empresaIds[0] || 'bacarsa')).trim();
  const activeEmp = String(activeEmpresaId || primaryEmpresa).trim();
  const role = resolveRoleForEmpresa(data, activeEmp);
  let isSuper = isSuperAdminRole(role) || isSuperAdminRole(tokenRole);
  let permissions: Record<string, string[]> = {};

  if (isSuper) {
    permissions = fullStaffModulePermissions() as unknown as Record<string, string[]>;
    const superKeys = [
      'DASHBOARD', 'OPERATIONS', 'PLANNING', 'PLANNING_AI', 'RRHH', 'CLIENTS',
      'SERVICES', 'REPORTS', 'ANALYSIS', 'HOURS_BANK', 'ASSISTANT', 'CONFIG', 'SUPERVISION',
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
      if (!allEmpresas && roleEmp && activeEmp && roleEmp.toLowerCase() !== activeEmp.toLowerCase()) {
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
    : primaryEmpresa;

  return {
    isSuperAdmin: isSuper,
    allEmpresas,
    empresaId,
    empresaIds,
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
  const eid = String(empresaId || '').trim();
  if (!eid) {
    throw new functions.https.HttpsError('invalid-argument', 'empresaId requerido.');
  }
  const panel = await resolvePanelUserForUid(db, uid, tokenRoleRaw, operatorNameFallback, eid);
  if (!panel) {
    throw new functions.https.HttpsError('permission-denied', 'Usuario no autorizado en el panel.');
  }
  if (!panel.isSuperAdmin && !panel.allEmpresas) {
    const allowed = panel.empresaIds.length > 0
      ? panel.empresaIds
      : [String(panel.empresaId || 'bacarsa').trim()];
    if (!allowed.map((x) => x.toLowerCase()).includes(eid.toLowerCase())) {
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
