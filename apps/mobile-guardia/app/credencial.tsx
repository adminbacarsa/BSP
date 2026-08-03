import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import QRCode from 'react-native-qrcode-svg';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEmpresaBranding } from '../src/hooks/useEmpresaBranding';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { getPortalFirebase } from '../src/lib/portal';
import {
  computeCredencialVerificationCode,
  credencialPublicVerifyUrl,
} from '../src/lib/credencialVerification';
import { readCredencialCache, writeCredencialCache } from '../src/lib/credencialCache';
import { uploadCredencialPhoto } from '../src/lib/uploadCredencialPhoto';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

type PublicCred = {
  photoUrl?: string;
  empresaNombre?: string;
  firstName?: string;
  lastName?: string;
  dni?: string;
  fileNumber?: string;
  category?: string;
};

export default function CredencialScreen() {
  return (
    <RequireAuth>
      <CredencialScreenContent />
    </RequireAuth>
  );
}

function CredencialScreenContent() {
  const { employee, empDocId } = usePortalAuth();
  const { palette } = useTheme();
  const { empresaNombre } = useEmpresaBranding(employee?.empresaId);
  const [publicCred, setPublicCred] = useState<PublicCred | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [ver, setVer] = useState({ code: '--- ---', remainingSec: 60, pct: 100 });

  const display = useMemo(() => {
    const firstName = publicCred?.firstName || employee?.firstName || '';
    const lastName = publicCred?.lastName || employee?.lastName || '';
    const name = [lastName, firstName].filter(Boolean).join(', ');
    return {
      name: name || 'Vigilador',
      dni: publicCred?.dni || employee?.dni || '—',
      legajo: publicCred?.fileNumber || employee?.fileNumber || employee?.legajo || '—',
      category: publicCred?.category || employee?.category || '—',
      empresa: publicCred?.empresaNombre || empresaNombre || 'Empresa',
      photoUrl: publicCred?.photoUrl || employee?.photoUrl,
    };
  }, [publicCred, employee, empresaNombre]);

  const verifyUrl = empDocId ? credencialPublicVerifyUrl(empDocId) : '';

  const load = useCallback(async () => {
    if (!empDocId) {
      setLoading(false);
      return;
    }
    const cached = await readCredencialCache(empDocId);
    if (cached) {
      setPublicCred({
        firstName: cached.firstName,
        lastName: cached.lastName,
        dni: cached.dni,
        fileNumber: cached.fileNumber,
        category: cached.category,
        empresaNombre: cached.empresaNombre,
        photoUrl: cached.photoUrl,
      });
      setFromCache(true);
      setLoading(false);
    }

    try {
      const { db } = getPortalFirebase();
      const snap = await getDoc(doc(db, 'credenciales_publicas', empDocId));
      if (snap.exists()) {
        const d = snap.data() as PublicCred;
        setPublicCred(d);
        setFromCache(false);
        await writeCredencialCache({
          empDocId,
          ...d,
          verifyUrl,
          cachedAt: Date.now(),
        });
      } else if (employee) {
        await setDoc(
          doc(db, 'credenciales_publicas', empDocId),
          {
            firstName: employee.firstName || '',
            lastName: employee.lastName || '',
            dni: employee.dni || '',
            fileNumber: employee.fileNumber || employee.legajo || '',
            category: employee.category || '',
            empresaNombre: empresaNombre || '',
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
    } catch (e) {
      if (!cached) Alert.alert('Credencial', 'No se pudo cargar. Si no hay red, solo verás la última copia guardada.');
    } finally {
      setLoading(false);
    }
  }, [empDocId, employee, empresaNombre, verifyUrl]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!empDocId) return;
    const tick = () => setVer(computeCredencialVerificationCode(empDocId));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [empDocId]);

  const pickPhoto = async () => {
    if (!empDocId) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Cámara', 'Activá el permiso de cámara en ajustes.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploadBusy(true);
    try {
      const url = await uploadCredencialPhoto(empDocId, asset.uri, asset.mimeType || 'image/jpeg');
      setPublicCred((prev) => ({ ...(prev || {}), photoUrl: url }));
      await writeCredencialCache({
        empDocId,
        photoUrl: url,
        firstName: display.name,
        empresaNombre: display.empresa,
        verifyUrl,
        cachedAt: Date.now(),
      });
      Alert.alert('Foto actualizada', 'La credencial pública ya muestra la nueva imagen.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo subir la foto');
    } finally {
      setUploadBusy(false);
    }
  };

  if (!empDocId) {
    return (
      <>
        <Stack.Screen options={{ title: 'Credencial' }} />
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
          <Text style={{ color: palette.onSurfaceMuted }}>Perfil de legajo no disponible.</Text>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Credencial digital' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {loading && !publicCred ? (
            <ActivityIndicator color={palette.primary} size="large" />
          ) : (
            <>
              {fromCache ? (
                <Text style={[styles.cacheHint, { color: palette.onSurfaceMuted }]}>
                  Vista desde copia local (sin red o Firestore lento).
                </Text>
              ) : null}
              <View style={[styles.card, { backgroundColor: palette.primary, borderColor: palette.cardBorder }]}>
                <Text style={styles.cardTitle}>CREDENCIAL DE ACCESO</Text>
                <Text style={styles.empresa}>{display.empresa}</Text>
                <View style={styles.photoRow}>
                  {display.photoUrl ? (
                    <Image source={{ uri: display.photoUrl }} style={styles.photo} />
                  ) : (
                    <View style={[styles.photo, styles.photoPlaceholder]}>
                      <Text style={styles.photoPlaceholderText}>Sin foto</Text>
                    </View>
                  )}
                  <View style={styles.meta}>
                    <Text style={styles.name}>{display.name}</Text>
                    <Text style={styles.line}>DNI {display.dni}</Text>
                    <Text style={styles.line}>Legajo {display.legajo}</Text>
                    <Text style={styles.line}>Cat. {display.category}</Text>
                  </View>
                </View>
                <View style={styles.verRow}>
                  <Text style={styles.verLabel}>Código verificación</Text>
                  <Text style={styles.verCode}>{ver.code}</Text>
                  <View style={styles.verBarBg}>
                    <View style={[styles.verBarFill, { width: `${ver.pct}%` }]} />
                  </View>
                  <Text style={styles.verSec}>{ver.remainingSec}s</Text>
                </View>
              </View>

              <CommandCard title="QR verificación">
                <Text style={[styles.qrHint, { color: palette.onSurfaceMuted }]}>
                  Mismo enlace que el portal web para validar en comtroldata.web.app/credencial
                </Text>
                <View style={styles.qrWrap}>
                  {verifyUrl ? (
                    <QRCode value={verifyUrl} size={168} backgroundColor="#fff" color="#0f172a" />
                  ) : null}
                </View>
                <Text style={[styles.url, { color: palette.primary }]} selectable>
                  {verifyUrl}
                </Text>
              </CommandCard>

              <CommandButton
                label={uploadBusy ? 'Subiendo foto…' : 'Actualizar foto (cámara)'}
                onPress={pickPhoto}
                disabled={uploadBusy}
              />
              <CommandButton label="Refrescar datos" variant="secondary" onPress={() => load()} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.container, gap: spacing.md, paddingBottom: 32 },
  cacheHint: { fontSize: 12, marginBottom: 4 },
  card: {
    borderRadius: radius.xl,
    padding: 20,
    borderWidth: 1,
  },
  cardTitle: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  empresa: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 6 },
  photoRow: { flexDirection: 'row', gap: 14, marginTop: 16, alignItems: 'center' },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: '#1e293b' },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  meta: { flex: 1 },
  name: { color: '#fff', fontSize: 18, fontWeight: '900' },
  line: { color: '#cbd5e1', fontSize: 13, marginTop: 4, fontWeight: '600' },
  verRow: { marginTop: 18, alignItems: 'center' },
  verLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  verCode: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 4 },
  verBarBg: {
    height: 4,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
    marginTop: 8,
  },
  verBarFill: { height: 4, backgroundColor: '#34d399', borderRadius: 4 },
  verSec: { color: '#94a3b8', fontSize: 11, marginTop: 4 },
  qrHint: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  qrWrap: {
    alignSelf: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: radius.md,
  },
  url: { fontSize: 11, marginTop: 10, textAlign: 'center' },
});
