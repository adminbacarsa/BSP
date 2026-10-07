import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { estadoNovedadEnPalabras, formatDateTimeAr, historialVisible, puedeSubirCertificado, rangoDias } from '@cosp/portal-core';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { useMisNovedades } from '../../src/hooks/useMisNovedades';
import { getPortalFirebase } from '../../src/lib/portal';
import { uploadAbsenceCertificate } from '../../src/lib/uploadAbsenceCertificate';
import { pickCertificateDocument, pickCertificatePhoto } from '../../src/lib/pickCertificateFile';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { useTheme } from '../../src/theme/ThemeContext';
import { appAlert } from '@/lib/appAlert';

export default function MisNovedadDetalleScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, initializing } = usePortalAuth();
  const { rows, loading } = useMisNovedades();
  const { db } = getPortalFirebase();
  const { palette } = useTheme();
  const [subiendo, setSubiendo] = useState(false);
  const novedad = rows.find((row) => row.id === id);

  if (initializing) return null;
  if (!user) return <Redirect href="/login" />;

  async function subir(origen: 'camera' | 'library' | 'pdf') {
    if (!user || !novedad || subiendo) return;
    if (origen === 'pdf' && Platform.OS !== 'web') {
      appAlert('PDF', 'En el teléfono sacá una foto. El PDF se sube desde la web.');
      return;
    }
    setSubiendo(true);
    try {
      const file = origen === 'pdf'
        ? await pickCertificateDocument()
        : await pickCertificatePhoto(origen);
      if (!file) {
        if (origen !== 'pdf') appAlert('Permiso', 'Activá cámara o fotos para adjuntar el certificado.');
        return;
      }
      const uploaded = await uploadAbsenceCertificate(user.uid, file);
      await updateDoc(doc(db, 'ausencias', novedad.id), {
        certificateUrl: uploaded.url,
        certificateName: uploaded.name,
        certificateStoragePath: uploaded.storagePath,
        certificateUploadedAt: serverTimestamp(),
        hasCertificate: true,
      });
      appAlert('Listo', 'El certificado quedó en esta novedad. RRHH lo revisa.');
    } catch (error) {
      appAlert('No se pudo subir', error instanceof Error ? error.message : 'Reintentá en un momento.');
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Novedad' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {loading ? (
            <Text style={{ color: palette.onSurfaceMuted }}>Cargando…</Text>
          ) : !novedad ? (
            <CommandCard title="No encontramos esa novedad">
              <CommandButton label="Volver al listado" variant="secondary" onPress={() => router.replace('/mis-novedades')} />
            </CommandCard>
          ) : (
            <>
              <CommandCard title={String(novedad.type || 'Novedad')}>
                <Text style={[styles.estado, { color: palette.primary }]}>{estadoNovedadEnPalabras(novedad)}</Text>
                <Text style={[styles.linea, { color: palette.onSurface }]}>{rangoDias(novedad) || 'Sin fechas'}</Text>
                <Text style={[styles.linea, { color: palette.onSurface }]}>
                  {novedad.reason ? String(novedad.reason) : 'Sin motivo'}
                </Text>
              </CommandCard>
              <CommandCard title="Historial">
                {historialVisible(novedad).map((linea, index) => (
                  <View key={`${linea.texto}-${index}`} style={styles.histo}>
                    <Text style={[styles.linea, { color: palette.onSurface }]}>{linea.texto}</Text>
                    <Text style={[styles.meta, { color: palette.onSurfaceMuted }]}>
                      {[linea.por, formatDateTimeAr(linea.at as never)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ))}
              </CommandCard>
              {puedeSubirCertificado(novedad) ? (
                <CommandCard title="Subir certificado">
                  <Text style={[styles.meta, { color: palette.onSurfaceMuted }]}>
                    Foto o PDF. Queda en esta misma novedad y RRHH lo ve para revisar.
                  </Text>
                  <CommandButton label={subiendo ? 'Subiendo…' : 'Tomar foto'} disabled={subiendo} onPress={() => { void subir('camera'); }} />
                  <CommandButton label="Elegir de la galería" variant="secondary" disabled={subiendo} onPress={() => { void subir('library'); }} />
                  <CommandButton label="Subir PDF" variant="secondary" disabled={subiendo} onPress={() => { void subir('pdf'); }} />
                </CommandCard>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, gap: 12 },
  estado: { fontSize: 15, fontWeight: '700' },
  linea: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 13, lineHeight: 18 },
  histo: { gap: 2 },
});
