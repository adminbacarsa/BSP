import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  DEFAULT_PORTAL_FEATURES,
  type PortalFeatures,
  type EmpleadoPortal,
} from '@cosp/portal-types';
import { resolveEmpDocIdWithRetry } from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';
import { withTimeout } from '../lib/emulatorHost';
import { getOrCreateDeviceId, getStoredDeviceId } from '../lib/deviceId';

const FIRESTORE_PROFILE_TIMEOUT_MS = 12_000;
const AUTH_INIT_TIMEOUT_MS = 9_000;

function normalizeRoleKey(role: string): string {
  return role.toLowerCase().replace(/_/g, '').trim();
}

type PortalAuthContextValue = {
  user: User | null;
  initializing: boolean;
  employeeProfileLoading: boolean;
  employeeProfileReady: boolean;
  empDocId: string | null;
  employee: EmpleadoPortal | null;
  portalFeatures: PortalFeatures;
  deviceVerified: boolean | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshEmployee: () => Promise<void>;
};

const PortalAuthContext = createContext<PortalAuthContextValue | null>(null);

async function isEmployeeUser(user: User, db: ReturnType<typeof getPortalFirebase>['db']): Promise<boolean> {
  const token = await user.getIdTokenResult(true);
  const claimRole = normalizeRoleKey(String(token.claims.role ?? ''));
  const claimType = normalizeRoleKey(String(token.claims.type ?? ''));
  if (EMPLOYEE_ROLES.includes(claimRole) || EMPLOYEE_ROLES.includes(claimType)) {
    return true;
  }
  try {
    const empId = await resolveEmpDocIdWithRetry(db, user, 2);
    return empId !== null;
  } catch {
    return false;
  }
}

function isNetworkOrFirestoreError(err: unknown): boolean {
  const code = String((err as { code?: string })?.code ?? '');
  const msg = String((err as { message?: string })?.message ?? '').toLowerCase();
  return (
    code.includes('unavailable') ||
    code.includes('network') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection')
  );
}

export function mapPortalAuthError(err: unknown, emulatorMode: boolean): string {
  const code = (err as { code?: string })?.code ?? '';
  if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(code)) {
    return emulatorMode
      ? 'Correo o contraseña incorrectos en el emulador. Probá guardia@bacarsa.com.ar / guardia1234 (npm run seed). Si en el navegador sí entra, revisá EXPO_PUBLIC_FIREBASE_EMULATOR_HOST con la IP Wi‑Fi de la PC (no 127.0.0.1).'
      : 'Correo o contraseña incorrectos.';
  }
  if (code === 'auth/network-request-failed' || isNetworkOrFirestoreError(err)) {
    return 'No hay conexión con Firebase. Misma Wi‑Fi que la PC, firewall abierto (8080, 9099) y en .env la IP de la notebook (EXPO_PUBLIC_FIREBASE_EMULATOR_HOST). Reiniciá Expo con npx expo start -c.';
  }
  if (err instanceof Error) return err.message;
  return 'No se pudo iniciar sesión.';
}

