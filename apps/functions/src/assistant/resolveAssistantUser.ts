import * as admin from 'firebase-admin';
import { KNOWN_ADMIN_MODULE_KEYS } from './cospKnowledge';

export type AssistantPersona = 'SYSTEM' | 'EMPLOYEE' | 'CLIENT';

export interface ResolvedAssistantUser {
  persona: AssistantPersona;
  roleName?: string | null;
  empresaId: string;
  readableModuleKeys: string[];
  summaryLabel: string;
}

function normalizeRoleId(role: string): string {
  return role.trim().toUpperCase().replace(/\s+/g, '_');
}

export async function resolveAssistantUser(uid: string): Promise<ResolvedAssistantUser | null> {
  const db = admin.firestore();
  const sys = await db.collection('system_users').doc(uid).get();
  if (sys.exists) {
    const role = String(sys.data()?.role || '');
    const isSuper =
      normalizeRoleId(role) === 'SUPERADMIN' || normalizeRoleId(role) === 'SUPER_ADMIN';
    let empresaId = String(sys.data()?.empresaId ?? '').trim() || (!isSuper ? 'bacarsa' : '');
    let readableModuleKeys: string[];
    if (isSuper || !role) {
      readableModuleKeys = [...KNOWN_ADMIN_MODULE_KEYS];
    } else {
      const roleSnap = await db.collection('roles').doc(normalizeRoleId(role)).get();
      const perms = (roleSnap.data()?.permissions ?? {}) as Record<string, unknown>;
      readableModuleKeys = KNOWN_ADMIN_MODULE_KEYS.filter((k) => {
        const a = perms[k];
        return Array.isArray(a) && a.includes('read');
      });
      if (!roleSnap.exists || readableModuleKeys.length === 0) {
        readableModuleKeys =
          KNOWN_ADMIN_MODULE_KEYS.length > 0 ? ['DASHBOARD'] : readableModuleKeys;
      }
    }
    return {
      persona: 'SYSTEM',
      roleName: role || null,
      empresaId,
      readableModuleKeys,
      summaryLabel: role ? `Usuario sistema (${role})` : 'Usuario sistema',
    };
  }

  const clientSnap = await db.collection('client_users').where('uid', '==', uid).limit(1).get();
  if (!clientSnap.empty) {
    const d = clientSnap.docs[0].data();
    return {
      persona: 'CLIENT',
      roleName: 'client_portal',
      empresaId: String(d.clientId ?? d.clienteId ?? d.empresaId ?? ''),
      readableModuleKeys: ['CLIENT_PORTAL'],
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
      summaryLabel: 'Colaborador (portal empleado)',
    };
  }

  const emulatorAuth = await tryResolveAssistantFromEmulatorAuth(uid);
  if (emulatorAuth) return emulatorAuth;

  return null;
}

/**
 * En el emulador de Functions, Auth y Firestore suelen estar alineados; si alguien levanta solo
 * Functions o Firestore quedó vacío, system_users puede faltar aunque el login (claims) sea válido.
 * Solo aplica con FUNCTIONS_EMULATOR=true (nunca en producción).
 */
async function tryResolveAssistantFromEmulatorAuth(uid: string): Promise<ResolvedAssistantUser | null> {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') return null;
  try {
    const u = await admin.auth().getUser(uid);
    const claims = (u.customClaims ?? {}) as Record<string, unknown>;
    const role = String(claims.role ?? '').trim();
    const isSuper =
      normalizeRoleId(role) === 'SUPERADMIN' || normalizeRoleId(role) === 'SUPER_ADMIN';
    if (isSuper) {
      const empresaId = String(claims.empresaId ?? '').trim() || 'bacarsa';
      return {
        persona: 'SYSTEM',
        roleName: role || 'SUPERADMIN',
        empresaId,
        readableModuleKeys: [...KNOWN_ADMIN_MODULE_KEYS],
        summaryLabel: 'Superadmin (emulador vía Auth; sin system_users en Firestore)',
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function empresaAllowed(
  claimedEmpresaId: string | undefined,
  profile: ResolvedAssistantUser,
): boolean {
  const c = String(claimedEmpresaId ?? '').trim();
  if (profile.persona === 'CLIENT') return true;
  const serverEmp = profile.empresaId.trim();
  if (!serverEmp) return true;
  if (!c) return true;
  return c.toLowerCase() === serverEmp.toLowerCase();
}
