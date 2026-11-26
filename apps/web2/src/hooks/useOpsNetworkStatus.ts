import { useEffect, useState } from 'react';
import type { OpsNetworkKind } from '@/lib/operaciones/opsNetworkStatus';
import { readNavigatorOnline } from '@/lib/operaciones/opsNetworkStatus';

/**
 * Online / offline del navegador + ventana breve "Sincronizando…" al recuperar red.
 */
export function useOpsNetworkStatus(): {
  kind: OpsNetworkKind;
  online: boolean;
} {
  const [online, setOnline] = useState(() => readNavigatorOnline());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      setSyncing(true);
      window.setTimeout(() => setSyncing(false), 2500);
    };
    const off = () => {
      setOnline(false);
      setSyncing(false);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    setOnline(readNavigatorOnline());
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const kind: OpsNetworkKind = !online ? 'offline' : syncing ? 'syncing' : 'online';
  return { kind, online };
}
