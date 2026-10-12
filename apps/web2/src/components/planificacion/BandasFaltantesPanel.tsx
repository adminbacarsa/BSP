import React, { useMemo, useState } from 'react';
import type { FaltanteBanda } from '@/lib/planificacion/lecturaBandas';
import { filaFaltante, resumenFaltantes } from '@/lib/planificacion/panelesPlanif';

type Props = {
  faltantes: FaltanteBanda[];
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
export function BandasFaltantesPanel({ faltantes, puedeFranco, onAplicar, onAplicarTodas, onPasarAFt, onElegirOtro }: Props) {
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
