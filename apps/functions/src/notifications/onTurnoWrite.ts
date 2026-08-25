import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { ymCordobaParts, planificacionEstadoLookupDocIds } from '../assistant/planificacionEstadoKeys';
import { checkLlegadaTardeReiterada } from '../ausencias/llegadaTardeUtils';
import { updateLiquidacionOnTurnoComplete } from '../liquidacion/updateLiquidacionOnTurnoComplete';
import { enqueueShiftNotifDigest, type DigestEventType } from './shiftNotifDigest';

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

async function sendEmployeeTurnoPush(
  db: admin.firestore.Firestore,
  employeeId: string,
  msg: { title: string; body: string },
  type: string,
  turnoId: string,
): Promise<void> {
  if (!employeeId || employeeId === 'VACANTE') return;
  const empDoc = await db.collection('empleados').doc(employeeId).get();
  const empUid: string | undefined = empDoc.exists ? empDoc.data()?.uid : undefined;
  const [byEmpId, byUid] = await Promise.all([
    db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
    empUid ? db.collection('device_tokens').where('uid', '==', empUid).get() : Promise.resolve({ docs: [] as any[] }),
  ]);
  const tokenSet = new Set<string>();
  [...byEmpId.docs, ...byUid.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10) tokenSet.add(t); });
  await db.collection('user_notifications').add({
    uid: empUid || null, employeeId, title: msg.title, body: msg.body,
    type, target: 'employee', turnoId, read: false, readAt: null,
    requiresAck: true, ackedAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const tokens = Array.from(tokenSet);
  if (tokens.length) {
    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: msg.title, body: msg.body },
      data: {
        type,
        turnoId,
        employeeId,
        title: msg.title,
        body: msg.body,
        link: '/empleado/dashboard',
      },
      android: { priority: 'high' as const },
      webpush: { notification: { icon: '/icons/icon-192x192.png', requireInteraction: true }, fcmOptions: { link: '/empleado/dashboard' } },
    }).catch(e => console.warn('[onTurnoWrite] push error:', e));
  }
}

