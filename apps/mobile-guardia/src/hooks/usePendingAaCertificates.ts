import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  query,
  updateDoc,
  doc,
  where,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { uploadAbsenceCertificate, type LocalCertificateFile } from '../lib/uploadAbsenceCertificate';

export type PendingAaAbsence = {
  id: string;
  startDate: string;
  reason?: string;
  objectiveName?: string;
  positionName?: string;
};

function isAaWithoutCert(data: Record<string, unknown>): boolean {
  const t = String(data.absenceType || data.type || '').toLowerCase();
  const isAa =
    t === 'aa' ||
    t === 'no presentacion' ||
    t === 'no presentación' ||
    t.includes('injustific');
  const hasCert = Boolean(data.certificateUrl || data.certificateDriveLink || data.hasCertificate);
  return isAa && !hasCert;
}

export function usePendingAaCertificates(params: {
  db: Firestore;
  authUid: string | null;
  empDocId: string | null;
  enabled?: boolean;
}) {
  const { db, authUid, empDocId, enabled = true } = params;
  const [items, setItems] = useState<PendingAaAbsence[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || (!authUid && !empDocId)) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fromStr = sevenDaysAgo.toISOString().slice(0, 10);
      const keys = [...new Set([empDocId, authUid].filter(Boolean) as string[])];
      const byId = new Map<string, PendingAaAbsence>();

      for (const key of keys) {
        const snap = await getDocs(
          query(
            collection(db, 'ausencias'),
            where('employeeId', '==', key),
            where('startDate', '>=', fromStr),
          ),
        );
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          if (!isAaWithoutCert(data)) continue;
          byId.set(d.id, {
            id: d.id,
            startDate: String(data.startDate || ''),
            reason: data.reason as string | undefined,
            objectiveName: data.objectiveName as string | undefined,
            positionName: data.positionName as string | undefined,
          });
        }
      }
      setItems(Array.from(byId.values()));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [db, authUid, empDocId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadCertificate = useCallback(
    async (ausenciaId: string, file: LocalCertificateFile) => {
      if (!authUid) return { ok: false as const, message: 'Sesión expirada.' };
      setUploadingId(ausenciaId);
      try {
        const uploaded = await uploadAbsenceCertificate(authUid, file);
        await updateDoc(doc(db, 'ausencias', ausenciaId), {
          certificateUrl: uploaded.url,
          certificateName: uploaded.name,
          certificateStoragePath: uploaded.storagePath,
          certificateUploadedAt: serverTimestamp(),
          hasCertificate: true,
          status: 'Confirmada',
        });
        await refresh();
        return { ok: true as const, message: 'Certificado enviado — RRHH fue notificado.' };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'No se pudo subir el certificado.';
        return { ok: false as const, message };
      } finally {
        setUploadingId(null);
      }
    },
    [authUid, db, refresh],
  );

  return { items, loading, uploadingId, refresh, uploadCertificate };
}
