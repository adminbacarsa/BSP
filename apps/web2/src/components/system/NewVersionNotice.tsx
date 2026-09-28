import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  CURRENT_BUILD_HASH,
  deployedVersion,
  fetchDeployedVersion,
  isNewerDeploy,
  isStaleBuild,
  markStaleBuild,
  subscribeStaleBuild,
} from '@/lib/appVersion';
import { appBusyReasons } from '@/lib/appBusyState';

const POLL_MS = 60 * 1000;
const RELOAD_DELAY_S = 5;
/** Con el operador ocupado esperamos; revisamos seguido para recargar apenas cierre. */
const BUSY_RECHECK_MS = 1000;

/**
 * Aviso de versión nueva del panel.
 *
 * Libre: cuenta 5 s y recarga sola.
 * Ocupado (protocolo de cobertura, modal, formulario o campo con texto sin guardar):
 * aviso fijo «Hay una versión nueva, se actualiza al cerrar» y recarga al cerrar.
 *
 * La recarga no toca `sesiones_operador`: el piloto sigue piloto y el copiloto copiloto.
 */
export function NewVersionNotice() {
  const [stale, setStale] = useState(isStaleBuild());
  const [busyReasons, setBusyReasons] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const reloadingRef = useRef(false);

  const doReload = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    window.location.reload();
  }, []);

  useEffect(() => subscribeStaleBuild(() => setStale(true)), []);

  // Polling del version.json publicado.
  useEffect(() => {
    if (!CURRENT_BUILD_HASH || CURRENT_BUILD_HASH === 'local') return;
    let cancelled = false;
    const controller = new AbortController();

    const check = async () => {
      if (cancelled || isStaleBuild()) return;
      const info = await fetchDeployedVersion(controller.signal);
      if (cancelled || !isNewerDeploy(info)) return;
      markStaleBuild(info);
    };

    void check();
    const id = setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  // Cuenta regresiva mientras no haya trabajo abierto; si lo hay, espera y reintenta.
  useEffect(() => {
    if (!stale) return;
    let remaining = RELOAD_DELAY_S;
    setCountdown(remaining);

    const tick = () => {
      const reasons = appBusyReasons();
      setBusyReasons(reasons);
      if (reasons.length > 0) {
        remaining = RELOAD_DELAY_S;
        setCountdown(null);
        return;
      }
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) doReload();
    };

    const id = setInterval(tick, BUSY_RECHECK_MS);
    return () => clearInterval(id);
  }, [stale, doReload]);

  if (!stale) return null;

  const esperando = busyReasons.length > 0;
  const info = deployedVersion();

  return (
    <div className="fixed bottom-4 left-4 z-[9999] max-w-sm">
      <div className="rounded-2xl border border-indigo-200 bg-white shadow-lg px-4 py-3 flex items-start gap-3">
        <RefreshCw size={16} className={`mt-0.5 shrink-0 text-indigo-600 ${esperando ? '' : 'animate-spin'}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">
            {esperando ? 'Hay una versión nueva, se actualiza al cerrar' : 'Hay una versión nueva del panel'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {esperando
              ? `Esperando: ${busyReasons.join(' · ')}.`
              : countdown != null && countdown > 0
                ? `Se recarga en ${countdown} s.`
                : 'Recargando…'}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            Hasta recargar, los automatismos de esta pestaña están en pausa.
            {info?.version ? ` Versión ${info.version}.` : ''}
          </p>
          <button
            type="button"
            onClick={doReload}
            className="mt-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 active:scale-95 transition"
          >
            Actualizar ahora
          </button>
        </div>
      </div>
    </div>
  );
}
