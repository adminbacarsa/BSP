import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { usePortalAuth } from './PortalAuthContext';
import { getPortalFirebase } from '../lib/portal';
import {
  activatePushNow,
  getNativePushGateSnapshot,
  registerPushNotifications,
  type NativePushGateSnapshot,
  type PushRegistrationStatus,
} from '../lib/pushNotifications';
import type { PushGateReason } from '../lib/pushPermissionGate';

type PushGateContextValue = {
  /** Banner fijo nativo (no en web). */
  needsBanner: boolean;
  reason: PushGateReason;
  status: PushRegistrationStatus | null;
  busy: boolean;
  refresh: () => Promise<void>;
  activateNow: () => Promise<void>;
};

const PushGateContext = createContext<PushGateContextValue | null>(null);

export function PushGateProvider({ children }: { children: ReactNode }) {
  const {
    user,
    empDocId,
    employee,
    employeeProfileReady,
    deviceVerified,
    isSuperAdmin,
    isPreviewMode,
  } = usePortalAuth();
  const { db } = getPortalFirebase();
  const [needsBanner, setNeedsBanner] = useState(false);
  const [reason, setReason] = useState<PushGateReason>(null);
  const [status, setStatus] = useState<PushRegistrationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage =
    !!user &&
    employeeProfileReady &&
    !!empDocId &&
    (isPreviewMode || (deviceVerified === true && !isSuperAdmin));

  const applyGate = useCallback((gate: NativePushGateSnapshot) => {
    setNeedsBanner(gate.needsBanner);
    setReason(gate.reason);
  }, []);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') {
      setNeedsBanner(false);
      setReason(null);
      return;
    }
    if (!canManage || !user) {
      setNeedsBanner(false);
      setReason(null);
      return;
    }
    const gate = await getNativePushGateSnapshot();
    applyGate(gate);
    if (gate.permissionGranted && !gate.channelBlocked) {
      const result = await registerPushNotifications({
        user,
        db,
        empDocId,
        empresaId: employee?.empresaId ?? null,
        previewOf: isPreviewMode,
        interactive: false,
      });
      setStatus(result.status);
      if (result.status === 'enabled') {
        setNeedsBanner(false);
        setReason(null);
      } else {
        const again = await getNativePushGateSnapshot();
        applyGate(again);
      }
    } else {
      setStatus(gate.permissionGranted ? 'denied' : 'denied');
    }
  }, [
    applyGate,
    canManage,
    user,
    db,
    empDocId,
    employee?.empresaId,
    isPreviewMode,
  ]);

  const activateNow = useCallback(async () => {
    if (!user || !empDocId || busy) return;
    setBusy(true);
    try {
      const result = await activatePushNow({
        user,
        db,
        empDocId,
        empresaId: employee?.empresaId ?? null,
        previewOf: isPreviewMode,
      });
      setStatus(result.status);
      if (result.status === 'enabled') {
        setNeedsBanner(false);
        setReason(null);
      } else if (result.gate) {
        applyGate(result.gate);
      } else {
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [user, empDocId, busy, db, employee?.empresaId, isPreviewMode, applyGate, refresh]);

  useEffect(() => {
    if (!canManage) {
      setNeedsBanner(false);
      setReason(null);
      return;
    }
    void refresh();
  }, [canManage, refresh]);

  useEffect(() => {
    if (!canManage || Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [canManage, refresh]);

  const value = useMemo(
    () => ({ needsBanner, reason, status, busy, refresh, activateNow }),
    [needsBanner, reason, status, busy, refresh, activateNow],
  );

  return <PushGateContext.Provider value={value}>{children}</PushGateContext.Provider>;
}

export function usePushGate(): PushGateContextValue {
  const ctx = useContext(PushGateContext);
  if (!ctx) {
    return {
      needsBanner: false,
      reason: null,
      status: null,
      busy: false,
      refresh: async () => {},
      activateNow: async () => {},
    };
  }
  return ctx;
}
