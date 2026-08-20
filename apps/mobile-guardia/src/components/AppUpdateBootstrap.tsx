import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { checkAndApplyAppUpdate } from '../lib/appUpdate';

/**
 * Solo avisa si hay update. Nunca aplica solo ni llama reloadAsync.
 */
export function AppUpdateBootstrap() {
  const promptedRef = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;

    const maybePrompt = async () => {
      if (cancelled || promptedRef.current) return;
      try {
        await new Promise((r) => setTimeout(r, 5000));
        if (cancelled || promptedRef.current) return;
        const result = await checkAndApplyAppUpdate({ apply: false });
        if (cancelled || result.status !== 'ready') return;
        promptedRef.current = true;
        Alert.alert('Actualización disponible', result.message, [
          { text: 'Después', style: 'cancel' },
          {
            text: 'Descargar',
            onPress: () => {
              void checkAndApplyAppUpdate({ apply: true }).then((r) => {
                Alert.alert(
                  r.status === 'downloaded' ? 'Listo' : 'Actualización',
                  r.message,
                );
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
