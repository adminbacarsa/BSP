import * as admin from 'firebase-admin';

function hoyAr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function esJornadaFutura(data: Record<string, unknown>, hoy: string): boolean {
  const fecha = String(data.scheduleDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha >= hoy;
  const start = (data.startTime as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
  return start >= Date.now();
}

async function turnosDelContrato(db: admin.firestore.Firestore, contratoId: string) {
  const snap = await db.collection('turnos').where('eventualContratoId', '==', contratoId).get();
  return snap.docs;
}

/**
 * AT confirmado: todos los turnos del contrato (y los que se creen después) pueden fichar.
 * BT o anulación: las jornadas de hoy en adelante vuelven a quedar bloqueadas.
 */
export async function propagarAltaEnTurnos(
  db: admin.firestore.Firestore,
  opts: { contratoIds: string[]; nroTransaccion?: string | null; encender: boolean },
): Promise<number> {
  const ids = [...new Set((opts.contratoIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return 0;
  const hoy = hoyAr();
  const nro = String(opts.nroTransaccion || '').trim();
  const batch = db.batch();
  let n = 0;
  for (const contratoId of ids) {
    const docs = await turnosDelContrato(db, contratoId);
    for (const doc of docs) {
      const data = doc.data();
      if (!opts.encender && !esJornadaFutura(data, hoy)) continue;
      const patch: Record<string, unknown> = {
        eventualContratoId: contratoId,
        eventualAltaArcaConfirmada: opts.encender,
      };
      if (opts.encender && nro) patch.nroTransaccion = nro;
      if (data.eventualAltaArcaConfirmada === opts.encender && (!nro || data.nroTransaccion === nro)) continue;
      batch.update(doc.ref, patch);
      n += 1;
    }
  }
  if (n) await batch.commit();
  return n;
}

/** El turno nuevo de un contrato que ya tiene AT confirmado hereda el alta. */
export async function altaConfirmadaDelContrato(
  db: admin.firestore.Firestore,
  contratoId: string,
): Promise<{ confirmada: boolean; nroTransaccion: string | null }> {
  if (!contratoId) return { confirmada: false, nroTransaccion: null };
  const snap = await db.collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get();
  const alta = snap.docs.map((d) => d.data()).find((e) => e.tipo === 'AT' && e.estado === 'CONFIRMADO' && e.quitadoDelLote !== true);
  if (!alta) return { confirmada: false, nroTransaccion: null };
  return { confirmada: true, nroTransaccion: String(alta.nroTransaccion || '') || null };
}
