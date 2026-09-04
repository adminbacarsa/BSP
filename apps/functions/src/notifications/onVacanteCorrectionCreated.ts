/**
 * Notifica a los usuarios admin cuando se crea una vacante de gestión:
 *   VACANTE_CORRECCION  → guardia quitado de turno publicado (planificación)
 *   VACANTE_POR_EVENTO  → guardia asignado a evento, turno original queda vacante
 *
 * Determina actionTarget según el turno del día:
 *   mañana antes de 19hs → PLANIFICACION  → VACANTE_PLANIFICACION (link /admin/planificacion)
 *   hoy o pasadas 19hs   → OPERACIONES    → VACANTE_OPERACIONES   (link /admin/operaciones)
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const HANDLED_ORIGINS = new Set(['VACANTE_CORRECCION', 'VACANTE_POR_EVENTO', 'VACANTE_POR_AUSENCIA']);

function resolveDateStr(data: Record<string, unknown>): string {
  if (typeof data.scheduleDate === 'string' && data.scheduleDate) return data.scheduleDate;
  // Fallback: extraer de startTime Timestamp
  const st = data.startTime as admin.firestore.Timestamp | null | undefined;
  if (st && typeof st.toDate === 'function') {
    const d = st.toDate();
    return d.toISOString().slice(0, 10);
  }
  return '';
}

function resolveActionTarget(scheduleDate: string): 'PLANIFICACION' | 'OPERACIONES' {
  if (!scheduleDate) return 'OPERACIONES';
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowH = new Date().getHours();
  const isTomorrow = scheduleDate > todayStr;
  return (isTomorrow && nowH < 19) ? 'PLANIFICACION' : 'OPERACIONES';
}

export const onVacanteCorrectionCreated = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('turnos/{turnoId}')
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const origin = String(data.origin || '');
    if (!HANDLED_ORIGINS.has(origin)) return;

    const empresaId = typeof data.empresaId === 'string' ? data.empresaId : null;
    if (!empresaId) return;

    const db = admin.firestore();

    const sysSnap = await db.collection('system_users')
      .where('empresaId', '==', empresaId)
      .get();

    if (sysSnap.empty) {
      console.warn(`[onVacanteCorrectionCreated] Sin system_users para empresa ${empresaId}`);
      return;
    }

    const scheduleDate = resolveDateStr(data);
    // Para VACANTE_CORRECCION el actionTarget ya viene en el doc; para VACANTE_POR_EVENTO lo calculamos
    const actionTarget: 'PLANIFICACION' | 'OPERACIONES' =
      origin === 'VACANTE_CORRECCION'
        ? (String(data.actionTarget || '') === 'PLANIFICACION' ? 'PLANIFICACION' : 'OPERACIONES')
        : resolveActionTarget(scheduleDate);

    const positionName    = String(data.positionName || '');
    const objectiveName   = String(data.objectiveName || '');
    const causedBy        = String(data.causedByEmployeeName || 'Guardia');
    const code            = String(data.code || '');
    const eventoNombre    = String(data.causedByEventoNombre || '');

    const slotDesc = `turno ${code} de ${causedBy}${positionName ? ` (${positionName})` : ''} del ${scheduleDate}`;

    const isPlan  = actionTarget === 'PLANIFICACION';
    const type    = isPlan ? 'VACANTE_PLANIFICACION' : 'VACANTE_OPERACIONES';

    let title: string;
    let body: string;

    if (origin === 'VACANTE_POR_EVENTO') {
      title = isPlan
        ? `Vacante por evento — ${objectiveName || 'puesto'}`
        : `⚠ Vacante urgente por evento — ${objectiveName || 'puesto'}`;
      body = isPlan
        ? `${causedBy} fue asignado al evento "${eventoNombre}". Queda vacante el ${slotDesc}. Requiere reasignación.`
        : `${causedBy} fue asignado al evento "${eventoNombre}". Queda vacante el ${slotDesc}. Cobertura operativa inmediata.`;
    } else if (origin === 'VACANTE_POR_AUSENCIA') {
      title = isPlan
        ? `Guardia ausente — vacante en ${objectiveName || 'puesto'}`
        : `⚠ Guardia ausente — cobertura urgente en ${objectiveName || 'puesto'}`;
      body = isPlan
        ? `${causedBy} no se presentó al ${slotDesc}. Requiere reasignación.`
        : `${causedBy} no se presentó al ${slotDesc}. Se necesita cobertura inmediata.`;
    } else {
      title = isPlan
        ? `Vacante en planificación — ${objectiveName || 'puesto'}`
        : `⚠ Vacante urgente — ${objectiveName || 'puesto'}`;
      body = isPlan
        ? `Se eliminó el ${slotDesc}. Requiere reasignación en planificación.`
        : `Se eliminó el ${slotDesc}. Requiere cobertura operativa inmediata.`;
    }

    const ts = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();

    for (const userDoc of sysSnap.docs) {
      const uid = String(userDoc.data()?.uid || userDoc.id);
      const notifRef = db.collection('user_notifications').doc();
      batch.set(notifRef, {
        uid,
        userId: uid,
        empresaId,
        type,
        title,
        body,
        read: false,
        createdAt: ts,
        relatedTurnoId: snap.id,
        data: {
          turnoId: snap.id,
          objectiveId: data.objectiveId || '',
          objectiveName,
          scheduleDate,
          code,
          positionName,
          actionTarget,
          origin,
          ...(eventoNombre && { eventoNombre }),
        },
      });
    }

    await batch.commit();
    console.log(
      `[onVacanteCorrectionCreated] ${sysSnap.size} notif ${type} (${origin}) empresa ${empresaId}`,
    );
  });
