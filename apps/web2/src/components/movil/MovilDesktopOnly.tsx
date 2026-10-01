import { Monitor } from 'lucide-react';
import { writeMovilChoice } from '@/lib/movil/useMovilMode';

/** Pantalla para rutas /admin/* que todavía no tienen versión celular. */
export function MovilDesktopOnly({ moduleLabel, onOpenFull = () => writeMovilChoice('0') }: { moduleLabel: string; onOpenFull?: () => void }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-slate-100 pb-24" data-movil-screen="escritorio">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-3 py-3">
        <p className="truncate text-sm font-black">{moduleLabel}</p>
        <p className="text-[11px] font-semibold text-slate-500">Modo celular</p>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-50 text-indigo-600 shadow-sm">
          <Monitor size={30} strokeWidth={2.2} />
        </div>
        <h1 className="text-lg font-black text-slate-900">Disponible en la computadora</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">
          {moduleLabel} todavía no tiene pantalla para el celular. Desde Más podés ir a Operación, Supervisión o Servicios.
        </p>
        <button
          type="button"
          onClick={onOpenFull}
          className="mt-6 min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white shadow-lg active:scale-95"
        >
          Abrir versión completa
        </button>
      </div>
    </div>
  );
}
