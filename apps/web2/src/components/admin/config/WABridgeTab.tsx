import React, { useEffect, useState } from 'react';
import { Wifi, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';

// Sin URL por defecto: cada empresa tiene su propio bridge (puerto y QR propios). Precargar la de otra
// empresa haría que dos empresas compartan el mismo WhatsApp.
const EJEMPLO_URL = 'https://autbacar.dnsalias.com/<empresa>';

export default function WABridgeTab() {
  const { empresaId, empresa } = useEmpresa();
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);
  const [loading, setLoading] = useState(true);

  // Ruta per-empresa: empresas/{empresaId}/config/wa-bridge
  const cfgDoc = empresaId ? doc(db, 'empresas', empresaId, 'config', 'wa-bridge') : null;

  useEffect(() => {
    if (!cfgDoc) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(cfgDoc);
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as { url?: string };
          const value = typeof data.url === 'string' ? data.url : '';
          setUrl(value);
          setSaved(value);
        } else {
          setUrl('');
          setSaved('');
        }
      } catch {
        if (!cancelled) {
          setUrl('');
          setSaved('');
          toast.error('No se pudo cargar la config del bridge');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [empresaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!cfgDoc) return;
    const trimmed = url.trim();
    setSaving(true);
    try {
      await setDoc(cfgDoc, { url: trimmed }, { merge: true });
      setSaved(trimmed);
      toast.success('URL del bridge guardada');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${url.trim()}/status`, {
        signal: AbortSignal.timeout(5000),
      });
      setTestResult(res.ok ? 'ok' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando configuración…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Wifi className="w-5 h-5 text-emerald-600" />
          Servidor WA Bridge
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          URL del servidor WhatsApp Bridge de <strong>{empresa?.name || empresaId}</strong> para check-ins y avisos al guardia
        </p>
      </div>

      {saved === '' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
          Esta empresa todavía no tiene un WA Bridge configurado. Mientras tanto, el Centro de Control
          funciona sin WhatsApp. Cada empresa necesita su propio bridge (puerto y QR propios): se da de alta
          en el servidor con <code className="font-mono text-xs">node nueva-empresa.js</code> y después se pega acá su URL.
        </div>
      )}

      <div
        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-sm"
        style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}
      >
        <div>
          <label
            htmlFor="wa-bridge-url"
            className="text-xs font-semibold uppercase tracking-wide block mb-1.5"
            style={{ color: 'var(--txt3)' }}
          >
            URL del servidor
          </label>
          <input
            id="wa-bridge-url"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTestResult(null);
            }}
            placeholder={EJEMPLO_URL}
            className="w-full text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            style={{ color: 'var(--txt)', borderColor: 'var(--border)' }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing || !url.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>

          {testResult === 'ok' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Conectado
            </span>
          )}
          {testResult === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              Sin respuesta
            </span>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !url.trim() || url.trim() === saved}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 text-sm text-blue-700 dark:text-blue-300">
        El bridge corre en Windows con PM2. URL accesible desde la red local o mediante Caddy.
      </div>
    </div>
  );
}
