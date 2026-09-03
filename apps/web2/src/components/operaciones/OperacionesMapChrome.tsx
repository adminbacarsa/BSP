import React from 'react';
import { Crosshair, MapPin } from 'lucide-react';

const LEGEND: { color: string; label: string }[] = [
  { color: '#10b981', label: 'Activo' },
  { color: '#f59e0b', label: 'Tarde' },
  { color: '#e11d48', label: 'Vacante / Ausente' },
  { color: '#f97316', label: 'Retención' },
  { color: '#d97706', label: 'Evento' },
  { color: '#7c3aed', label: 'Devuelto' },
  { color: '#3b82f6', label: 'Franco' },
  { color: '#64748b', label: 'Sin turno' },
];

export function OperacionesMapChrome({
  provider,
  markerCount,
  onFit,
}: {
  provider: 'google' | 'osm';
  markerCount: number;
  onFit?: () => void;
}) {
  return (
    <>
      {/* Izquierda, encima de Alertas y del logo Google (~56px) */}
      <div className="absolute bottom-28 left-4 z-[450] pointer-events-auto max-w-[220px]">
        <div className="rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-lg px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-300">
            <MapPin size={11} className={provider === 'google' ? 'text-indigo-400' : 'text-amber-400'} />
            {provider === 'google' ? 'Google Maps' : 'OpenStreetMap'}
            <span className="text-slate-500 font-bold normal-case tracking-normal">· {markerCount} pts</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {LEGEND.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-[9px] font-bold text-slate-300">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Derecha: encima de zoom / attribution de Google */}
      {onFit && (
        <button
          type="button"
          onClick={onFit}
          className="absolute bottom-24 right-14 z-[450] pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-200 text-[10px] font-black uppercase hover:bg-slate-800 shadow-lg"
        >
          <Crosshair size={12} /> Ajustar
        </button>
      )}
    </>
  );
}
