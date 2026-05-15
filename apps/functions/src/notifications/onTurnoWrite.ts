import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

function formatDate(ts: any): string {
  if (!ts) return '';
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildMessage(type: string, after: any, before: any, turnoId: string): { title: string; body: string } | null {
  const dateStr = formatDate(after?.startTime || before?.startTime);
  const objective = (after || before)?.objectiveName || (after || before)?.clientName || '';
  const code = (after || before)?.code || '';
  const isFranco = code === 'F' || (after || before)?.isFranco;

  switch (type) {
    case 'TURNO_ELIMINADO':
      return {
        title: '❌ Turno eliminado',
        body: dateStr ? `${dateStr}${code && code !== 'F' ? ` · ${code}` : ''} — ${objective || 'tu cronograma'}` : 'Un turno fue eliminado de tu cronograma',
      };
    case 'FRANCO_ASIGNADO':
      return {
        title: '🟢 Franco asignado',
        body: dateStr ? `${dateStr} — día libre confirmado` : 'Se te asignó un día franco',
      };
    case 'TURNO_NUEVO':
      return {
        title: '📅 Nuevo turno asignado',
        body: dateStr ? `${dateStr}${code ? ` · ${code}` : ''} — ${objective}` : objective || 'Nuevo turno en tu cronograma',
      };
    case 'TURNO_MODIFICADO': {
      const changes: string[] = [];
      if (before && after) {
        if (JSON.stringify(before.startTime) !== JSON.stringify(after.startTime) ||
            JSON.stringify(before.endTime)   !== JSON.stringify(after.endTime)) {
          changes.push('horario cambiado');
        }
        if (before.code !== after.code) changes.push(`turno: ${before.code} → ${after.code}`);
        if (before.objectiveName !== after.objectiveName) changes.push(`objetivo: ${after.objectiveName}`);
        if (before.positionName !== after.positionName) changes.push(`puesto: ${after.positionName}`);
      }
      const detail = changes.length ? changes.join(', ') : (dateStr ? `${dateStr}${code ? ` · ${code}` : ''}` : '');
      return {
        title: '🔄 Cambio en tu cronograma',
        body: detail || objective || 'Tu cronograma fue modificado',
      };
    }
    default:
      return null;
  }
}

export const onTurnoWrite = functions
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .firestore.document('turnos/{turnoId}')
  .onWrite(async (change) => {
    const db = admin.firestore();
    const after  = change.after.exists  ? change.after.data()!  : null;
    const before = change.before.exists ? change.before.data()! : null;

    // No notificar turnos en borrador (se notificará cuando se publique)
    if (after?.draft === true) return;

    // Determinar tipo de evento
    let eventType: string;
    const employeeId: string = (after || before)?.employeeId;
    if (!employeeId) return;

    if (!after) {
      // Eliminación
      eventType = 'TURNO_ELIMINADO';
    } else if (!before) {
      // Creación
      const isFranco = after.code === 'F' || after.isFranco;
      eventType = isFranco ? 'FRANCO_ASIGNADO' : 'TURNO_NUEVO';
    } else {
      // Modificación — solo notificar si cambió algo relevante
      const relevantFields = ['startTime', 'endTime', 'code', 'objectiveName', 'clientName', 'positionName', 'isFranco'];
      const changed = relevantFields.some(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
      if (!changed) return;

      // Si se convirtió en franco
      const nowFranco = after.code === 'F' || after.isFranco;
      const wasFranco = before.code === 'F' || before.isFranco;
      eventType = (nowFranco && !wasFranco) ? 'FRANCO_ASIGNADO' : 'TURNO_MODIFICADO';
    }

    const msg = buildMessage(eventType, after, before, change.after.id || change.before.id);
    if (!msg) return;

    // Obtener uid del empleado
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    const empUid: string | undefined = empDoc.exists ? empDoc.data()?.uid : undefined;

    // Consultar tokens por ambos campos en paralelo para máxima cobertura
    const [byEmpId, byUid] = await Promise.all([
      db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
      empUid
        ? db.collection('device_tokens').where('uid', '==', empUid).get()
        : Promise.resolve({ docs: [] as any[] }),
    ]);

    const tokenSet = new Set<string>();
    [...byEmpId.docs, ...byUid.docs].forEach(d => {
      const t = d.data()?.token;
      if (typeof t === 'string' && t.length > 10) tokenSet.add(t);
    });
    const tokens = Array.from(tokenSet);

    const turnoId = change.after.id || change.before.id;

    // Guardar en user_notifications (siempre, con o sin tokens)
    let notifDocId: string | null = null;
    try {
      const notifRef = await db.collection('user_notifications').add({
        uid: empUid || null,
        employeeId,
        title: msg.title,
        body: msg.body,
        type: eventType,
        turnoId,
        read: false,
        readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      notifDocId = notifRef.id;
    } catch (e) {
      console.error('[onTurnoWrite] Error saving notification:', (e as Error)?.message);
    }

    if (!tokens.length) {
      console.warn('[onTurnoWrite] No tokens found for employee:', employeeId, 'uid:', empUid);
      return;
    }

    console.log('[onTurnoWrite] Sending push to', tokens.length, 'token(s) for employee:', employeeId);

    try {
      // Data-only message: onBackgroundMessage in SW controls display (avoids browser default text)
      const result = await admin.messaging().sendEachForMulticast({
        data: {
          turnoId,
          employeeId,
          type: eventType,
          title: msg.title,
          body: msg.body,
          notificationId: notifDocId || '',
          link: `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`,
        },
        webpush: {
          headers: { Urgency: 'high' },
          fcmOptions: { link: `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}` },
        },
        tokens,
      });
      console.log('[onTurnoWrite] FCM result: success=', result.successCount, 'fail=', result.failureCount);
      // Limpiar tokens inválidos
      const invalidTokens: string[] = [];
      result.responses.forEach((r, i) => {
        if (!r.success && (r.error?.code === 'messaging/registration-token-not-registered' || r.error?.code === 'messaging/invalid-registration-token')) {
          invalidTokens.push(tokens[i]);
        }
      });
      if (invalidTokens.length > 0) {
        const cleanSnap = await db.collection('device_tokens').where('token', 'in', invalidTokens).get();
        const batch = db.batch();
        cleanSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        console.log('[onTurnoWrite] Cleaned', invalidTokens.length, 'invalid token(s)');
      }
    } catch (e) {
      console.error('[onTurnoWrite] FCM error:', (e as Error)?.message);
    }
  });
