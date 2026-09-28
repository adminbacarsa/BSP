/**
 * Detección de versión nueva del panel.
 *
 * `next.config.js` escribe `public/version.json` en cada build con el hash de git.
 * La pestaña abierta compara ese archivo con el hash que trae su propio bundle:
 * si difieren, el deploy dejó esta pestaña vieja.
 *
 * Una pestaña vieja no vuelve a escribir sola (`autoWritesPaused`): sus monitores
 * y auto-acciones quedan en pausa hasta que recargue, para que no siga ejecutando
 * automatismos que la versión nueva ya retiró.
 */

export type DeployedVersion = {
  hash: string;
  builtAt: string;
  version: string;
};

export const CURRENT_BUILD_HASH = String(process.env.NEXT_PUBLIC_BUILD_HASH || '').trim();
export const CURRENT_BUILD_TIME = String(process.env.NEXT_PUBLIC_BUILD_TIME || '').trim();

const VERSION_URL = '/version.json';

let staleBuild = false;
let deployed: DeployedVersion | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('[appVersion]', e);
    }
  });
}

export function isStaleBuild(): boolean {
  return staleBuild;
}

export function deployedVersion(): DeployedVersion | null {
  return deployed;
}

/**
 * Mientras la pestaña esté vieja no se ejecutan escrituras automáticas
 * (monitores de operaciones, auto-cierres de novedades, auto-acciones del CC).
 * Las acciones que dispara el operador a mano siguen habilitadas.
 */
export function autoWritesPaused(): boolean {
  return staleBuild;
}

export function markStaleBuild(info: DeployedVersion | null): void {
  if (staleBuild) return;
  staleBuild = true;
  deployed = info;
  notify();
}

export function subscribeStaleBuild(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function fetchDeployedVersion(signal?: AbortSignal): Promise<DeployedVersion | null> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store', signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DeployedVersion>;
    const hash = String(data?.hash || '').trim();
    if (!hash) return null;
    return {
      hash,
      builtAt: String(data?.builtAt || ''),
      version: String(data?.version || ''),
    };
  } catch {
    return null;
  }
}

/** Devuelve true si el archivo publicado corresponde a un build distinto al de esta pestaña. */
export function isNewerDeploy(info: DeployedVersion | null): boolean {
  if (!info?.hash || !CURRENT_BUILD_HASH) return false;
  return info.hash !== CURRENT_BUILD_HASH;
}
