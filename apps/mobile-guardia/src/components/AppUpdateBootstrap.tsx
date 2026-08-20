import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { checkAndApplyAppUpdate } from '../lib/appUpdate';

/**
 * Aviso silencioso al volver a primer plano si hay OTA pendiente (solo builds EAS).
 */
export function AppUpdateBootstrap() {
  const promptedRef = useRef(false);

  useEffect(() => {
    if (__DEV__) return;

    const maybePrompt = async () => {
      if (promptedRef.current) return;
      const result = await checkAndApplyAppUpdate({ apply: false });
      if (result.status !== 'ready') return;
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
    };

    void maybePrompt();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maybePrompt();
    });

    return () => sub.remove();
  }, []);

  return null;
}
