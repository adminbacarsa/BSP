import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { ymCordobaParts, planificacionEstadoLookupDocIds } from '../assistant/planificacionEstadoKeys';
import { checkLlegadaTardeReiterada } from '../ausencias/llegadaTardeUtils';
import { updateLiquidacionOnTurnoComplete } from '../liquidacion/updateLiquidacionOnTurnoComplete';

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

    try {
      await updateLiquidacionOnTurnoComplete(db, change.after.id, after, before);
    } catch (e) {
      console.warn('[onTurnoWrite] liquidacion incremental:', (e as Error)?.message);
    }

    // No notificar turnos en borrador (se notificará cuando se publique)
    if (after?.draft === true) return;

    // Turnos de planificación (SLA_VIRTUAL, PLANIFICADOR, sin origin): no notificar si el
    // cronograma del objetivo/mes no está publicado. RETEN y OPERATIONS_COVERAGE son
    // asignaciones operativas explícitas y siempre se notifican.
    const turn = after || before;
    const planningOrigins = new Set(['', 'PLANIFICADOR', 'SLA_VIRTUAL', undefined]);
    if (turn && planningOrigins.has(turn.origin) && turn.objectiveId) {
      const startMs: number = turn.startTime?.toMillis?.() ?? (turn.startTime?.seconds ? turn.startTime.seconds * 1000 : 0);
      if (startMs) {
        const { year, month } = ymCordobaParts(new Date(startMs));
        const empId = String(turn.empresaId ?? '').trim();
        const docIds = planificacionEstadoLookupDocIds(empId, turn.objectiveId, year, month);
        const planDocs = await Promise.all(docIds.map(id => db.doc(`planificacion_estados/${id}`).get()));
        if (!planDocs.some(s => s.exists)) return; // cronograma no publicado → no notificar
      }
    }

    // ── ABSENT → PRESENT: ausencia AA → "Llegada Tarde" automático ─────────────
    if (before && after && before.isAbsent === true && after.isPresent === true && !after.isAbsent) {
      const turnoId = change.after.id;
      try {
        const ausSnap = await db.collection('ausencias')
          .where('shiftId', '==', turnoId)
          .limit(5).get();
        const aaDoc = ausSnap.docs.find(d => d.data().absenceType === 'AA');
        if (aaDoc) {
          const ausData = aaDoc.data();
          const fmtT = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
          const st = after.startTime?.toDate ? after.startTime.toDate() : null;
          const et = after.endTime?.toDate ? after.endTime.toDate() : null;
          const horario = st ? (et ? `${fmtT(st)} - ${fmtT(et)}` : fmtT(st)) : '';

          // Hora real de llegada (checkInTime del turno)
          const checkInTs = after.checkInTime?.toDate ? after.checkInTime.toDate() : null;
          const checkInStr = checkInTs ? fmtT(checkInTs) : null;

          await aaDoc.ref.update({
            type: 'Llegada Tarde',
            absenceType: 'LT',             // actualizar absenceType para que la grilla muestre LT
            status: 'Confirmada',
            reason: `Llegada tarde al turno${horario ? ' ' + horario : ''} - ${after.objectiveName || ''} (${after.positionName || ''})`,
            arrivedAt: admin.firestore.FieldValue.serverTimestamp(),
            checkInTime: after.checkInTime || null,   // hora real de ingreso
            checkInTimeStr: checkInStr,               // string formateado para UI
          });
          console.log('[onTurnoWrite] Ausencia → Llegada Tarde para turno:', turnoId, 'ingresó:', checkInStr);

          // Verificar si acumula 3 tardanzas en el mes
          await checkLlegadaTardeReiterada(
            db,
            ausData.employeeId || after.employeeId || '',
            ausData.employeeName || after.employeeName || '',
            ausData.empresaId || after.empresaId || null,
            ausData.startDate || '',
          );
        }
      } catch (e) {
        console.warn('[onTurnoWrite] Error actualizando ausencia a Llegada Tarde:', e);
      }
      return; // no enviar push de "turno modificado" para este caso
    }

    // ── RETENCIÓN: isRetention false → true → push inmediato al guardia ────────
    if (after && before && !before.isRetention && after.isRetention === true) {
      const employeeId: string = after.employeeId;
      if (!employeeId) return;
      const objective = after.objectiveName || after.clientName || 'el puesto';
      const position = after.positionName || '';
      const retMsg = { title: '⏰ Quedaste retenido', body: `Permanecé en ${objective}${position ? ' · ' + position : ''} hasta nuevo aviso de Operaciones.` };
      const empDoc = await db.collection('empleados').doc(employeeId).get();
      const empUid: string | undefined = empDoc.exists ? empDoc.data()?.uid : undefined;
      const [byEmpId, byUid] = await Promise.all([
        db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
        empUid ? db.collection('device_tokens').where('uid', '==', empUid).get() : Promise.resolve({ docs: [] as any[] }),
      ]);
      const tokenSet = new Set<string>();
      [...byEmpId.docs, ...byUid.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10) tokenSet.add(t); });
      const tokens = Array.from(tokenSet);
      const turnoId = change.after.id;
      await db.collection('user_notifications').add({ uid: empUid || null, employeeId, title: retMsg.title, body: retMsg.body, type: 'RETENCION_AUTO', target: 'employee', turnoId, read: false, readAt: null, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      if (tokens.length) {
        await admin.messaging().sendEachForMulticast({ tokens, notification: { title: retMsg.title, body: retMsg.body }, webpush: { notification: { icon: '/icons/icon-192x192.png', requireInteraction: true }, fcmOptions: { link: '/empleado/dashboard' } } }).catch(e => console.warn('[onTurnoWrite] Retención push error:', e));
      }
      return; // ya procesamos, no seguir
    }

    // ── TURNO COMPLETADO AUTOMÁTICAMENTE → push al guardia ──────────────────
    // Se dispara cuando el sistema cierra el turno (completionReason: AUTO_SHIFT_END).
    // El guardia recibe una notificación de finalización en su app.
    if (after && before && !before.isCompleted && after.isCompleted === true &&
        (after.completionReason === 'AUTO_SHIFT_END' || after.completionReason === 'AUTO_SHIFT_END_CUSTOM' || after.completionReason === 'AUTO_END_CF_RETENTION_TIMEOUT' || after.completionReason === 'AUTO_COVERAGE_COMPLETE')) {
      const completedEmployeeId: string = after.employeeId;
      if (!completedEmployeeId) return;
      const objective = after.objectiveName || after.clientName || 'tu puesto';
      const fmtT = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
      const endDate = after.endTime?.toDate ? after.endTime.toDate() : null;
      const endStr = endDate ? fmtT(endDate) : '';
      const completedMsg = {
        title: '✅ Turno finalizado',
        body: endStr
          ? `Tu turno en ${objective} finalizó a las ${endStr}. ¡Hasta luego!`
          : `Tu turno en ${objective} ha concluido. ¡Hasta luego!`,
      };
      const empDocC = await db.collection('empleados').doc(completedEmployeeId).get();
      const empUidC: string | undefined = empDocC.exists ? empDocC.data()?.uid : undefined;
      const [byEmpIdC, byUidC] = await Promise.all([
        db.collection('device_tokens').where('employeeId', '==', completedEmployeeId).get(),
        empUidC ? db.collection('device_tokens').where('uid', '==', empUidC).get() : Promise.resolve({ docs: [] as any[] }),
      ]);
      const tokenSetC = new Set<string>();
      [...byEmpIdC.docs, ...byUidC.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10) tokenSetC.add(t); });
      const tokensC = Array.from(tokenSetC);
      const turnoIdC = change.after.id;
      await db.collection('user_notifications').add({
        uid: empUidC || null, employeeId: completedEmployeeId,
        title: completedMsg.title, body: completedMsg.body,
        type: 'TURNO_COMPLETADO', target: 'employee', turnoId: turnoIdC,
        read: false, readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (tokensC.length) {
        await admin.messaging().sendEachForMulticast({
          tokens: tokensC,
          notification: { title: completedMsg.title, body: completedMsg.body },
          webpush: { notification: { icon: '/icons/icon-192x192.png' }, fcmOptions: { link: '/empleado/dashboard' } },
        }).catch(e => console.warn('[onTurnoWrite] Completado push error:', e));
      }
      return;
    }

    // ── RFZ/TURA: asignación de empleado (VACANTE → empleado real) ──────────
    const rfzTuraCodes = new Set(['RFZ', 'TURA']);
    if (after && before && rfzTuraCodes.has(String(after.code || '').toUpperCase())) {
      const wasVacante = !before.employeeId || before.employeeId === 'VACANTE';
      const nowHasEmployee = after.employeeId && after.employeeId !== 'VACANTE';
      if (wasVacante && nowHasEmployee) {
        const assignedEmployeeId: string = after.employeeId;
        const objective = after.objectiveName || after.clientName || 'el objetivo';
        const position = after.positionName || '';
        const code = String(after.code || 'RFZ').toUpperCase();
        const dateStr = formatDate(after.startTime);
        const rfzMsg = {
          title: code === 'TURA' ? '📅 Turno Agregado asignado' : '📅 Refuerzo de cliente asignado',
          body: `${dateStr}${position ? ' · ' + position : ''} — ${objective}`,
        };
        const empDocR = await db.collection('empleados').doc(assignedEmployeeId).get();
        const empUidR: string | undefined = empDocR.exists ? empDocR.data()?.uid : undefined;
        const [byEmpIdR, byUidR] = await Promise.all([
          db.collection('device_tokens').where('employeeId', '==', assignedEmployeeId).get(),
          empUidR ? db.collection('device_tokens').where('uid', '==', empUidR).get() : Promise.resolve({ docs: [] as any[] }),
        ]);
        const tokenSetR = new Set<string>();
        [...byEmpIdR.docs, ...byUidR.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10) tokenSetR.add(t); });
        const tokensR = Array.from(tokenSetR);
        const turnoIdR = change.after.id;
        await db.collection('user_notifications').add({
          uid: empUidR || null,
          employeeId: assignedEmployeeId,
          title: rfzMsg.title,
          body: rfzMsg.body,
          type: 'TURNO_NUEVO',
          target: 'employee',
          turnoId: turnoIdR,
          read: false,
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (tokensR.length) {
          await admin.messaging().sendEachForMulticast({
            tokens: tokensR,
            notification: { title: rfzMsg.title, body: rfzMsg.body },
            webpush: { notification: { icon: '/icons/icon-192x192.png', requireInteraction: true }, fcmOptions: { link: '/empleado/dashboard' } },
          }).catch(e => console.warn('[onTurnoWrite] RFZ/TURA push error:', e));
        }
        return;
      }
    }

    // Determinar tipo de evento
    let eventType: string;
    const employeeId: string = (after || before)?.employeeId;
    if (!employeeId) return;

    if (!after) {
      // Eliminación
      eventType = 'TURNO_ELIMINADO';
    } else if (!before) {
      // Creación directa (no draft) — puede ser un turno operativo (retén, cobertura)
      // Si viene con draft:true, no hacer nada (se notificará vía onCronogramaPublished al publicar)
      if (after.draft === true) return;
      const isFranco = after.code === 'F' || after.isFranco;
      eventType = isFranco ? 'FRANCO_ASIGNADO' : 'TURNO_NUEVO';
    } else {
      // Modificación — solo notificar si cambió algo relevante
      const relevantFields = ['startTime', 'endTime', 'code', 'objectiveName', 'clientName', 'positionName', 'isFranco'];
      const changed = relevantFields.some(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));

      // Silenciar: publicación masiva (draft:true → draft:false sin otros cambios)
      // La notificación consolidada la envía onCronogramaPublished
      if (before.draft === true && after.draft === false && !changed) return;

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
        target: 'employee',
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
