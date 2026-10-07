import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { LocalCertificateFile } from './uploadAbsenceCertificate';

function assetToFile(asset: ImagePicker.ImagePickerAsset): LocalCertificateFile {
  const ext = asset.mimeType?.includes('png') ? 'png' : 'jpg';
  return {
    uri: asset.uri,
    fileName: asset.fileName?.trim() || `certificado_${Date.now()}.${ext}`,
    mimeType: asset.mimeType || 'image/jpeg',
  };
}

export async function pickCertificatePhoto(source: 'camera' | 'library'): Promise<LocalCertificateFile | null> {
  if (source === 'camera') {
    const current = await ImagePicker.getCameraPermissionsAsync();
    const granted = current.granted || (await ImagePicker.requestCameraPermissionsAsync()).granted;
    if (!granted) return null;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    return result.canceled || !result.assets[0] ? null : assetToFile(result.assets[0]);
  }
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  const granted = current.granted || (await ImagePicker.requestMediaLibraryPermissionsAsync()).granted;
  if (!granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
  return result.canceled || !result.assets[0] ? null : assetToFile(result.assets[0]);
}

/** PDF o imagen en /app. En el teléfono el archivo se saca con la cámara o la galería. */
export function pickCertificateDocument(): Promise<LocalCertificateFile | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({
        uri: URL.createObjectURL(file),
        fileName: file.name || 'certificado.pdf',
        mimeType: file.type || 'application/pdf',
      });
    };
    input.click();
  });
}
