import React, { useEffect, useState } from 'react';
import { consultasVisiblesEnCurso, resumenConsultaDia, textoIndicadorConsulta, textoTooltipConsulta, type ConsultaCurso } from '@/lib/planificacion/coberturaEventualesUx';

function estadoRespuesta(estado: string, consultaVencida: boolean): string {
  if (estado === 'ASIGNADO') return 'aceptó';
  if (estado === 'NO') return 'rechazó';
  if (estado === 'CANCELADA') return 'cancelada';
  if (estado === 'VENCIDA' || estado === 'CUBIERTO') return estado === 'CUBIERTO' ? 'ya cubierto' : 'sin respuesta';
  return consultaVencida ? 'sin respuesta' : 'pendiente';
}

const DESCARTADAS_KEY = 'cosp-consultas-descartadas';

function leerDescartadas(): string[] {
  try {
    const raw = window.localStorage.getItem(DESCARTADAS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String).slice(-200) : [];
  } catch {
    return [];
  }
}

function guardarDescartadas(ids: string[]) {
  try {
    window.localStorage.setItem(DESCARTADAS_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    /* sin almacenamiento: se descarta solo en esta sesión */
  }
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
  // Las vencidas se pueden descartar (queda en este navegador); las abiertas siempre se ven.
  const [descartadas, setDescartadas] = useState<string[]>([]);
  useEffect(() => { setDescartadas(leerDescartadas()); }, []);
  const descartar = (ids: string[]) => {
    const next = Array.from(new Set([...descartadas, ...ids]));
    setDescartadas(next);
    guardarDescartadas(next);
  };
  const visibles = consultasVisiblesEnCurso(props.consultas)
    .filter((c) => c.status === 'ABIERTA' || !descartadas.includes(c.id));
  const enCurso = visibles.filter((c) => c.status === 'ABIERTA').length;
  const vencidasIds = visibles.filter((c) => c.status === 'VENCIDA').map((c) => c.id);
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">En vivo</p>
            <div className="flex items-center gap-1">
              {vencidasIds.length > 1 && (
                <button
                  type="button"
                  data-consultas-descartar-todas="1"
                  onClick={() => descartar(vencidasIds)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600"
                >
                  Descartar vencidas
                </button>
              )}
              <button
                type="button"
                aria-label="Cerrar"
                data-consultas-cerrar="1"
                onClick={() => setAbierta(false)}
                className="rounded-lg px-2 py-1 text-[12px] font-black text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
          </div>
          {visibles.map((c) => (
            <div key={c.id} className="mb-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-2" data-consulta-item={c.id}>
              <p className="text-[11px] font-black text-slate-800">{textoIndicadorConsulta(c)}</p>
              <p className="text-[10px] font-bold text-indigo-700">{resumenConsultaDia(c)}</p>
              {(c.respuestas || []).map((r) => (
                <p key={`${c.id}-${r.nombre}`} className="text-[10px] font-semibold text-slate-600">
                  {r.nombre.split(',')[0]} · {estadoRespuesta(r.estado, c.status === 'VENCIDA')}{r.hora ? ` ${r.hora}` : ''}
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
                    onClick={() => { descartar([c.id]); props.onConsultarOtros(c); }}
                    className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-black text-white"
                  >
                    Consultar a otros
                  </button>
                  <button
                    type="button"
                    data-consulta-otra={c.id}
                    onClick={() => { descartar([c.id]); props.onCubrirOtraForma(c); }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-700"
                  >
                    Cubrir de otra forma
                  </button>
                  <button
                    type="button"
                    data-consulta-descartar={c.id}
                    onClick={() => descartar([c.id])}
                    className="rounded-lg px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-100"
                  >
                    Descartar
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
