import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { FaltanteBanda } from '@/lib/planificacion/lecturaBandas';

type Props = {
  faltantes: FaltanteBanda[];
  puedeFranco: boolean;
  onAplicar: (faltante: FaltanteBanda) => void;
  onAplicarTodas: () => void;
  onConsultarFranco: (faltante: FaltanteBanda, franco: { empId: string; nombre: string }) => void;
  onCerrar: () => void;
};

/** Lista del mes: día, puesto, banda que falta y el par de 12 h que la cierra. */
export function BandasFaltantesPanel({ faltantes, puedeFranco, onAplicar, onAplicarTodas, onConsultarFranco, onCerrar }: Props) {
  const [francoDe, setFrancoDe] = useState<string | null>(null);
  const conPar = faltantes.filter((f) => f.propuesta);
  if (!faltantes.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[80] w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-amber-200 bg-white p-3 shadow-lg" data-bandas-faltantes>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-black uppercase tracking-wide text-amber-800">Bandas faltantes del mes</p>
        <span className="text-[10px] font-bold text-slate-400">{faltantes.length}</span>
        <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar bandas faltantes">
          <X size={14} />
        </button>
      </div>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {faltantes.map((f) => {
          const clave = `${f.dateStr}|${f.positionName}|${f.banda}`;
          return (
            <li key={clave} className="rounded-xl border border-slate-100 px-2 py-1.5" data-faltante={clave}>
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[11px] font-medium leading-snug text-slate-700">{f.texto}</p>
                {f.propuesta ? (
                  <button type="button" onClick={() => onAplicar(f)} className="shrink-0 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-black text-white hover:bg-indigo-700" data-faltante-aplicar={clave}>
                    Aplicar
                  </button>
                ) : (
                  <button type="button" onClick={() => setFrancoDe(francoDe === clave ? null : clave)} className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-800" data-faltante-franco={clave}>
                    Consultar franco
                  </button>
                )}
              </div>
              {francoDe === clave && (
                <div className="mt-1 space-y-1">
                  {!puedeFranco && <p className="text-[10px] text-slate-500">Para consultar un franco hace falta el permiso de franco trabajado.</p>}
                  {f.francos.length === 0 && <p className="text-[10px] text-slate-500">Ese día no hay francos para consultar.</p>}
                  {puedeFranco && f.francos.map((fr) => (
                    <button key={fr.empId} type="button" onClick={() => onConsultarFranco(f, fr)} className="block w-full rounded-lg px-2 py-1 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50" data-franco={fr.empId}>
                      {fr.nombre}
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
