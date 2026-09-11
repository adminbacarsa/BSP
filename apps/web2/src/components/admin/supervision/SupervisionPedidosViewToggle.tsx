import React from 'react';
import { LayoutGrid, Table2 } from 'lucide-react';
import type { SupervisionPedidosView } from '@/lib/supervision/supervisionPedidos';

export default function SupervisionPedidosViewToggle({
  value,
  onChange,
}: {
  value: SupervisionPedidosView;
  onChange: (v: SupervisionPedidosView) => void;
}) {
  return (
    <div
      className="flex shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5"
      role="group"
      aria-label="Vista de pedidos"
    >
      <button
        type="button"
        onClick={() => onChange('table')}
        title="Vista tabla"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-colors ${
          value === 'table'
            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
            : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
        }`}
      >
        <Table2 size={14} />
        <span className="hidden xs:inline sm:inline">Tabla</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('cards')}
        title="Vista tarjetas"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-colors ${
          value === 'cards'
            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
            : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
        }`}
      >
        <LayoutGrid size={14} />
        <span className="hidden xs:inline sm:inline">Cards</span>
      </button>
    </div>
  );
}
