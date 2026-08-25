import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useResponsiveLayout } from '../src/hooks/useResponsiveLayout';

export default function DeviceBlockedScreen() {
  const router = useRouter();
  const { signOut, refreshEmployee } = usePortalAuth();
  const { formMaxWidth } = useResponsiveLayout();

  return (
    <>
      <Stack.Screen options={{ title: 'Dispositivo no autorizado' }} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={[styles.card, { maxWidth: formMaxWidth, width: '100%', alignSelf: 'center' }]}>
            <Text style={styles.title}>Dispositivo no vinculado</Text>
            <Text style={styles.body}>
              Esta cuenta ya está activa en otro celular. Cada legajo permite un dispositivo a la vez.
            </Text>
            <Text style={styles.body}>
              Si cambiaste de teléfono, pedile a RRHH un nuevo mail de acceso y activá desde el botón
              «Abrir en COSP Guardia».
            </Text>
            <Pressable
              style={styles.btnSecondary}
              onPress={async () => {
                await refreshEmployee();
                router.replace('/');
              }}
            >
              <Text style={styles.btnSecondaryText}>Reintentar verificación</Text>
            </Pressable>
            <Pressable
              style={styles.btn}
              onPress={async () => {
                await signOut();
                router.replace('/login');
              }}
            >
              <Text style={styles.btnText}>Cerrar sesión</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#fecaca',
    gap: 16,
    shadowColor: '#b91c1c',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#991b1b' },
  body: { fontSize: 14, color: '#64748b', lineHeight: 22 },
  btn: {
    backgroundColor: '#4f46e5',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#334155', fontWeight: '700' },
});
