import React from 'react';
import { useOperacionesMonitorCore } from '@/hooks/useOperacionesMonitor';
import { OperacionesMonitorContext } from '@/context/operacionesMonitorContext';

export function OperacionesMonitorProvider({ children }: { children: React.ReactNode }) {
  const shared = useOperacionesMonitorCore({ enabled: true });
  return (
    <OperacionesMonitorContext.Provider value={shared}>
      {children}
    </OperacionesMonitorContext.Provider>
  );
}

export { useOperacionesMonitorContext } from '@/context/operacionesMonitorContext';
