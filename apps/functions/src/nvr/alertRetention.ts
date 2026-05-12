/**
 * Limpieza de alertas NVR: tras X días (por NVR) se conserva solo el informe,
 * se eliminan las imágenes de Storage.
 * Política por NVR: nvr_devices/{nvrId}.alert_retention_days (número; default 30).
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const DEFAULT_RETENTION_DAYS = 30;

function ensureAdmin() {
  if (!admin.apps.length) admin.initializeApp();
}

/** Extrae la ruta del archivo en Storage desde una URL de Firebase Storage (alt=media) */
function storagePathFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const match = url.match(/\/o\/(.+?)(\?|$)/);
    if (!match) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** Obtiene nvrId desde route_key (ej. "17589859__1" -> "17589859") */
function nvrIdFromRouteKey(routeKey: string | null | undefined): string {
  if (!routeKey || typeof routeKey !== 'string') return 'default';
  const idx = routeKey.indexOf('__');
  return idx >= 0 ? routeKey.slice(0, idx) : routeKey;
}

export const cleanupExpiredNvrAlerts = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'America/Argentina/Buenos_Aires', timeoutSeconds: 540 },
  async () => {
    ensureAdmin();
    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    const resolved = await db
      .collection('alerts')
      .where('status', 'in', ['acknowledged', 'false_alarm'])
      .limit(1000)
      .get();

    const nvrRetentionCache: Record<string, number> = {};

    async function getRetentionDays(nvrId: string): Promise<number> {
      if (nvrRetentionCache[nvrId] !== undefined) return nvrRetentionCache[nvrId];
      let days = DEFAULT_RETENTION_DAYS;
      try {
        const nvrSnap = await db.collection('nvr_devices').doc(nvrId).get();
        if (nvrSnap.exists && typeof nvrSnap.data()?.alert_retention_days === 'number') {
          days = Math.max(1, nvrSnap.data()!.alert_retention_days);
        }
      } catch {
        // use default
      }
      nvrRetentionCache[nvrId] = days;
      return days;
    }

    let deletedFiles = 0;
    let updatedDocs = 0;
    const now = Date.now();

    for (const docSnap of resolved.docs) {
      const data = docSnap.data();
      if (data.images_expired === true) continue;

      const routeKey = data.route_key;
      const nvrId = nvrIdFromRouteKey(routeKey);
      const retentionDays = await getRetentionDays(nvrId);

      const ts = data.timestamp?.toMillis?.() ?? (data.timestamp?.seconds ?? 0) * 1000;
      const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
      if (ts >= cutoff) continue;

      const urls: string[] = Array.isArray(data.image_urls)
        ? data.image_urls
        : data.image_url
          ? [data.image_url]
          : [];
      if (urls.length === 0 && !data.image_url) continue;

      for (const url of urls) {
        const path = storagePathFromUrl(url);
        if (path) {
          try {
            await bucket.file(path).delete();
            deletedFiles++;
          } catch (e: unknown) {
            const err = e as { code?: number };
            if (err?.code !== 404) console.warn('[ALERT_RETENTION] No se pudo borrar', path, err);
          }
        }
      }

      await docSnap.ref.update({
        image_url: null,
        image_urls: [],
        images_expired: true,
        retention_cleaned_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      updatedDocs++;
    }

    if (updatedDocs > 0) {
      console.log('[ALERT_RETENTION] Limpieza:', updatedDocs, 'alertas,', deletedFiles, 'archivos borrados. Política por NVR.');
    }
  }
);
