import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getPortalFirebase } from './portal';

export async function uploadCredencialPhoto(
  empDocId: string,
  uri: string,
  mimeType: string,
): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const { storage, db } = getPortalFirebase();
  const path = `credenciales/${empDocId}/foto.png`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blob, { contentType: mimeType || 'image/png' });
  const url = await getDownloadURL(fileRef);

  await setDoc(
    doc(db, 'credenciales_publicas', empDocId),
    { photoUrl: url, updatedAt: serverTimestamp() },
    { merge: true },
  );
  await updateDoc(doc(db, 'empleados', empDocId), { photoUrl: url }).catch(() => {});

  return url;
}
