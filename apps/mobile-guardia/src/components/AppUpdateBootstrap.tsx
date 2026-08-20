import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { checkAndApplyAppUpdate } from '../lib/appUpdate';

/**
 * Aviso diferido de OTA (no corre en el primer frame: evita carrera con checkAutomatically nativo).
 * Solo prompt manual-friendly; no aplica solo.
 */
export function AppUpdateBootstrap() {
  const promptedRef = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;

    const maybePrompt = async () => {
      if (cancelled || promptedRef.current) return;
      try {
        // Esperar a que termine el boot nativo / splash
        await new Promise((r) => setTimeout(r, 4000));
        if (cancelled || promptedRef.current) return;
        const result = await checkAndApplyAppUpdate({ apply: false });
        if (cancelled || result.status !== 'ready') return;
        promptedRef.current = true;
        Alert.alert('Actualización disponible', result.message, [
          { text: 'Después', style: 'cancel' },
          {
            text: 'Actualizar ahora',
            onPress: () => {
              void checkAndApplyAppUpdate({ apply: true }).then((r) => {
                if (r.status === 'error') Alert.alert('Actualización', r.message);
              });
            },
          },
        ]);
      } catch {
        /* no bloquear arranque */
      }
    };

    void maybePrompt();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maybePrompt();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return null;
}
