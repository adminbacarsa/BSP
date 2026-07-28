import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { getFirebaseHealth } from '../src/lib/firebase';

type Health = ReturnType<typeof getFirebaseHealth>;

export default function HomeScreen() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    setHealth(getFirebaseHealth());
  }, []);

  const ready = health?.configured;

  return (
    <>
      <Stack.Screen options={{ title: 'COSP Guardia' }} />
      <View style={styles.container}>
        <View style={styles.heroCard}>
          <Text style={styles.badge}>F0 · Smoke test</Text>
          <Text style={styles.title}>COSP Guardia</Text>
          <Text style={styles.subtitle}>Portal del vigilador · Grupo Bacar</Text>
        </View>

        {!health ? (
          <ActivityIndicator size="large" color="#4f46e5" style={styles.loader} />
        ) : (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>Estado Firebase</Text>
            <Row label="Proyecto" value={health.projectId} />
            <Row label="Configuración" value={ready ? 'Completa' : 'Faltan variables'} ok={ready} />
            {!ready && health.missing.length > 0 && (
              <Text style={styles.missing}>Faltan: {health.missing.join(', ')}</Text>
            )}
            <Row label="Emulador" value={health.emulator ? 'Activo' : 'Producción'} />
            {health.emulator && (
              <Row label="Emulador conectado" value={health.emulatorConnected ? 'Sí' : 'No'} ok={health.emulatorConnected} />
            )}
            <Text style={styles.hint}>
              {ready
                ? 'SDK listo. Siguiente paso: login y turnos (Fase 1).'
                : 'Copiá .env.example → .env y completá las claves de Firebase.'}
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, ok === true && styles.ok, ok === false && styles.warn]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 20,
  },
  heroCard: {
    backgroundColor: '#312e81',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#312e81',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: '#c7d2fe',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 12,
    overflow: 'hidden',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#c7d2fe',
    fontSize: 14,
    marginTop: 6,
  },
  loader: {
    marginTop: 40,
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    color: '#64748b',
    fontSize: 13,
    flex: 1,
  },
  rowValue: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  ok: {
    color: '#059669',
  },
  warn: {
    color: '#d97706',
  },
  missing: {
    color: '#b45309',
    fontSize: 12,
    marginTop: 4,
  },
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
});
