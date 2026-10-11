import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, X } from 'lucide-react';
import type { FaltanteBanda } from '@/lib/planificacion/lecturaBandas';

type Props = {
  faltantes: FaltanteBanda[];
  puedeFranco: boolean;
  storageKey?: string;
  onAplicar: (faltante: FaltanteBanda) => void;
  onAplicarTodas: () => void;
  onPasarAFt: (faltante: FaltanteBanda, franco: { empId: string; nombre: string }) => void;
  onElegirOtro?: (faltante: FaltanteBanda) => void;
  onCerrar: () => void;
};

function leerMin(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

/** Lista del mes, siempre dentro del viewport. Minimizar la deja como pastilla. */
export function BandasFaltantesPanel({ faltantes, puedeFranco, storageKey, onAplicar, onAplicarTodas, onPasarAFt, onElegirOtro, onCerrar }: Props) {
  const [francoDe, setFrancoDe] = useState<string | null>(null);
  const [abiertoDia, setAbiertoDia] = useState<string | null>(null);
  const [min, setMin] = useState(false);
  useEffect(() => { setMin(storageKey ? leerMin(storageKey) : false); }, [storageKey]);
  const guardarMin = (v: boolean) => {
    setMin(v);
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, v ? '1' : '0'); } catch { /* sin almacenamiento */ }
  };
  const conPar = faltantes.filter((f) => f.propuesta);
  const paraFranco = faltantes.length - conPar.length;
  const porDia = useMemo(() => {
    const map = new Map<string, FaltanteBanda[]>();
    for (const f of faltantes) {
      const lista = map.get(f.dateStr) || [];
      lista.push(f);
      map.set(f.dateStr, lista);
    }
    return [...map.entries()];
  }, [faltantes]);
  if (!faltantes.length || typeof document === 'undefined') return null;
  if (min) {
    return createPortal(
      <button
        type="button"
        onClick={() => guardarMin(false)}
        className="fixed bottom-4 right-4 z-[80] rounded-full border border-amber-300 bg-white px-3 py-2 text-[12px] font-black text-amber-900 shadow-lg"
        data-bandas-faltantes-pastilla
      >
        {faltantes.length} bandas faltantes
      </button>,
      document.body,
    );
  }
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[80] w-[min(440px,calc(100vw-1rem))] max-h-[min(70vh,560px)] overflow-hidden rounded-2xl border border-amber-200 bg-white p-3 shadow-lg" data-bandas-faltantes>
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 text-[11px] font-black uppercase tracking-wide text-amber-800">Bandas faltantes del mes</p>
        <span className="text-[10px] font-bold text-slate-400">{faltantes.length}</span>
        <button type="button" onClick={() => guardarMin(true)} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Minimizar bandas faltantes" data-bandas-minimizar>
          <Minus size={14} />
        </button>
        <button type="button" onClick={onCerrar} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar bandas faltantes">
          <X size={14} />
        </button>
      </div>
      <p className="mb-2 text-[11px] font-bold text-slate-600" data-bandas-resumen>
        {conPar.length} con propuesta 12 h · {paraFranco} para consultar franco
      </p>
      <ul className="max-h-[46vh] space-y-1 overflow-auto">
        {porDia.map(([dia, lista]) => {
          const etiqueta = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
          const abierto = abiertoDia === dia || porDia.length === 1;
          return (
            <li key={dia} className="rounded-xl border border-slate-100">
              <button type="button" onClick={() => setAbiertoDia(abierto && porDia.length > 1 ? null : dia)} className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[12px] font-black text-slate-800" data-faltante-dia={dia}>
                <span>{etiqueta}</span>
                <span className="text-[10px] font-bold text-slate-400">{lista.length}</span>
              </button>
              {abierto && lista.map((f) => {
                const clave = `${f.dateStr}|${f.positionName}|${f.banda}`;
                return (
                  <div key={clave} className="border-t border-slate-50 px-2 py-1.5" data-faltante={clave}>
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 break-words text-[11px] font-medium leading-snug text-slate-700">{f.texto}</p>
                      {f.propuesta ? (
                        <span className="flex shrink-0 flex-col gap-1">
                          <button type="button" onClick={() => onAplicar(f)} className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-black text-white hover:bg-indigo-700" data-faltante-aplicar={clave}>
                            Aplicar
                          </button>
                          {onElegirOtro && (
                            <button type="button" onClick={() => onElegirOtro(f)} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600" data-faltante-elegir={clave}>
                              Elegir otro
                            </button>
                          )}
                        </span>
                      ) : (
                        <button type="button" onClick={() => setFrancoDe(francoDe === clave ? null : clave)} className="shrink-0 rounded-lg border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-800" data-faltante-franco={clave}>
                          Pasar a FT
                        </button>
                      )}
                    </div>
                    {francoDe === clave && (
                      <div className="mt-1 space-y-1">
                        {!puedeFranco && <p className="text-[10px] text-slate-500">Sin permiso de franco trabajado: no se escribe.</p>}
                        {f.francos.length === 0 && <p className="text-[10px] text-slate-500">Ese día no hay francos para pasar a FT.</p>}
                        {puedeFranco && f.francos.map((fr) => (
                          <button key={fr.empId} type="button" onClick={() => onPasarAFt(f, fr)} className="block w-full rounded-lg px-2 py-1 text-left text-[11px] font-bold text-slate-700 hover:bg-violet-50" data-franco={fr.empId}>
                            Pasar a FT a {fr.nombre}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
      {conPar.length > 0 && (
        <button type="button" onClick={onAplicarTodas} className="mt-2 w-full rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black text-white" data-faltante-aplicar-todas>
          Aplicar todas ({conPar.length})
        </button>
      )}
    </div>,
    document.body,
  );
}
