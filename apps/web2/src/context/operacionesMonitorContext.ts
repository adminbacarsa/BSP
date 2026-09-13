import { createContext, useContext } from 'react';
import type { OperacionesMonitorShared } from '@/hooks/useOperacionesMonitor';

export const OperacionesMonitorContext = createContext<OperacionesMonitorShared | null>(null);

export function useOperacionesMonitorContext(): OperacionesMonitorShared | null {
  return useContext(OperacionesMonitorContext);
}
