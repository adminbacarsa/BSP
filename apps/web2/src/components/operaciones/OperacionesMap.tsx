import React from 'react';
import dynamic from 'next/dynamic';
import { useEmpresa } from '@/context/EmpresaContext';
import { getGoogleMapsApiKey, isGoogleMapsEnabled } from '@/lib/googleMapsConfig';
import type { OperacionesMapProps } from '@/components/operaciones/OperacionesMapGoogle';

const OperacionesMapGoogle = dynamic(() => import('@/components/operaciones/OperacionesMapGoogle'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-100 text-slate-500 font-mono text-xs">
      CARGANDO GOOGLE MAPS...
    </div>
  ),
});

const OperacionesMapLeaflet = dynamic(() => import('@/components/operaciones/OperacionesMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-100 text-slate-500 font-mono text-xs">
      CARGANDO MAPA...
    </div>
  ),
});

const OperacionesMap = (props: OperacionesMapProps) => {
  const { empresa, loadingEmpresa } = useEmpresa();
  const runtimeKey = empresa?.googleMapsApiKey;
  const apiKey = getGoogleMapsApiKey(runtimeKey);

  // Esperar empresa: evita montar OSM y después saltar a Google (dos “versiones”).
  if (loadingEmpresa || empresa === null) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-100 text-slate-500 font-mono text-xs">
        CARGANDO MAPA...
      </div>
    );
  }

  if (isGoogleMapsEnabled(runtimeKey)) {
    return <OperacionesMapGoogle {...props} apiKey={apiKey} />;
  }
  return <OperacionesMapLeaflet {...props} />;
};

export default OperacionesMap;
export type { OperacionesMapProps };
