import { useEffect, useState } from 'react';
import { readSessionJson, writeSessionJson } from '@/lib/persistSession';

/** Estado que sobrevive F5 (sessionStorage). No usar para Dates ni Sets. */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setState] = useState<T>(initial);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const saved = readSessionJson<T>(key);
        if (saved !== null) setState(saved);
        setReady(true);
    }, [key]);

    useEffect(() => {
        if (!ready) return;
        writeSessionJson(key, state);
    }, [key, ready, state]);

    return [state, setState];
}
