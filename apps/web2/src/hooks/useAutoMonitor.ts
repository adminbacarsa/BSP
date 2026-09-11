import { useEffect, useRef } from 'react';
import { collection, query, where, addDoc, setDoc, updateDoc, doc, getDoc, getDocs, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { toast } from 'sonner';
import { stampEmpresaId } from '@/lib/multiempresa';

export interface AutoMonitorProps {
  isActive: boolean;
  /**
   * Pipeline rutinario: cierres, retención T+0, autorelevo.
   * Demo + Auto + Manual asistido.
   */
  pipelineRoutine: boolean;
  /**
   * Automatismos de decisión: novedades LLEGADA_TARDE, FCM, etc.
   * Solo Demo + Auto (no Manual).
   */
  fullAuto: boolean;
  empresaId: string;
  activeOperatorId: string | null;
  processedData: any[];
}

const sendBrowserNotif = (title: string, body: string) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/icons/icon-192x192.png' }); } catch {}
  }
};

const createNovedad = (type: string, title: string, description: string, shiftData: any, empresaId: string) =>
  addDoc(collection(db, 'novedades'), stampEmpresaId({
    type,
    status: 'pending',
    title,
    description,
    shiftId: shiftData.id || null,
    clientId: shiftData.clientId || null,
    objectiveId: shiftData.objectiveId || null,
    objectiveName: shiftData.objectiveName || null,
    employeeId: shiftData.employeeId || null,
    employeeName: shiftData.employeeName || null,
    positionName: shiftData.positionName || null,
    createdAt: serverTimestamp(),
    reportedBy: 'SISTEMA_AUTO',
  }, String(shiftData.empresaId || empresaId || '').trim())).catch(() => {});

