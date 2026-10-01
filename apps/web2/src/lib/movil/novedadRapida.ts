import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';

export interface NovedadRapidaInput {
  empresaId: string;
  /** Tipo en mayúsculas (`OBSERVACION`, `SUPERVISION_NOVEDAD`…). */
  type: string;
  title: string;
  description: string;
  reportedBy: string;
  employeeId?: string | null;
  employeeName?: string;
  objectiveId?: string | null;
  objectiveName?: string;
  clientId?: string | null;
  /** `SUPERVISION` cuando la escribe el supervisor; el filtro de alertas lo usa. */
  source?: string;
  /** Foto opcional: se sube a Storage y queda en `imageUrl`. */
  foto?: File | null;
  /** Campos extra del módulo (ej. `visitaId`). */
  extra?: Record<string, unknown>;
}

/**
 * La misma escritura de novedades para RRHH celular y Supervisión: `novedades` con
 * `stampEmpresaId`, `status: pending`, y foto subida a `novedades/{empresaId}/…`.
 * Se llama dentro de `enqueueFirestoreWrite` para respetar la cola offline.
 */
export async function crearNovedadRapida(input: NovedadRapidaInput): Promise<string> {
  let imageUrl: string | null = null;
  let imageStoragePath: string | null = null;
  if (input.foto) {
    imageStoragePath = `novedades/${input.empresaId}/${Date.now()}_${input.foto.name.replace(/\s+/g, '_')}`;
    const fileRef = ref(storage, imageStoragePath);
    await uploadBytes(fileRef, input.foto);
    imageUrl = await getDownloadURL(fileRef);
  }
  const docRef = await addDoc(collection(db, 'novedades'), stampEmpresaId({
    type: input.type.toUpperCase(),
    title: input.title,
    status: 'pending',
    employeeId: input.employeeId || null,
    employeeName: input.employeeName || '',
    objectiveId: input.objectiveId || null,
    objectiveName: input.objectiveName || '',
    clientId: input.clientId || null,
    description: input.description,
    reportedBy: input.reportedBy,
    ...(input.source ? { source: input.source } : {}),
    ...(imageUrl ? { imageUrl, imageStoragePath } : {}),
    ...(input.extra || {}),
    createdAt: Timestamp.now(),
  }, input.empresaId));
  return docRef.id;
}
