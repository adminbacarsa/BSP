import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

export function normalizeBackupRole(role: unknown): string {
  return String(role ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

export function isSuperAdminBackupRole(role: unknown): boolean {
  const r = normalizeBackupRole(role);
  return r === 'SUPERADMIN' || r === 'SUPER_ADMIN' || r === 'SP';
}

export function isAdminBackupRole(role: unknown): boolean {
  const r = normalizeBackupRole(role);
  return isSuperAdminBackupRole(r) || r === 'ADMIN';
}

export async function resolveBackupCaller(
  uid: string,
  tokenRoleRaw: unknown,
): Promise<{ isPanelUser: boolean; isSuper: boolean; profileEmpresa: string; sysRole: string }> {
  const tokenRole = normalizeBackupRole(tokenRoleRaw);
  let isSuper = isSuperAdminBackupRole(tokenRole);
  let profileEmpresa = '';
  let sysRole = '';

  const db = admin.firestore();
  const sysUser = await db.collection('system_users').doc(uid).get();
  if (sysUser.exists) {
    sysRole = normalizeBackupRole(sysUser.data()?.role);
    isSuper = isSuper || isSuperAdminBackupRole(sysRole);
    profileEmpresa = String(sysUser.data()?.empresaId ?? '').trim();
    return { isPanelUser: true, isSuper, profileEmpresa, sysRole };
  }

  try {
    const authUser = await admin.auth().getUser(uid);
    const claimRole = normalizeBackupRole(authUser.customClaims?.role);
    if (isAdminBackupRole(claimRole)) {
      isSuper = isSuper || isSuperAdminBackupRole(claimRole);
      sysRole = claimRole;
      return { isPanelUser: true, isSuper, profileEmpresa, sysRole };
    }
  } catch {
    /* Auth lookup opcional */
  }

  if (isAdminBackupRole(tokenRole)) {
    sysRole = tokenRole;
    return { isPanelUser: true, isSuper, profileEmpresa, sysRole };
  }

  return { isPanelUser: false, isSuper: false, profileEmpresa: '', sysRole: '' };
}

export async function assertBackupCallableAllowed(context: functions.https.CallableContext): Promise<void> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida');
  }
  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  if (!caller.isPanelUser) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo usuarios del panel de administración pueden usar backups.',
    );
  }
}
