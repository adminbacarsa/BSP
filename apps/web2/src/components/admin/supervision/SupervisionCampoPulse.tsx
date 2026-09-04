import React from 'react';
import { AlertTriangle, ClipboardList, MapPin, ShieldAlert } from 'lucide-react';
import type { SupervisionCampoPulseMetrics } from '@/lib/supervision/supervisionCampoPulse';

export default function SupervisionCampoPulse({
  metrics,
  objectivesTotal,
  compact = false,
}: {
  metrics: SupervisionCampoPulseMetrics;
  objectivesTotal: number;
  compact?: boolean;
}) {
  const cards = [
    {
      key: 'incidentes',
      label: 'Incidentes abiertos',
      value: metrics.incidentesAbiertos,
      icon: ShieldAlert,
      tone: metrics.incidentesAbiertos > 0
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-slate-200 bg-white text-slate-600',
      valueTone: metrics.incidentesAbiertos > 0 ? 'text-rose-700' : 'text-slate-800',
    },
    {
      key: 'visitas',
      label: 'Visitas mes',
      value: metrics.visitasMes,
      icon: MapPin,
      tone: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      valueTone: 'text-indigo-800',
    },
    {
      key: 'objetivos',
      label: 'Objetivos visitados',
      value: objectivesTotal > 0
        ? `${metrics.objetivosVisitadosMes}/${objectivesTotal}`
        : metrics.objetivosVisitadosMes,
      icon: MapPin,
      tone: 'border-violet-200 bg-violet-50 text-violet-700',
      valueTone: 'text-violet-800',
    },
    {
      key: 'consignas',
      label: 'Consignas activas',
      value: metrics.consignasActivas,
      icon: ClipboardList,
      tone: 'border-teal-200 bg-teal-50 text-teal-700',
      valueTone: 'text-teal-800',
    },
  ] as const;

  if (compact) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
        {cards.map(({ key, label, value, tone, valueTone }) => (
          <div
            key={key}
            className={`shrink-0 rounded-xl border px-3 py-2 min-w-[108px] ${tone}`}
          >
            <p className="text-[9px] font-black uppercase opacity-80 truncate">{label}</p>
            <p className={`text-lg font-black leading-tight ${valueTone}`}>{value}</p>
          </div>
        ))}
        {metrics.visitasCriticasMes > 0 && (
          <div className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 min-w-[108px] text-amber-800">
            <p className="text-[9px] font-black uppercase flex items-center gap-1">
              <AlertTriangle size={10} /> Críticas
            </p>
            <p className="text-lg font-black">{metrics.visitasCriticasMes}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {cards.map(({ key, label, value, icon: Icon, tone, valueTone }) => (
        <div key={key} className={`rounded-2xl border p-3 shadow-sm ${tone}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[10px] font-black uppercase">{label}</p>
            <Icon size={14} className="opacity-70 shrink-0" />
          </div>
          <p className={`text-2xl font-black ${valueTone}`}>{value}</p>
        </div>
      ))}
      {metrics.visitasCriticasMes > 0 && (
        <div className="col-span-2 lg:col-span-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle size={14} />
            {metrics.visitasCriticasMes} visita{metrics.visitasCriticasMes !== 1 ? 's' : ''} con resultado crítico este mes
          </p>
        </div>
      )}
    </div>
  );
}
