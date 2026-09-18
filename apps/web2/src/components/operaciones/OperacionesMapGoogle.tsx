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
import { useOperacionesMapMarkers, type OperacionesMapMarker } from '@/hooks/useOperacionesMapMarkers';
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

const MAP_OPTIONS = OPERACIONES_MAP_OPTIONS as google.maps.MapOptions;

const MapMarker = React.memo(function MapMarker({
  marker,
  icon,
  tacticalHud,
  onSelect,
}: {
  marker: OperacionesMapMarker;
  icon: google.maps.Icon | undefined;
  tacticalHud?: boolean;
  onSelect: (id: string) => void;
}) {
  const label = useMemo(
    () => ({
      text: truncateObjectiveLabel(marker.name) || ' ',
      color: '#f8fafc',
      fontSize: '11px',
      fontWeight: '700' as const,
      className: 'cosp-obj-label',
    }),
    [marker.name],
  );

  return (
    <Marker
      position={{ lat: marker.lat, lng: marker.lng }}
      icon={icon}
      label={label}
      title={`${marker.name} · ${marker.statusText}`}
      zIndex={marker.layerOrder === 0 ? 1 : marker.isEvent ? 600 : 500}
      onClick={() => onSelect(marker.id)}
      options={{ optimized: true }}
    />
  );
});

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
  const initialFitDoneRef = useRef(false);
  const markerIdsKeyRef = useRef('');
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

  const markerIdsKey = useMemo(
    () => markers.map((m) => m.id).sort().join('|'),
    [markers],
  );

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
    map.fitBounds(
      bounds,
      tacticalHud ? { top: 96, right: 56, bottom: 88, left: 24 } : 48,
    );
  }, [markers, tacticalHud]);

  // Auto-ajuste solo al cargar o cuando cambia el conjunto de objetivos (filtro cliente/búsqueda).
  // No re-fit en cada tick de Firestore (evita parpadeo de pines).
  useEffect(() => {
    if (!isLoaded || !mapRef.current || markers.length === 0) return;
    const idsChanged = markerIdsKeyRef.current !== markerIdsKey;
    if (!initialFitDoneRef.current || idsChanged) {
      fitMapToMarkers();
      initialFitDoneRef.current = true;
      markerIdsKeyRef.current = markerIdsKey;
    }
  }, [isLoaded, markers.length, markerIdsKey, fitMapToMarkers]);

  // Tras cambios de layout (flex/absolute), Google Maps a veces queda en 0×0 hasta un resize.
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const runResize = () => google.maps.event.trigger(map, 'resize');
    runResize();
    const t1 = window.setTimeout(runResize, 120);
    const t2 = window.setTimeout(runResize, 400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isLoaded]);

  const handleSelectMarker = useCallback((id: string) => {
    setSelectedMarkerId(id);
  }, []);

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
        options={MAP_OPTIONS}
        onLoad={(map) => {
          mapRef.current = map;
          if (markers.length > 0 && !initialFitDoneRef.current) {
            fitMapToMarkers();
            initialFitDoneRef.current = true;
            markerIdsKeyRef.current = markerIdsKey;
          }
        }}
        onUnmount={() => {
          mapRef.current = null;
          initialFitDoneRef.current = false;
          markerIdsKeyRef.current = '';
        }}
      >
        {markers.map((marker) => (
          <MapMarker
            key={marker.id}
            marker={marker}
            icon={markerIcons[marker.iconPreset]}
            tacticalHud={tacticalHud}
            onSelect={handleSelectMarker}
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
