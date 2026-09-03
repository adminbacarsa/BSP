import * as admin from 'firebase-admin';
import { isSuperAdminRole, normalizeRoleId } from '../common/role.util';
import { KNOWN_ADMIN_MODULE_KEYS } from './cospKnowledge';

export type AssistantPersona = 'SYSTEM' | 'EMPLOYEE' | 'CLIENT';

export interface ResolvedAssistantUser {
  persona: AssistantPersona;
  roleName?: string | null;
  empresaId: string;
  readableModuleKeys: string[];
  /** Acceso al asistente (globo / callable). Backoffice: permiso ASSISTANT read; portal empleado/cliente: true. */
  canUseAssistant: boolean;
  /** Bypass tenant y permisos de rol (system_users.role o Auth claim). */
  isSuperAdmin: boolean;
  summaryLabel: string;
}

function roleHasAssistantRead(perms: Record<string, unknown>): boolean {
  const a = perms.ASSISTANT;
  return Array.isArray(a) && a.includes('read');
}

async function authClaimRole(uid: string): Promise<string> {
  try {
    const u = await admin.auth().getUser(uid);
    return String((u.customClaims ?? {}).role ?? '').trim();
  } catch {
    return '';
  }
}

export type ResolveAssistantUserOptions = {
  /** Rol del JWT ya verificado (p. ej. context.auth.token.role en callables). */
  tokenRole?: string;
};

export async function resolveAssistantUser(
  uid: string,
  opts?: ResolveAssistantUserOptions,
): Promise<ResolvedAssistantUser | null> {
  const db = admin.firestore();
  const tokenRole = String(opts?.tokenRole ?? '').trim();
  const claimRole = tokenRole || (await authClaimRole(uid));
  const sys = await db.collection('system_users').doc(uid).get();
  if (sys.exists) {
    const role = String(sys.data()?.role || '');
    let isSuper = isSuperAdminRole(role) || isSuperAdminRole(claimRole);
    let empresaId = String(sys.data()?.empresaId ?? '').trim() || (!isSuper ? 'bacarsa' : '');
    let readableModuleKeys: string[];
    let canUseAssistant = isSuper;
    if (isSuper || !role) {
      readableModuleKeys = [...KNOWN_ADMIN_MODULE_KEYS];
      canUseAssistant = true;
    } else {
      const roleSnap = await db.collection('roles').doc(normalizeRoleId(role)).get();
      const perms = (roleSnap.data()?.permissions ?? {}) as Record<string, unknown>;
      const roleEmp = String(roleSnap.data()?.empresaId ?? '').trim();
      if (roleEmp && empresaId && roleEmp.toLowerCase() !== empresaId.toLowerCase()) {
        readableModuleKeys = ['DASHBOARD'];
        canUseAssistant = false;
      } else {
        canUseAssistant = roleHasAssistantRead(perms);
        readableModuleKeys = KNOWN_ADMIN_MODULE_KEYS.filter((k) => {
          const a = perms[k];
          return Array.isArray(a) && a.includes('read');
        });
        if (!roleSnap.exists || readableModuleKeys.length === 0) {
          readableModuleKeys =
            KNOWN_ADMIN_MODULE_KEYS.length > 0 ? ['DASHBOARD'] : readableModuleKeys;
        }
      }
    }
    if (!canUseAssistant && isSuperAdminRole(claimRole)) {
      isSuper = true;
      canUseAssistant = true;
      readableModuleKeys = [...KNOWN_ADMIN_MODULE_KEYS];
    }
    return {
      persona: 'SYSTEM',
      roleName: role || claimRole || null,
      empresaId,
      readableModuleKeys,
      canUseAssistant,
      isSuperAdmin: isSuper,
      summaryLabel: role ? `Usuario sistema (${role})` : 'Usuario sistema',
    };
  }

  // Si el claim ya certifica SuperAdmin, no hay que buscar en client_users ni empleados
  if (isSuperAdminRole(claimRole)) {
    const authSuper = await tryResolveSuperAdminFromAuth(uid, claimRole);
    if (authSuper) return authSuper;
  }

  const clientSnap = await db.collection('client_users').where('uid', '==', uid).limit(1).get();
  if (!clientSnap.empty) {
    const d = clientSnap.docs[0].data();
    return {
      persona: 'CLIENT',
      roleName: 'client_portal',
      empresaId: String(d.clientId ?? d.clienteId ?? d.empresaId ?? ''),
      readableModuleKeys: ['CLIENT_PORTAL'],
      canUseAssistant: true,
      isSuperAdmin: false,
      summaryLabel: 'Portal cliente',
    };
  }

  const empSnap = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
  if (!empSnap.empty) {
    const d = empSnap.docs[0].data();
    return {
      persona: 'EMPLOYEE',
      roleName: 'empleado_portal',
      empresaId: String(d.empresaId ?? ''),
      readableModuleKeys: ['EMPLOYEE_PORTAL'],
      canUseAssistant: true,
      isSuperAdmin: false,
      summaryLabel: 'Colaborador (portal empleado)',
    };
  }

  const authSuper = await tryResolveSuperAdminFromAuth(uid, claimRole);
  if (authSuper) return authSuper;

  return null;
}

/**
 * Respaldo cuando falta system_users o el rol en Firestore no coincide con SUPERADMIN en Auth/JWT.
 * Solo eleva a superadmin si el claim verificado es SUPERADMIN (seteado server-side).
 */
async function tryResolveSuperAdminFromAuth(
  uid: string,
  claimRole: string,
): Promise<ResolvedAssistantUser | null> {
  if (!isSuperAdminRole(claimRole)) return null;
  let empresaId = '';
  try {
    const u = await admin.auth().getUser(uid);
    const claims = (u.customClaims ?? {}) as Record<string, unknown>;
    empresaId = String(claims.empresaId ?? '').trim();
  } catch {
    /* ignore */
  }
  return {
    persona: 'SYSTEM',
    roleName: claimRole || 'SUPERADMIN',
    empresaId,
    readableModuleKeys: [...KNOWN_ADMIN_MODULE_KEYS],
    canUseAssistant: true,
    isSuperAdmin: true,
    summaryLabel: process.env.FUNCTIONS_EMULATOR === 'true'
      ? 'Superadmin (emulador vía Auth; sin system_users en Firestore)'
      : 'Superadmin (vía Auth claim)',
  };
}

export function empresaAllowed(
  claimedEmpresaId: string | undefined,
  profile: ResolvedAssistantUser,
): boolean {
  const c = String(claimedEmpresaId ?? '').trim();
  if (profile.persona === 'CLIENT') return true;
  if (profile.isSuperAdmin) return true;
  const serverEmp = profile.empresaId.trim();
  if (!serverEmp) return true;
  if (!c) return true;
  return c.toLowerCase() === serverEmp.toLowerCase();
}
