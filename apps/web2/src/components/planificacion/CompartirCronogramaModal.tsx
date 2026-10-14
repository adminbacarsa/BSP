import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { dibujarCronograma, nombreArchivo, type DatosImagen } from '@/lib/planificacion/imagenCronograma';

type Props = {
  datos: DatosImagen;
  mesLabel: string;
  onCerrar: () => void;
};

/** Imagen del cronograma (todo o un guardia) para mandar por WhatsApp. */
export function CompartirCronogramaModal({ datos, mesLabel, onCerrar }: Props) {
  const [quien, setQuien] = useState('__todos__');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');

  const datosVista = useMemo<DatosImagen>(() => {
    if (quien === '__todos__') return datos;
    const fila = datos.filas.find((f) => f.nombre === quien);
    return { ...datos, filas: fila ? [fila] : [], titulo: quien, subtitulo: `${datos.titulo} · ${datos.subtitulo}` };
  }, [datos, quien]);

  useEffect(() => {
    const canvas = dibujarCronograma(datosVista);
    let vivo = true;
    let creada = '';
    canvas.toBlob((b) => {
      if (!vivo || !b) return;
      creada = URL.createObjectURL(b);
      setBlob(b);
      setUrl(creada);
    }, 'image/png');
    return () => {
      vivo = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [datosVista]);

  const archivo = nombreArchivo(quien === '__todos__' ? datos.titulo : quien, mesLabel);

  const descargar = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo;
    a.click();
  };
  const copiar = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast.success('Imagen copiada: pegala en WhatsApp con Ctrl+V');
    } catch {
      toast.error('No se pudo copiar. Usá Descargar.');
    }
  };
  const file = blob ? new File([blob], archivo, { type: 'image/png' }) : null;
  const puedeCompartir = !!file && typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [file] });
  const compartir = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: datosVista.titulo });
    } catch {
      /* cancelado */
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/50 p-4" data-compartir-cronograma onClick={onCerrar}>
      <div className="flex max-h-[92vh] w-full max-w-[1100px] flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <div className="text-sm font-black text-slate-900">Imagen del cronograma</div>
            <div className="text-[11px] text-slate-500">Para mandar por WhatsApp. Se genera con lo que ves en la grilla, incluido lo que está en borrador.</div>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5">
          <label className="text-[12px] font-bold text-slate-700">Mostrar</label>
          <select value={quien} onChange={(e) => setQuien(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]" data-compartir-quien>
            <option value="__todos__">Todo el cronograma ({datos.filas.length})</option>
            {datos.filas.map((f) => <option key={f.nombre} value={f.nombre}>{f.nombre}</option>)}
          </select>
          <div className="ml-auto flex gap-2">
            {puedeCompartir && (
              <button type="button" onClick={compartir} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700"><Share2 size={14} /> Compartir</button>
            )}
            <button type="button" onClick={copiar} disabled={!blob} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Copy size={14} /> Copiar imagen</button>
            <button type="button" onClick={descargar} disabled={!url} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={14} /> Descargar</button>
          </div>
        </div>
        <div className="overflow-auto bg-slate-100 p-4">
          {url ? <img src={url} alt="Cronograma" className="mx-auto max-w-full rounded-lg border border-slate-200 bg-white shadow-sm" /> : <div className="py-10 text-center text-sm text-slate-500">Generando…</div>}
        </div>
      </div>
    </div>
  );
}
