import React, { useEffect, useState } from 'react';
import { Minus } from 'lucide-react';
import type { FaltanteBanda } from '@/lib/planificacion/lecturaBandas';
import type { AvisoRapido } from '@/lib/planificacion/modoRapido';
import { type ConsultaCurso } from '@/lib/planificacion/coberturaEventualesUx';
import { contarConsultasVisibles } from '@/components/planificacion/ConsultasEnCurso';
import {
  PANELES_KEY,
  leerEstadoPaneles,
  serializarEstadoPaneles,
  textoPastilla,
  textoPestana,
  type EstadoPaneles,
  type PestanaPanel,
} from '@/lib/planificacion/panelesPlanif';
import { BandasFaltantesPanel } from '@/components/planificacion/BandasFaltantesPanel';
import { ModoRapidoAvisosPanel } from '@/components/planificacion/ModoRapidoPiezas';
import { ConsultasEnCursoPill } from '@/components/planificacion/ConsultasEnCurso';

const PESTANAS: PestanaPanel[] = ['faltantes', 'avisos', 'consultas'];

type Props = {
  children: React.ReactNode;
  faltantes: FaltanteBanda[];
  puedeFranco: boolean;
  onAplicar: (faltante: FaltanteBanda) => void;
  onAplicarTodas: () => void;
  onPasarAFt: (faltante: FaltanteBanda, franco: { empId: string; nombre: string }) => void;
  onElegirOtro: (faltante: FaltanteBanda) => void;
  avisos: AvisoRapido[];
  sinServicio: boolean;
  modoRapido: boolean;
  onIrAviso: (a: AvisoRapido) => void;
  onVisto: (ids: string[]) => void;
  onAsignarPuesto?: (a: AvisoRapido) => void;
  consultas: ConsultaCurso[];
  consultaFoco?: string | null;
  consultaTick?: number;
  onCancelarConsulta: (id: string) => void;
  onConsultarOtros: (consulta: ConsultaCurso) => void;
  onCubrirOtraForma: (consulta: ConsultaCurso) => void;
};

/** Dock a la derecha de la grilla. Minimizado, una pastilla al pie, lejos de la esquina. */
export function PanelesMarco(props: Props) {
  const [pref, setPref] = useState<EstadoPaneles | null>(null);
  const [ajusteConsultas, setAjusteConsultas] = useState<number | null>(null);
  useEffect(() => {
    try { setPref(leerEstadoPaneles(localStorage.getItem(PANELES_KEY))); } catch { setPref(null); }
  }, []);
  const consultasN = ajusteConsultas ?? contarConsultasVisibles(props.consultas);
  const hay = props.faltantes.length + props.avisos.length + consultasN > 0;
  const abierto = pref ? pref.abierto : hay;
  const pestana: PestanaPanel = pref?.pestana || (props.faltantes.length ? 'faltantes' : props.avisos.length ? 'avisos' : 'consultas');
  const guardar = (next: EstadoPaneles) => {
    setPref(next);
    try { localStorage.setItem(PANELES_KEY, serializarEstadoPaneles(next)); } catch { /* sin almacenamiento */ }
  };
  useEffect(() => {
    if (!props.consultaFoco) return;
    guardar({ abierto: true, pestana: 'consultas' });
    // solo cuando llega una consulta para mostrar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.consultaFoco, props.consultaTick]);
  const numeros: Record<PestanaPanel, number> = {
    faltantes: props.faltantes.length,
    avisos: props.avisos.length,
    consultas: consultasN,
  };
  const pastilla = textoPastilla(numeros.faltantes, numeros.avisos, numeros.consultas);
  return (
    <div className={`relative flex h-full min-h-0 min-w-0 flex-1 overflow-x-hidden ${abierto ? 'flex-col min-[1180px]:flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {props.children}
        {!abierto && hay && (
          <button
            type="button"
            onClick={() => guardar({ abierto: true, pestana })}
            className="mb-1 ml-1 mr-24 max-w-[min(100%,32rem)] self-start break-words rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-[12px] font-black leading-snug text-slate-800 shadow-sm hover:bg-slate-50"
            data-paneles-pastilla
            data-bandas-faltantes-pastilla
            data-modo-rapido-avisos={props.avisos.length}
            data-modo-rapido-avisos-pill
          >
            {pastilla}
          </button>
        )}
      </div>
      {abierto && (
        <aside
          data-paneles-planif
          data-paneles-abierto="1"
          data-modo-rapido-avisos={props.avisos.length}
          className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm max-[1179px]:max-h-[42vh] min-[1180px]:h-full min-[1180px]:w-[300px]"
        >
          <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
            <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-wide text-slate-500">Planificación</p>
            <button
              type="button"
              onClick={() => guardar({ abierto: false, pestana })}
              className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50"
              aria-label="Minimizar paneles"
              data-paneles-minimizar
            >
              <Minus size={14} />
            </button>
          </div>
          <div className="flex shrink-0 gap-1 px-2 py-2" role="tablist">
            {PESTANAS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pestana === id}
                onClick={() => guardar({ abierto: true, pestana: id })}
                className={`min-w-0 flex-1 rounded-xl px-1 py-1.5 text-center text-[11px] font-black leading-tight ${pestana === id ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                data-paneles-tab={id}
              >
                {textoPestana(id, numeros[id])}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
            {pestana === 'faltantes' && (
              <BandasFaltantesPanel
                faltantes={props.faltantes}
                puedeFranco={props.puedeFranco}
                onAplicar={props.onAplicar}
                onAplicarTodas={props.onAplicarTodas}
                onPasarAFt={props.onPasarAFt}
                onElegirOtro={props.onElegirOtro}
              />
            )}
            {pestana === 'avisos' && (
              <>
                {!props.modoRapido && <p className="px-1 pb-1 text-[11px] text-slate-500">Los avisos aparecen con el modo rápido.</p>}
                <ModoRapidoAvisosPanel
                  avisos={props.avisos}
                  sinServicio={props.sinServicio}
                  onIr={props.onIrAviso}
                  onVisto={props.onVisto}
                  onAsignarPuesto={props.onAsignarPuesto}
                />
              </>
            )}
            <div className={pestana === 'consultas' ? '' : 'hidden'}>
              <ConsultasEnCursoPill
                embebida
                consultas={props.consultas}
                focoId={props.consultaFoco}
                focoTick={props.consultaTick}
                onCancelar={props.onCancelarConsulta}
                onConsultarOtros={props.onConsultarOtros}
                onCubrirOtraForma={props.onCubrirOtraForma}
                onConteo={setAjusteConsultas}
              />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
