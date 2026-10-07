import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { TIPOS_JUSTIFICAR_DEFAULT, type TipoJustificacion } from '@/lib/movil/rrhhDia';

type Aviso = {
  id: string;
  employeeName?: string;
  type?: string;
  reason?: string;
  startDate?: string;
  endDate?: string;
  certificateUrl?: string;
  status?: string;
};

function fechaCorta(value: unknown): string {
  const raw = String(value || '').slice(0, 10);
  const [y, m, d] = raw.split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}

/**
 * RRHH controla el aviso que el guardia ya dejó activo: justificar a E/L/A
 * (con certificado si lo hay) o dejarlo injustificado. No vuelve a «cargarlo».
 */
export function RevisionAvisoPortal({
  aviso,
  tipos = TIPOS_JUSTIFICAR_DEFAULT,
  ocupado,
  onClose,
  onJustificar,
  onInjustificada,
}: {
  aviso: Aviso;
  tipos?: TipoJustificacion[];
  ocupado?: boolean;
  onClose: () => void;
  onJustificar: (tipo: TipoJustificacion, archivo: File | null) => void;
  onInjustificada: () => void;
}) {
  const [tipoId, setTipoId] = useState(tipos[0]?.id || 'E');
  const [archivo, setArchivo] = useState<File | null>(null);
  const tipo = tipos.find((row) => row.id === tipoId) || tipos[0];

  return (
    <div className="fixed inset-0 z-[210] bg-black/70 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div data-revision-aviso={aviso.id} className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wide text-amber-600">Aviso para revisar</p>
            <h2 className="text-lg font-black text-slate-900 dark:text-white truncate">{aviso.employeeName || 'Guardia'}</h2>
            <p className="text-xs text-slate-500 mt-1">
              {fechaCorta(aviso.startDate)} → {fechaCorta(aviso.endDate)} · ya figura ausente
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            <span className="font-black">Motivo. </span>{aviso.reason || 'Sin motivo'}
          </p>
          {aviso.certificateUrl ? (
            <a href={aviso.certificateUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-indigo-600 hover:underline">
              Ver certificado
            </a>
          ) : (
            <p className="text-xs text-slate-400">No subió certificado.</p>
          )}
          <div>
            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Justificar como</label>
            <select
              data-revision-tipo
              value={tipoId}
              onChange={(e) => setTipoId(e.target.value)}
              className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl font-bold text-sm text-slate-900 dark:text-white outline-none"
            >
              {tipos.map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
          </div>
          <label className="block text-xs font-bold text-slate-500">
            Certificado
            <input
              data-revision-certificado
              type="file"
              accept="image/*,.pdf"
              className="mt-1 block w-full text-sm"
              onChange={(e) => setArchivo(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-2">
          <button
            type="button"
            data-revision-justificar
            disabled={ocupado || !tipo}
            onClick={() => tipo && onJustificar(tipo, archivo)}
            className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={16} /> Justificar
          </button>
          <button
            type="button"
            data-revision-injustificada
            disabled={ocupado}
            onClick={onInjustificada}
            className="w-full py-3 rounded-2xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-black text-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Dejar injustificada
          </button>
        </div>
      </div>
    </div>
  );
}
