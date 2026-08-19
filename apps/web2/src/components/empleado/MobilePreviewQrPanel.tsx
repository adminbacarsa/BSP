import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

function buildMobilePreviewUrl(empDocId: string): string {
  const base = process.env.NEXT_PUBLIC_MOBILE_PREVIEW_LINK_BASE?.trim();
  if (base) {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}emp=${encodeURIComponent(empDocId)}`;
  }
  return `cosp-guardia://preview?emp=${encodeURIComponent(empDocId)}`;
}

type Props = {
  empDocId: string;
  employeeName: string;
  compact?: boolean;
};

export function MobilePreviewQrPanel({ empDocId, employeeName, compact }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const url = buildMobilePreviewUrl(empDocId);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: compact ? 120 : 148, margin: 1 })
      .then((value) => {
        if (!cancelled) setDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, compact]);

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/80 ${compact ? 'p-3' : 'p-4'} flex flex-col items-center gap-2`}>
      <p className="text-[11px] font-black uppercase tracking-wide text-orange-400 self-start">
        App móvil · QR ingreso
      </p>
      <p className="text-[11px] text-slate-400 self-start leading-snug">
        Escaneá con COSP Guardia (SuperAdmin logueado) para abrir como{' '}
        <span className="text-slate-200 font-bold">{employeeName}</span>.
      </p>
      {dataUrl ? (
        <img src={dataUrl} alt={`QR preview ${employeeName}`} className="rounded-xl bg-white p-2" />
      ) : (
        <div className="w-[148px] h-[148px] rounded-xl bg-slate-800 animate-pulse" />
      )}
      <p className="text-[9px] text-slate-500 font-mono break-all text-center">{url}</p>
    </div>
  );
}

export { buildMobilePreviewUrl };
