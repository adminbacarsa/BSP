import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import type { LocalCertificateFile } from '../lib/uploadAbsenceCertificate';
import { colors, radius } from '../theme/tokens';

type Props = {
  value: LocalCertificateFile | null;
  onChange: (file: LocalCertificateFile | null) => void;
  disabled?: boolean;
};

async function ensureCameraPermission(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  const requested = await ImagePicker.requestCameraPermissionsAsync();
  return requested.granted;
}

async function ensureLibraryPermission(): Promise<boolean> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return true;
  const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return requested.granted;
}

function assetToFile(asset: ImagePicker.ImagePickerAsset): LocalCertificateFile {
  const ext = asset.mimeType?.includes('png') ? 'png' : 'jpg';
  const fileName = asset.fileName?.trim() || `certificado_${Date.now()}.${ext}`;
  return {
    uri: asset.uri,
    fileName,
    mimeType: asset.mimeType || 'image/jpeg',
  };
}

export function CertificateAttachmentField({ value, onChange, disabled }: Props) {
  const [busy, setBusy] = useState(false);

  async function pickFromCamera() {
    if (disabled || busy) return;
    const ok = await ensureCameraPermission();
    if (!ok) {
      Alert.alert('Cámara', 'Activá el permiso de cámara en ajustes del teléfono.');
      return;
    }
    setBusy(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        onChange(assetToFile(result.assets[0]));
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickFromGallery() {
    if (disabled || busy) return;
    const ok = await ensureLibraryPermission();
    if (!ok) {
      Alert.alert('Galería', 'Activá el permiso de fotos en ajustes del teléfono.');
      return;
    }
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        onChange(assetToFile(result.assets[0]));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Certificado (opcional)</Text>
      <Text style={styles.hint}>JPG o PNG. Misma ruta que el portal web (`absences/` en Storage).</Text>
      {value ? (
        <View style={styles.previewBox}>
          <Image source={{ uri: value.uri }} style={styles.preview} resizeMode="cover" />
          <View style={styles.previewMeta}>
            <Text style={styles.fileName} numberOfLines={2}>
              {value.fileName}
            </Text>
            <Pressable
              onPress={() => onChange(null)}
              disabled={disabled || busy}
              style={styles.removeBtn}
              accessibilityLabel="Quitar certificado"
            >
              <Ionicons name="close" size={20} color={colors.slate700} />
            </Pressable>
          </View>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={pickFromCamera}
          disabled={disabled || busy}
          style={[styles.actionBtn, (disabled || busy) && styles.actionDisabled]}
        >
          <Ionicons name="camera" size={18} color={colors.indigo600} />
          <Text style={styles.actionText}>{busy ? 'Abriendo…' : 'Tomar foto'}</Text>
        </Pressable>
        <Pressable
          onPress={pickFromGallery}
          disabled={disabled || busy}
          style={[styles.actionBtn, (disabled || busy) && styles.actionDisabled]}
        >
          <Ionicons name="images" size={18} color={colors.indigo600} />
          <Text style={styles.actionText}>Galería</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginTop: 8 },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: { fontSize: 12, color: colors.slate500, lineHeight: 18 },
  previewBox: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.white,
  },
  preview: { width: '100%', height: 160, backgroundColor: colors.slate100 },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  fileName: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.slate700 },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.slate100,
  },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.indigo200,
    backgroundColor: colors.indigo100,
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { fontSize: 13, fontWeight: '800', color: colors.indigo800 },
});
