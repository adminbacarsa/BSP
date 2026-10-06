import React, { useEffect, useState } from 'react';
import { consultasVisiblesEnCurso, resumenConsultaDia, textoIndicadorConsulta, textoTooltipConsulta, type ConsultaCurso } from '@/lib/planificacion/coberturaEventualesUx';

function estadoRespuesta(estado: string): string {
  if (estado === 'ASIGNADO') return 'aceptó';
  if (estado === 'NO') return 'rechazó';
  if (estado === 'CANCELADA') return 'cancelada';
  if (estado === 'VENCIDA' || estado === 'CUBIERTO') return estado === 'CUBIERTO' ? 'ya cubierto' : 'vencida';
  return 'pendiente';
}

/** Pastilla «Consultas en curso (N)». La lista sale del snapshot que le pasa el padre. */
export function ConsultasEnCursoPill(props: {
  consultas: ConsultaCurso[];
  focoId?: string | null;
  focoTick?: number;
  anclaje?: 'escritorio' | 'celular';
  onCancelar: (consultaId: string) => void;
  onConsultarOtros: (consulta: ConsultaCurso) => void;
  onCubrirOtraForma: (consulta: ConsultaCurso) => void;
}) {
  const visibles = consultasVisiblesEnCurso(props.consultas);
  const enCurso = visibles.filter((c) => c.status === 'ABIERTA').length;
  const [abierta, setAbierta] = useState(!!props.focoId);
  useEffect(() => {
    if (props.focoId) setAbierta(true);
  }, [props.focoId, props.focoTick]);
  if (!visibles.length) return null;
  const abajo = props.anclaje === 'celular' ? 'bottom-24' : 'bottom-6';
  return (
    <div className={`fixed ${abajo} right-4 z-40 max-w-sm`} data-consultas-pill="1">
      {abierta && (
        <div className="mb-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">En vivo</p>
          {visibles.map((c) => (
            <div key={c.id} className="mb-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-2" data-consulta-item={c.id}>
              <p className="text-[11px] font-black text-slate-800">{textoIndicadorConsulta(c)}</p>
              <p className="text-[10px] font-bold text-indigo-700">{resumenConsultaDia(c)}</p>
              {(c.respuestas || []).map((r) => (
                <p key={`${c.id}-${r.nombre}`} className="text-[10px] font-semibold text-slate-600">
                  {r.nombre.split(',')[0]} · {estadoRespuesta(r.estado)}{r.hora ? ` ${r.hora}` : ''}
                </p>
              ))}
              {c.status === 'ABIERTA' && (
                <button
                  type="button"
                  data-consulta-cancelar={c.id}
                  onClick={() => props.onCancelar(c.id)}
                  className="mt-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[10px] font-black text-rose-700"
                >
                  Cancelar consulta
                </button>
              )}
              {c.status === 'VENCIDA' && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    data-consulta-otros={c.id}
                    onClick={() => props.onConsultarOtros(c)}
                    className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-black text-white"
                  >
                    Consultar a otros
                  </button>
                  <button
                    type="button"
                    data-consulta-otra={c.id}
                    onClick={() => props.onCubrirOtraForma(c)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-700"
                  >
                    Cubrir de otra forma
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        data-consultas-toggle="1"
        onClick={() => setAbierta((v) => !v)}
        className="rounded-full bg-indigo-600 px-4 py-2 text-[12px] font-black text-white shadow-lg"
      >
        {enCurso > 0 ? `Consultas en curso (${enCurso})` : `Consultas vencidas (${visibles.length})`}
      </button>
    </div>
  );
}

/** Marca de la celda. El texto completo va en el tooltip; el click abre el estado. */
export function IndicadorConsultaCelda(props: { texto: string; tooltip: string; onAbrir: () => void }) {
  return (
    <button
      type="button"
      data-consulta-celda="1"
      title={props.tooltip}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); props.onAbrir(); }}
      className="absolute inset-x-0 bottom-0 z-20 truncate bg-indigo-600 px-0.5 text-left text-[6px] font-black leading-none text-white"
    >
      {props.texto}
    </button>
  );
}
