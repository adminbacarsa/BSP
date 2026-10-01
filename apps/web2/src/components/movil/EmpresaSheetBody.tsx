import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { empresaColor, empresasVisibles, necesitaBuscador, type MovilEmpresaItem } from '@/lib/movil/empresaSelector';
import { MOVIL_BORDER, MOVIL_PRIMARY_TEXT } from './ui/tones';

/**
 * Cuerpo de la hoja «Empresa»: lista compacta, la activa con check, el color de la
 * empresa como punto. Buscador solo si hay más de 6. Misma hoja en el menú y en la
 * barra de cada módulo.
 */
export function EmpresaSheetBody({ empresas, activaId, onElegir }: {
  empresas: readonly MovilEmpresaItem[];
  activaId: string;
  onElegir: (id: string) => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const conBuscador = necesitaBuscador(empresas.length);
  const visibles = empresasVisibles(empresas, activaId, busqueda);
  return (
    <div data-movil-empresa-sheet={empresas.length}>
      {conBuscador && (
        <label className={`mb-2 flex h-9 items-center gap-2 rounded-lg border ${MOVIL_BORDER} bg-white px-2.5`}>
          <Search size={14} strokeWidth={1.75} className="shrink-0 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar empresa"
            data-movil-empresa-buscar="1"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
          />
        </label>
      )}
      <ul className={`divide-y divide-slate-100 overflow-hidden rounded-lg border ${MOVIL_BORDER} bg-white`}>
        {visibles.map((item) => {
          const activa = item.id === activaId;
          const color = empresaColor(item.color);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onElegir(item.id)}
                aria-current={activa ? 'true' : undefined}
                data-movil-empresa-item={item.id}
                className={`flex min-h-11 w-full items-center gap-3 px-3 text-left active:bg-slate-50 ${activa ? MOVIL_PRIMARY_TEXT : 'text-slate-800'}`}
              >
                <span
                  aria-hidden="true"
                  data-movil-empresa-color={color || 'none'}
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${color ? '' : 'border border-slate-300'}`}
                  style={color ? { backgroundColor: color } : undefined}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.name}</span>
                {activa && <Check size={16} strokeWidth={2} aria-label="Empresa activa" className="shrink-0" />}
              </button>
            </li>
          );
        })}
        {visibles.length === 0 && (
          <li className="px-3 py-3 text-[12px] font-medium text-slate-400">Ninguna empresa coincide.</li>
        )}
      </ul>
    </div>
  );
}
