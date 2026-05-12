import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User, setPersistence, browserLocalPersistence, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/router';

function roleDocId(role: string) {
  return role.trim().toUpperCase().replace(/\s+/g, '_');
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
  canReadModule: () => false,
  empresaId: 'bacarsa',
});
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [assignedClientId, setAssignedClientId] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [empresaId, setEmpresaId] = useState<string>('bacarsa');
  const router = useRouter();

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(e => console.error("Error persistencia:", e));

    const unsub = onAuthStateChanged(auth, async (u) => {
      console.log("Auth State:", u ? "LOGGED IN" : "LOGGED OUT");
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'system_users', u.uid));
          if (snap.exists()) {
            const role = snap.data().role || null;
            setUserRole(role);
            setAssignedClientId(snap.data().assignedClientId || null);
            // Superadmin no tiene empresa fija — no defaultear a 'bacarsa'
            const isSuper = ['SUPERADMIN', 'SUPER_ADMIN'].includes((role || '').toUpperCase());
            setEmpresaId(isSuper
              ? (snap.data().empresaId || '')
              : (snap.data().empresaId || 'bacarsa'));
            if (role) {
              const roleSnap = await getDoc(doc(db, 'roles', roleDocId(role)));
              if (roleSnap.exists()) {
                const perms = (roleSnap.data().permissions || {}) as Record<string, string[]>;
                setRolePermissions(perms);
              } else {
                setRolePermissions({});
              }
            } else {
              setRolePermissions({});
            }
          } else {
            // Fallback: usar custom claims del token cuando system_users no existe
            // (común en emulador después de reimport de backup)
            const token = await u.getIdTokenResult(true);
            const claimRole = (token.claims.role as string) || null;
            setUserRole(claimRole);
            setAssignedClientId(null);
            if (claimRole) {
              const roleSnap = await getDoc(doc(db, 'roles', roleDocId(claimRole)));
              if (roleSnap.exists()) {
                setRolePermissions((roleSnap.data().permissions || {}) as Record<string, string[]>);
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
        }
      } else {
        setUserRole(null);
        setAssignedClientId(null);
        setRolePermissions({});
        setEmpresaId('bacarsa');
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

  const isSuperAdmin = useMemo(() => {
    const r = (userRole || '').toUpperCase();
    return r === 'SUPERADMIN' || r === 'SUPER_ADMIN';
  }, [userRole]);

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
        canReadModule,
        empresaId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