async function markSolicitudAsignada(
  db: admin.firestore.Firestore,
  solicitudId: string,
  turnoId: string,
  employeeId: string,
): Promise<void> {
  if (!solicitudId) return;
  try {
    await db.collection('solicitudes_refuerzo').doc(solicitudId).update({
      estado: 'ASIGNADA',
      turnoIds: admin.firestore.FieldValue.arrayUnion(turnoId),
      empleadoIds: admin.firestore.FieldValue.arrayUnion(employeeId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const novSnap = await db.collection('novedades')
      .where('solicitudRefuerzoId', '==', solicitudId)
      .where('type', '==', 'REFUERZO_CLIENTE_PENDIENTE')
      .where('status', '==', 'pending')
      .limit(5).get();
    if (!novSnap.empty) {
      const batch = db.batch();
      novSnap.docs.forEach(d => batch.update(d.ref, { status: 'read', viewed: true }));
      await batch.commit();
    }
  } catch (e) {
    console.warn('[onTurnoWrite] markSolicitudAsignada error:', e);
  }
}

function isEventoShift(turn: any): boolean {
  if (!turn) return false;
  const origin = String(turn.origin ?? '')
    .trim()
    .toUpperCase();
  const code = String(turn.code ?? '')
    .trim()
    .toUpperCase();
  return origin === 'EVENTO' || code === 'EV' || !!turn.eventoId;
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

    // Borrador de planificación: no notificar — excepto turnos EV (independientes del crono).
    if (after?.draft === true && !isEventoShift(after)) return;

    // Planificación: solo notificar si el objetivo/mes tiene publishedAt.
    // Tener doc en planificacion_estados NO alcanza (ahí también viven puestos sin publicar).
    // EV / operativos: siempre (no dependen de publishedAt).
    const turn = after || before;
    if (turn?.objectiveId) {
      const origin = String(turn.origin ?? '')
        .trim()
        .toUpperCase();
      const code = String(turn.code ?? '')
        .trim()
        .toUpperCase();
      const isOperational =
        origin === 'RETEN' ||
        origin === 'OPERATIONS_COVERAGE' ||
        origin === 'CLIENT_REQUEST' ||
        origin === 'EVENTO' ||
        turn.isReten === true ||
        String(turn.resolvedBy || '').toUpperCase() === 'OPERACIONES' ||
        code === 'EV' ||
        !!turn.eventoId;

      if (!isOperational) {
        const startMs: number =
          turn.startTime?.toMillis?.() ??
          (turn.startTime?.seconds ? turn.startTime.seconds * 1000 : 0);
        if (startMs) {
          const { year, month } = ymCordobaParts(new Date(startMs));
          const empId = String(turn.empresaId ?? '').trim();
          const docIds = planificacionEstadoLookupDocIds(empId, turn.objectiveId, year, month);
          const planDocs = await Promise.all(
            docIds.map((id) => db.doc(`planificacion_estados/${id}`).get()),
          );
          const published = planDocs.some((s) => {
            if (!s.exists) return false;
            const pub = s.data()?.publishedAt;
            return pub != null && pub !== '';
          });
          if (!published) {
            console.log(
              '[onTurnoWrite] Skip notify: cronograma no publicado',
              turn.objectiveId,
              `${month}/${year}`,
            );
            return;
          }
        } else {
          // Sin fecha no podemos validar mes → no spamear al portal
          return;
        }
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

    // ── Solicitud refuerzo: COMPLETADA cuando todos los turnos vinculados finalizaron ──
    if (after && before && !before.isCompleted && after.isCompleted === true) {
      const solicitudId: string | undefined = after.solicitudRefuerzoId;
      if (solicitudId) {
        try {
          const solDoc = await db.collection('solicitudes_refuerzo').doc(solicitudId).get();
          if (solDoc.exists) {
            const data = solDoc.data() || {};
            const turnoIds: string[] = Array.isArray(data.turnoIds) ? data.turnoIds : [];
            const idsToCheck = turnoIds.length > 0 ? turnoIds : [change.after.id];
            const snaps = await Promise.all(idsToCheck.map((id) => db.collection('turnos').doc(id).get()));
            const allDone = snaps.every((d) => d.exists && d.data()?.isCompleted === true);
            if (allDone && data.estado !== 'COMPLETADA') {
              await db.collection('solicitudes_refuerzo').doc(solicitudId).update({
                estado: 'COMPLETADA',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          }
        } catch (e) {
          console.warn('[onTurnoWrite] solicitud COMPLETADA error:', e);
        }
      }
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
        const sampleBody = `${dateStr}${position ? ' · ' + position : ''} — ${objective}${code ? ` · ${code}` : ''}`;
        const turnoIdR = change.after.id;
        await enqueueShiftNotifDigest(db, {
          employeeId: assignedEmployeeId,
          empresaId: after.empresaId || null,
          eventType: 'TURNO_NUEVO',
          sampleBody,
          turnoId: turnoIdR,
        });
        await markSolicitudAsignada(db, after.solicitudRefuerzoId, turnoIdR, assignedEmployeeId);
        return;
      }
    }

    // ── RFZ/TURA: republicación (draft true→false) ──────────────────────────
    // Sin push acá: la publicación masiva la cubre onCronogramaPublished;
    // cambios sueltos (VACANTE→empleado u otros campos) van al digest.
    if (after && before && rfzTuraCodes.has(String(after.code || '').toUpperCase())
        && before.draft === true && after.draft === false
        && after.employeeId && after.employeeId !== 'VACANTE') {
      await markSolicitudAsignada(db, after.solicitudRefuerzoId, change.after.id, after.employeeId);
      return;
    }

    // Determinar tipo de evento
    let eventType: DigestEventType;
    const employeeId: string = (after || before)?.employeeId;
    if (!employeeId) return;

    if (!after) {
      eventType = 'TURNO_ELIMINADO';
    } else if (!before) {
      if (after.draft === true && !isEventoShift(after)) return;
      const isFranco = after.code === 'F' || after.isFranco;
      eventType = isFranco ? 'FRANCO_ASIGNADO' : 'TURNO_NUEVO';
    } else {
      const relevantFields = ['startTime', 'endTime', 'code', 'objectiveName', 'clientName', 'positionName', 'isFranco'];
      const changed = relevantFields.some(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));

      // Publicación masiva: solo onCronogramaPublished
      if (before.draft === true && after.draft === false && !changed) return;

      if (!changed) return;

      const nowFranco = after.code === 'F' || after.isFranco;
      const wasFranco = before.code === 'F' || before.isFranco;
      eventType = (nowFranco && !wasFranco) ? 'FRANCO_ASIGNADO' : 'TURNO_MODIFICADO';
    }

    const msg = buildMessage(eventType, after, before, change.after.id || change.before.id);
    if (!msg) return;

    const turnoId = change.after.id || change.before.id;
    await enqueueShiftNotifDigest(db, {
      employeeId,
      empresaId: after?.empresaId || before?.empresaId || null,
      eventType,
      sampleBody: msg.body,
      turnoId,
    });
  });
