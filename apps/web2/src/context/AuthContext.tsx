import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User, setPersistence, browserLocalPersistence, signOut } from 'firebase/auth';
import { auth, db, ensureFirebaseEmulatorsConnected, functions } from '@/lib/firebase';

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useRouter } from 'next/router';

import { isSuperAdminRole, normalizeRoleId as roleDocId } from '@/lib/roles';
import {
  parseRolesByEmpresa,
  resolveRoleForEmpresa,
  type RolesByEmpresa,
} from '@/lib/systemUser';

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
  perms['PLANNING'] = ['read', 'create', 'update', 'delete', 'publish', 'correct', 'auto_lab', 'assign_ft'];
  perms['RRHH'] = ['read', 'create', 'update', 'delete', 'adjust'];
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
  /** Permisos del rol en Firestore `roles/{id}.permissions` (según empresa activa). */
  rolePermissions: Record<string, string[]>;
  isSuperAdmin: boolean;
  /** Bypass tenant en permisos de rol (multi-empresa sin ser SuperAdmin). */
  allEmpresas: boolean;
  /** Subconjunto explícito de empresas (cuando no es allEmpresas). */
  empresaIds: string[];
  /** Rol por empresa (`system_users.rolesByEmpresa`). */
  rolesByEmpresa: RolesByEmpresa;
  /** Lectura mínima sobre un módulo (clave SYSTEM_MODULES, ej. CONFIG, CLIENTS). */
  canReadModule: (moduleKey: string) => boolean;
  /** ID de la empresa a la que pertenece el usuario. Default: 'bacarsa' */
  empresaId: string;
  /**
   * Recalcula rol/permisos al cambiar la empresa activa (lo llama EmpresaContext).
   * No cambia el tenant de datos: solo el rol efectivo de esa empresa.
   */
  applyEmpresaContext: (activeEmpresaId: string) => Promise<void>;
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
  empresaIds: [],
  rolesByEmpresa: {},
  canReadModule: () => false,
  empresaId: 'bacarsa',
  applyEmpresaContext: async () => {},
});
export const useAuth = () => useContext(AuthContext);

type SystemUserProfile = {
  role: string | null;
  assignedClientId: string | null;
  empresaId: string;
  allEmpresas: boolean;
  empresaIds: string[];
  rolesByEmpresa: RolesByEmpresa;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [claimRole, setClaimRole] = useState<string | null>(null);
  const [assignedClientId, setAssignedClientId] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [empresaId, setEmpresaId] = useState<string>('bacarsa');
  const [allEmpresas, setAllEmpresas] = useState(false);
  const [empresaIds, setEmpresaIds] = useState<string[]>([]);
  const [rolesByEmpresa, setRolesByEmpresa] = useState<RolesByEmpresa>({});
  const [profile, setProfile] = useState<SystemUserProfile | null>(null);
  const router = useRouter();

  const loadPermissionsForRole = useCallback(async (
    role: string | null,
    opts: { allEmpresas: boolean; activeEmpresaId: string; tokenRole: string | null },
  ) => {
    const isSuper = isSuperAdminRoleId(role) || isSuperAdminRoleId(opts.tokenRole);
    if (isSuper) {
      setRolePermissions(fullSuperAdminPermissions());
      return;
    }
    if (!role) {
      setRolePermissions({});
      return;
    }
    try {
      const roleSnap = await getDoc(doc(db, 'roles', roleDocId(role)));
      if (!roleSnap.exists()) {
        setRolePermissions({});
        return;
      }
      const roleData = roleSnap.data();
      const roleEmp = String(roleData?.empresaId ?? '').trim();
      const activeEmp = String(opts.activeEmpresaId || '').trim();
      // Rol de otra empresa: solo se acepta si el usuario es allEmpresas (legado).
      if (!opts.allEmpresas && roleEmp && activeEmp && roleEmp.toLowerCase() !== activeEmp.toLowerCase()) {
        setRolePermissions({});
        return;
      }
      setRolePermissions((roleData?.permissions || {}) as Record<string, string[]>);
    } catch {
      setRolePermissions({});
    }
  }, []);

  const applyEmpresaContext = useCallback(async (activeEmpresaId: string) => {
    if (!profile) return;
    const eid = String(activeEmpresaId || '').trim();
    const effectiveRole = resolveRoleForEmpresa(profile, eid || profile.empresaId);
    setUserRole(effectiveRole || null);
    await loadPermissionsForRole(effectiveRole || null, {
      allEmpresas: profile.allEmpresas,
      activeEmpresaId: eid || profile.empresaId,
      tokenRole: claimRole,
    });
  }, [profile, claimRole, loadPermissionsForRole]);

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
            const role = (data.role as string) || null;
            const multiEmpresa = data.allEmpresas === true;
            const rawEmpresaIds = Array.isArray(data.empresaIds) ? (data.empresaIds as string[]) : [];
            const mapRoles = parseRolesByEmpresa(data.rolesByEmpresa);
            const isSuper = isSuperAdminRoleId(role) || isSuperAdminRoleId(tokenRole);
            const defaultEmpresa = rawEmpresaIds.length > 0 ? rawEmpresaIds[0] : (data.empresaId || '');
            const authEmpresa = isSuper || multiEmpresa
              ? (data.empresaId || '')
              : (rawEmpresaIds.length > 1
                ? defaultEmpresa
                : (data.empresaId || 'bacarsa'));

            const nextProfile: SystemUserProfile = {
              role,
              assignedClientId: data.assignedClientId || null,
              empresaId: String(authEmpresa || data.empresaId || 'bacarsa'),
              allEmpresas: multiEmpresa,
              empresaIds: rawEmpresaIds,
              rolesByEmpresa: mapRoles,
            };
            setProfile(nextProfile);
            setAssignedClientId(nextProfile.assignedClientId);
            setAllEmpresas(multiEmpresa);
            setEmpresaIds(rawEmpresaIds);
            setRolesByEmpresa(mapRoles);
            setEmpresaId(nextProfile.empresaId);

            const effectiveRole = resolveRoleForEmpresa(nextProfile, nextProfile.empresaId);
            setUserRole(effectiveRole || null);
            await loadPermissionsForRole(effectiveRole || null, {
              allEmpresas: multiEmpresa,
              activeEmpresaId: nextProfile.empresaId,
              tokenRole,
            });

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
            setProfile(null);
            setUserRole(tokenRole);
            setAssignedClientId(null);
            setAllEmpresas(false);
            setEmpresaIds([]);
            setRolesByEmpresa({});
            const isSuper = isSuperAdminRoleId(tokenRole);
            setEmpresaId('bacarsa');
            if (isSuper) {
              setRolePermissions(fullSuperAdminPermissions());
            } else if (tokenRole) {
              await loadPermissionsForRole(tokenRole, {
                allEmpresas: false,
                activeEmpresaId: 'bacarsa',
                tokenRole,
              });
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
        setEmpresaIds([]);
        setRolesByEmpresa({});
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [loadPermissionsForRole]);

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
        empresaIds,
        rolesByEmpresa,
        canReadModule,
        empresaId,
        applyEmpresaContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
