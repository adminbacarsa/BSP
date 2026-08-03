import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getPortalFirebase } from './portal';

export type LocalCertificateFile = {
  uri: string;
  fileName: string;
  mimeType: string;
};

export async function uploadAbsenceCertificate(
  authUid: string,
  file: LocalCertificateFile,
): Promise<{ url: string; name: string; storagePath: string }> {
  const safeName = `${Date.now()}_${file.fileName.replace(/\s+/g, '_')}`;
  const storagePath = `absences/${authUid}/${safeName}`;
  const response = await fetch(file.uri);
  const blob = await response.blob();
  const { storage } = getPortalFirebase();
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, blob, { contentType: file.mimeType || 'application/octet-stream' });
  const url = await getDownloadURL(fileRef);
  return { url, name: file.fileName, storagePath };
}
