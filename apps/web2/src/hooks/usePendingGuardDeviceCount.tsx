import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

const POLL_MS = 60_000;

type PendingGuardDeviceCountContextValue = {
  count: number;
  refresh: () => Promise<void>;
};

const PendingGuardDeviceCountContext = createContext<PendingGuardDeviceCountContextValue>({
  count: 0,
  refresh: async () => {},
});

export function PendingGuardDeviceCountProvider({
  enabled,
  empresaId,
  children,
}: {
  enabled: boolean;
  empresaId: string | null | undefined;
  children: ReactNode;
}) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled || !empresaId) {
      setCount(0);
      return;
    }
    try {
      const listFn = httpsCallable(functions, 'listPendingGuardDeviceRegistrations');
      const res = await listFn({ empresaId, limit: 50 });
      const data = res.data as { requests?: unknown[] };
      setCount(Array.isArray(data?.requests) ? data.requests.length : 0);
    } catch {
      setCount(0);
    }
  }, [enabled, empresaId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const scheduleTimer = () => {
      clearTimer();
      if (document.visibilityState === 'hidden') return;
      timer = setInterval(() => void refresh(), POLL_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        scheduleTimer();
      } else {
        clearTimer();
      }
    };

    void refresh();
    scheduleTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  const value: PendingGuardDeviceCountContextValue = { count, refresh };

  return (
    <PendingGuardDeviceCountContext.Provider value={value}>{children}</PendingGuardDeviceCountContext.Provider>
  );
}

/** Contador compartido (sidebar, bottom nav, campanas RRHH/CC). */
export function usePendingGuardDeviceCount(): PendingGuardDeviceCountContextValue {
  return useContext(PendingGuardDeviceCountContext);
}
