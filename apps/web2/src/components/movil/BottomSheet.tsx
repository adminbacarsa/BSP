import { useEffect, type ReactNode } from 'react';
import { MOVIL_BORDER, MOVIL_FONT } from './ui/tones';

export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80]" role="presentation">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-slate-900/45" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className={`absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto rounded-t-lg border-t ${MOVIL_BORDER} bg-white px-4 pt-3 pb-6 ${MOVIL_FONT}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-slate-300" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 active:bg-slate-50">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
