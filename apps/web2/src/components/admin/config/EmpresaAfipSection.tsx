import React, { useCallback, useEffect, useState } from 'react';
import { FileKey, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { fetchEmpresaAfipConfig, saveEmpresaAfipConfig } from '@/services/afipEmpresaConfig';

type Props = {
  empresaId: string;
  empresaName?: string;
  empresaCuit?: string;
};

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsText(file);
  });
}

export default function EmpresaAfipSection({ empresaId, empresaName, empresaCuit }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [statusCuit, setStatusCuit] = useState('');
  const [statusProd, setStatusProd] = useState(false);
  const [statusExpiry, setStatusExpiry] = useState('');

  const [certCuit, setCertCuit] = useState('');
  const [production, setProduction] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const s = await fetchEmpresaAfipConfig(empresaId);
      setConfigured(s.configured);
      setStatusCuit(s.certCuit || '');
      setStatusProd(!!s.production);
      setStatusExpiry(s.certNotAfter || '');
      setCertCuit(s.certCuit || String(empresaCuit || '').replace(/\D/g, ''));
      setProduction(!!s.production);
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast.error(err.message || 'No se pudo cargar configuración AFIP');
    } finally {
      setLoading(false);
    }
  }, [empresaId, empresaCuit]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const digits = String(certCuit || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      toast.error('CUIT del certificado: 11 dígitos');
      return;
    }
    if (!certFile || !keyFile) {
      toast.error('Seleccioná certificado (.crt/.pem) y clave privada (.key)');
      return;
    }
    setSaving(true);
    try {
      const [cert, privateKey] = await Promise.all([
        readFileAsText(certFile),
        readFileAsText(keyFile),
      ]);
      const r = await saveEmpresaAfipConfig({
        empresaId,
        certCuit: digits,
        cert,
        privateKey,
        production,
      });
      toast.success(
        r.certNotAfter
          ? `Certificado AFIP guardado para ${empresaName || empresaId} (vence ${r.certNotAfter})`
          : `Certificado AFIP guardado para ${empresaName || empresaId}`,
      );
      await load();
      setCertFile(null);
      setKeyFile(null);
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast.error(err.message || 'Error al guardar certificado AFIP');
    } finally {
      setSaving(false);
    }
  };

  if (!empresaId) return null;

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-violet-900 uppercase flex items-center gap-2">
            <ShieldCheck size={18} /> Certificado AFIP (ARCA)
          </h3>
          <p className="text-[11px] text-violet-800/80 mt-1 max-w-xl">
            Credencial de esta empresa para consultar el padrón (CRM). Si en ARCA web un CUIT aparece pero acá dice
            «no encontrado», casi siempre es porque el cert es de homologación: generá uno en producción y marcá el
            checkbox de abajo. El mismo cert puede repetirse en varias empresas del panel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="p-2 rounded-lg border border-violet-200 text-violet-700 hover:bg-white"
          title="Recargar estado"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-violet-700 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : configured ? (
        <div className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          Configurado — CUIT certificado {statusCuit} · {statusProd ? 'Producción' : 'Homologación'}
          {statusExpiry ? ` · vence ${statusExpiry}` : ''}
        </div>
      ) : (
        <div className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          Sin certificado para esta empresa. El botón AFIP del CRM no funcionará hasta cargarlo acá.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[10px] font-black text-slate-500 uppercase">CUIT del certificado</span>
          <input
            value={certCuit}
            onChange={(e) => setCertCuit(e.target.value)}
            placeholder="20217563519"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={production}
            onChange={(e) => setProduction(e.target.checked)}
          />
          <span className="text-xs font-bold text-slate-700">Ambiente producción AFIP</span>
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-500 uppercase">Certificado (.crt / .pem)</span>
          <input
            type="file"
            accept=".crt,.pem,.cer"
            className="mt-1 w-full text-xs"
            onChange={(e) => setCertFile(e.target.files?.[0] || null)}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-500 uppercase">Clave privada (.key)</span>
          <input
            type="file"
            accept=".key,.pem"
            className="mt-1 w-full text-xs"
            onChange={(e) => setKeyFile(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void handleSave()}
        className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-black text-xs uppercase px-6 py-2.5 rounded-xl disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <FileKey size={14} />}
        Guardar certificado AFIP
      </button>
    </div>
  );
}
