/** Estado de UI por pestaña de navegador (sobrevive F5, se pierde al cerrar). */

export function readSessionJson<T>(key: string): T | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export function writeSessionJson(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* quota / private mode */
    }
}

export function readSessionString(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

export function writeSessionString(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(key, value);
    } catch {
        /* quota / private mode */
    }
}
