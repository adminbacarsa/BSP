import React, { useMemo, useState } from 'react';
import type { FaltanteBanda } from '@/lib/planificacion/lecturaBandas';
import { filaFaltante, resumenFaltantes } from '@/lib/planificacion/panelesPlanif';

/** Quien puede cubrir la banda antes de extender a 12 h (RET, volante, libre, de otro objetivo). */
export type CandidatoFaltante = { empId: string; nombre: string; tipo: 'RET' | 'VOLANTE' | 'LIBRE' | 'CERCANO'; horas: number };

const ETIQUETA_TIPO: Record<CandidatoFaltante['tipo'], string> = { RET: 'RET', VOLANTE: 'Volante', LIBRE: 'Libre', CERCANO: 'Otro objetivo' };

type Props = {
  faltantes: FaltanteBanda[];
  /** Candidatos en orden (RET → volante → libre → otro objetivo); van antes del par de 12 h y del franco. */
  candidatosDe?: (faltante: FaltanteBanda) => CandidatoFaltante[];
  onAsignarCandidato?: (faltante: FaltanteBanda, empId: string) => void;
  puedeFranco: boolean;
  onAplicar: (faltante: FaltanteBanda) => void;
  onAplicarTodas: () => void;
  onPasarAFt: (faltante: FaltanteBanda, franco: { empId: string; nombre: string }) => void;
  onElegirOtro?: (faltante: FaltanteBanda) => void;
};

function propuestaDe(f: FaltanteBanda): string {
  if (!f.propuesta || f.propuesta.cambios.length < 2) return '';
  return f.propuesta.cambios.map((c) => {
    const apellido = String(c.nombre || '').split(',')[0].trim();
    const pos = c.positionName && c.positionName !== f.positionName ? ` (${c.positionName})` : '';
    return `${apellido} ${c.code}${pos}`;
  }).join(' + ');
}

/** Filas del mes: día · puesto · banda · propuesta · acciones. */
export function BandasFaltantesPanel({ faltantes, puedeFranco, onAplicar, onAplicarTodas, onPasarAFt, onElegirOtro, candidatosDe, onAsignarCandidato }: Props) {
  const [francoDe, setFrancoDe] = useState<string | null>(null);
  const conPar = faltantes.filter((f) => f.propuesta);
  const paraFranco = faltantes.length - conPar.length;
  const filas = useMemo(() => faltantes.map((f) => ({ f, texto: filaFaltante({ dateStr: f.dateStr, positionName: f.positionName, banda: f.banda, propuestaTexto: propuestaDe(f) }) })), [faltantes]);
  if (!faltantes.length) {
    return <p className="px-1 py-2 text-[12px] text-slate-400" data-bandas-faltantes>Sin bandas faltantes.</p>;
  }
  return (
    <div data-bandas-faltantes>
      <p className="mb-2 break-words text-[12px] font-bold leading-snug text-slate-600" data-bandas-resumen>
        {resumenFaltantes(conPar.length, paraFranco)}
      </p>
      <ul className="space-y-1">
        {filas.map(({ f, texto }) => {
          const clave = `${f.dateStr}|${f.positionName}|${f.banda}`;
          return (
            <li key={clave} className="rounded-xl border border-slate-100 px-2 py-1.5" data-faltante={clave}>
              <p className="break-words text-[12px] font-bold leading-snug text-slate-800">{texto}</p>
              {(() => {
                const cands = candidatosDe ? candidatosDe(f).slice(0, 4) : [];
                if (!cands.length || !onAsignarCandidato) return null;
                return (
                  <div className="mt-1 flex flex-wrap items-center gap-1" data-faltante-candidatos={clave}>
                    <span className="text-[10px] font-black uppercase text-emerald-700">Antes que 12 h:</span>
                    {cands.map((c) => (
                      <button
                        key={c.empId}
                        type="button"
                        onClick={() => onAsignarCandidato(f, c.empId)}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-900 hover:bg-emerald-100"
                        title={`Asignar ${f.banda} de ${f.positionName} a ${c.nombre} · ${ETIQUETA_TIPO[c.tipo]} · ${Math.round(c.horas)} h en el mes`}
                        data-faltante-candidato={c.empId}
                      >
                        {ETIQUETA_TIPO[c.tipo]} · {c.nombre.split(',')[0]} ({Math.round(c.horas)} h)
                      </button>
                    ))}
                  </div>
                );
              })()}
              <div className="mt-1 flex flex-wrap gap-1">
                {f.propuesta ? (
                  <>
                    <button type="button" onClick={() => onAplicar(f)} className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-black text-white hover:bg-indigo-700" data-faltante-aplicar={clave}>
                      Aplicar
                    </button>
                    {onElegirOtro && (
                      <button type="button" onClick={() => onElegirOtro(f)} className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600" data-faltante-elegir={clave}>
                        Elegir otro
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={() => setFrancoDe(francoDe === clave ? null : clave)} className="rounded-lg border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-black text-violet-800" data-faltante-franco={clave}>
                    Consultar franco
                  </button>
                )}
              </div>
              {francoDe === clave && (
                <div className="mt-1 space-y-1">
                  {!puedeFranco && <p className="text-[11px] text-slate-500">Sin permiso de franco trabajado: no se escribe.</p>}
                  {f.francos.length === 0 && <p className="text-[11px] text-slate-500">Ese día no hay francos.</p>}
                  {puedeFranco && f.francos.map((fr) => (
                    <button key={fr.empId} type="button" onClick={() => onPasarAFt(f, fr)} className="block w-full break-words rounded-lg px-2 py-1 text-left text-[11px] font-bold text-slate-700 hover:bg-violet-50" data-franco={fr.empId}>
                      Pasar a FT a {fr.nombre}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {conPar.length > 0 && (
        <button type="button" onClick={onAplicarTodas} className="mt-2 w-full rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black text-white" data-faltante-aplicar-todas>
          Aplicar todas ({conPar.length})
        </button>
      )}
    </div>
  );
}
