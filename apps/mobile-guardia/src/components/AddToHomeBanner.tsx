import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const DISMISS_KEY = 'cosp_a2hs_dismissed';

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notOther = !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
  return iOS && webkit && notOther;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)')?.matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(mq || iosStandalone);
}

/**
 * iOS Safari no instala PWA sola: hace falta «Agregar a pantalla de inicio»
 * para push (limitado) y para reducir borrado de datos a los 7 días.
 */
export function AddToHomeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* ignore */
    }
    if (!isIosSafari() || isStandaloneDisplay()) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <View style={styles.card}>
        <Text style={styles.title}>Agregá COSP a tu pantalla de inicio</Text>
        <Text style={styles.body}>
          En Safari: tocá Compartir → «Agregar a pantalla de inicio». Así las notificaciones y el
          dispositivo vinculado no se pierden si no abrís la app en varios días.
        </Text>
        <Pressable
          style={styles.btn}
          onPress={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, '1');
            } catch {
              /* ignore */
            }
            setVisible(false);
          }}
        >
          <Text style={styles.btnText}>Entendido</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 88,
    zIndex: 100,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  title: { color: '#fff', fontWeight: '800', fontSize: 15 },
  body: { color: '#cbd5e1', fontSize: 13, lineHeight: 19 },
  btn: {
    alignSelf: 'flex-end',
    backgroundColor: '#8B1A1A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