async function verifyDeviceForUser(user: User, db: ReturnType<typeof getPortalFirebase>['db']): Promise<boolean> {
  const empDocId = await resolveEmpDocIdWithRetry(db, user, 2);
  if (empDocId) {
    const empSnap = await getDoc(doc(db, 'empleados', empDocId));
    if (empSnap.exists() && empSnap.data()?.bypassDeviceCheck === true) {
      return true;
    }
  }

  const tokenSnap = await getDoc(doc(db, 'device_tokens', user.uid));
  if (!tokenSnap.exists()) return false;
  const data = tokenSnap.data();
  if (!data.verified) return false;
  if (!data.deviceId) return true;

  const localId = await getStoredDeviceId();
  if (!localId) {
    await getOrCreateDeviceId();
    const again = await getStoredDeviceId();
    return again === data.deviceId;
  }
  return data.deviceId === localId;
}

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const { auth, db } = getPortalFirebase();
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [employeeProfileLoading, setEmployeeProfileLoading] = useState(false);
  const [employeeProfileReady, setEmployeeProfileReady] = useState(false);
  const [empDocId, setEmpDocId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<EmpleadoPortal | null>(null);
  const [portalFeatures, setPortalFeatures] = useState<PortalFeatures>(DEFAULT_PORTAL_FEATURES);
  const [deviceVerified, setDeviceVerified] = useState<boolean | null>(null);

  const loadEmployee = useCallback(
    async (currentUser: User) => {
      setEmployeeProfileLoading(true);
      try {
        const id = await withTimeout(
          resolveEmpDocIdWithRetry(db, currentUser, 3),
          FIRESTORE_PROFILE_TIMEOUT_MS,
          'Carga de legajo',
        );
        setEmpDocId(id);
        if (!id) {
          setEmployee(null);
          setPortalFeatures(DEFAULT_PORTAL_FEATURES);
          return;
        }
        const snap = await withTimeout(
          getDoc(doc(db, 'empleados', id)),
          FIRESTORE_PROFILE_TIMEOUT_MS,
          'Lectura de legajo',
        );
        if (!snap.exists()) {
          setEmployee(null);
          return;
        }
        const data = snap.data();
        setEmployee({
          id,
          uid: data.uid,
          email: data.email,
          firstName: data.firstName || data.nombre,
          lastName: data.lastName || data.apellido,
          fileNumber: data.fileNumber || data.legajo,
          empresaId: data.empresaId,
          deviceId: data.deviceId ?? null,
        });
        const pf = data.portalFeatures;
        if (pf && typeof pf === 'object') {
          setPortalFeatures((prev) => ({ ...prev, ...pf }));
        } else {
          setPortalFeatures(DEFAULT_PORTAL_FEATURES);
        }
      } catch {
        setEmployee(null);
      } finally {
        setEmployeeProfileLoading(false);
        setEmployeeProfileReady(true);
      }
    },
    [db],
  );

  useEffect(() => {
    const authReadyTimer = setTimeout(() => {
      setInitializing(false);
    }, AUTH_INIT_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      clearTimeout(authReadyTimer);
      setUser(nextUser);
      if (!nextUser) {
        setEmpDocId(null);
        setEmployee(null);
        setEmployeeProfileReady(false);
        setPortalFeatures(DEFAULT_PORTAL_FEATURES);
        setDeviceVerified(null);
        setInitializing(false);
        return;
      }

      try {
        const okEmployee = await isEmployeeUser(nextUser, db);
        if (!okEmployee) {
          await firebaseSignOut(auth);
          setUser(null);
          setDeviceVerified(null);
          setInitializing(false);
          return;
        }
        await loadEmployee(nextUser);
        const verified = await verifyDeviceForUser(nextUser, db);
        setDeviceVerified(verified);
      } catch (err) {
        const token = await nextUser.getIdTokenResult(true).catch(() => null);
        const role = normalizeRoleKey(String(token?.claims?.role ?? ''));
        const type = normalizeRoleKey(String(token?.claims?.type ?? ''));
        if (EMPLOYEE_ROLES.includes(role) || EMPLOYEE_ROLES.includes(type)) {
          try {
            await loadEmployee(nextUser);
          } catch {
            /* Firestore intermitente en móvil */
          }
          setDeviceVerified(null);
        } else {
          await firebaseSignOut(auth);
          setUser(null);
        }
      } finally {
        setInitializing(false);
      }
    });
    return () => {
      clearTimeout(authReadyTimer);
      unsub();
    };
  }, [auth, db, loadEmployee]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const okEmployee = await isEmployeeUser(cred.user, db);
        if (!okEmployee) {
          await firebaseSignOut(auth);
          throw new Error('Esta app es solo para vigiladores. Usá el panel web para administración.');
        }
        await loadEmployee(cred.user);
        const verified = await verifyDeviceForUser(cred.user, db);
        setDeviceVerified(verified);
      } catch (err) {
        if (isNetworkOrFirestoreError(err)) {
          throw new Error(
            'Auth OK pero Firestore no respondió. En el celular configurá la IP de tu PC en EXPO_PUBLIC_FIREBASE_EMULATOR_HOST (apps/mobile-guardia/.env) y ejecutá npx expo start -c.',
          );
        }
        throw err;
      }
    },
    [auth, db, loadEmployee],
  );

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setEmpDocId(null);
    setEmployee(null);
    setEmployeeProfileReady(false);
    setDeviceVerified(null);
  }, [auth]);

  const refreshEmployee = useCallback(async () => {
    if (!user) return;
    await loadEmployee(user);
    const verified = await verifyDeviceForUser(user, db);
    setDeviceVerified(verified);
  }, [user, loadEmployee, db]);

  const value = useMemo(
    () => ({
      user,
      initializing,
      employeeProfileLoading,
      employeeProfileReady,
      empDocId,
      employee,
      portalFeatures,
      deviceVerified,
      signIn,
      signOut,
      refreshEmployee,
    }),
    [user, initializing, employeeProfileLoading, employeeProfileReady, empDocId, employee, portalFeatures, deviceVerified, signIn, signOut, refreshEmployee],
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth(): PortalAuthContextValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) {
    throw new Error('usePortalAuth debe usarse dentro de PortalAuthProvider');
  }
  return ctx;
}
