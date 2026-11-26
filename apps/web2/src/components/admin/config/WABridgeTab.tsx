import React, { useEffect, useState } from 'react';
import { Wifi, Loader2, Save, MessageCircle, Cloud, Power } from 'lucide-react';
import { toast } from 'sonner';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import {
  emptyWhatsAppConfig,
  mergeLegacyBridgeUrl,
  parseWhatsAppConfig,
  whatsappConfigWritablePayload,
  type EmpresaWhatsAppConfig,
  type WhatsAppProvider,
} from '@/lib/whatsapp/empresaWhatsappConfig';

const EJEMPLO_URL = 'https://autbacar.dnsalias.com/<empresa>';

type TokenStatus = {
  hasToken: boolean;
  maskedToken: string;
  updatedAt: unknown;
  updatedBy: string;
};

const PROVIDERS: Array<{
  id: WhatsAppProvider;
  label: string;
  hint: string;
  icon: typeof Power;
}> = [
  {
    id: 'off',
    label: 'Apagado',
    hint: 'Sin WhatsApp en Modo Rápido',
    icon: Power,
  },
  {
    id: 'bridge',
    label: 'Bridge (Baileys)',
    hint: 'Servidor propio / grupos (como hoy)',
    icon: Wifi,
  },
  {
    id: 'cloud',
    label: 'Cloud API',
    hint: 'Meta oficial · chat 1:1',
    icon: Cloud,
  },
];

