import { useEffect, useRef } from 'react';
import { collection, query, where, addDoc, updateDoc, doc, getDoc, getDocs, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { toast } from 'sonner';
import { stampEmpresaId } from '@/lib/multiempresa';

export interface AutoMonitorProps {
  isActive: boolean;
  isAutoMode: boolean;
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

export const useAutoMonitor = ({ isActive, isAutoMode, empresaId, activeOperatorId, processedData }: AutoMonitorProps) => {
  const mountTime = useRef(Date.now());
  const processedIds = useRef(new Set<string>());
  // Primera ejecución = baseline silencioso: marca el estado actual como ya visto
  // para evitar toasts de eventos pre-existentes al abrir/recargar el navegador.
  const isBaselineRef = useRef(true);

  // — Detecta ingresos desde el portal del empleado (status → 'InProgress') —
  useEffect(() => {
    if (!isActive || !empresaId) return;

    const startWindow = new Date();
    startWindow.setDate(startWindow.getDate() - 1);

    // Índice compuesto requerido: empresaId ASC, status ASC, startTime ASC
    const q = query(
      collection(db, 'turnos'),
      where('empresaId', '==', empresaId),
      where('status', '==', 'InProgress'),
      where('startTime', '>=', Timestamp.fromDate(startWindow)),
    );

    const unsub = onSnapshotFresh(q, snap => {
      snap.docChanges().forEach(async change => {
        if (change.type !== 'modified' && change.type !== 'added') return;
        const data = change.doc.data();
        const shiftId = change.doc.id;

        // Ignorar si ya procesado, si fue ingreso manual por operador, o si es evento previo al montaje
        if (processedIds.current.has(`checkin_${shiftId}`)) return;
        if (data.isManualRecord || data.processedBy) return;
        const checkInTs = data.checkInTime?.toDate?.()?.getTime() || 0;
        if (checkInTs < mountTime.current) return;

        processedIds.current.add(`checkin_${shiftId}`);

        const empName = data.employeeName || 'Guardia';
        const objName = data.objectiveName || 'Objetivo';

        if (isAutoMode) {
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
  }, [isActive, isAutoMode, empresaId, activeOperatorId]);

  // — Timer: guardias tardíos y retenciones (corre cada 3 min) —
  useEffect(() => {
    if (!isActive || !processedData.length) return;

    const check = async () => {
      const now = new Date();
      // Baseline: primera llamada sólo popula processedIds, no tostea ni notifica
      const isBaseline = isBaselineRef.current;
      isBaselineRef.current = false;

      // Guardias tarde: T+5 a T+60 (ventana donde puede marcar llegada tarde)
      const lateGuards = processedData.filter(s => {
        if (s.isPresent || s.isCompleted || s.isAbsent || s.isUnassigned || s.isFranco) return false;
        if (processedIds.current.has(`late_${s.id}`)) return false;
        const diff = (now.getTime() - (s.shiftDateObj?.getTime() || 0)) / 60000;
        return diff > 5 && diff < 60;
      });

      for (const s of lateGuards) {
        processedIds.current.add(`late_${s.id}`);
        if (isAutoMode) {
          const msg = `${s.employeeName} — ${s.objectiveName}`;
          // Dedup: evitar duplicados entre tabs o re-renders
          const existing = await getDocs(query(collection(db, 'novedades'),
            where('shiftId', '==', s.id), where('type', '==', 'LLEGADA_TARDE'), limit(1)));
          if (existing.empty) {
            await createNovedad('LLEGADA_TARDE', 'Llegada Tarde',
              `${msg} llegó tarde al turno`, s, empresaId);
          }
        }
      }

      // Toast consolidado — un solo aviso para todos los tardíos del batch
      if (!isBaseline && lateGuards.length > 0) {
        if (lateGuards.length === 1) {
          const s = lateGuards[0];
          const msg = `${s.employeeName} — ${s.objectiveName}`;
          if (isAutoMode) {
            toast.warning(`⏰ Llegada tarde: ${msg}`, { duration: 8000 });
          } else {
            toast.warning(`⏰ No llegó: ${msg}`, {
              duration: 15000,
              description: 'Ir al tab AUSENTES para gestionar cobertura',
            });
          }
          sendBrowserNotif('⚠️ Guardia no presente', msg);
        } else {
          // Múltiples ausentes: un solo toast consolidado
          const objectives = [...new Set(lateGuards.map(s => s.objectiveName).filter(Boolean))];
          const objSummary = objectives.slice(0, 2).join(', ') + (objectives.length > 2 ? ` y ${objectives.length - 2} más` : '');
          if (isAutoMode) {
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

      // ── Auto-relevo: cierre automático cuando el entrante ya está presente ──
      // Agrupa por objetivo + puesto; si hay entrante presente y saliente activo → cierra saliente
      const byPost = new Map<string, { incoming: any[]; outgoing: any[] }>();
      for (const s of processedData) {
        if (s.isFranco || s.isUnassigned || s.isCompleted || !s.isPresent) continue;
        const key = `${s.objectiveId}||${String(s.positionName || '').trim().toLowerCase()}`;
        if (!byPost.has(key)) byPost.set(key, { incoming: [], outgoing: [] });
        const post = byPost.get(key)!;
        const endMs = s.endDateObj?.getTime() || 0;
        // Saliente: turno cuyo fin ya pasó o termina en ≤30 min y hay alguien más presente
        if (endMs > 0 && endMs <= now.getTime() + 30 * 60 * 1000) {
          post.outgoing.push(s);
        } else {
          post.incoming.push(s);
        }
      }
      for (const [, { incoming, outgoing }] of byPost) {
        if (incoming.length === 0 || outgoing.length === 0) continue;
        // Relevar de más antiguo a más nuevo (por orden de llegada)
        outgoing.sort((a, b) => (a.arrivedAt?.seconds || 0) - (b.arrivedAt?.seconds || 0));
        for (const s of outgoing) {
          if (processedIds.current.has(`autorelevo_${s.id}`)) continue;
          processedIds.current.add(`autorelevo_${s.id}`);
          if (isAutoMode) {
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

      // ── RETENCIÓN T+0: guardia presente cuyo turno acaba de terminar ──────────
      // Escribe isRetention:true a Firestore inmediatamente → dispara onTurnoWrite → push al guardia
      // Solo si hay continuidad planificada en el mismo puesto (turno sin continuidad se auto-cierra)
      const newlyRetained = processedData.filter(s => {
        if (!s.isPresent || s.isCompleted || s.isFranco || s.isUnassigned) return false;
        if (processedIds.current.has(`retention_set_${s.id}`)) return false;
        // Puestos custom: no marcar isRetention — se auto-cierran al terminar el turno
        if (s.isCustomPost) return false;
        // isRetention computado (por tiempo) pero aún no guardado en Firestore
        const retentionByTime = s.endDateObj && (new Date()).getTime() > s.endDateObj.getTime();
        if (!retentionByTime || s.isRetention) return false;
        // Sin continuidad: no retener — dejar que auto-completion cierre a los 2 min
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
        updateDoc(doc(db, 'turnos', s.id), {
          isRetention: true,
          retentionReason: 'FIN_TURNO_SIN_RELEVO',
          autoRetentionAt: serverTimestamp(),
        }).catch(e => console.warn('[retention T+0]', e));

        // Notificar al entrante: ¿llegás tarde o no venís?
        if (isAutoMode) {
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
      }

      // Guardias en retención > 30 min (solo puestos 24h — los custom se auto-cierran)
      const retentions = processedData.filter(s => {
        if (!s.isRetention) return false;
        if (s.isCustomPost && !s.manualRetentionType) return false; // custom sin retención manual → no alertar
        if (processedIds.current.has(`retention_${s.id}`)) return false;
        return s.retentionMinutes > 30;
      });

      for (const s of retentions) {
        processedIds.current.add(`retention_${s.id}`);
        const msg = `${s.employeeName} lleva ${s.retentionMinutes}min de retención en ${s.objectiveName}`;
        if (isAutoMode) {
          // Dedup: no crear novedad si ya existe una RETENCION_DETECTADA para este turno
          const existingReten = await getDocs(query(
            collection(db, 'novedades'),
            where('shiftId', '==', s.id),
            where('type', '==', 'RETENCION_DETECTADA'),
            limit(1)
          ));
          if (existingReten.empty) {
            await createNovedad('RETENCION_DETECTADA', 'Recargo Automático Detectado', msg, s, empresaId);
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

      // ── Auto-finalización: turnos PRESENT cuyo endTime ya pasó ──
      const toComplete = processedData.filter(s => {
        if (s.isCompleted || s.status === 'COMPLETED' || s.status === 'INTERRUPTED') return false;
        if (!(s.isPresent || s.status === 'PRESENT')) return false;
        if (s.isFranco || s.isUnassigned) return false;
        // No auto-completar retenciones naturales — sí las retenciones manuales con tiempo fijo (manualRetentionType='extended')
        // Excepción: puestos custom sin retención manual del operador se auto-cierran siempre
        const isOperatorRetention = s.isRetentionByField && !!s.manualRetentionType;
        if (s.isRetention && s.manualRetentionType !== 'extended' && !(s.isCustomPost && !isOperatorRetention)) return false;
        if (processedIds.current.has(`autocomplete_${s.id}`)) return false;
        const endMs = s.endDateObj?.getTime?.() || 0;
        return endMs > 0 && (now.getTime() - endMs) > 2 * 60 * 1000;
      });

      for (const s of toComplete) {
        processedIds.current.add(`autocomplete_${s.id}`);
        const msg = `${s.employeeName} — ${s.objectiveName}`;
        if (isAutoMode) {
          try {
            const turnoSnap = await getDoc(doc(db, 'turnos', s.id));
            const freshData = turnoSnap.data();
            const naturalRetention = freshData?.isRetention && freshData?.manualRetentionType !== 'extended';
            if (turnoSnap.exists() && (freshData?.isCompleted || naturalRetention)) {
              continue;
            }
            await updateDoc(doc(db, 'turnos', s.id), {
              status: 'COMPLETED', isCompleted: true,
              realEndTime: serverTimestamp(), autoCompletedAt: serverTimestamp(),
              completionReason: s.manualRetentionType === 'extended' ? 'AUTO_MANUAL_RETENTION_END' : 'AUTO_SHIFT_END',
            });
            await createNovedad('TURNO_COMPLETADO_AUTO', 'Turno Completado (Auto)',
              `Finalización automática al vencimiento del horario: ${msg}`, s, empresaId);
            toast.success(`🤖 Turno finalizado: ${msg}`, { duration: 6000 });
            sendBrowserNotif('Turno Completado', msg);
          } catch (e) {
            console.error('[autoComplete] Error al finalizar turno:', s.id, e);
          }
        } else {
          if (!isBaseline) {
            toast.info(`⏱️ Finalizar turno: ${msg}`, {
              duration: 20000,
              description: 'El horario de fin ya pasó. Confirmar salida manualmente.',
            });
            sendBrowserNotif('⏱️ Turno a finalizar', msg);
          }
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
        if (isAutoMode) {
          // Dedup: no crear novedad si ya existe una RECARGO_12H para este turno
          const existingRecargo = await getDocs(query(
            collection(db, 'novedades'),
            where('shiftId', '==', s.id),
            where('type', '==', 'RECARGO_12H'),
            limit(1)
          ));
          if (existingRecargo.empty) {
            await createNovedad('RECARGO_12H', 'Guardia más de 12h en servicio', msg, s, empresaId);
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
  }, [processedData, isAutoMode, isActive, empresaId]);
};
