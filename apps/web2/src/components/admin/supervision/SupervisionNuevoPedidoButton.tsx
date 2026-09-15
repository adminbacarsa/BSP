import React from 'react';
import { Plus } from 'lucide-react';
import { SUPERVISION_PEDIDO_CTA } from '@/lib/supervision/supervisionNav';

type Variant = 'inline' | 'fab';

export default function SupervisionNuevoPedidoButton({
  onClick,
  variant = 'inline',
  className = '',
}: {
  onClick: () => void;
  variant?: Variant;
  className?: string;
}) {
  if (variant === 'fab') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={SUPERVISION_PEDIDO_CTA.label}
        className={`fixed z-[65] lg:hidden right-4 flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30 active:scale-95 transition-transform ${className}`}
        style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-[10px] uppercase shadow-sm active:scale-95 transition-transform ${className}`}
    >
      <Plus size={14} strokeWidth={2.5} />
      {SUPERVISION_PEDIDO_CTA.label}
    </button>
  );
}
