import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { Copy, Check, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type TokenData = {
  hasToken: boolean;
  enabled: boolean;
  maskedKey: string;
  createdAt: { toDate: () => Date } | null;
  createdBy: string;
};

export default function DashboardApiTab() {
  const { empresa } = useEmpresa();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [freshApiKey, setFreshApiKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState<'regenerate' | 'revoke' | null>(null);
  const [copied, setCopied] = useState<'url' | 'key' | null>(null);

  const ENDPOINT = 'https://us-central1-comtroldata.cloudfunctions.net/getDashboardSnapshot';
  const fullUrl = `${ENDPOINT}?empresaId=${empresa?.id ?? ''}`;

  useEffect(() => {
    if (!empresa?.id) return;
    setLoading(true);
    loadStatus(empresa.id)
      .catch(() => setTokenData({ hasToken: false, enabled: false, maskedKey: '', createdAt: null, createdBy: '' }))
      .finally(() => setLoading(false));
  }, [empresa?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStatus = async (id: string) => {
    const fn = httpsCallable<{ empresaId: string }, TokenData>(functions, 'getDashboardTokenStatus');
    const result = await fn({ empresaId: id });
    setTokenData(result.data);
  };

  const handleGenerate = async () => {
    if (!empresa?.id) return;
    setGenerating(true);
    try {
      const fn = httpsCallable<{ empresaId: string; empresaName: string }, { apiKey: string }>(
        functions, 'generateDashboardToken'
      );
      const result = await fn({ empresaId: empresa.id, empresaName: empresa.name });
      setFreshApiKey(result.data.apiKey);
      await loadStatus(empresa.id);
      toast.success('Clave generada — guardala, no se volverá a mostrar');
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al generar la clave');
    } finally {
      setGenerating(false);
      setConfirming(null);
    }
  };

  const handleRevoke = async () => {
    if (!empresa?.id) return;
    try {
      const fn = httpsCallable(functions, 'revokeDashboardToken');
      await fn({ empresaId: empresa.id });
      setFreshApiKey(null);
      await loadStatus(empresa.id);
      toast.success('Acceso revocado');
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al revocar');
    } finally {
      setConfirming(null);
    }
  };

  const copyText = async (text: string, key: 'url' | 'key') => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignorar */ }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando configuración…</span>
      </div>
    );
  }

  const isActive = tokenData?.enabled === true;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Dashboard externo — API de integración
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Compartí los indicadores de esta empresa con plataformas externas autorizadas
          mediante una clave de acceso única sin vencimiento. Los datos se actualizan
          automáticamente cada hora.
        </p>
      </div>

      {/* Badge estado */}
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
        isActive
          ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-slate-400'}`} />
        {isActive ? 'Activo' : 'Sin configurar'}
      </span>

      {/* Panel de conexión */}
      {isActive && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-4">
          {/* URL endpoint */}
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-1.5">
              Endpoint
            </label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 min-w-0">
                <Link2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">{fullUrl}</span>
              </div>
              <button
                onClick={() => copyText(fullUrl, 'url')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300 flex-shrink-0"
              >
                {copied === 'url' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'url' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>

          {/* Clave de acceso */}
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-1.5">
              Clave de acceso (x-api-key)
              {freshApiKey && (
                <span className="ml-2 text-amber-600 dark:text-amber-400 normal-case font-normal">
                  — guardala ahora, no se volverá a mostrar
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                type={freshApiKey ? 'text' : 'password'}
                value={freshApiKey ?? tokenData?.maskedKey ?? ''}
                className="flex-1 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-300 min-w-0"
              />
              {freshApiKey && (
                <button
                  onClick={() => copyText(freshApiKey, 'key')}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300 flex-shrink-0"
                >
                  {copied === 'key' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'key' ? 'Copiado' : 'Copiar'}
                </button>
              )}
            </div>
            {tokenData?.createdBy && (
              <p className="text-xs text-slate-400 mt-1.5">
                Generada el{' '}
                {tokenData.createdAt?.toDate().toLocaleDateString('es-AR') ?? '—'}{' '}
                por {tokenData.createdBy}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-wrap gap-3">
        {!isActive ? (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 rounded-lg hover:bg-slate-700 dark:hover:bg-white transition-colors disabled:opacity-50"
          >
            {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {generating ? 'Generando…' : 'Generar clave de acceso'}
          </button>
        ) : confirming === 'regenerate' ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-400">¿Confirmar? La clave anterior dejará de funcionar.</span>
            <button onClick={handleGenerate} disabled={generating} className="font-semibold text-amber-600 dark:text-amber-400 hover:underline">
              Sí, regenerar
            </button>
            <button onClick={() => setConfirming(null)} className="text-slate-500 hover:underline">Cancelar</button>
          </div>
        ) : confirming === 'revoke' ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-400">¿Revocar acceso? Se desactivará de inmediato.</span>
            <button onClick={handleRevoke} className="font-semibold text-red-600 dark:text-red-400 hover:underline">
              Sí, revocar
            </button>
            <button onClick={() => setConfirming(null)} className="text-slate-500 hover:underline">Cancelar</button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setConfirming('regenerate')}
              className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Regenerar clave
            </button>
            <button
              onClick={() => setConfirming('revoke')}
              className="px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Revocar acceso
            </button>
          </>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 text-sm text-blue-700 dark:text-blue-300">
        <strong>¿Cómo funciona?</strong> El sistema calcula los indicadores cada hora y los
        guarda en un snapshot. La plataforma externa llama al endpoint con esta clave y
        recibe un JSON con los KPIs en tiempo real. La clave no tiene vencimiento —
        revocala si ya no es necesaria.
      </div>
    </div>
  );
}
