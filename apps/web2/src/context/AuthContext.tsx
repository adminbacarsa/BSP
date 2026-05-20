import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User, setPersistence, browserLocalPersistence, signOut } from 'firebase/auth';
import { auth, db, ensureFirebaseEmulatorsConnected, functions } from '@/lib/firebase';

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useRouter } from 'next/router';

import { isSuperAdminRole, normalizeRoleId as roleDocId } from '@/lib/roles';

function isSuperAdminRoleId(role: unknown): boolean {
  return isSuperAdminRole(role);
}

const SUPERADMIN_MODULE_KEYS = [
  'DASHBOARD', 'OPERATIONS', 'PLANNING', 'PLANNING_AI', 'RRHH', 'CLIENTS',
  'SERVICES', 'REPORTS', 'ANALYSIS', 'ASSISTANT', 'CONFIG',
] as const;

function fullSuperAdminPermissions(): Record<string, string[]> {
  const perms: Record<string, string[]> = {};
  SUPERADMIN_MODULE_KEYS.forEach((m) => { perms[m] = ['read', 'create', 'update', 'delete']; });
  return perms;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  userRole: string | null;
  assignedClientId: string | null;
  /** true si no tiene empresa fija (vista multi-cliente). No confundir con permisos de rol. */
  isAdmin: boolean;
  /** Permisos del rol en Firestore `roles/{id}.permissions` */
  rolePermissions: Record<string, string[]>;
  isSuperAdmin: boolean;
  /** Bypass tenant en permisos de rol (multi-empresa sin ser SuperAdmin). */
  allEmpresas: boolean;
  /** Lectura mínima sobre un módulo (clave SYSTEM_MODULES, ej. CONFIG, CLIENTS). */
  canReadModule: (moduleKey: string) => boolean;
  /** ID de la empresa a la que pertenece el usuario. Default: 'bacarsa' */
  empresaId: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
  userRole: null,
  assignedClientId: null,
  isAdmin: true,
  rolePermissions: {},
  isSuperAdmin: false,
  allEmpresas: false,
  canReadModule: () => false,
  empresaId: 'bacarsa',
});
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [claimRole, setClaimRole] = useState<string | null>(null);
  const [assignedClientId, setAssignedClientId] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [empresaId, setEmpresaId] = useState<string>('bacarsa');
  const [allEmpresas, setAllEmpresas] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (USE_EMULATOR) ensureFirebaseEmulatorsConnected();
    setPersistence(auth, browserLocalPersistence).catch(e => console.error("Error persistencia:", e));

    const unsub = onAuthStateChanged(auth, async (u) => {
      console.log("Auth State:", u ? "LOGGED IN" : "LOGGED OUT");
      setUser(u);
      if (u) {
        try {
          const token = await u.getIdTokenResult(true);
          const tokenRole = String(token.claims.role ?? '').trim() || null;
          setClaimRole(tokenRole);

          const snap = await getDoc(doc(db, 'system_users', u.uid));
          if (snap.exists()) {
            const data = snap.data();
            const role = data.role || null;
            const multiEmpresa = data.allEmpresas === true;
            setUserRole(role);
            setAssignedClientId(data.assignedClientId || null);
            setAllEmpresas(multiEmpresa);
            const isSuper = isSuperAdminRoleId(role) || isSuperAdminRoleId(tokenRole);
            setEmpresaId(isSuper || multiEmpresa
              ? (data.empresaId || '')
              : (data.empresaId || 'bacarsa'));
            if (isSuper) {
              setRolePermissions(fullSuperAdminPermissions());
            } else if (role) {
              const roleSnap = await getDoc(doc(db, 'roles', roleDocId(role)));
              if (roleSnap.exists()) {
                const roleData = roleSnap.data();
                const roleEmp = String(roleData?.empresaId ?? '').trim();
                const userEmp = String(data.empresaId || 'bacarsa').trim();
                if (!multiEmpresa && roleEmp && userEmp && roleEmp.toLowerCase() !== userEmp.toLowerCase()) {
                  setRolePermissions({});
                } else {
                  setRolePermissions((roleData?.permissions || {}) as Record<string, string[]>);
                }
              } else {
                setRolePermissions({});
              }
            } else {
              setRolePermissions({});
            }
            try {
              if (roleDocId(role || '') !== roleDocId(tokenRole || '')) {
                const syncFn = httpsCallable(functions, 'syncSystemUserClaims');
                await syncFn({});
                const refreshed = await u.getIdTokenResult(true);
                const syncedRole = String(refreshed.claims.role ?? '').trim() || null;
                setClaimRole(syncedRole);
                if (isSuperAdminRoleId(role) || isSuperAdminRoleId(syncedRole)) {
                  setRolePermissions(fullSuperAdminPermissions());
                }
              }
            } catch {
              /* sync opcional */
            }
          } else {
            setUserRole(tokenRole);
            setAssignedClientId(null);
            setAllEmpresas(false);
            const isSuper = isSuperAdminRoleId(tokenRole);
            setEmpresaId(isSuper ? '' : 'bacarsa');
            if (isSuper) {
              setRolePermissions(fullSuperAdminPermissions());
            } else if (tokenRole) {
              const roleSnap = await getDoc(doc(db, 'roles', roleDocId(tokenRole)));
              if (roleSnap.exists()) {
                const roleData = roleSnap.data();
                const roleEmp = String(roleData?.empresaId ?? '').trim();
                const userEmp = 'bacarsa';
                if (roleEmp && userEmp && roleEmp.toLowerCase() !== userEmp.toLowerCase()) {
                  setRolePermissions({});
                } else {
                  setRolePermissions((roleData?.permissions || {}) as Record<string, string[]>);
                }
              } else {
                setRolePermissions({});
              }
            } else {
              setRolePermissions({});
            }
          }
        } catch (e) {
          console.error("Error cargando system_users:", e);
          setRolePermissions({});
          try {
            const token = await u.getIdTokenResult(true);
            const fallbackClaim = String(token.claims.role ?? '').trim() || null;
            setClaimRole(fallbackClaim);
            if (fallbackClaim) setUserRole(fallbackClaim);
            if (isSuperAdminRoleId(fallbackClaim)) {
              setRolePermissions(fullSuperAdminPermissions());
              setEmpresaId('');
            }
          } catch {
            /* ignore */
          }
        }
      } else {
        setUserRole(null);
        setClaimRole(null);
        setAssignedClientId(null);
        setRolePermissions({});
        setEmpresaId('bacarsa');
        setAllEmpresas(false);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const logout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  const isAdmin = !assignedClientId;

  const isSuperAdmin = useMemo(
    () => isSuperAdminRoleId(userRole) || isSuperAdminRoleId(claimRole),
    [userRole, claimRole]
  );

  const canReadModule = useCallback(
    (moduleKey: string) => {
      if (isSuperAdmin) return true;
      const actions = rolePermissions[moduleKey];
      return Array.isArray(actions) && actions.includes('read');
    },
    [isSuperAdmin, rolePermissions]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        logout,
        userRole,
        assignedClientId,
        isAdmin,
        rolePermissions,
        isSuperAdmin,
        allEmpresas,
        canReadModule,
        empresaId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
