import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from '@react-google-maps/api';
import {
  DEFAULT_MAP_CENTER,
  getGoogleMapsApiKey,
  GOOGLE_MAPS_LIBRARIES,
  OPERACIONES_MAP_OPTIONS,
  toLatLng,
} from '@/lib/googleMapsConfig';
import { toGoogleMapsIcon, truncateObjectiveLabel } from '@/lib/operaciones/mapMarkerIcons';
import { MAP_OBJECTIVE_LABEL_CSS } from '@/components/operaciones/mapLabelStyles';
import { useOperacionesMapMarkers } from '@/hooks/useOperacionesMapMarkers';
import { OperacionesMapPopup } from '@/components/operaciones/OperacionesMapPopup';
import { OperacionesMapChrome } from '@/components/operaciones/OperacionesMapChrome';

export type OperacionesMapProps = {
  center?: [number, number] | { lat: number; lng: number };
  allObjectives?: any[];
  filteredShifts?: any[];
  onOpenCoverage: (shift: any) => void;
  onOpenCheckout?: (shift: any) => void;
  onOpenAttendance: (shift: any) => void;
  onOpenHandover: (shift: any) => void;
  onOpenInterrupt: (shift: any) => void;
  onOpenManualRetention?: (shift: any) => void;
  onReportPlanning?: (shift: any) => void;
  /** Key runtime (empresa). Si falta, usa NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. */
  apiKey?: string;
  /** HUD táctico arriba: leyenda más abajo y padding de fitBounds. */
  tacticalHud?: boolean;
};

const OperacionesMapGoogle = ({
  center,
  allObjectives = [],
  filteredShifts = [],
  onOpenCoverage,
  onOpenAttendance,
  onOpenHandover,
  onOpenInterrupt,
  onOpenManualRetention,
  apiKey,
  tacticalHud,
}: OperacionesMapProps) => {
  const mapCenter = toLatLng(center);
  const markers = useOperacionesMapMarkers(allObjectives, filteredShifts);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const resolvedKey = getGoogleMapsApiKey(apiKey);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'cosp-google-maps',
    googleMapsApiKey: resolvedKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const markerIcons = useMemo(() => {
    if (!isLoaded) return {} as Record<string, google.maps.Icon>;
    const cache: Record<string, google.maps.Icon> = {};
    markers.forEach((m) => {
      if (!cache[m.iconPreset]) cache[m.iconPreset] = toGoogleMapsIcon(m.iconPreset);
    });
    return cache;
  }, [markers, isLoaded]);

  const fitMapToMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || markers.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
    if (markers.length === 1) {
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(16);
      return;
    }
    map.fitBounds(bounds, tacticalHud
      ? { top: 96, right: 56, bottom: 88, left: 24 }
      : 48);
  }, [markers, tacticalHud]);

  useEffect(() => {
    fitMapToMarkers();
  }, [fitMapToMarkers]);

  const selectedMarker = markers.find((m) => m.id === selectedMarkerId) ?? null;

  if (loadError) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-900 text-rose-300 text-sm font-medium p-6 text-center gap-2">
        <p>No se pudo cargar Google Maps.</p>
        <p className="text-xs text-slate-400 font-normal max-w-md">
          Verificá la key en Configuración → Empresas (o NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) y que Maps JavaScript API esté habilitada en Google Cloud.
        </p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-900 text-slate-400 font-mono text-xs">
        CARGANDO GOOGLE MAPS...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <style>{MAP_OBJECTIVE_LABEL_CSS}</style>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={mapCenter || DEFAULT_MAP_CENTER}
        zoom={13}
        options={OPERACIONES_MAP_OPTIONS as google.maps.MapOptions}
        onLoad={(map) => {
          mapRef.current = map;
          fitMapToMarkers();
        }}
        onUnmount={() => {
          mapRef.current = null;
        }}
      >
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={{ lat: marker.lat, lng: marker.lng }}
            icon={markerIcons[marker.iconPreset]}
            label={{
              text: truncateObjectiveLabel(marker.name) || ' ',
              color: '#0f172a',
              fontSize: '10px',
              fontWeight: '800',
              className: 'cosp-obj-label',
            }}
            title={`${marker.name} · ${marker.statusText}`}
            zIndex={marker.layerOrder === 0 ? 1 : marker.isEvent ? 600 : 500}
            onClick={() => setSelectedMarkerId(marker.id)}
          />
        ))}

        {selectedMarker && (
          <InfoWindow
            position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
            options={{ pixelOffset: new google.maps.Size(0, tacticalHud ? 12 : 0) }}
            onCloseClick={() => setSelectedMarkerId(null)}
          >
            <OperacionesMapPopup
              marker={selectedMarker}
              onOpenCoverage={onOpenCoverage}
              onOpenAttendance={onOpenAttendance}
              onOpenHandover={onOpenHandover}
              onOpenInterrupt={onOpenInterrupt}
              onOpenManualRetention={onOpenManualRetention}
            />
          </InfoWindow>
        )}
      </GoogleMap>
      <OperacionesMapChrome
        provider="google"
        markerCount={markers.length}
        onFit={fitMapToMarkers}
        legendClassName={tacticalHud ? 'top-20 left-3' : 'top-4 left-4'}
      />
    </div>
  );
};

export default OperacionesMapGoogle;
