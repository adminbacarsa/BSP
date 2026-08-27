import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getMapBasemapConfig } from '@/lib/mapBasemap';
import { buildOperacionesMarkerIcon } from '@/lib/operaciones/mapMarkerIcons';
import { useOperacionesMapMarkers } from '@/hooks/useOperacionesMapMarkers';
import { OperacionesMapPopup } from '@/components/operaciones/OperacionesMapPopup';
import type { OperacionesMapProps } from '@/components/operaciones/OperacionesMapGoogle';

const createLeafletIcon = (preset: string) => {
  const gIcon = buildOperacionesMarkerIcon(preset as any);
  return L.icon({
    iconUrl: gIcon.url,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
};

const MapUpdater = ({ markers }: { markers: { lat: number; lng: number }[] }) => {
  const map = useMap();
  useEffect(() => {
    if (markers.length > 0) {
      const group = new L.FeatureGroup(markers.map((m) => L.marker([m.lat, m.lng])));
      map.fitBounds(group.getBounds().pad(0.2));
    }
  }, [markers, map]);
  return null;
};

const OperacionesMapLeaflet = ({
  center = [-31.4201, -64.1888],
  allObjectives = [],
  filteredShifts = [],
  onOpenCoverage,
  onOpenAttendance,
  onOpenHandover,
  onOpenInterrupt,
  onOpenManualRetention,
}: OperacionesMapProps) => {
  const markers = useOperacionesMapMarkers(allObjectives, filteredShifts);
  const basemap = getMapBasemapConfig();
  const mapCenter = Array.isArray(center) ? center : [center.lat, center.lng];

  return (
    <div className="relative h-full w-full">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] px-3 py-1.5 rounded-xl bg-slate-900/90 text-slate-200 text-[10px] font-semibold shadow-lg border border-slate-700/50 pointer-events-none">
        Modo OpenStreetMap — agregá <code className="text-indigo-300">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> para Google Maps y rondines
      </div>
      <MapContainer center={mapCenter as [number, number]} zoom={13} style={{ height: '100%', width: '100%' }} className="z-0">
        <TileLayer url={basemap.url} attribution={basemap.attribution} />
        <MapUpdater markers={markers} />

        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.lat, marker.lng]}
            icon={createLeafletIcon(marker.iconPreset)}
            zIndexOffset={marker.layerOrder === 0 ? 0 : 500}
          >
            <Popup className="custom-popup">
              <OperacionesMapPopup
                marker={marker}
                onOpenCoverage={onOpenCoverage}
                onOpenAttendance={onOpenAttendance}
                onOpenHandover={onOpenHandover}
                onOpenInterrupt={onOpenInterrupt}
                onOpenManualRetention={onOpenManualRetention}
              />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default OperacionesMapLeaflet;
