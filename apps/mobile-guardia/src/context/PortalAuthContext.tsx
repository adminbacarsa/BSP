import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import * as Linking from 'expo-linking';
import {
  DEFAULT_PORTAL_FEATURES,
  type PortalFeatures,
  type EmpleadoPortal,
} from '@cosp/portal-types';
import { resolveEmpDocIdWithRetry } from '@cosp/portal-core';
import { getPortalFirebase, isEmulatorMode } from '../lib/portal';
import { withTimeout } from '../lib/emulatorHost';
import { getOrCreateDeviceId, getStoredDeviceId } from '../lib/deviceId';
import {
  evaluateDeviceTokenBinding,
  type DeviceBlockReason,
  type DeviceVerifyResult,
} from '../lib/deviceVerification';
import { detachPushTokenOnServer, unregisterPushForUser } from '../lib/pushNotifications';
import { parsePreviewEmpFromUrl } from '../lib/previewLinks';
import { isSuperAdminRole, userIsSuperAdmin } from '../lib/superAdmin';

const FIRESTORE_PROFILE_TIMEOUT_MS = 22_000;
const AUTH_INIT_TIMEOUT_MS = 9_000;
const EMPLOYEE_ROLES = ['employee', 'empleado'];

function normalizeRoleKey(role: string): string {
  return role.toLowerCase().replace(/_/g, '').trim();
}

type PortalAuthContextValue = {
  user: User | null;
  initializing: boolean;
  isSuperAdmin: boolean;
  isPreviewMode: boolean;
  previewEmpDocId: string | null;
  employeeProfileLoading: boolean;
  employeeProfileReady: boolean;
  empDocId: string | null;
  employee: EmpleadoPortal | null;
  portalFeatures: PortalFeatures;
  /** null = aún verificando; true = OK; false = bloqueado (ver deviceBlockReason). */
  deviceVerified: boolean | null;
  /** Motivo de bloqueo cuando deviceVerified === false. */
  deviceBlockReason: DeviceBlockReason | null;
  employeeProfileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshEmployee: () => Promise<void>;
  enterPreview: (empDocId: string) => Promise<void>;
  exitPreview: () => Promise<void>;
};

const PortalAuthContext = createContext<PortalAuthContextValue | null>(null);

async function isEmployeeUser(user: User, db: ReturnType<typeof getPortalFirebase>['db']): Promise<boolean> {
  if (await userIsSuperAdmin(user)) return true;

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
      ? 'Correo o contraseña incorrectos en el emulador. Ejecutá npm run seed y usá el usuario de prueba del seed. Si en el navegador sí entra, revisá EXPO_PUBLIC_FIREBASE_EMULATOR_HOST con la IP Wi‑Fi de la PC (no 127.0.0.1).'
      : 'Correo o contraseña incorrectos.';
  }
  if (code === 'auth/network-request-failed' || isNetworkOrFirestoreError(err)) {
    return 'No hay conexión con Firebase. Misma Wi‑Fi que la PC, firewall abierto (8080, 9099) y en .env la IP de la notebook (EXPO_PUBLIC_FIREBASE_EMULATOR_HOST). Reiniciá Expo con npx expo start -c.';
  }
  if (err instanceof Error) return err.message;
  return 'No se pudo iniciar sesión.';
}

async function anyLinkedLegajoBypassesDevice(
  user: User,
  db: ReturnType<typeof getPortalFirebase>['db'],
): Promise<boolean> {
  try {
    const direct = await getDoc(doc(db, 'empleados', user.uid));
    if (direct.exists() && direct.data()?.bypassDeviceCheck === true) return true;
    const byUid = await getDocs(query(collection(db, 'empleados'), where('uid', '==', user.uid)));
    if (byUid.docs.some((d) => d.data()?.bypassDeviceCheck === true)) return true;
    const raw = user.email?.trim();
    if (raw) {
      for (const email of new Set([raw, raw.toLowerCase()])) {
        const byEmail = await getDocs(query(collection(db, 'empleados'), where('email', '==', email)));
        if (byEmail.docs.some((d) => d.data()?.bypassDeviceCheck === true)) return true;
      }
    }
  } catch {
    /* sin lectura: sigue la validación normal por device_tokens */
  }
  return false;
}

