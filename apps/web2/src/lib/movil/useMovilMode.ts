import { useEffect, useState } from 'react';

export const MOVIL_MODE_KEY = 'cosp-movil';
export const MOVIL_MODE_EVENT = 'cosp-movil-change';

/** '1' fuerza celular, '0' fuerza escritorio, vacío = ancho < 768. */
export function readMovilMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const choice = window.localStorage.getItem(MOVIL_MODE_KEY);
    if (choice === '1') return true;
    if (choice === '0') return false;
  } catch {
    /* ignore */
  }
  return window.innerWidth < 768;
}

export function writeMovilChoice(choice: '0' | '1' | null): void {
  if (choice) window.localStorage.setItem(MOVIL_MODE_KEY, choice);
  else window.localStorage.removeItem(MOVIL_MODE_KEY);
  window.dispatchEvent(new Event(MOVIL_MODE_EVENT));
}

export function useMovilMode(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const apply = () => setOn(readMovilMode());
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener(MOVIL_MODE_EVENT, apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener(MOVIL_MODE_EVENT, apply);
    };
  }, []);
  return on;
}
