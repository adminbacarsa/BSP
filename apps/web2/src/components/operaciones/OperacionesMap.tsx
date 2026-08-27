import React from 'react';
import dynamic from 'next/dynamic';
import { isGoogleMapsEnabled } from '@/lib/googleMapsConfig';
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
  if (isGoogleMapsEnabled()) return <OperacionesMapGoogle {...props} />;
  return <OperacionesMapLeaflet {...props} />;
};

export default OperacionesMap;
export type { OperacionesMapProps };