export const useAutoMonitor = ({
  isActive,
  pipelineRoutine,
  fullAuto,
  empresaId,
  activeOperatorId,
  processedData,
}: AutoMonitorProps) => {
  const mountTime = useRef(Date.now());
  const processedIds = useRef(new Set<string>());
  // Primera ejecución = baseline silencioso: marca el estado actual como ya visto
  // para evitar toasts de eventos pre-existentes al abrir/recargar el navegador.
  const isBaselineRef = useRef(true);

  // — Detecta ingresos desde el portal del empleado (status PRESENT) —
  useEffect(() => {
    if (!isActive || !empresaId) return;

    const startWindow = new Date();
    startWindow.setDate(startWindow.getDate() - 1);

    // Índice compuesto: empresaId ASC, status ASC, startTime ASC
    const q = query(
      collection(db, 'turnos'),
      where('empresaId', '==', empresaId),
      where('status', '==', 'PRESENT'),
      where('startTime', '>=', Timestamp.fromDate(startWindow)),
    );

    const unsub = onSnapshotFresh(q, snap => {
      snap.docChanges().forEach(async change => {
        if (change.type !== 'modified' && change.type !== 'added') return;
        const data = change.doc.data();
        const shiftId = change.doc.id;

        if (processedIds.current.has(`checkin_${shiftId}`)) return;
        if (data.isManualRecord || data.processedBy) return;
        // Demo auto-presencia: no alertar como ingreso portal
        if (data.autoPresencia || data.modoDemoAt) return;
        const checkInTs =
          data.checkInTime?.toDate?.()?.getTime() ||
          data.presentAt?.toDate?.()?.getTime() ||
          data.realStartTime?.toDate?.()?.getTime() ||
          0;
        if (!checkInTs || checkInTs < mountTime.current) return;

        processedIds.current.add(`checkin_${shiftId}`);

        const empName = data.employeeName || 'Guardia';
        const objName = data.objectiveName || 'Objetivo';

        if (fullAuto) {
          await createNovedad(
            'INGRESO_AUTOREGISTRO',
            'Ingreso por Autoregistro',
            `${empName} marcó ingreso en ${objName} vía portal`,
            { id: shiftId, ...data }, empresaId
          );
          toast.info(`🤖 AUTO: ${empName} ingresó en ${objName}`, { duration: 8000 });
          sendBrowserNotif('Ingreso Automático', `${empName} → ${objName}`);
        } else {
          toast.warning(`⚡ Portal: ${empName} marcó ingreso en ${objName}`, {
            duration: 12000,
            description: 'Verificar relevo en curso',
          });
          sendBrowserNotif('⚡ Ingreso por Portal', `${empName} → ${objName} — Confirmar relevo`);
          if (activeOperatorId) {
            addDoc(collection(db, 'user_notifications'), {
              uid: activeOperatorId,
              title: '⚡ Ingreso Portal',
              body: `${empName} marcó presencia en ${objName}`,
              read: false,
              createdAt: serverTimestamp(),
              type: 'OPERACIONES_ALERT',
              data: { shiftId, objectiveName: objName },
            }).catch(() => {});
          }
        }
      });
    });

    return () => unsub();
  }, [isActive, fullAuto, empresaId, activeOperatorId]);

  // — Timer: guardias tardíos y retenciones (corre cada 3 min) —
  useEffect(() => {
    if (!isActive || !processedData.length) return;

    const check = async () => {
      const now = new Date();
      const isBaseline = isBaselineRef.current;
      isBaselineRef.current = false;

      const lateGuards = processedData.filter(s => {
        if (s.isPresent || s.isCompleted || s.isAbsent || s.isUnassigned || s.isFranco) return false;
        if (processedIds.current.has(`late_${s.id}`)) return false;
        const diff = (now.getTime() - (s.shiftDateObj?.getTime() || 0)) / 60000;
        return diff > 5 && diff < 60;
      });

      for (const s of lateGuards) {
        processedIds.current.add(`late_${s.id}`);
        if (fullAuto) {
          const msg = `${s.employeeName} — ${s.objectiveName}`;
          const existing = await getDocs(query(collection(db, 'novedades'),
            where('shiftId', '==', s.id), where('type', '==', 'LLEGADA_TARDE'), limit(1)));
          if (existing.empty) {
            await createNovedad('LLEGADA_TARDE', 'Llegada Tarde',
              `${msg} llegó tarde al turno`, s, empresaId);
          }
          if (s.employeeId) {
            const existingNotif = await getDocs(query(
              collection(db, 'user_notifications'),
              where('shiftId', '==', s.id),
              where('type', '==', 'SOLICITUD_ESTADO_LLEGADA'),
              limit(1)
            ));
            if (existingNotif.empty) {
              addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                uid: s.employeeId, userId: s.employeeId,
                type: 'SOLICITUD_ESTADO_LLEGADA',
                title: '¿Estás en camino?',
                body: `Tu turno en ${s.objectiveName || ''} comenzó hace varios minutos y no registraste presencia. ¿Llegás tarde o no podés presentarte?`,
                read: false, createdAt: serverTimestamp(),
                shiftId: s.id,
                data: { shiftId: s.id, objectiveId: s.objectiveId, objectiveName: s.objectiveName },
              }, empresaId)).catch(() => {});
            }
          }
        }
      }

      if (!isBaseline && lateGuards.length > 0) {
        if (lateGuards.length === 1) {
          const s = lateGuards[0];
          const msg = `${s.employeeName} — ${s.objectiveName}`;
          if (fullAuto) {
            toast.warning(`⏰ Llegada tarde: ${msg}`, { duration: 8000 });
          } else {
            toast.warning(`⏰ No llegó: ${msg}`, {
              duration: 15000,
              description: 'Ir al tab AUSENTES para gestionar cobertura',
            });
          }
          sendBrowserNotif('⚠️ Guardia no presente', msg);
        } else {
          const objectives = [...new Set(lateGuards.map(s => s.objectiveName).filter(Boolean))];
          const objSummary = objectives.slice(0, 2).join(', ') + (objectives.length > 2 ? ` y ${objectives.length - 2} más` : '');
          if (fullAuto) {
            toast.warning(`🤖 AUTO: ${lateGuards.length} ausencias detectadas`, {
              duration: 10000,
              description: objSummary,
            });
          } else {
            toast.error(`⚠️ ${lateGuards.length} guardias no se presentaron`, {
              duration: 20000,
              description: `Objetivos: ${objSummary} — Ver tab AUSENTES`,
            });
          }
          sendBrowserNotif(
            `⚠️ ${lateGuards.length} guardias no presentes`,
            `Objetivos afectados: ${objSummary}`
          );
        }
      }

      // ── Auto-relevo ──
      const byPost = new Map<string, { incoming: any[]; outgoing: any[] }>();
      for (const s of processedData) {
        if (s.isFranco || s.isUnassigned || s.isCompleted || !s.isPresent) continue;
        const key = `${s.objectiveId}||${String(s.positionName || '').trim().toLowerCase()}`;
        if (!byPost.has(key)) byPost.set(key, { incoming: [], outgoing: [] });
        const post = byPost.get(key)!;
        const endMs = s.endDateObj?.getTime() || 0;
        if (endMs > 0 && endMs <= now.getTime() + 30 * 60 * 1000) {
          post.outgoing.push(s);
        } else {
          post.incoming.push(s);
        }
      }
      for (const [, { incoming, outgoing }] of byPost) {
        if (incoming.length === 0 || outgoing.length === 0) continue;
        outgoing.sort((a, b) => (a.arrivedAt?.seconds || 0) - (b.arrivedAt?.seconds || 0));
        for (const s of outgoing) {
          if (processedIds.current.has(`autorelevo_${s.id}`)) continue;
          processedIds.current.add(`autorelevo_${s.id}`);
          if (pipelineRoutine) {
            try {
              await updateDoc(doc(db, 'turnos', s.id), {
                isCompleted: true, status: 'COMPLETED',
                realEndTime: serverTimestamp(), autoCompletedAt: serverTimestamp(),
                completionReason: 'AUTO_RELEVO', isRetention: false,
              });
              if (s.employeeId) {
                await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                  uid: s.employeeId, userId: s.employeeId,
                  type: 'RELEVO', title: 'Tu relevo llegó — turno finalizado',
                  body: `Tu turno en ${s.objectiveName || ''} terminó. Tu relevo está en el puesto.`,
                  read: false, createdAt: serverTimestamp(),
                }, empresaId));
              }
              toast.success(`🤖 Relevo: ${s.employeeName} relevado en ${s.objectiveName}`, { duration: 6000 });
              sendBrowserNotif('Relevo completado', `${s.employeeName} → ${s.objectiveName}`);
            } catch (e) { console.error('[autorelevo]', e); }
          } else if (!isBaseline) {
            toast.info(`↔️ Relevo listo: ${s.employeeName} puede ser relevado en ${s.objectiveName}`, { duration: 10000 });
          }
        }
      }

      // ── RETENCIÓN T+0 (solo pipeline rutinario: Demo / Auto / Manual asistido) ──
      const newlyRetained = processedData.filter(s => {
        if (!s.isPresent || s.isCompleted || s.isFranco || s.isUnassigned) return false;
        if (processedIds.current.has(`retention_set_${s.id}`)) return false;
        if (s.isCustomPost) return false;
        const retentionByTime = s.endDateObj && (new Date()).getTime() > s.endDateObj.getTime();
        if (!retentionByTime || s.isRetention) return false;
        const hasContinuity = processedData.some(other =>
          other.id !== s.id &&
          other.objectiveId === s.objectiveId &&
          String(other.positionName || '').trim().toLowerCase() === String(s.positionName || '').trim().toLowerCase() &&
          !other.isCompleted &&
          (other.shiftDateObj?.getTime() || 0) >= (s.endDateObj?.getTime() || 0) - 15 * 60 * 1000
        );
        return hasContinuity;
      });
      for (const s of newlyRetained) {
        processedIds.current.add(`retention_set_${s.id}`);
        if (pipelineRoutine) {
          updateDoc(doc(db, 'turnos', s.id), {
            isRetention: true,
            retentionReason: 'FIN_TURNO_SIN_RELEVO',
            autoRetentionAt: serverTimestamp(),
          }).catch(e => console.warn('[retention T+0]', e));

          if (fullAuto) {
            const nextShift = processedData.find(other =>
              other.id !== s.id &&
              other.objectiveId === s.objectiveId &&
              String(other.positionName || '').trim().toLowerCase() === String(s.positionName || '').trim().toLowerCase() &&
              !other.isCompleted && !other.isPresent &&
              (other.shiftDateObj?.getTime() || 0) >= (s.endDateObj?.getTime() || 0) - 15 * 60 * 1000
            );
            if (nextShift?.employeeId) {
              addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                uid: nextShift.employeeId, userId: nextShift.employeeId,
                type: 'SOLICITUD_ESTADO_RELEVO',
                title: '¿Llegás a tu turno?',
                body: `Hay un guardia esperando tu relevo en ${s.objectiveName || ''}. ¿Llegás tarde o no podés venir? Avisá para coordinar cobertura.`,
                read: false, createdAt: serverTimestamp(),
                data: { shiftId: nextShift.id, objectiveId: nextShift.objectiveId },
              }, empresaId)).catch(() => {});
            }
          }
        } else if (!isBaseline) {
          toast.info(`⏱️ Retención: ${s.employeeName} — confirmar en UI`, { duration: 12000 });
        }
      }

      const retentions = processedData.filter(s => {
        if (!s.isRetention) return false;
        if (s.isCustomPost && !s.manualRetentionType) return false;
        if (processedIds.current.has(`retention_${s.id}`)) return false;
        return s.retentionMinutes > 30;
      });

      for (const s of retentions) {
        processedIds.current.add(`retention_${s.id}`);
        const msg = `${s.employeeName} lleva ${s.retentionMinutes}min de retención en ${s.objectiveName}`;
        if (fullAuto) {
          const safeId = (s.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
          const novedadRef = doc(db, 'novedades', `autoreten_${safeId}`);
          const existing = await getDoc(novedadRef).catch(() => null);
          if (!existing?.exists()) {
            await setDoc(novedadRef, stampEmpresaId({
              type: 'RETENCION_DETECTADA',
              status: 'pending',
              title: 'Recargo Automático Detectado',
              description: msg,
              shiftId: s.id || null,
              clientId: s.clientId || null,
              objectiveId: s.objectiveId || null,
              objectiveName: s.objectiveName || null,
              employeeId: s.employeeId || null,
              employeeName: s.employeeName || null,
              positionName: s.positionName || null,
              createdAt: serverTimestamp(),
              reportedBy: 'SISTEMA_AUTO',
            }, String(s.empresaId || empresaId || '').trim()), { merge: false }).catch(() => {});
          }
        }
      }
      if (!isBaseline) {
        if (retentions.length === 1) {
          const s = retentions[0];
          const msg = `${s.employeeName} lleva ${s.retentionMinutes}min en ${s.objectiveName}`;
          toast.warning(`⏰ Recargo: ${msg}`, { duration: 10000 });
          sendBrowserNotif('⏰ Guardia en Recargo', msg);
        } else if (retentions.length > 1) {
          toast.warning(`⏰ ${retentions.length} guardias en retención`, {
            duration: 10000,
            description: retentions.map(s => s.employeeName).slice(0, 3).join(', ') + (retentions.length > 3 ? '...' : ''),
          });
          sendBrowserNotif('⏰ Guardias en Retención', `${retentions.length} guardias superaron 30 min`);
        }
      }

      // ── Auto-finalización ──
      const toComplete = processedData.filter(s => {
        if (s.isCompleted || s.status === 'COMPLETED' || s.status === 'INTERRUPTED') return false;
        if (!(s.isPresent || s.status === 'PRESENT')) return false;
        if (s.isFranco || s.isUnassigned) return false;
        const isOperatorRetention = s.isRetentionByField && !!s.manualRetentionType;
        if (s.isRetention && s.manualRetentionType !== 'extended' && !(s.isCustomPost && !isOperatorRetention)) return false;
        if (processedIds.current.has(`autocomplete_${s.id}`)) return false;
        const endMs = s.endDateObj?.getTime?.() || 0;
        return endMs > 0 && (now.getTime() - endMs) > 2 * 60 * 1000;
      });

      for (const s of toComplete) {
        processedIds.current.add(`autocomplete_${s.id}`);
        const msg = `${s.employeeName} — ${s.objectiveName}`;
        if (pipelineRoutine) {
          try {
            const turnoSnap = await getDoc(doc(db, 'turnos', s.id));
            const freshData = turnoSnap.data();
            const naturalRetention = freshData?.isRetention && freshData?.manualRetentionType !== 'extended';
            if (turnoSnap.exists() && (freshData?.isCompleted || naturalRetention)) {
              continue;
            }
            const lastAutoComplete = freshData?.autoCompletedAt?.toMillis?.() ?? 0;
            if (lastAutoComplete && (Date.now() - lastAutoComplete) < 120_000) {
              continue;
            }
            await updateDoc(doc(db, 'turnos', s.id), {
              status: 'COMPLETED', isCompleted: true,
              realEndTime: serverTimestamp(), autoCompletedAt: serverTimestamp(),
              completionReason: s.manualRetentionType === 'extended' ? 'AUTO_MANUAL_RETENTION_END' : 'AUTO_SHIFT_END',
            });
            const safeId = (s.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
            const novedadRef = doc(db, 'novedades', `autocompletar_${safeId}`);
            const existingNov = await getDoc(novedadRef).catch(() => null);
            if (!existingNov?.exists()) {
              await setDoc(novedadRef, stampEmpresaId({
                type: 'TURNO_COMPLETADO_AUTO',
                status: 'ATENDIDA',
                title: 'Turno Completado (Auto)',
                description: `Finalización automática al vencimiento del horario: ${msg}`,
                shiftId: s.id || null,
                clientId: s.clientId || null,
                objectiveId: s.objectiveId || null,
                objectiveName: s.objectiveName || null,
                employeeId: s.employeeId || null,
                employeeName: s.employeeName || null,
                positionName: s.positionName || null,
                createdAt: serverTimestamp(),
                atendidaAt: serverTimestamp(),
                atendidaPor: 'SISTEMA_AUTO',
                autoAttended: true,
                reportedBy: 'SISTEMA_AUTO',
              }, String(s.empresaId || empresaId || '').trim()), { merge: false }).catch(() => {});
            }
            toast.success(`🤖 Turno finalizado: ${msg}`, { duration: 6000 });
            sendBrowserNotif('Turno Completado', msg);
          } catch (e) {
            console.error('[autoComplete] Error al finalizar turno:', s.id, e);
          }
        } else if (!isBaseline) {
          toast.info(`⏱️ Finalizar turno: ${msg}`, {
            duration: 20000,
            description: 'El horario de fin ya pasó. Confirmar salida manualmente.',
          });
          sendBrowserNotif('⏱️ Turno a finalizar', msg);
        }
      }

      const over12h = processedData.filter(s => {
        if (!s.isPresent || s.isCompleted || s.isFranco || s.isUnassigned) return false;
        if (processedIds.current.has(`over12h_${s.id}`)) return false;
        return (s.totalMinutesWorked ?? 0) >= 12 * 60;
      });
      for (const s of over12h) {
        processedIds.current.add(`over12h_${s.id}`);
        const hrs = ((s.totalMinutesWorked ?? 0) / 60).toFixed(1);
        const msg = `${s.employeeName} lleva ${hrs}h en ${s.objectiveName} — ${s.positionName}`;
        if (fullAuto) {
          const safeId = (s.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
          const novedadRef = doc(db, 'novedades', `autorecargo_${safeId}`);
          const existing = await getDoc(novedadRef).catch(() => null);
          if (!existing?.exists()) {
            await setDoc(novedadRef, stampEmpresaId({
              type: 'RECARGO_12H',
              status: 'pending',
              title: 'Guardia más de 12h en servicio',
              description: msg,
              shiftId: s.id || null,
              clientId: s.clientId || null,
              objectiveId: s.objectiveId || null,
              objectiveName: s.objectiveName || null,
              employeeId: s.employeeId || null,
              employeeName: s.employeeName || null,
              positionName: s.positionName || null,
              createdAt: serverTimestamp(),
              reportedBy: 'SISTEMA_AUTO',
            }, String(s.empresaId || empresaId || '').trim()), { merge: false }).catch(() => {});
          }
        }
        if (!isBaseline) {
          toast.error(`🚨 +12h: ${msg}`, {
            duration: 30000,
            description: 'Relevar urgente. Riesgo laboral y de seguridad.',
          });
          sendBrowserNotif('🚨 Guardia +12h en servicio', msg);
        }
      }
    };

    check();
    const interval = setInterval(check, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [processedData, pipelineRoutine, fullAuto, isActive, empresaId]);
};
