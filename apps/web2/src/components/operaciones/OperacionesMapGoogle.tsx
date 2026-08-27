import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from '@react-google-maps/api';
import {
  DEFAULT_MAP_CENTER,
  getGoogleMapsApiKey,
  GOOGLE_MAPS_LIBRARIES,
  OPERACIONES_MAP_OPTIONS,
  toLatLng,
} from '@/lib/googleMapsConfig';
import { buildOperacionesMarkerIcon } from '@/lib/operaciones/mapMarkerIcons';
import { useOperacionesMapMarkers } from '@/hooks/useOperacionesMapMarkers';
import { OperacionesMapPopup } from '@/components/operaciones/OperacionesMapPopup';

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
}: OperacionesMapProps) => {
  const mapCenter = toLatLng(center);
  const markers = useOperacionesMapMarkers(allObjectives, filteredShifts);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'cosp-google-maps',
    googleMapsApiKey: getGoogleMapsApiKey(),
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const markerIcons = useMemo(() => {
    const cache: Record<string, ReturnType<typeof buildOperacionesMarkerIcon>> = {};
    markers.forEach((m) => {
      if (!cache[m.iconPreset]) cache[m.iconPreset] = buildOperacionesMarkerIcon(m.iconPreset);
    });
    return cache;
  }, [markers]);

  const fitMapToMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || markers.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
    map.fitBounds(bounds, 48);
  }, [markers]);

  useEffect(() => {
    fitMapToMarkers();
  }, [fitMapToMarkers]);

  const selectedMarker = markers.find((m) => m.id === selectedMarkerId) ?? null;

  if (loadError) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-900 text-rose-300 text-sm font-medium p-6 text-center">
        No se pudo cargar Google Maps. Verificá la API key y que Maps JavaScript API esté habilitada.
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
          icon={markerIcons[marker.iconPreset] as google.maps.Icon}
          zIndex={marker.layerOrder === 0 ? 1 : 500}
          onClick={() => setSelectedMarkerId(marker.id)}
        />
      ))}

      {selectedMarker && (
        <InfoWindow
          position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
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
  );
};

export default OperacionesMapGoogle;
