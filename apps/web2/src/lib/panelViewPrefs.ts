/** Preferencias de vista (localStorage) por usuario: modo rápido al entrar. */
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

function uidKey(uid: string | null | undefined): string {
  return uid || 'anon';
}

function opsKey(uid: string | null | undefined): string {
  return `cosp-ops-prefer-modo-rapido:${uidKey(uid)}`;
}

function planifKey(uid: string | null | undefined): string {
  return `cosp-planif-modo-rapido:${uidKey(uid)}`;
}

function readFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function readPreferOpsModoRapido(uid: string | null | undefined): boolean {
  return readFlag(opsKey(uid));
}

export function writePreferOpsModoRapido(uid: string | null | undefined, on: boolean): void {
  writeFlag(opsKey(uid), on);
}

/**
 * Persiste el pin "Por defecto" a nivel empresa para que Functions silencie
 * push/bandeja/cascada del CC clásico (localStorage solo alcanza al navegador).
 */
export async function syncOpsPreferModoRapidoEmpresa(
  empresaId: string | null | undefined,
  on: boolean,
): Promise<void> {
  const eid = String(empresaId || '').trim();
  if (!eid) return;
  await setDoc(
    doc(db, 'empresas', eid, 'config', 'ops'),
    {
      preferModoRapido: on,
      preferModoRapidoUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export function readPreferPlanifModoRapido(uid: string | null | undefined): boolean {
  return readFlag(planifKey(uid));
}

export function writePreferPlanifModoRapido(uid: string | null | undefined, on: boolean): void {
  writeFlag(planifKey(uid), on);
}

/** Href del menú Centro Control según preferencia. */
export function opsLandingHref(uid: string | null | undefined): string {
  return readPreferOpsModoRapido(uid)
    ? '/admin/operaciones/modo-rapido'
    : '/admin/operaciones';
}