async function verifyDeviceForUser(
  user: User,
  db: ReturnType<typeof getPortalFirebase>['db'],
): Promise<DeviceVerifyResult> {
  if (await userIsSuperAdmin(user)) return { verified: true };

  // Un mismo usuario puede tener legajo en varias empresas (ej. Bacarsa y Pruebas SA): la excepción
  // de dispositivo vale si cualquiera de sus legajos la tiene, no solo el primero que se resuelve.
  // bypassDeviceCheck: deja entrar sin vincular deviceId (no escribe device_tokens).
  if (await anyLinkedLegajoBypassesDevice(user, db)) return { verified: true };

  const tokenSnap = await getDoc(doc(db, 'device_tokens', user.uid));
  if (!tokenSnap.exists()) {
    return { verified: false, reason: 'never_activated' };
  }
  const data = tokenSnap.data();
  let localId = await getStoredDeviceId();
  if (!localId) {
    await getOrCreateDeviceId();
    localId = await getStoredDeviceId();
  }
  return evaluateDeviceTokenBinding({
    tokenExists: true,
    verified: data?.verified === true,
    boundDeviceId: (data?.deviceId as string | null | undefined) ?? null,
    localDeviceId: localId,
  });
}

function mapEmpleadoPortal(id: string, data: Record<string, unknown>, uid: string): EmpleadoPortal {
  return {
    id,
    uid,
    email: data.email as string | undefined,
    firstName: (data.firstName || data.nombre) as string | undefined,
    lastName: (data.lastName || data.apellido) as string | undefined,
    fileNumber: (data.fileNumber || data.legajo) as string | undefined,
    empresaId: data.empresaId as string | undefined,
    deviceId: (data.deviceId as string | null | undefined) ?? null,
  };
}

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const { auth, db } = getPortalFirebase();
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [previewEmpDocId, setPreviewEmpDocId] = useState<string | null>(null);
  const [employeeProfileLoading, setEmployeeProfileLoading] = useState(false);
  const [employeeProfileReady, setEmployeeProfileReady] = useState(false);
  const [empDocId, setEmpDocId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<EmpleadoPortal | null>(null);
  const [portalFeatures, setPortalFeatures] = useState<PortalFeatures>(DEFAULT_PORTAL_FEATURES);
  const [deviceVerified, setDeviceVerified] = useState<boolean | null>(null);
  const [deviceBlockReason, setDeviceBlockReason] = useState<DeviceBlockReason | null>(null);
  const [employeeProfileError, setEmployeeProfileError] = useState<string | null>(null);
  const pendingPreviewRef = useRef<string | null>(null);
  const initialUrlHandledRef = useRef(false);

  const applyDeviceVerifyResult = useCallback((result: DeviceVerifyResult) => {
    setDeviceVerified(result.verified);
    setDeviceBlockReason(result.verified ? null : result.reason ?? 'other_device');
  }, []);

  const resolvePendingPreviewId = useCallback(async (): Promise<string | null> => {
    if (!initialUrlHandledRef.current) {
      initialUrlHandledRef.current = true;
      try {
        const initialUrl = await Linking.getInitialURL();
        const fromUrl = parsePreviewEmpFromUrl(initialUrl);
        if (fromUrl) pendingPreviewRef.current = fromUrl;
      } catch {
        /* ignore */
      }
    }
    const id = pendingPreviewRef.current;
    pendingPreviewRef.current = null;
    return id;
  }, []);

  const loadEmployeeByDocId = useCallback(
    async (id: string, currentUser: User) => {
      setEmployeeProfileLoading(true);
      setEmployeeProfileError(null);
      try {
        const snap = await withTimeout(
          getDoc(doc(db, 'empleados', id)),
          FIRESTORE_PROFILE_TIMEOUT_MS,
          'Lectura de legajo preview',
        );
        if (!snap.exists()) {
          setEmployee(null);
          setEmpDocId(null);
          setEmployeeProfileError('Legajo no encontrado en Firestore.');
          return;
        }
        const data = snap.data();
        setEmpDocId(id);
        setEmployee(mapEmpleadoPortal(id, data, currentUser.uid));
        const pf = data.portalFeatures;
        if (pf && typeof pf === 'object') {
          setPortalFeatures((prev) => ({ ...prev, ...pf }));
        } else {
          setPortalFeatures(DEFAULT_PORTAL_FEATURES);
        }
        // Preview SuperAdmin: atar FCM del dispositivo del SA al legajo visto
        // (previewOf: true). En web no pide permiso acá — hace falta el botón.
        const { registerPushNotifications } = await import('../lib/pushNotifications');
        await registerPushNotifications({
          user: currentUser,
          db,
          empDocId: id,
          empresaId: (data.empresaId as string) ?? null,
          previewOf: true,
          interactive: false,
        }).catch(() => {});
      } catch (err) {
        setEmployee(null);
        setEmpDocId(null);
        if (isNetworkOrFirestoreError(err)) {
          setEmployeeProfileError('No se pudo leer el legajo de preview. Revisá la conexión y reintentá.');
        } else {
          const msg = err instanceof Error ? err.message : 'Error cargando legajo preview';
          setEmployeeProfileError(msg);
        }
      } finally {
        setEmployeeProfileLoading(false);
        setEmployeeProfileReady(true);
      }
    },
    [db],
  );

  const loadEmployee = useCallback(
    async (currentUser: User) => {
      setEmployeeProfileLoading(true);
      setEmployeeProfileError(null);
      try {
        await currentUser.getIdToken(true);
        const id = await withTimeout(
          resolveEmpDocIdWithRetry(db, currentUser, 4),
          FIRESTORE_PROFILE_TIMEOUT_MS,
          'Carga de legajo',
        );
        setEmpDocId(id);
        if (!id) {
          setEmployee(null);
          setPortalFeatures(DEFAULT_PORTAL_FEATURES);
          setEmployeeProfileError(
            isEmulatorMode()
              ? 'No hay legajo para tu usuario. Cerrá sesión, ejecutá npm run seed en la PC y volvé a entrar con el usuario de prueba.'
              : 'No hay legajo vinculado a tu usuario. Pedile a RRHH que revise tu acceso al portal.',
          );
          return;
        }
        const snap = await withTimeout(
          getDoc(doc(db, 'empleados', id)),
          FIRESTORE_PROFILE_TIMEOUT_MS,
          'Lectura de legajo',
        );
        if (!snap.exists()) {
          setEmployee(null);
          setEmployeeProfileError('Legajo no encontrado en Firestore.');
          return;
        }
        const data = snap.data();
        if (data.uid !== currentUser.uid) {
          try {
            await updateDoc(doc(db, 'empleados', id), { uid: currentUser.uid });
          } catch {
            /* emulador / permisos */
          }
        }
        setEmployee(mapEmpleadoPortal(id, data, currentUser.uid));
        const pf = data.portalFeatures;
        if (pf && typeof pf === 'object') {
          setPortalFeatures((prev) => ({ ...prev, ...pf }));
        } else {
          setPortalFeatures(DEFAULT_PORTAL_FEATURES);
        }
      } catch (err) {
        setEmployee(null);
        if (isNetworkOrFirestoreError(err)) {
          setEmployeeProfileError(
            'No se pudo leer Firestore desde el celular. Misma Wi‑Fi, firewall (8080/9099) y EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.0.49 en .env. Tocá Reintentar.',
          );
        } else {
          const msg = err instanceof Error ? err.message : 'Error cargando legajo';
          setEmployeeProfileError(msg);
        }
      } finally {
        setEmployeeProfileLoading(false);
        setEmployeeProfileReady(true);
      }
    },
    [db],
  );

  const bootstrapSession = useCallback(
    async (currentUser: User, previewId: string | null) => {
      const superAdmin = await userIsSuperAdmin(currentUser);
      setIsSuperAdmin(superAdmin);

      const okEmployee = await isEmployeeUser(currentUser, db);
      if (!okEmployee) {
        await firebaseSignOut(auth);
        setUser(null);
        setIsSuperAdmin(false);
        setDeviceVerified(null);
        setDeviceBlockReason(null);
        return;
      }

      if (superAdmin) {
        setDeviceVerified(true);
        setDeviceBlockReason(null);
        if (previewId) {
          setPreviewEmpDocId(previewId);
          await loadEmployeeByDocId(previewId, currentUser);
        } else {
          setPreviewEmpDocId(null);
          setEmpDocId(null);
          setEmployee(null);
          setPortalFeatures(DEFAULT_PORTAL_FEATURES);
          setEmployeeProfileReady(true);
          setEmployeeProfileLoading(false);
          setEmployeeProfileError(null);
        }
        return;
      }

      setPreviewEmpDocId(null);
      // Gate: no registrar push ni exponer datos de ops hasta deviceVerified === true.
      // loadEmployee es necesario para device-blocked (nombre / empDocId) pero las
      // pantallas con tabs solo montan hooks de datos tras el gate.
      await loadEmployee(currentUser);
      const result = await verifyDeviceForUser(currentUser, db);
      applyDeviceVerifyResult(result);
      if (result.verified) {
        const resolvedId = await resolveEmpDocIdWithRetry(db, currentUser, 2);
        const empSnap = resolvedId ? await getDoc(doc(db, 'empleados', resolvedId)) : null;
        const { registerPushNotifications } = await import('../lib/pushNotifications');
        await registerPushNotifications({
          user: currentUser,
          db,
          empDocId: resolvedId,
          empresaId: (empSnap?.data()?.empresaId as string) ?? null,
          interactive: false,
        }).catch(() => {});
      }
    },
    [auth, db, loadEmployee, loadEmployeeByDocId, applyDeviceVerifyResult],
  );

  const enterPreview = useCallback(
    async (id: string) => {
      if (!user || !isSuperAdmin) return;
      setPreviewEmpDocId(id);
      await loadEmployeeByDocId(id, user);
    },
    [user, isSuperAdmin, loadEmployeeByDocId],
  );

  const exitPreview = useCallback(async () => {
    try {
      await detachPushTokenOnServer(db);
    } catch {
      /* no bloquear salida de preview */
    }
    setPreviewEmpDocId(null);
    setEmpDocId(null);
    setEmployee(null);
    setPortalFeatures(DEFAULT_PORTAL_FEATURES);
    setEmployeeProfileError(null);
    setEmployeeProfileReady(true);
    setEmployeeProfileLoading(false);
  }, [db]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      const emp = parsePreviewEmpFromUrl(url);
      if (!emp) return;
      if (user && isSuperAdmin) {
        void enterPreview(emp);
        return;
      }
      pendingPreviewRef.current = emp;
    });

    return () => sub.remove();
  }, [user, isSuperAdmin, enterPreview]);

  useEffect(() => {
    const authReadyTimer = setTimeout(() => {
      setInitializing(false);
    }, AUTH_INIT_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      clearTimeout(authReadyTimer);
      setUser(nextUser);
      if (!nextUser) {
        setIsSuperAdmin(false);
        setPreviewEmpDocId(null);
        pendingPreviewRef.current = null;
        setEmpDocId(null);
        setEmployee(null);
        setEmployeeProfileReady(false);
        setPortalFeatures(DEFAULT_PORTAL_FEATURES);
        setDeviceVerified(null);
        setDeviceBlockReason(null);
        setEmployeeProfileError(null);
        setInitializing(false);
        return;
      }

      try {
        // Mientras corre bootstrap, deviceVerified queda null → UI de carga (sin tabs/datos).
        setDeviceVerified(null);
        setDeviceBlockReason(null);
        const previewId = await resolvePendingPreviewId();
        await bootstrapSession(nextUser, previewId);
      } catch (err) {
        const token = await nextUser.getIdTokenResult(true).catch(() => null);
        const role = normalizeRoleKey(String(token?.claims?.role ?? ''));
        const type = normalizeRoleKey(String(token?.claims?.type ?? ''));
        const superAdmin = isSuperAdminRole(token?.claims?.role) || isSuperAdminRole(token?.claims?.type);
        if (superAdmin) {
          setIsSuperAdmin(true);
          setDeviceVerified(true);
          setDeviceBlockReason(null);
          setEmployeeProfileReady(true);
        } else if (EMPLOYEE_ROLES.includes(role) || EMPLOYEE_ROLES.includes(type)) {
          try {
            await loadEmployee(nextUser);
          } catch {
            /* Firestore intermitente en móvil */
          }
          // No abrir la app si falló la verificación: queda en carga hasta refresh / reintento.
          setDeviceVerified(null);
          setDeviceBlockReason(null);
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
  }, [auth, bootstrapSession, loadEmployee, resolvePendingPreviewId]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const okEmployee = await isEmployeeUser(cred.user, db);
        if (!okEmployee) {
          await firebaseSignOut(auth);
          throw new Error('Esta app es solo para vigiladores. Usá el panel web para administración.');
        }
        const previewId = await resolvePendingPreviewId();
        await bootstrapSession(cred.user, previewId);
      } catch (err) {
        if (isNetworkOrFirestoreError(err)) {
          throw new Error(
            'Auth OK pero Firestore no respondió. En el celular configurá la IP de tu PC en EXPO_PUBLIC_FIREBASE_EMULATOR_HOST (apps/mobile-guardia/.env) y ejecutá npx expo start -c.',
          );
        }
        throw err;
      }
    },
    [auth, db, bootstrapSession, resolvePendingPreviewId],
  );

  const signOut = useCallback(async () => {
    try {
      await unregisterPushForUser(db);
    } catch {
      /* no bloquear logout */
    }
    await firebaseSignOut(auth);
    setUser(null);
    setIsSuperAdmin(false);
    setPreviewEmpDocId(null);
    setEmpDocId(null);
    setEmployee(null);
    setPortalFeatures(DEFAULT_PORTAL_FEATURES);
    setEmployeeProfileReady(false);
    setDeviceVerified(null);
    setDeviceBlockReason(null);
    setEmployeeProfileError(null);
  }, [auth, db]);

  const refreshEmployee = useCallback(async () => {
    if (!user) return;
    if (isSuperAdmin && previewEmpDocId) {
      await loadEmployeeByDocId(previewEmpDocId, user);
      return;
    }
    await loadEmployee(user);
    const result = await verifyDeviceForUser(user, db);
    applyDeviceVerifyResult(result);
  }, [user, isSuperAdmin, previewEmpDocId, loadEmployee, loadEmployeeByDocId, db, applyDeviceVerifyResult]);

  const isPreviewMode = isSuperAdmin && !!previewEmpDocId;

  const value = useMemo(
    () => ({
      user,
      initializing,
      isSuperAdmin,
      isPreviewMode,
      previewEmpDocId,
      employeeProfileLoading,
      employeeProfileReady,
      empDocId,
      employee,
      portalFeatures,
      deviceVerified,
      deviceBlockReason,
      employeeProfileError,
      signIn,
      signOut,
      refreshEmployee,
      enterPreview,
      exitPreview,
    }),
    [
      user,
      initializing,
      isSuperAdmin,
      isPreviewMode,
      previewEmpDocId,
      employeeProfileLoading,
      employeeProfileReady,
      empDocId,
      employee,
      portalFeatures,
      deviceVerified,
      deviceBlockReason,
      employeeProfileError,
      signIn,
      signOut,
      refreshEmployee,
      enterPreview,
      exitPreview,
    ],
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
