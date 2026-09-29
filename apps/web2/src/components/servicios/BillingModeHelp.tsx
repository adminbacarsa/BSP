import React, { useState } from 'react';
import { Info } from 'lucide-react';
import type { SlaBillingMode } from '@/lib/crm/slaBilling.types';

const MODE_HELP: Record<SlaBillingMode, { label: string; text: string }> = {
  PLANIFICADO: {
    label: 'Planificado',
    text: 'Factura las horas del cronograma publicado. Una ausencia no cubierta igual se factura.',
  },
  EJECUTADO: {
    label: 'Ejecutado',
    text: 'Factura las horas realmente cubiertas por franja. Lo no cubierto no se factura. ESC/REF no facturan; la tardanza no descuenta.',
  },
  FIJO: {
    label: 'Fijo',
    text: 'Factura una cantidad fija de horas (o monto) por mes, sin importar cronograma ni operación.',
  },
  ORDEN_COMPRA: {
    label: 'Orden de compra',
    text: 'Como Ejecutado, con tope en las horas autorizadas por la OC seleccionada. Si la OC no cubre el período, factura lo ejecutado sin tope.',
  },
};

const AUTO_HELP = {
  label: 'Auto (sin modo propio)',
  text: 'El sistema decide: contrato comercial abierto → Ejecutado; si no → Planificado.',
};

interface BillingModeHelpProps {
  mode: SlaBillingMode | null;
  autoLabel: string;
}

export function BillingModeHelp({ mode, autoLabel }: BillingModeHelpProps) {
  const [open, setOpen] = useState(false);
  const current = mode ? MODE_HELP[mode] : { label: autoLabel, text: AUTO_HELP.text };

  return (
    <div className="space-y-2 ml-1">
      <div className="flex items-start gap-1.5">
        <p className="flex-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{current.text}</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 p-0.5 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 active:scale-95"
          title="Ver todos los modos"
          aria-expanded={open}
        >
          <Info size={14} />
        </button>
      </div>
      {open && (
        <ul className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm space-y-1.5">
          {[...Object.values(MODE_HELP), AUTO_HELP].map((h) => (
            <li key={h.label} className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              <span className="font-bold text-slate-700 dark:text-slate-200">{h.label}:</span> {h.text}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] leading-snug text-slate-400 italic">
        El modo solo cambia la prefactura: no modifica el SLA, el cronograma ni la liquidación.
      </p>
    </div>
  );
}
