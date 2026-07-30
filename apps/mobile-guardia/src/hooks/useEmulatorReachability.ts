import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getEmulatorHostLabel, isEmulatorMode } from '../lib/portal';

export type EmulatorReachability = 'idle' | 'checking' | 'ok' | 'fail';

export function useEmulatorReachability(): EmulatorReachability {
  const [state, setState] = useState<EmulatorReachability>('idle');

  useEffect(() => {
    if (Platform.OS === 'web' || !isEmulatorMode()) {
      setState('idle');
      return;
    }
    const host = getEmulatorHostLabel();
    if (host === '127.0.0.1' || host === 'localhost') {
      setState('fail');
      return;
    }

    let cancelled = false;
    setState('checking');

    (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`http://${host}:9099`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!cancelled) {
          setState(res.status > 0 ? 'ok' : 'fail');
        }
      } catch {
        if (!cancelled) setState('fail');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
