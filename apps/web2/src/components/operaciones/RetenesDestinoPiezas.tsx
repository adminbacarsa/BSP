import React from 'react';
import { format } from 'date-fns';
import { GraduationCap, MapPin, Star, UserCheck } from 'lucide-react';
import {
  formatearDistancia,
  type OrdenRetenes,
  type RetenEvaluado,
} from '@/lib/operaciones/retenesParaDestino';

export interface DestinoRetenOpcion {
  key: string;
  tipo: 'hueco' | 'objetivo';
  objectiveId: string;
  objetivo: string;
  positionName?: string;
  lat?: number;
  lng?: number;
  /** Texto de la opción del selector. */
  etiqueta: string;
}

function claseDistancia(ev: RetenEvaluado): string {
  if (!ev.hasGeo || ev.distanceKm == null) return 'bg-slate-100 text-slate-500 border-slate-200';
  if (ev.distanceKm <= 5) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (ev.distanceKm <= 15) return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (ev.distanceKm <= 30) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function claseNivel(ev: RetenEvaluado): string {
  switch (ev.nivel) {
    case 'TITULAR':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case 'CONOCIDO':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'ESCUELA':
      return 'bg-sky-100 text-sky-700 border-sky-200';
    default:
      return 'bg-slate-100 text-slate-500 border-slate-200';
  }
}

const CHIP = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap';

export function ChipsRetenEvaluado({ ev }: { ev: RetenEvaluado }) {
  const Icono = ev.nivel === 'TITULAR' ? Star : ev.nivel === 'ESCUELA' ? GraduationCap : UserCheck;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`${CHIP} ${claseDistancia(ev)}`} title="Distancia del domicilio al objetivo (en línea recta)">
        <MapPin size={10} aria-hidden />
        {formatearDistancia(ev)}
      </span>
      <span
        className={`${CHIP} ${claseNivel(ev)}`}
        title={
          ev.ultimaPresenciaMs
            ? `Última presencia en el objetivo: ${format(new Date(ev.ultimaPresenciaMs), 'dd/MM/yyyy')}`
            : 'Conocimiento del objetivo según el legajo'
        }
      >
        <Icono size={10} aria-hidden />
        {ev.nivelLabel}
        {ev.nivel !== 'TITULAR' && ev.turnosEnObjetivo > 0 ? ` · ${ev.turnosEnObjetivo} turnos` : ''}
      </span>
      {ev.conocePuesto && (
        <span className={`${CHIP} bg-emerald-50 text-emerald-700 border-emerald-200`} title="Conoce el puesto exacto">
          Puesto ✓
        </span>
      )}
      {!ev.dentroRadio && ev.dentroRadioExtendido && (
        <span className={`${CHIP} bg-amber-50 text-amber-800 border-amber-200`} title="Fuera del radio de 15 km">
          &gt; 15 km
        </span>
      )}
      {!ev.dentroRadioExtendido && (
        <span className={`${CHIP} bg-red-50 text-red-700 border-red-200`} title="Fuera del radio extendido de 30 km">
          &gt; 30 km
        </span>
      )}
    </div>
  );
}

export function SelectorDestinoRetenes({
  destinos,
  valor,
  totalRetenes,
  retenesHoy,
  retenesManana,
  orden,
  onChange,
  onOrden,
}: {
  destinos: DestinoRetenOpcion[];
  valor: string;
  /** @deprecated Preferir retenesHoy + retenesManana (el total sumado confundía con la pestaña Hoy/Mañana). */
  totalRetenes?: number;
  /** Retenes del día activo en el modal (pestaña Hoy). */
  retenesHoy?: number;
  /** Retenes de la pestaña Mañana. */
  retenesManana?: number;
  orden: OrdenRetenes;
  onChange: (key: string) => void;
  onOrden: (o: OrdenRetenes) => void;
}) {
  const huecos = destinos.filter((d) => d.tipo === 'hueco');
  const objetivos = destinos.filter((d) => d.tipo === 'objetivo');
  const etiquetaTodos =
    retenesHoy !== undefined && retenesManana !== undefined
      ? `Todos los retenes (hoy ${retenesHoy} · mañana ${retenesManana})`
      : totalRetenes !== undefined
        ? `Todos los retenes (${totalRetenes})`
        : null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-violet-50/70 border-b border-violet-100">
      <label className="text-[10px] font-black uppercase tracking-wide text-violet-700" htmlFor="retenes-destino">
        ¿Dónde lo voy a usar?
      </label>
      <select
        id="retenes-destino"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-[220px] max-w-xl rounded-xl border border-violet-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
      >
        <option value="">Elegí un hueco u objetivo…</option>
        {etiquetaTodos && (
          <option value="__todos__">{etiquetaTodos}</option>
        )}
        {huecos.length > 0 && (
          <optgroup label="Huecos sin cubrir">
            {huecos.map((d) => (
              <option key={d.key} value={d.key}>
                {d.etiqueta}
              </option>
            ))}
          </optgroup>
        )}
        {objetivos.length > 0 && (
          <optgroup label="Objetivos de hoy">
            {objetivos.map((d) => (
              <option key={d.key} value={d.key}>
                {d.etiqueta}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {valor && valor !== '__todos__' && (
        <div className="inline-flex rounded-xl border border-violet-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Orden de retenes">
          {(
            [
              ['cercania', 'Cercanía'],
              ['conocimiento', 'Conocimiento'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={orden === id}
              onClick={() => onOrden(id)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${
                orden === id ? 'bg-violet-600 text-white' : 'text-violet-700 hover:bg-violet-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
