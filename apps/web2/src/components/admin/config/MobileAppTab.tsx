import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import {
  Smartphone,
  Cloud,
  KeyRound,
  RefreshCw,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Zap,
  Eye,
  EyeOff,
} from 'lucide-react';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import {
  maskSecret,
  readFirebasePublicConfig,
  readPortalWebOrigin,
} from '@/lib/firebasePublicConfig';
import { SuperAdminGuardPreviewPicker } from '@/components/empleado/SuperAdminGuardPreviewPicker';

type MobileAppConfig = {
  expoAccountOwner: string;
  expoProjectSlug: string;
  expoProjectId: string;
  portalWebOrigin: string;
  githubRepo: string;
  hasExpoToken: boolean;
  expoTokenHint: string;
  lastEnvSyncAt: string | null;
  lastEnvSyncBy: string | null;
  lastEnvSyncSummary: string | null;
  lastBuildId: string | null;
  lastBuildStatus: string | null;
  lastBuildUrl: string | null;
  lastBuildAt: string | null;
  lastBuildTrigger: string | null;
  updatedAt: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR');
  } catch {
    return iso;
  }
}

export default function MobileAppTab() {
  const { isSuperAdmin } = useAuth();
  const firebasePublic = useMemo(() => readFirebasePublicConfig(), []);
  const defaultOrigin = useMemo(() => readPortalWebOrigin(), []);

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<MobileAppConfig | null>(null);
  const [owner, setOwner] = useState('cosp-guardia');
  const [slug, setSlug] = useState('cosp-guardia');
  const [projectId, setProjectId] = useState('79b445af-b6a7-456b-b1be-87cf25a20bd5');
  const [portalOrigin, setPortalOrigin] = useState(defaultOrigin);
  const [githubRepo, setGithubRepo] = useState('adminbacarsa/BSP');
  const [expoToken, setExpoToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'getMobileAppConfig');
      const res = await fn({});
      const cfg = (res.data as { config: MobileAppConfig }).config;
      setConfig(cfg);
      setOwner(cfg.expoAccountOwner || 'cosp-guardia');
      setSlug(cfg.expoProjectSlug || 'cosp-guardia');
      setProjectId(cfg.expoProjectId || '79b445af-b6a7-456b-b1be-87cf25a20bd5');
      setPortalOrigin(cfg.portalWebOrigin || defaultOrigin);
      setGithubRepo(cfg.githubRepo || 'adminbacarsa/BSP');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo cargar config app móvil');
    } finally {
      setLoading(false);
    }
  }, [defaultOrigin]);

  useEffect(() => {
    if (isSuperAdmin) void load();
  }, [isSuperAdmin, load]);

  if (!isSuperAdmin) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-8 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto mb-3" />
        <p className="font-black text-amber-900 dark:text-amber-100">Solo SuperAdmin</p>
        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
          La configuración de la app nativa COSP Guardia requiere rol SuperAdmin.
        </p>
      </div>
    );
  }

  const saveSettings = async () => {
    if (!owner.trim()) return toast.error('Indicá el usuario/cuenta Expo (owner)');
    let cleanOwner = owner.trim().replace(/^@/, '');
    let cleanSlug = slug.trim().replace(/^@/, '');
    // Si pegaron "@cuenta/slug" en slug, separar
    if (cleanSlug.includes('/')) {
      const parts = cleanSlug.split('/').filter(Boolean);
      if (parts.length >= 2) {
        cleanOwner = parts[0];
        cleanSlug = parts[parts.length - 1];
        setOwner(cleanOwner);
        setSlug(cleanSlug);
      }
    }
    if (!projectId.trim()) {
      return toast.error('Falta el ID proyecto EAS (79b445af-...)');
    }
    setBusy('save');
    try {
      const fn = httpsCallable(functions, 'saveMobileAppConfig');
      const res = await fn({
        expoAccountOwner: cleanOwner,
        expoProjectSlug: cleanSlug,
        expoProjectId: projectId.trim(),
        portalWebOrigin: portalOrigin.trim(),
        githubRepo: githubRepo.trim(),
        expoAccessToken: expoToken.trim() || undefined,
      });
      setConfig((res.data as { config: MobileAppConfig }).config);
      setExpoToken('');
      toast.success('Configuración guardada');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setBusy(null);
    }
  };

  const syncEas = async () => {
    setBusy('sync');
    try {
      const fn = httpsCallable(functions, 'syncMobileAppEasEnv');
      const res = await fn({
        firebase: firebasePublic,
        portalWebOrigin: portalOrigin.trim(),
      });
      toast.success((res.data as { summary: string }).summary || 'Variables sincronizadas en EAS');
      await load();
    } catch (e: unknown) {
      const fb = e as { code?: string; message?: string };
      toast.error(fb.message || (e instanceof Error ? e.message : 'Error sincronizando EAS'));
    } finally {
      setBusy(null);
    }
  };

  const triggerBuild = async () => {
    setBusy('build');
    try {
      const fn = httpsCallable(functions, 'triggerMobileAppPreviewBuild');
      const res = await fn({});
      toast.success((res.data as { message: string }).message);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo encolar el build');
    } finally {
      setBusy(null);
    }
  };

  const refreshBuild = async () => {
    setBusy('refresh');
    try {
      const fn = httpsCallable(functions, 'refreshMobileAppBuildStatus');
      const res = await fn({});
      setConfig((res.data as { config: MobileAppConfig }).config);
      toast.success('Estado actualizado');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error consultando build');
    } finally {
      setBusy(null);
    }
  };

  const expoFullName = owner.trim() ? `@${owner.trim()}/${slug.trim() || 'cosp-guardia'}` : '—';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/40 dark:to-slate-900 p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg">
            <Smartphone size={24} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">App móvil COSP Guardia</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-3xl">
              Configuración centralizada: Firebase → EAS → APK nativa. El preview web sigue en{' '}
              <strong>Sistema → Portales</strong>; acá preparás la <strong>app instalable</strong> (no Expo Go / notebook).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Recargar
          </button>
        </div>
      </div>

      {loading && !config ? (
        <div className="py-16 text-center text-slate-500 font-bold flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl border p-6 shadow-sm" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
              <h3 className="font-black text-sm uppercase flex items-center gap-2 mb-4" style={{ color: 'var(--txt)' }}>
                <Cloud size={18} className="text-indigo-500" /> Firebase (auto desde este panel)
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Se toma del build web actual. Al sincronizar, se copia a EAS como{' '}
                <code className="text-indigo-600">EXPO_PUBLIC_*</code> para preview y production.
              </p>
              <dl className="space-y-2 text-xs font-mono">
                {[
                  ['Project', firebasePublic.projectId],
                  ['Auth domain', firebasePublic.authDomain],
                  ['API Key', maskSecret(firebasePublic.apiKey)],
                  ['App ID', maskSecret(firebasePublic.appId, 6)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-slate-800 dark:text-slate-200 text-right break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-2xl border p-6 shadow-sm" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
              <h3 className="font-black text-sm uppercase flex items-center gap-2 mb-4" style={{ color: 'var(--txt)' }}>
                <KeyRound size={18} className="text-orange-500" /> Expo / EAS
              </h3>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Cuenta Expo (owner)</span>
                  <input
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="ej. tu-usuario-expo"
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm dark:bg-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Slug proyecto</span>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm dark:bg-slate-900"
                  />
                </label>
                <label className="block rounded-xl border-2 border-orange-300 dark:border-orange-700 bg-orange-50/80 dark:bg-orange-950/30 p-3">
                  <span className="text-[11px] font-black text-orange-800 dark:text-orange-200 uppercase">ID proyecto EAS (obligatorio)</span>
                  <input
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="79b445af-b6a7-456b-b1be-87cf25a20bd5"
                    className="mt-1 w-full rounded-xl border border-orange-200 dark:border-orange-800 px-3 py-2 text-sm font-mono dark:bg-slate-900 bg-white"
                  />
                  <p className="text-[10px] text-orange-700/80 dark:text-orange-300/80 mt-1">
                    Pegá acá: 79b445af-b6a7-456b-b1be-87cf25a20bd5
                  </p>
                </label>
                <p className="text-[11px] text-indigo-600 font-bold">Proyecto EAS: {expoFullName}</p>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Origen portal (QR credencial)</span>
                  <input
                    value={portalOrigin}
                    onChange={(e) => setPortalOrigin(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm dark:bg-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Repo GitHub (build APK)</span>
                  <input
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm dark:bg-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">
                    Token acceso Expo {config?.hasExpoToken ? `(guardado ${config.expoTokenHint})` : ''}
                  </span>
                  <div className="mt-1 flex gap-2">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={expoToken}
                      onChange={(e) => setExpoToken(e.target.value)}
                      placeholder="Pegar solo si querés rotar (expo.dev → Access Tokens)"
                      className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="px-3 rounded-xl border border-slate-200 dark:border-slate-700"
                    >
                      {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={busy === 'save'}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white py-2.5 text-sm font-black"
                >
                  {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Guardar conexión Expo
                </button>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border p-6 shadow-sm" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
            <h3 className="font-black text-sm uppercase flex items-center gap-2 mb-4" style={{ color: 'var(--txt)' }}>
              <Zap size={18} className="text-emerald-500" /> Acciones automáticas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => void syncEas()}
                disabled={!!busy}
                className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 p-4 text-left hover:shadow-md transition-shadow"
              >
                <p className="font-black text-indigo-900 dark:text-indigo-100 text-sm">1 · Sincronizar variables EAS</p>
                <p className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80 mt-1">
                  Copia Firebase + portal a Expo (preview/prod). Sin notebook.
                </p>
                {config?.lastEnvSyncAt ? (
                  <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                    <CheckCircle2 size={12} className="text-emerald-500" />
                    {fmtDate(config.lastEnvSyncAt)} · {config.lastEnvSyncSummary}
                  </p>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => void triggerBuild()}
                disabled={!!busy}
                className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-left hover:shadow-md transition-shadow"
              >
                <p className="font-black text-emerald-900 dark:text-emerald-100 text-sm">2 · Generar APK preview</p>
                <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-1">
                  Encola GitHub Actions → EAS build APK (instalable en celular).
                </p>
                {config?.lastBuildAt ? (
                  <p className="text-[10px] text-slate-500 mt-2">
                    Último: {fmtDate(config.lastBuildAt)} · {config.lastBuildStatus || '—'}
                  </p>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => void refreshBuild()}
                disabled={!!busy}
                className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 text-left hover:shadow-md transition-shadow"
              >
                <p className="font-black text-slate-800 dark:text-white text-sm">Actualizar estado build</p>
                <p className="text-[11px] text-slate-500 mt-1">Consulta EAS por el último build registrado.</p>
                {config?.lastBuildUrl ? (
                  <a
                    href={config.lastBuildUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-600 font-bold mt-2 inline-flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Descargar APK <ExternalLink size={10} />
                  </a>
                ) : null}
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 px-4 py-3 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              <p className="font-bold text-slate-800 dark:text-slate-200 mb-1">Requisitos una sola vez (infra)</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Token Expo guardado arriba (permiso de build).</li>
                <li>
                  Secret Firebase Functions{' '}
                  <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded">GITHUB_DISPATCH_TOKEN</code> con permiso{' '}
                  <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded">actions:write</code> en el repo.
                </li>
                <li>Secret GitHub <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded">EXPO_TOKEN</code> para el workflow.</li>
                <li>Proyecto Expo <strong>{expoFullName}</strong> creado y vinculado al repo.</li>
              </ul>
              <p className="mt-2">
                Fallback manual en notebook (después de paso 1):{' '}
                <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded">npm run mobile:build:preview</code>
              </p>
            </div>
          </section>

          <section>
            <h3 className="font-black text-sm uppercase flex items-center gap-2 mb-3 text-slate-800 dark:text-white">
              <Eye size={16} /> Preview web guardia (mientras no haya APK)
            </h3>
            <SuperAdminGuardPreviewPicker
              variant="inline"
              title="Probar portal guardia en navegador (producción)"
              onSelect={(empId) => {
                window.open(`/empleado/dashboard?preview=${encodeURIComponent(empId)}`, '_blank', 'noopener,noreferrer');
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}
