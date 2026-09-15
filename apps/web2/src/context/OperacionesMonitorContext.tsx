import React from 'react';
import {
  useOperacionesMonitorCore,
  OperacionesMonitorReactContext,
} from '@/hooks/useOperacionesMonitor';

export function OperacionesMonitorProvider({ children }: { children: React.ReactNode }) {
  const shared = useOperacionesMonitorCore({ enabled: true });
  return (
    <OperacionesMonitorReactContext.Provider value={shared}>
      {children}
    </OperacionesMonitorReactContext.Provider>
  );
}

export { useOperacionesMonitorContext } from '@/hooks/useOperacionesMonitor';
