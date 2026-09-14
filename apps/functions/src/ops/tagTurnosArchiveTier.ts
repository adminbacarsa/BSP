import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  classifyDate,
  hotWindow,
  onlineOldestYearMonth,
  calendarMonthBounds,
  type ArchiveTier,
} from './dataRetention';

const BATCH_SIZE = 400;

/**
 * Etiqueta turnos con archiveTier (hot|warm|cold) sin borrar.
 * Fase 1 de retención: permite filtrar / reportar antes de mover a colección hist.
 */
export async function tagTurnosArchiveTier(opts?: {
  empresaId?: string;
  dryRun?: boolean;
  maxDocs?: number;
}): Promise<{ scanned: number; updated: number; byTier: Record<ArchiveTier, number>; dryRun: boolean }> {
  const db = admin.firestore();
  const dryRun = opts?.dryRun === true;
  const maxDocs = opts?.maxDocs ?? 5000;
  const now = new Date();
  const oldestOnline = calendarMonthBounds(onlineOldestYearMonth(now)).start;
  // Solo revisamos docs claramente fuera de hot (start < hot.start) + muestra reciente sin tag
  const hot = hotWindow(now);

  const byTier: Record<ArchiveTier, number> = { hot: 0, warm: 0, cold: 0 };
  let scanned = 0;
  let updated = 0;

  // Pass 1: turnos anteriores al inicio hot (candidatos warm/cold)
  let q: FirebaseFirestore.Query = db
    .collection('turnos')
    .where('startTime', '<', Timestamp.fromDate(hot.start))
    .orderBy('startTime', 'asc')
    .limit(Math.min(BATCH_SIZE, maxDocs));

  if (opts?.empresaId) {
    q = db
      .collection('turnos')
      .where('empresaId', '==', opts.empresaId)
      .where('startTime', '<', Timestamp.fromDate(hot.start))
      .orderBy('startTime', 'asc')
      .limit(Math.min(BATCH_SIZE, maxDocs));
  }

  const snap = await q.get();
  let batch = db.batch();
  let ops = 0;

  const flush = async () => {
    if (ops === 0 || dryRun) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const doc of snap.docs) {
    if (scanned >= maxDocs) break;
    scanned += 1;
    const data = doc.data();
    const start = data.startTime?.toDate?.() as Date | undefined;
    if (!start) continue;
    const tier = classifyDate(start, now);
    byTier[tier] += 1;
    if (data.archiveTier === tier) continue;
    updated += 1;
    if (!dryRun) {
      batch.update(doc.ref, {
        archiveTier: tier,
        archiveTaggedAt: FieldValue.serverTimestamp(),
      });
      ops += 1;
      if (ops >= BATCH_SIZE) await flush();
    }
  }
  await flush();

  // Pass 2 opcional: docs en hot sin tag → marcar hot (muestra acotada)
  // Se omite en cron diario para no tocar toda la malla caliente; solo cold/warm.

  console.info('[tagTurnosArchiveTier]', {
    dryRun,
    scanned,
    updated,
    byTier,
    hotStart: hot.start.toISOString(),
    onlineOldest: oldestOnline.toISOString(),
  });

  return { scanned, updated, byTier, dryRun };
}
