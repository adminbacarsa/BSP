import { useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
    createdAt: serverTimestamp(),
    reportedBy: 'SISTEMA_AUTO',
  }, String(shiftData.empresaId || empresaId || '').trim())).catch(() => {});

export const useAutoMonitor = ({ isActive, isAutoMode, empresaId, activeOperatorId, processedData }: AutoMonitorProps) => {
  const mountTime = useRef(Date.now());
  const processedIds = useRef(new Set<string>());

  // — Detecta ingresos desde el portal del empleado (status → 'InProgress') —
  useEffect(() => {
    if (!isActive || !empresaId) return;

    const startWindow = new Date();
    startWindow.setDate(startWindow.getDate() - 1);

    const q = query(
      collection(db, 'turnos'),
      where('startTime', '>=', Timestamp.fromDate(startWindow)),
      where('status', '==', 'InProgress')
    );

    const unsub = onSnapshot(q, snap => {
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

      // Guardias que no se presentaron (> 15 min y < 3 hs)
      const lateGuards = processedData.filter(s => {
        if (s.isPresent || s.isCompleted || s.isAbsent || s.isUnassigned || s.isFranco) return false;
        if (processedIds.current.has(`late_${s.id}`)) return false;
        const diff = (now.getTime() - (s.shiftDateObj?.getTime() || 0)) / 60000;
        return diff > 15 && diff < 180;
      });

      for (const s of lateGuards) {
        processedIds.current.add(`late_${s.id}`);
        const msg = `${s.employeeName} — ${s.objectiveName}`;
        if (isAutoMode) {
          await createNovedad('AUSENCIA_DETECTADA', 'Ausencia Detectada (Auto)',
            `No se presentó: ${msg}`, s, empresaId);
          toast.warning(`🤖 AUTO: Ausencia — ${msg}`, { duration: 8000 });
          sendBrowserNotif('Ausencia Detectada', msg);
        } else {
          toast.error(`⚠️ No se presentó: ${msg}`, { duration: 15000 });
          sendBrowserNotif('⚠️ Guardia no presente', msg);
        }
      }

      // Guardias en retención > 30 min
      const retentions = processedData.filter(s => {
        if (!s.isRetention) return false;
        if (processedIds.current.has(`retention_${s.id}`)) return false;
        return s.retentionMinutes > 30;
      });

      for (const s of retentions) {
        processedIds.current.add(`retention_${s.id}`);
        const msg = `${s.employeeName} lleva ${s.retentionMinutes}min de retención en ${s.objectiveName}`;
        if (isAutoMode) {
          await createNovedad('RETENCION_DETECTADA', 'Recargo Automático Detectado', msg, s, empresaId);
        }
        toast.warning(`⏰ Recargo: ${msg}`, { duration: 10000 });
        sendBrowserNotif('⏰ Guardia en Recargo', msg);
      }

      // ── Auto-finalización: turnos PRESENT cuyo endTime ya pasó ──
      const toComplete = processedData.filter(s => {
        if (s.isCompleted || s.status === 'COMPLETED' || s.status === 'INTERRUPTED') return false;
        if (!(s.isPresent || s.status === 'PRESENT')) return false;
        if (s.isFranco || s.isUnassigned) return false;
        if (processedIds.current.has(`autocomplete_${s.id}`)) return false;
        const endMs = s.endDateObj?.getTime?.() || 0;
        // Solo completar si pasaron al menos 2 minutos desde el fin de turno
        return endMs > 0 && (now.getTime() - endMs) > 2 * 60 * 1000;
      });

      for (const s of toComplete) {
        processedIds.current.add(`autocomplete_${s.id}`);
        const msg = `${s.employeeName} — ${s.objectiveName}`;

        if (isAutoMode) {
          try {
            await updateDoc(doc(db, 'turnos', s.id), {
              status: 'COMPLETED',
              isCompleted: true,
              realEndTime: serverTimestamp(),
              autoCompletedAt: serverTimestamp(),
            });
            await createNovedad(
              'TURNO_COMPLETADO_AUTO',
              'Turno Completado (Auto)',
              `Finalización automática al vencimiento del horario: ${msg}`,
              s, empresaId
            );
            toast.success(`🤖 Turno finalizado: ${msg}`, { duration: 6000 });
            sendBrowserNotif('Turno Completado', msg);
          } catch (e) {
            console.error('[autoComplete] Error al finalizar turno:', s.id, e);
          }
        } else {
          // Modo manual: solo avisa al operador
          toast.info(`⏱️ Finalizar turno: ${msg}`, {
            duration: 20000,
            description: 'El horario de fin ya pasó. Confirmar salida manualmente.',
          });
          sendBrowserNotif('⏱️ Turno a finalizar', msg);
        }
      }
    };

    check();
    const interval = setInterval(check, 60 * 1000); // cada 1 minuto para auto-finalización precisa
    return () => clearInterval(interval);
  }, [isActive, isAutoMode, processedData, empresaId]);
};
