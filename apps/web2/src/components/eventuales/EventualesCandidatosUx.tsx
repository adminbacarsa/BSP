/**
 * Piezas de la solapa «Eventuales (bolsa)» del modal de cobertura. Sin Firestore: las usa
 * `EventualesCandidatosPanel` y se renderizan en los tests.
 * En cobertura (06/10) al eventual solo se le pregunta: la tarjeta lleva casilla y la barra manda la
 * consulta. `modo="asignar"` queda para Eventos y Sustituir, que no consultan.
 */
import React from 'react';
import { AlertTriangle, BellOff, ChevronDown, ExternalLink, MapPin, Phone } from 'lucide-react';
import { TOOLTIP_SIN_PUSH } from '@/lib/eventuales/consultaCanal.mjs';
import { PuntajeChip } from '@/components/desempeno/PuntajeChip';
import { PruebasBadge } from '@/components/servicios/EventoConvocarResumen';
import {
  ESPERA_OPCIONES,
  TEXTO_EVENTUALES_SOLO_CONSULTA,
  accionParaMotivo,
  linkFichaEventual,
  horasDelBloque,
  textoBarraPreguntar,
  textoBotonEnviar,
  textoHorasBloque,
  textoNoDisponibles,
  type JornadaCorta,
  type ModoEventuales,
} from '@/lib/planificacion/coberturaEventualesUx';

export type CandidatoTarjeta = {
  cuil: string;
  nombre: string;
  telefono?: string;
  elegible: boolean;
  motivo: string | null;
  motivoCodigo: string | null;
  distanciaKm: number | null;
  pruebasSinMarco?: boolean;
  horasMes?: { texto: string; aviso: boolean } | null;
  /** El bloque de días no entra en el tope del mes. */
  topeBloque?: string | null;
  canal?: { chip?: string | null; motivo?: string | null; sinCanal?: boolean; porMail?: boolean; sinPush?: boolean } | null;
  linkAcceso?: string | null;
};

/** Una línea arriba de la bolsa en cobertura: no hay asignación directa para el eventual. */
export function AvisoEventualesSoloConsulta() {
  return (
    <p className="mb-2 px-1 text-[9px] font-bold text-slate-500" data-eventuales-solo-consulta>
      {TEXTO_EVENTUALES_SOLO_CONSULTA}
    </p>
  );
}

export function TarjetaEventual({ c, modo, marcado, disabled, onToggle, onAsignar }: {
  c: CandidatoTarjeta;
  modo: ModoEventuales;
  marcado: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onAsignar: () => void;
}) {
  const preguntar = modo === 'preguntar';
  const onClick = preguntar ? onToggle : onAsignar;
  return (
    <button
      type="button"
      data-eventual-tarjeta={c.cuil}
      disabled={!!disabled}
      onClick={onClick}
      aria-pressed={preguntar ? marcado : undefined}
      title={preguntar ? `Preguntar a ${c.nombre}` : `Asignar a ${c.nombre}`}
      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
        marcado && preguntar ? 'border-indigo-400 bg-indigo-50/70' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {preguntar && (
        <span
          aria-hidden="true"
          data-consulta-cuil={c.cuil}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${marcado ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white'}`}
        >
          {marcado ? <span className="text-[10px] font-black leading-none">✓</span> : null}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[11px] font-black text-slate-800">
          <span className="truncate" title={c.cuil}>{c.nombre}</span>
          <PuntajeChip sujetoId={c.cuil} />
          {c.pruebasSinMarco && <PruebasBadge compact />}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] font-bold text-slate-500">
          {preguntar && c.canal?.sinPush && (
            <span data-sin-push={c.cuil} title={TOOLTIP_SIN_PUSH} className="inline-flex items-center gap-0.5 text-slate-400">
              <BellOff size={11} aria-hidden />
              sin push
            </span>
          )}
          {c.horasMes && <span data-horas-mes className={c.horasMes.aviso ? 'text-amber-700' : ''}>{c.horasMes.texto}</span>}
          {c.topeBloque && <span data-tope-bloque className="text-amber-800">{c.topeBloque}</span>}
          {c.distanciaKm != null && <span className="flex items-center gap-0.5"><MapPin size={9} />{c.distanciaKm} km</span>}
          {c.telefono && <span className="flex items-center gap-0.5"><Phone size={9} />{c.telefono}</span>}
        </span>
      </span>
    </button>
  );
}

export function NoDisponiblesLista({ rows }: { rows: CandidatoTarjeta[] }) {
  if (!rows.length) return null;
  return (
    <details className="mt-1 rounded-xl border border-slate-200 bg-slate-50" data-no-disponibles={rows.length}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[10px] font-black text-slate-600">
        <span>{textoNoDisponibles(rows.length)}</span>
        <ChevronDown size={12} className="text-slate-400" />
      </summary>
      <ul className="divide-y divide-slate-200 border-t border-slate-200">
        {rows.map((c) => {
          const accion = accionParaMotivo(c.motivoCodigo);
          return (
            <li key={c.cuil} className="flex items-center gap-2 px-3 py-1.5" data-no-disponible={c.cuil}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-bold text-slate-700">{c.nombre}</span>
                <span className="flex items-center gap-1 text-[9px] font-bold text-rose-700">
                  <AlertTriangle size={9} className="shrink-0" />
                  <span className="truncate">{c.motivo || 'No elegible'}</span>
                </span>
              </span>
              {accion && (
                <a
                  href={linkFichaEventual(c.cuil)}
                  target="_blank"
                  rel="noreferrer"
                  data-ficha-accion={c.motivoCodigo || ''}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[9px] font-black text-slate-700 hover:bg-slate-100"
                >
                  {accion}
                  <ExternalLink size={9} />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function BarraPreguntar({ n, jornadas, espera, onEspera, onEnviar, enviando }: {
  n: number;
  jornadas: JornadaCorta[];
  espera: number;
  onEspera: (minutos: number) => void;
  onEnviar: () => void;
  enviando?: boolean;
}) {
  const horasTxt = jornadas.length > 1 ? textoHorasBloque(horasDelBloque(jornadas)) : '';
  return (
    <div className="mx-1 mt-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-2.5 py-2" data-consulta-bar>
      <p className="text-[10px] font-black text-indigo-950" data-consulta-texto>{textoBarraPreguntar(n, jornadas)}</p>
      {horasTxt && <p className="mt-0.5 text-[10px] font-bold text-slate-700" data-consulta-horas>{horasTxt}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-bold text-slate-600">Esperar respuesta:</span>
        <div className="flex gap-1" role="radiogroup" data-consulta-espera={espera}>
          {ESPERA_OPCIONES.map((o) => (
            <button
              key={o.minutos}
              type="button"
              role="radio"
              aria-checked={espera === o.minutos}
              onClick={() => onEspera(o.minutos)}
              className={`rounded-md border px-2 py-0.5 text-[9px] font-black ${espera === o.minutos ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={n === 0 || !!enviando}
          onClick={onEnviar}
          data-consulta-enviar
          className="ml-auto rounded-xl bg-indigo-600 px-3 py-1.5 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:border disabled:border-slate-300 disabled:bg-white disabled:text-slate-500"
        >
          {enviando ? 'Enviando…' : textoBotonEnviar(n)}
        </button>
      </div>
    </div>
  );
}
