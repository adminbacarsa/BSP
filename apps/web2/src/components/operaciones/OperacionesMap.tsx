import React from 'react';
import dynamic from 'next/dynamic';
import { useEmpresa } from '@/context/EmpresaContext';
import { getGoogleMapsApiKey, isGoogleMapsEnabled } from '@/lib/googleMapsConfig';
import type { OperacionesMapProps } from '@/components/operaciones/OperacionesMapGoogle';

const OperacionesMapGoogle = dynamic(() => import('@/components/operaciones/OperacionesMapGoogle'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-900 text-slate-400 font-mono text-xs">
      CARGANDO MAPA TÁCTICO...
    </div>
  ),
});

const OperacionesMapLeaflet = dynamic(() => import('@/components/operaciones/OperacionesMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-900 text-slate-400 font-mono text-xs">
      CARGANDO MAPA TÁCTICO...
    </div>
  ),
});

const OperacionesMap = (props: OperacionesMapProps) => {
  const { empresa } = useEmpresa();
  const runtimeKey = empresa?.googleMapsApiKey;
  const apiKey = getGoogleMapsApiKey(runtimeKey);

  if (isGoogleMapsEnabled(runtimeKey)) {
    return <OperacionesMapGoogle {...props} apiKey={apiKey} />;
  }
  return <OperacionesMapLeaflet {...props} />;
};

export default OperacionesMap;
export type { OperacionesMapProps };