export default function WABridgeTab() {
  const { empresaId, empresa } = useEmpresa();
  const { user } = useAuth();
  const [cfg, setCfg] = useState<EmpresaWhatsAppConfig>(emptyWhatsAppConfig());
  const [savedSnap, setSavedSnap] = useState('');
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingBridge, setTestingBridge] = useState(false);
  const [bridgeTest, setBridgeTest] = useState<'ok' | 'error' | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [testingCloud, setTestingCloud] = useState(false);
  const [loading, setLoading] = useState(true);

  const cfgDoc = empresaId ? doc(db, 'empresas', empresaId, 'config', 'whatsapp') : null;
  const legacyDoc = empresaId ? doc(db, 'empresas', empresaId, 'config', 'wa-bridge') : null;

  const loadTokenStatus = async (id: string) => {
    try {
      const fn = httpsCallable<{ empresaId: string }, TokenStatus>(
        functions,
        'getWhatsAppCloudTokenStatus',
      );
      const res = await fn({ empresaId: id });
      setTokenStatus(res.data);
      setCfg((prev) => ({
        ...prev,
        cloud: { ...prev.cloud, tokenConfigured: res.data.hasToken === true },
      }));
    } catch {
      setTokenStatus({ hasToken: false, maskedToken: '', updatedAt: null, updatedBy: '' });
    }
  };

  useEffect(() => {
    if (!cfgDoc || !legacyDoc || !empresaId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [snap, legacy] = await Promise.all([getDoc(cfgDoc), getDoc(legacyDoc)]);
        if (cancelled) return;
        let next = parseWhatsAppConfig(snap.exists() ? snap.data() : null);
        const legacyUrl =
          legacy.exists() && typeof legacy.data()?.url === 'string'
            ? String(legacy.data()?.url)
            : '';
        next = mergeLegacyBridgeUrl(next, legacyUrl);
        setCfg(next);
        setSavedSnap(JSON.stringify(whatsappConfigWritablePayload(next)));
        await loadTokenStatus(empresaId);
      } catch {
        if (!cancelled) {
          setCfg(emptyWhatsAppConfig());
          toast.error('No se pudo cargar la config de WhatsApp');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [empresaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(whatsappConfigWritablePayload(cfg)) !== savedSnap;

  const handleSave = async () => {
    if (!cfgDoc || !legacyDoc || !empresaId) return;
    if (cfg.provider === 'bridge' && !cfg.bridge.url.trim()) {
      toast.error('Con Bridge activo hace falta la URL del servidor');
      return;
    }
    if (cfg.provider === 'cloud') {
      if (!cfg.cloud.phoneNumberId.trim() || !cfg.cloud.wabaId.trim()) {
        toast.error('Cloud API requiere Phone number ID y WABA ID');
        return;
      }
      if (!cfg.cloud.tokenConfigured && !tokenStatus?.hasToken) {
        toast.error('Guardá el token de Meta antes de activar Cloud API');
        return;
      }
    }
    setSaving(true);
    try {
      const payload = whatsappConfigWritablePayload({
        ...cfg,
        cloud: {
          ...cfg.cloud,
          tokenConfigured: tokenStatus?.hasToken === true || cfg.cloud.tokenConfigured,
        },
      });
      await setDoc(
        cfgDoc,
        {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid || 'config',
        },
        { merge: true },
      );
      // Mantener el doc legacy en sync para lectores viejos (RRHH remap, etc.).
      await setDoc(legacyDoc, { url: cfg.bridge.url.trim() }, { merge: true });
      setSavedSnap(JSON.stringify(payload));
      toast.success('Configuración de WhatsApp guardada');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleTestBridge = async () => {
    setTestingBridge(true);
    setBridgeTest(null);
    try {
      const res = await fetch(`${cfg.bridge.url.trim()}/status`, {
        signal: AbortSignal.timeout(5000),
      });
      setBridgeTest(res.ok ? 'ok' : 'error');
    } catch {
      setBridgeTest('error');
    } finally {
      setTestingBridge(false);
    }
  };

  const handleSaveToken = async () => {
    if (!empresaId) return;
    const accessToken = tokenInput.trim();
    if (accessToken.length < 20) {
      toast.error('Pegá el token permanente de Meta (system user)');
      return;
    }
    setSavingToken(true);
    try {
      const fn = httpsCallable<
        { empresaId: string; accessToken: string },
        { ok: boolean; maskedToken: string }
      >(functions, 'setWhatsAppCloudToken');
      const res = await fn({ empresaId, accessToken });
      setTokenInput('');
      setTokenStatus({
        hasToken: true,
        maskedToken: res.data.maskedToken,
        updatedAt: null,
        updatedBy: user?.email || user?.uid || '',
      });
      setCfg((prev) => ({
        ...prev,
        cloud: { ...prev.cloud, tokenConfigured: true },
      }));
      toast.success('Token guardado en el servidor (no queda en el navegador)');
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: string }).message)
          : 'Error al guardar el token';
      toast.error(msg);
    } finally {
      setSavingToken(false);
    }
  };

  const handleClearToken = async () => {
    if (!empresaId) return;
    if (!window.confirm('¿Revocar el token Cloud de esta empresa?')) return;
    setSavingToken(true);
    try {
      const fn = httpsCallable(functions, 'clearWhatsAppCloudToken');
      await fn({ empresaId });
      setTokenStatus({ hasToken: false, maskedToken: '', updatedAt: null, updatedBy: '' });
      setCfg((prev) => ({
        ...prev,
        cloud: { ...prev.cloud, tokenConfigured: false },
      }));
      toast.success('Token revocado');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al revocar');
    } finally {
      setSavingToken(false);
    }
  };

  const handleTestCloud = async () => {
    if (!empresaId) return;
    setTestingCloud(true);
    try {
      const fn = httpsCallable(functions, 'testWhatsAppCloudSend');
      await fn({
        empresaId,
        toPhone: testPhone,
        phoneNumberId: cfg.cloud.phoneNumberId,
      });
      toast.success('hello_world enviado — revisá WhatsApp del celular de prueba');
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: string }).message)
          : 'Falló el envío de prueba';
      toast.error(msg);
    } finally {
      setTestingCloud(false);
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-emerald-600" />
          WhatsApp · {empresa?.name || empresaId}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Elegí un solo proveedor activo. Bridge y Cloud pueden quedar configurados en paralelo; solo
          uno opera en Modo Rápido.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const Icon = p.icon;
          const active = cfg.provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setCfg((prev) => ({ ...prev, provider: p.id }))}
              className={`rounded-2xl border p-4 text-left shadow-sm transition-colors ${
                active
                  ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <Icon className={`w-4 h-4 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                {p.label}
              </div>
              <p className="mt-1 text-xs text-slate-500">{p.hint}</p>
            </button>
          );
        })}
      </div>

      {(cfg.provider === 'bridge' || cfg.bridge.url) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
          <div>
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-emerald-600" />
              Bridge (Baileys)
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              URL del servidor por empresa. Alta en el host con{' '}
              <code className="font-mono text-[11px]">node alta-empresa.js</code>.
            </p>
          </div>
          {!cfg.bridge.url && cfg.provider === 'bridge' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Falta la URL. Sin ella el Centro de Control no usa WhatsApp.
            </div>
          )}
          <div>
            <label
              htmlFor="wa-bridge-url"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1.5"
            >
              URL del servidor
            </label>
            <input
              id="wa-bridge-url"
              type="url"
              value={cfg.bridge.url}
              onChange={(e) => {
                setBridgeTest(null);
                setCfg((prev) => ({
                  ...prev,
                  bridge: { url: e.target.value },
                }));
              }}
              placeholder={EJEMPLO_URL}
              className="w-full text-sm font-mono bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleTestBridge()}
              disabled={testingBridge || !cfg.bridge.url.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50"
            >
              {testingBridge && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {testingBridge ? 'Probando…' : 'Probar conexión'}
            </button>
            {bridgeTest === 'ok' && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                Conectado
              </span>
            )}
            {bridgeTest === 'error' && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700">
                Sin respuesta
              </span>
            )}
          </div>
        </div>
      )}

      {(cfg.provider === 'cloud' ||
        cfg.cloud.phoneNumberId ||
        cfg.cloud.wabaId ||
        tokenStatus?.hasToken) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
          <div>
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Cloud className="w-4 h-4 text-indigo-600" />
              Cloud API (Meta)
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              IDs del App Dashboard. El token de system user se guarda solo en el servidor. El webhook
              de recepción se conecta en una etapa siguiente; con Cloud activo Modo Rápido no usa el
              Bridge.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                Phone number ID
              </label>
              <input
                value={cfg.cloud.phoneNumberId}
                onChange={(e) =>
                  setCfg((prev) => ({
                    ...prev,
                    cloud: { ...prev.cloud, phoneNumberId: e.target.value },
                  }))
                }
                className="w-full text-sm font-mono border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="123456789012345"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                WABA ID
              </label>
              <input
                value={cfg.cloud.wabaId}
                onChange={(e) =>
                  setCfg((prev) => ({
                    ...prev,
                    cloud: { ...prev.cloud, wabaId: e.target.value },
                  }))
                }
                className="w-full text-sm font-mono border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="WhatsApp Business Account ID"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                Número visible (opcional)
              </label>
              <input
                value={cfg.cloud.displayPhone}
                onChange={(e) =>
                  setCfg((prev) => ({
                    ...prev,
                    cloud: { ...prev.cloud, displayPhone: e.target.value },
                  }))
                }
                className="w-full text-sm font-mono border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="+54 9 351 …"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Access token</p>
                <p className="text-sm text-slate-700">
                  {tokenStatus?.hasToken
                    ? `Configurado · ${tokenStatus.maskedToken || '••••'}`
                    : 'Sin token'}
                </p>
              </div>
              {tokenStatus?.hasToken && (
                <button
                  type="button"
                  onClick={() => void handleClearToken()}
                  disabled={savingToken}
                  className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                >
                  Revocar
                </button>
              )}
            </div>
            <input
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Pegá el token permanente (system user)…"
              className="w-full text-sm font-mono border border-slate-200 rounded-xl px-3 py-2.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              type="button"
              onClick={() => void handleSaveToken()}
              disabled={savingToken || tokenInput.trim().length < 20}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingToken ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {tokenStatus?.hasToken ? 'Rotar token' : 'Guardar token'}
            </button>
          </div>

          <div>
            <p className="text-xs font-bold uppercase text-slate-500 mb-2">
              Nombres de plantillas Meta
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['presenteOk', 'Presente OK'],
                  ['fueraDeRadio', 'Fuera de radio'],
                  ['salidaOk', 'Salida OK'],
                  ['salidaAntesDeFin', 'Salida antes de fin'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                    {label}
                  </label>
                  <input
                    value={cfg.cloud.templates[key]}
                    onChange={(e) =>
                      setCfg((prev) => ({
                        ...prev,
                        cloud: {
                          ...prev.cloud,
                          templates: { ...prev.cloud.templates, [key]: e.target.value },
                        },
                      }))
                    }
                    className="w-full text-sm font-mono border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="nombre_en_meta"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                Celular de prueba (E.164)
              </label>
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="549351..."
                className="w-full text-sm font-mono border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleTestCloud()}
              disabled={
                testingCloud ||
                !tokenStatus?.hasToken ||
                !cfg.cloud.phoneNumberId.trim() ||
                !testPhone.trim()
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border border-indigo-300 text-indigo-700 rounded-xl hover:bg-indigo-50 disabled:opacity-50"
            >
              {testingCloud && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Enviar hello_world
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-sm disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}
