import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Phone, ChevronRight, CheckCircle, Clock, AlertTriangle, Users, SkipForward } from 'lucide-react';
import { collection, doc, addDoc, writeBatch, serverTimestamp, Timestamp, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { stampEmpresaId } from '@/lib/multiempresa';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';

// ─── Tipos ──────────────────────────────────────────────────────────────────

type StepKey = 'SIN_TURNO' | 'RET_PASIVO' | 'ESC' | 'RETENCION' | 'FT';
type SessionStatus = 'SELECTING' | 'PENDING' | 'PENDING_DUAL' | 'CONFIRMED' | 'FAILED';

interface PendingSlot {
  notifId: string;
  empId: string;
  sec: number;
  candShiftId?: string;
}

interface Session {
  status: SessionStatus;
  currentStep: number;
  pending: PendingSlot | null;
  pendingExt: PendingSlot | null;
  pendingAdv: PendingSlot | null;
  confirmedExt: string | null;
  confirmedAdv: string | null;
  awaitingPhone: boolean;
  selectedExtId: string | null;
  selectedAdvId: string | null;
}

// ─── Constantes de protocolo ─────────────────────────────────────────────────

const STEPS: { key: StepKey; label: string; icon: string; mandatory: boolean; timeoutSec: number; isDual?: boolean }[] = [
  { key: 'SIN_TURNO',  label: 'Sin turno',       icon: '1', mandatory: true,  timeoutSec: 60  },
  { key: 'RET_PASIVO', label: 'Retención Pasiva', icon: '2', mandatory: true,  timeoutSec: 180 },
  { key: 'ESC',        label: 'ESC / REF',        icon: '3', mandatory: true,  timeoutSec: 60  },
  { key: 'RETENCION',  label: 'Ext. 12h',         icon: '4', mandatory: false, timeoutSec: 60, isDual: true },
  { key: 'FT',         label: 'Franco Trabajado',  icon: '5', mandatory: false, timeoutSec: 180 },
];

const fmtCountdown = (sec: number) => {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const simPhone = (id: string) => {
  const n = parseInt(id.replace(/\D/g, '')) || 1;
  return `+54 9 351 ${String(n * 1317 % 10000).padStart(4, '0')}-${String(n * 7531 % 10000).padStart(4, '0')}`;
};

// ─── Helpers de fecha ────────────────────────────────────────────────────────

const toDate = (d: any): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (d.seconds) return new Date(d.seconds * 1000);
  return new Date(d);
};

const fmtTime = (d: any) => {
  try {
    return toDate(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
  } catch { return '--:--'; }
};

const isSameDay = (d1: any, d2: any) => {
  if (!d1 || !d2) return false;
  return toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA');
};

// ─── Componente principal ────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
  absenceShift: any;
  logic: any;
  onAudit?: (action: string, detail: string) => void;
}

export function CoverageProtocolPanel({ isOpen, onClose, absenceShift, logic, onAudit }: Props) {
  const { empresaId } = useEmpresa();
  const tid = String(absenceShift?.empresaId || empresaId || '').trim();

  const [session, setSession] = useState<Session>({
    status: 'SELECTING',
    currentStep: 0,
    pending: null,
    pendingExt: null,
    pendingAdv: null,
    confirmedExt: null,
    confirmedAdv: null,
    awaitingPhone: false,
    selectedExtId: null,
    selectedAdvId: null,
  });
  const [loading, setLoading] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dualTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const upd = useCallback((patch: Partial<Session>) => setSession(s => ({ ...s, ...patch })), []);

  // Limpiar timers al desmontar
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (dualTimerRef.current) clearInterval(dualTimerRef.current);
    if (unsubRef.current) unsubRef.current();
  }, []);

  if (!isOpen || !absenceShift) return null;

  const now = new Date();
  const absenceEnd = toDate(absenceShift.endDateObj);
  const hiStart = fmtTime(absenceShift.shiftDateObj);
  const hiEnd = fmtTime(absenceShift.endDateObj);
  const step = STEPS[session.currentStep];

  // ─── Candidatos por paso ─────────────────────────────────────────────────

  const targetDate = toDate(absenceShift.shiftDateObj);

  // Empleados que ya tienen turno o descanso asignado en la fecha del turno ausente
  const hasShiftOnTargetDate = new Set<string>(
    (logic.processedData || [])
      .filter((s: any) => isSameDay(s.shiftDateObj, targetDate))
      .map((s: any) => s.employeeId)
  );

  const busyIds = new Set<string>([
    ...hasShiftOnTargetDate,
  ]);

  const candidatesBySin: any[] = (logic.employees || [])
    .filter((e: any) => !busyIds.has(e.id) && e.id !== absenceShift.employeeId)
    .map((e: any) => ({ ...e, fullName: e.firstName ? `${e.firstName} ${e.lastName || ''}`.trim() : e.name || e.fullName || '', phone: e.phone || e.celular || '' }));

  const candidatesRet: any[] = (logic.processedData || [])
    .filter((s: any) => s.code === 'RET' && isSameDay(s.shiftDateObj, targetDate) && !s.isAbsent && s.employeeId !== absenceShift.employeeId);

  const candidatesEsc: any[] = (logic.processedData || [])
    .filter((s: any) => (s.code === 'ESC' || s.code === 'REF') && isSameDay(s.shiftDateObj, targetDate) && !s.isAbsent && s.employeeId !== absenceShift.employeeId);

  const candidatesExt: any[] = (logic.processedData || [])
    .filter((s: any) =>
      s.isPresent && !s.isCompleted &&
      isSameDay(s.shiftDateObj, targetDate) &&
      s.objectiveId === absenceShift.objectiveId &&
      s.positionName === absenceShift.positionName &&
      s.id !== absenceShift.id
    );

  const candidatesAdv: any[] = (logic.processedData || [])
    .filter((s: any) =>
      !s.isPresent && !s.isCompleted && !s.isAbsent && !s.isUnassigned && !s.isFranco &&
      s.objectiveId === absenceShift.objectiveId &&
      s.positionName === absenceShift.positionName &&
      toDate(s.shiftDateObj) > targetDate &&
      isSameDay(s.shiftDateObj, targetDate)
    )
    .sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime())
    .slice(0, 1);

  const candidatesFt: any[] = (logic.processedData || [])
    .filter((s: any) => s.isFranco && isSameDay(s.shiftDateObj, targetDate) && !s.isFrancoTrabajado && !s.isAbsent && s.employeeId !== absenceShift.employeeId)
    .map((s: any) => {
      const emp = (logic.employees || []).find((e: any) => e.id === s.employeeId);
      return { ...s, fullName: s.employeeName, phone: s.phone || emp?.phone || emp?.celular || '' };
    });

  const candidatesForStep = (): any[] => {
    switch (step.key) {
      case 'SIN_TURNO':  return candidatesBySin;
      case 'RET_PASIVO': return candidatesRet;
      case 'ESC':        return candidatesEsc;
      case 'RETENCION':  return [];  // dual: handled separately
      case 'FT':         return candidatesFt;
    }
  };

  // ─── Timers ──────────────────────────────────────────────────────────────

  const startTimer = (totalSec: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSession(s => {
        if (!s.pending) { clearInterval(timerRef.current!); timerRef.current = null; return s; }
        const next = s.pending.sec - 1;
        if (next <= 0) {
          clearInterval(timerRef.current!); timerRef.current = null;
          return { ...s, pending: { ...s.pending, sec: 0 }, awaitingPhone: true };
        }
        return { ...s, pending: { ...s.pending, sec: next } };
      });
    }, 1000);
  };

  const startDualTimer = () => {
    if (dualTimerRef.current) clearInterval(dualTimerRef.current);
    dualTimerRef.current = setInterval(() => {
      setSession(s => {
        const newExt = s.pendingExt && s.pendingExt.sec > 0 ? { ...s.pendingExt, sec: s.pendingExt.sec - 1 } : s.pendingExt;
        const newAdv = s.pendingAdv && s.pendingAdv.sec > 0 ? { ...s.pendingAdv, sec: s.pendingAdv.sec - 1 } : s.pendingAdv;
        if (!newExt && !newAdv) { clearInterval(dualTimerRef.current!); dualTimerRef.current = null; }
        return { ...s, pendingExt: newExt, pendingAdv: newAdv };
      });
    }, 1000);
  };

  // ─── Listener de respuesta del empleado ──────────────────────────────────

  const listenNotif = (notifId: string, role: 'single' | 'ext' | 'adv') => {
    if (unsubRef.current) unsubRef.current();
    const unsub = onSnapshot(doc(db, 'user_notifications', notifId), snap => {
      const data = snap.data();
      if (!data) return;
      if (data.response === 'ACCEPTED') {
        if (role === 'single') { upd({ pending: null, awaitingPhone: false }); toast.info('El guardia aceptó la notificación'); }
        else if (role === 'ext') upd({ pendingExt: null, confirmedExt: data.userId });
        else if (role === 'adv') upd({ pendingAdv: null, confirmedAdv: data.userId });
      } else if (data.response === 'REJECTED') {
        if (role === 'single') { upd({ pending: null, awaitingPhone: false, status: 'SELECTING' }); toast.info('El guardia rechazó la notificación'); }
        else if (role === 'ext') upd({ pendingExt: null });
        else if (role === 'adv') upd({ pendingAdv: null });
      }
    });
    unsubRef.current = unsub;
  };

  // ─── Acciones del protocolo ───────────────────────────────────────────────

  const sendNotification = async (emp: any) => {
    const empId = emp.employeeId || emp.id;
    const candShiftId = (emp.employeeId && emp.id && emp.id !== emp.employeeId)
      ? emp.id
      : (emp.shiftId && emp.shiftId !== empId ? emp.shiftId : undefined);
    setLoading('notif_' + (emp.id || empId));
    try {
      const notifData: any = {
        userId: empId,
        type: step.key === 'SIN_TURNO' ? 'CONVOCATORIA_COBERTURA'
            : step.key === 'RET_PASIVO' ? 'CONVOCATORIA_COBERTURA'
            : step.key === 'ESC'        ? 'CONVOCATORIA_COBERTURA'
            : 'CONVOCATORIA_COBERTURA',
        title: `Convocatoria de cobertura · ${step.label}`,
        body: `Se te solicita cubrir el turno en ${absenceShift.objectiveName} (${hiStart}–${hiEnd}).`,
        objectiveId: absenceShift.objectiveId,
        shiftId: absenceShift.id || null,
        protocolStep: step.key,
        read: false,
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'user_notifications'), stampEmpresaId(notifData, tid));
      const slot: PendingSlot = { notifId: ref.id, empId, sec: step.timeoutSec, candShiftId };
      upd({ status: 'PENDING', pending: slot, awaitingPhone: false });
      startTimer(step.timeoutSec);
      listenNotif(ref.id, 'single');
      onAudit?.('NOTIF_ENVIADA', `[${step.key}] ${emp.fullName || emp.employeeName}`);
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const confirmCandidate = async () => {
    if (!session.pending) return;
    const empId = session.pending.empId;
    const emp = (logic.employees || []).find((e: any) => e.id === empId);
    const empName = emp?.fullName || (emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : '') || emp?.name || '';

    // Buscar si el candidato tiene un turno real en Firestore para redirigir/transformar
    let candidateShift: any = null;
    const givenShiftId = session.pending.candShiftId;
    if (givenShiftId && givenShiftId !== empId && !String(givenShiftId).startsWith('V124_') && !String(givenShiftId).startsWith('SLA_GAP')) {
      candidateShift = (logic.processedData || []).find((sh: any) => sh.id === givenShiftId);
    }
    if (!candidateShift && step.key !== 'SIN_TURNO') {
      if (step.key === 'RET_PASIVO') {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && sh.code === 'RET' && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      } else if (step.key === 'ESC') {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && (sh.code === 'ESC' || sh.code === 'REF') && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      } else if (step.key === 'FT') {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && sh.isFranco && !sh.isFrancoTrabajado && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      }
      if (!candidateShift) {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && sh.id && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      }
    }

    const candidateShiftId = candidateShift?.id || (givenShiftId && givenShiftId !== empId && !String(givenShiftId).startsWith('V124_') && !String(givenShiftId).startsWith('SLA_GAP') ? givenShiftId : null);

    setLoading('confirm');
    try {
      const batch = writeBatch(db);
      const isRealVacant = absenceShift.isUnassigned && absenceShift.id && !absenceShift.isVirtual && !String(absenceShift.id).startsWith('V124_') && !String(absenceShift.id).startsWith('SLA_GAP');
      const covEmpId = empId;
      const covEmpName = empName;
      const markCovered = (coverageType: string) => {
        if (isRealVacant) {
          batch.update(doc(db, 'turnos', absenceShift.id), {
            status: 'COVERED',
            resolvedBy: 'OPERACIONES',
            coverageType,
            coveredAt: serverTimestamp(),
            coveredByEmployeeId: covEmpId,
            coveredByEmployeeName: covEmpName,
          });
        }
        if (absenceShift.causedByShiftId && !String(absenceShift.causedByShiftId).startsWith('V124_') && !String(absenceShift.causedByShiftId).startsWith('SLA_GAP')) {
          batch.update(doc(db, 'turnos', absenceShift.causedByShiftId), {
            operacionallyCovered: true,
            resolvedBy: 'OPERACIONES',
            coverageType,
            coveredAt: serverTimestamp(),
            coveredByEmployeeId: covEmpId,
            coveredByEmployeeName: covEmpName,
          });
        }
      };

      if (step.key === 'SIN_TURNO' || !candidateShiftId) {
        const newRef = doc(collection(db, 'turnos'));
        batch.set(newRef, stampEmpresaId({
          employeeId: empId, employeeName: empName,
          clientId: absenceShift.clientId, clientName: absenceShift.clientName,
          objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName,
          positionName: absenceShift.positionName,
          startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)),
          endTime: Timestamp.fromDate(absenceEnd),
          status: 'PENDING', origin: 'RETEN', isReten: true,
          coverageType: step.key,
          absenceShiftId: isRealVacant ? absenceShift.id : null, createdAt: serverTimestamp(),
        }, tid));
        markCovered('RETEN');
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'CONVOCATORIA_RETEN', title: 'Convocatoria retén', status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: newRef.id, description: `Convocado como retén en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES', protocolStep: step.key }, tid));
      } else if (step.key === 'RET_PASIVO' || step.key === 'ESC') {
        // Redirigir el guardia en RET/ESC al puesto de cobertura
        batch.update(doc(db, 'turnos', candidateShiftId), { coverageRedirectedTo: absenceShift.objectiveId, coverageRedirectedAt: serverTimestamp(), resolvedBy: 'OPERACIONES' });
        markCovered(step.key);
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: step.key === 'RET_PASIVO' ? 'CONVOCATORIA_RETEN' : 'CONVOCATORIA_COBERTURA', title: `Cobertura por ${step.label}`, status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: candidateShiftId, description: `${empName} redirigido de ${step.label} a cobertura en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES', protocolStep: step.key }, tid));
      } else if (step.key === 'FT') {
        batch.update(doc(db, 'turnos', candidateShiftId), {
          isFranco: false, isFrancoTrabajado: true, code: 'FT', type: 'EXTRA_FRANCO',
          startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)),
          endTime: Timestamp.fromDate(absenceEnd),
          francoTrabajadoAt: serverTimestamp(),
          francoObjectiveId: absenceShift.objectiveId, francoObjectiveName: absenceShift.objectiveName,
          comments: `Franco Trabajado (Protocolo) — cubre ${absenceShift.objectiveName || 'vacante'}`,
        });
        markCovered('FRANCO');
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: candidateShiftId, description: `${empName} trabaja su franco en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES', protocolStep: step.key }, tid));
      }

      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      toast.success('Cobertura confirmada');
      onAudit?.('COBERTURA_CONFIRMADA', `[${step.key}] ${empName}`);
      upd({ status: 'CONFIRMED', pending: null, awaitingPhone: false });
      setTimeout(() => onClose(), 1500);
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const rejectCandidate = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    upd({ status: 'SELECTING', pending: null, awaitingPhone: false });
  };

  const skipStep = () => {
    rejectCandidate();
    const next = session.currentStep + 1;
    if (next < STEPS.length) upd({ currentStep: next, status: 'SELECTING', pending: null, awaitingPhone: false });
    else upd({ status: 'FAILED' });
  };

  // ─── Dual (RETENCION) ─────────────────────────────────────────────────────

  const sendDualNotification = async () => {
    const extId = session.selectedExtId;
    const advId = session.selectedAdvId;
    if (!extId || !advId) return;
    setLoading('dual');
    try {
      const extShift = candidatesExt.find((s: any) => s.id === extId || s.employeeId === extId);
      const advShift = candidatesAdv.find((s: any) => s.id === advId || s.employeeId === advId);
      const extEmpId = extShift?.employeeId || extId;
      const advEmpId = advShift?.employeeId || advId;

      const [extRef, advRef] = await Promise.all([
        addDoc(collection(db, 'user_notifications'), stampEmpresaId({ userId: extEmpId, type: 'RETENCION', title: 'Extensión de jornada', body: `Tu turno en ${absenceShift.objectiveName} se extiende hasta ${hiEnd}.`, objectiveId: absenceShift.objectiveId, shiftId: extShift?.id || null, protocolStep: 'RETENCION_EXT', read: false, createdAt: serverTimestamp() }, tid)),
        addDoc(collection(db, 'user_notifications'), stampEmpresaId({ userId: advEmpId, type: 'ADELANTO', title: 'Adelanto de turno', body: `Tu turno en ${absenceShift.objectiveName} fue adelantado. Confirmá llegada.`, objectiveId: absenceShift.objectiveId, shiftId: advShift?.id || null, protocolStep: 'RETENCION_ADV', read: false, createdAt: serverTimestamp() }, tid)),
      ]);

      upd({
        status: 'PENDING_DUAL',
        pendingExt: { notifId: extRef.id, empId: extEmpId, sec: step.timeoutSec },
        pendingAdv: { notifId: advRef.id, empId: advEmpId, sec: step.timeoutSec },
      });
      startDualTimer();
      onAudit?.('DUAL_NOTIF', `EXT ${extShift?.employeeName} + ADV ${advShift?.employeeName}`);
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const confirmDual = async (role: 'ext' | 'adv') => {
    const slot = role === 'ext' ? session.pendingExt : session.pendingAdv;
    if (!slot) return;
    setLoading('confirm_' + role);
    try {
      const batch = writeBatch(db);
      const isRealVacant = absenceShift.id && !absenceShift.isVirtual && !String(absenceShift.id).startsWith('V124_') && !String(absenceShift.id).startsWith('SLA_GAP');
      if (role === 'ext') {
        const extShift = candidatesExt.find((s: any) => s.employeeId === slot.empId);
        const isRealExt = extShift && extShift.id && !String(extShift.id).startsWith('V124_') && !String(extShift.id).startsWith('SLA_GAP') && extShift.id !== slot.empId;
        if (isRealExt) batch.update(doc(db, 'turnos', extShift.id), {
          isRetention: true,
          isExtended: true,
          retentionEndTime: Timestamp.fromDate(absenceEnd),
          endTime: Timestamp.fromDate(absenceEnd),
        });
        if (isRealVacant && !session.confirmedAdv) {
          // solo marcar covered cuando ambos estén confirmados; por ahora registrar parcial
        }
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'RETENCION', title: 'Retención de guardia (EXT)', status: 'pending', employeeId: slot.empId, employeeName: extShift?.employeeName || '', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: isRealExt ? extShift.id : null, description: `${extShift?.employeeName} retenido hasta ${hiEnd} — cobertura 1ª mitad`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES', protocolStep: 'RETENCION_EXT' }, tid));
        const nextAdv = session.confirmedAdv;
        if (nextAdv) {
          const advSh = candidatesAdv.find((s: any) => s.employeeId === nextAdv);
          const extName = (extShift?.employeeName || '').split(' ')[0];
          const advName = (advSh?.employeeName || '').split(' ')[0];
          const covLabel = `${extName} ext + ${advName} adel`;
          if (isRealVacant) {
            batch.update(doc(db, 'turnos', absenceShift.id), {
              status: 'COVERED',
              resolvedBy: 'OPERACIONES',
              coverageType: 'RETENCION',
              coveredAt: serverTimestamp(),
              coveredByEmployeeName: covLabel,
            });
          }
          if (absenceShift.causedByShiftId && !String(absenceShift.causedByShiftId).startsWith('V124_') && !String(absenceShift.causedByShiftId).startsWith('SLA_GAP')) {
            batch.update(doc(db, 'turnos', absenceShift.causedByShiftId), {
              operacionallyCovered: true,
              resolvedBy: 'OPERACIONES',
              coverageType: 'RETENCION',
              coveredAt: serverTimestamp(),
              coveredByEmployeeName: covLabel,
            });
          }
          await batch.commit();
          toast.success('Cobertura completa — ambos confirmados');
          upd({ status: 'CONFIRMED', confirmedExt: slot.empId, pendingExt: null });
          setTimeout(onClose, 1500);
        } else {
          upd({ confirmedExt: slot.empId, pendingExt: null });
        }
      } else {
        const advShift = candidatesAdv.find((s: any) => s.employeeId === slot.empId);
        const isRealAdv = advShift && advShift.id && !String(advShift.id).startsWith('V124_') && !String(advShift.id).startsWith('SLA_GAP') && advShift.id !== slot.empId;
        const vacancyStart = Timestamp.fromDate(toDate(absenceShift.shiftDateObj));
        if (isRealAdv) batch.update(doc(db, 'turnos', advShift.id), {
          adjustedStartTime: vacancyStart,
          startTime: vacancyStart,
          isEarlyStart: true,
        });
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'ADELANTO_TURNO', title: 'Adelanto de turno (ADV)', status: 'pending', employeeId: slot.empId, employeeName: advShift?.employeeName || '', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: isRealAdv ? advShift.id : null, description: `${advShift?.employeeName} adelantado — cobertura 2ª mitad`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES', protocolStep: 'RETENCION_ADV' }, tid));
        const nextExt = session.confirmedExt;
        if (nextExt) {
          const extSh = candidatesExt.find((s: any) => s.employeeId === nextExt);
          const extName = (extSh?.employeeName || '').split(' ')[0];
          const advName = (advShift?.employeeName || '').split(' ')[0];
          const covLabel = `${extName} ext + ${advName} adel`;
          if (isRealVacant) {
            batch.update(doc(db, 'turnos', absenceShift.id), {
              status: 'COVERED',
              resolvedBy: 'OPERACIONES',
              coverageType: 'RETENCION',
              coveredAt: serverTimestamp(),
              coveredByEmployeeName: covLabel,
            });
          }
          if (absenceShift.causedByShiftId && !String(absenceShift.causedByShiftId).startsWith('V124_') && !String(absenceShift.causedByShiftId).startsWith('SLA_GAP')) {
            batch.update(doc(db, 'turnos', absenceShift.causedByShiftId), {
              operacionallyCovered: true,
              resolvedBy: 'OPERACIONES',
              coverageType: 'RETENCION',
              coveredAt: serverTimestamp(),
              coveredByEmployeeName: covLabel,
            });
          }
          await batch.commit();
          toast.success('Cobertura completa — ambos confirmados');
          upd({ status: 'CONFIRMED', confirmedAdv: slot.empId, pendingAdv: null });
          setTimeout(onClose, 1500);
        } else {
          upd({ confirmedAdv: slot.empId, pendingAdv: null });
        }
      }
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const rejectDual = (role: 'ext' | 'adv') => {
    if (role === 'ext') upd({ pendingExt: null, selectedExtId: null });
    else upd({ pendingAdv: null, selectedAdvId: null });
    if (!session.pendingExt && !session.pendingAdv && !session.confirmedExt && !session.confirmedAdv) {
      if (dualTimerRef.current) { clearInterval(dualTimerRef.current); dualTimerRef.current = null; }
      upd({ status: 'SELECTING', pendingExt: null, pendingAdv: null });
    }
  };

  // ─── Render helpers ───────────────────────────────────────────────────────

  const isBusy = (k: string) => loading === k || loading?.startsWith(k);

  const CandCard = ({ cand, role }: { cand: any; role?: 'ext' | 'adv' }) => {
    const empId = cand.employeeId || cand.id;
    const name = cand.fullName || cand.employeeName || cand.name || '—';
    const phone = cand.phone || cand.celular || simPhone(empId);
    const isSelected = role === 'ext' ? session.selectedExtId === (cand.id || empId) : role === 'adv' ? session.selectedAdvId === (cand.id || empId) : false;
    const isPendingThis = role === 'ext' ? session.pendingExt?.empId === empId : role === 'adv' ? session.pendingAdv?.empId === empId : false;
    const isConfirmedThis = role === 'ext' ? session.confirmedExt === empId : role === 'adv' ? session.confirmedAdv === empId : false;
    const sec = role === 'ext' ? session.pendingExt?.sec : session.pendingAdv?.sec;
    const isDual = !!role;

    if (isConfirmedThis) {
      return (
        <div className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-emerald-400 bg-emerald-50">
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-content-center text-white text-xs font-black flex-shrink-0 flex items-center justify-center">✓</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-emerald-800">{name}</div>
            <div className="text-[10px] text-emerald-600 font-semibold">Confirmado</div>
          </div>
          <CheckCircle size={16} className="text-emerald-500" />
        </div>
      );
    }

    if (isDual && isPendingThis) {
      return (
        <div className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-amber-400 bg-amber-50">
          <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-[9px] font-black flex-shrink-0 font-mono">{fmtCountdown(sec ?? 0)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-amber-900">{name}</div>
            <div className="text-[11px] font-bold text-amber-800 font-mono bg-white border border-amber-300 rounded px-1.5 py-0.5 inline-block mt-1">📱 {phone}</div>
          </div>
        </div>
      );
    }

    if (isDual) {
      const otherPending = role === 'ext' ? !!session.pendingExt : !!session.pendingAdv;
      const otherConfirmed = role === 'ext' ? !!session.confirmedExt : !!session.confirmedAdv;
      const slotBusy = otherPending || otherConfirmed;
      const clickable = !slotBusy;
      const handleSel = () => {
        if (!clickable) return;
        const key = cand.id || empId;
        if (role === 'ext') upd({ selectedExtId: session.selectedExtId === key ? null : key });
        else upd({ selectedAdvId: session.selectedAdvId === key ? null : key });
      };
      return (
        <div onClick={handleSel} style={{ opacity: slotBusy ? 0.35 : 1 }} className={`flex items-center gap-2 p-2.5 rounded-xl border-2 transition-all ${isSelected ? 'border-indigo-500 bg-indigo-50 cursor-pointer' : 'border-slate-200 bg-white cursor-pointer hover:border-slate-300'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{isSelected ? '✓' : (name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase())}</div>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>{name}</div>
            <div className="text-[11px] font-bold text-slate-600 font-mono bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 inline-block mt-1">📱 {phone}</div>
          </div>
          {isSelected && <div className="text-[9px] font-bold text-indigo-600 bg-white border border-indigo-300 rounded px-1.5 py-0.5">SEL.</div>}
        </div>
      );
    }

    // Single candidate card
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white">
        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-600 flex-shrink-0">
          {name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-slate-800">{name}</div>
          {cand.positionName && <div className="text-[10px] text-slate-500">{cand.positionName}</div>}
          <div className="text-[11px] font-bold text-slate-700 font-mono bg-slate-50 border border-slate-200 rounded px-2 py-0.5 inline-block mt-1">📱 {phone}</div>
        </div>
        <button
          onClick={() => sendNotification(cand)}
          disabled={!!loading || session.status !== 'SELECTING'}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
        >
          {isBusy('notif_' + empId) ? '...' : 'Notificar'}
        </button>
      </div>
    );
  };

  // ─── Vista de paso activo ─────────────────────────────────────────────────

  const renderPendingView = () => {
    const emp = (logic.employees || []).find((e: any) => e.id === session.pending?.empId)
      || (logic.processedData || []).find((s: any) => s.employeeId === session.pending?.empId);
    const name = emp?.fullName || emp?.employeeName || emp?.name || '—';
    const phone = emp?.phone || emp?.celular || simPhone(session.pending?.empId || '');
    const timedOut = session.awaitingPhone;
    const pct = timedOut ? 0 : (session.pending?.sec ?? 0) / step.timeoutSec;
    const r = 36, circ = 2 * Math.PI * r;

    return (
      <div className="flex flex-col items-center gap-4 py-4">
        {/* Countdown ring */}
        <div className="relative w-20 h-20">
          <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
            <circle cx="44" cy="44" r={r} fill="none" strokeWidth="6" className="stroke-slate-200" />
            <circle cx="44" cy="44" r={r} fill="none" strokeWidth="6"
              stroke={timedOut ? '#EF4444' : '#F59E0B'}
              strokeDasharray={circ.toFixed(1)}
              strokeDashoffset={(circ * (1 - pct)).toFixed(1)}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {timedOut ? <Phone size={22} className="text-red-500" /> : <span className="text-sm font-black text-slate-700 font-mono">{fmtCountdown(session.pending?.sec ?? 0)}</span>}
          </div>
        </div>

        <div className="text-center">
          <div className={`text-sm font-black ${timedOut ? 'text-amber-700' : 'text-slate-700'}`}>
            {timedOut ? 'Sin respuesta · Llamar directamente' : 'Notificación enviada · Esperando confirmación'}
          </div>
          {step.mandatory && <div className="text-[10px] text-orange-600 font-bold mt-1">Asignación obligatoria — no puede rechazar</div>}
        </div>

        {/* Card del guardia */}
        <div className={`w-full rounded-xl border-2 p-4 ${timedOut ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${timedOut ? 'bg-amber-200 text-amber-800' : 'bg-indigo-100 text-indigo-700'}`}>
              {name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-bold text-slate-800">{name}</div>
              <div className="text-[10px] text-slate-500">{step.label}</div>
            </div>
          </div>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${timedOut ? 'text-amber-700' : 'text-slate-500'}`}>
              {timedOut ? '📞 Llamar ahora' : '📱 Teléfono de contacto'}
            </div>
            <div className={`text-base font-black font-mono rounded-lg px-3 py-2 text-center ${timedOut ? 'bg-white border-2 border-amber-400 text-amber-900' : 'bg-slate-50 border border-slate-200 text-slate-800'}`}>
              {phone}
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="w-full flex flex-col gap-2">
          <div className="text-[10px] text-center text-slate-400 font-semibold uppercase tracking-widest">— Resultado —</div>
          <button
            onClick={confirmCandidate}
            disabled={!!loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black rounded-xl transition-colors"
          >
            {loading === 'confirm' ? 'Confirmando...' : step.mandatory ? '✓ Confirmó / Asignado' : timedOut ? '✓ Acepta por teléfono' : '✓ Acepta'}
          </button>
          {!step.mandatory && (
            <button onClick={rejectCandidate} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm transition-colors">
              ✗ {timedOut ? 'No contesta / No puede' : 'Rechaza'} — siguiente candidato
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderDualPanel = () => {
    const canNotify = session.selectedExtId && session.selectedAdvId && session.status !== 'PENDING_DUAL';
    const isPending = session.status === 'PENDING_DUAL';

    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-slate-500 font-semibold">
          {isPending ? '⏳ Notificaciones enviadas · esperando respuesta de cada guardia' : 'Seleccioná un candidato de cada columna y notificá a ambos simultáneamente.'}
        </p>

        {/* Grilla EXT / ADV */}
        <div className="grid grid-cols-2 gap-2">
          {/* Columna EXT */}
          <div className="flex flex-col gap-2 bg-violet-50 border border-violet-200 rounded-xl p-2.5">
            <div className="text-[9px] font-black text-violet-700 uppercase tracking-wider border-b border-violet-200 pb-1.5 mb-0.5">⟵ 1ª mitad · EXT</div>
            {session.confirmedExt ? (
              <CandCard cand={candidatesExt.find((s: any) => s.employeeId === session.confirmedExt) || { id: session.confirmedExt, employeeId: session.confirmedExt }} role="ext" />
            ) : session.pendingExt ? (
              <>
                <CandCard cand={candidatesExt.find((s: any) => s.employeeId === session.pendingExt!.empId) || { id: session.pendingExt.empId, employeeId: session.pendingExt.empId }} role="ext" />
              </>
            ) : candidatesExt.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic py-2 text-center">Sin candidatos EXT</p>
            ) : (
              candidatesExt.map((c: any) => <CandCard key={c.id} cand={c} role="ext" />)
            )}
          </div>

          {/* Columna ADV */}
          <div className="flex flex-col gap-2 bg-sky-50 border border-sky-200 rounded-xl p-2.5">
            <div className="text-[9px] font-black text-sky-700 uppercase tracking-wider border-b border-sky-200 pb-1.5 mb-0.5">2ª mitad · ADV ⟶</div>
            {session.confirmedAdv ? (
              <CandCard cand={candidatesAdv.find((s: any) => s.employeeId === session.confirmedAdv) || { id: session.confirmedAdv, employeeId: session.confirmedAdv }} role="adv" />
            ) : session.pendingAdv ? (
              <>
                <CandCard cand={candidatesAdv.find((s: any) => s.employeeId === session.pendingAdv!.empId) || { id: session.pendingAdv.empId, employeeId: session.pendingAdv.empId }} role="adv" />
              </>
            ) : candidatesAdv.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic py-2 text-center">Sin candidatos ADV</p>
            ) : (
              candidatesAdv.map((c: any) => <CandCard key={c.id} cand={c} role="adv" />)
            )}
          </div>
        </div>

        {/* Botones de simulación (cuando hay pendientes) */}
        {isPending && (session.pendingExt || session.pendingAdv) && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
            <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wide mb-2">Resultado de cada guardia</div>
            <div className="flex flex-col gap-2">
              {session.pendingExt && !session.confirmedExt && (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-violet-700 w-8">EXT</span>
                  <button onClick={() => confirmDual('ext')} disabled={!!loading} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg">✓ Acepta</button>
                  <button onClick={() => rejectDual('ext')} disabled={!!loading} className="flex-1 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg">✗ Rechaza</button>
                </div>
              )}
              {session.pendingAdv && !session.confirmedAdv && (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-sky-700 w-8">ADV</span>
                  <button onClick={() => confirmDual('adv')} disabled={!!loading} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg">✓ Acepta</button>
                  <button onClick={() => rejectDual('adv')} disabled={!!loading} className="flex-1 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg">✗ Rechaza</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Botón notificar a ambos */}
        {!isPending && (
          <button
            onClick={sendDualNotification}
            disabled={!canNotify || !!loading}
            className={`w-full py-3 font-black rounded-xl text-sm transition-colors ${canNotify ? 'bg-violet-700 hover:bg-violet-800 text-white cursor-pointer' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
          >
            {loading === 'dual' ? '...'
              : canNotify
                ? `⚡ Notificar a ambos simultáneamente`
                : session.selectedExtId ? 'Falta seleccionar ADV →'
                : session.selectedAdvId ? '← Falta seleccionar EXT'
                : 'Seleccioná un candidato de cada columna'}
          </button>
        )}
      </div>
    );
  };

  // ─── Layout principal ─────────────────────────────────────────────────────

  const candidates = candidatesForStep();
  const isConfirmed = session.status === 'CONFIRMED';
  const isFailed = session.status === 'FAILED';

  return (
    <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-end sm:items-center justify-center p-2 sm:p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="p-4 bg-rose-600 text-white flex justify-between items-start shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-black text-base shrink-0">
              {(absenceShift.employeeName || 'V')[0].toUpperCase()}
            </div>
            <div>
              <p className="text-[10px] font-bold opacity-70 uppercase tracking-wide">Protocolo de Cobertura CCT</p>
              <p className="font-black text-base leading-tight">{absenceShift.employeeName || 'Vacante'}</p>
              <p className="text-xs font-semibold opacity-80 mt-0.5">{absenceShift.objectiveName} · {hiStart}–{hiEnd}</p>
            </div>
          </div>
          <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 transition-colors shrink-0"><X size={18} /></button>
        </div>

        {/* Progress steps */}
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {STEPS.map((st, i) => {
              const done = i < session.currentStep || isConfirmed;
              const active = i === session.currentStep && !isConfirmed && !isFailed;
              return (
                <React.Fragment key={st.key}>
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black transition-colors whitespace-nowrap ${
                    done ? 'bg-emerald-100 text-emerald-700'
                    : active ? 'bg-rose-600 text-white'
                    : 'bg-white text-slate-400 border border-slate-200'
                  }`}>
                    <span>{done ? '✓' : st.icon}</span>
                    <span>{st.label}</span>
                    {active && session.status === 'PENDING' && <span className="font-mono ml-1">{fmtCountdown(session.pending?.sec ?? 0)}</span>}
                    {active && session.status === 'PENDING_DUAL' && <Clock size={10} className="ml-1" />}
                  </div>
                  {i < STEPS.length - 1 && <ChevronRight size={10} className="text-slate-300 flex-shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">

          {isConfirmed && (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle size={48} className="text-emerald-500" />
              <div className="text-lg font-black text-emerald-700">Cobertura confirmada</div>
              <div className="text-sm text-slate-500">El turno ha sido cubierto exitosamente.</div>
            </div>
          )}

          {isFailed && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertTriangle size={48} className="text-amber-500" />
              <div className="text-lg font-black text-amber-700">Protocolo agotado</div>
              <div className="text-sm text-slate-500">No se encontró cobertura disponible.</div>
              <button onClick={() => { upd({ status: 'FAILED' }); addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'SIN_COBERTURA', title: 'Puesto sin cobertura', status: 'pending', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName || '', positionName: absenceShift.positionName || '', employeeId: absenceShift.employeeId || null, employeeName: absenceShift.employeeName || null, description: `Protocolo CCT agotado — sin cobertura disponible`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid)).then(() => { toast.info('Registrado sin cobertura'); onClose(); }); }} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-sm">Registrar sin cobertura</button>
            </div>
          )}

          {!isConfirmed && !isFailed && (
            <>
              {/* Paso activo */}
              <div className="mb-2">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Paso {session.currentStep + 1} de {STEPS.length}</span>
                    <h3 className="text-base font-black text-slate-800">{step.label}</h3>
                    {step.mandatory && <span className="text-[10px] text-orange-600 font-bold">Asignación obligatoria</span>}
                  </div>
                  {session.status === 'SELECTING' && session.currentStep < STEPS.length - 1 && !step.isDual && (
                    <button onClick={skipStep} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 font-semibold transition-colors">
                      <SkipForward size={12} /> Siguiente paso
                    </button>
                  )}
                </div>

                {/* Pending o selección */}
                {session.status === 'PENDING' ? renderPendingView()
                  : step.isDual ? renderDualPanel()
                  : candidates.length === 0
                    ? (
                      <div className="flex flex-col items-center gap-3 py-8 text-center">
                        <Users size={32} className="text-slate-300" />
                        <div className="text-sm text-slate-400">Sin candidatos para este paso</div>
                        {session.currentStep < STEPS.length - 1 && (
                          <button onClick={skipStep} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl text-sm flex items-center gap-2">
                            <SkipForward size={14} /> Siguiente paso
                          </button>
                        )}
                      </div>
                    )
                    : (
                      <div className="flex flex-col gap-2">
                        {candidates.map((c: any) => <CandCard key={c.id} cand={c} />)}
                      </div>
                    )
                }
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isConfirmed && !isFailed && (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 shrink-0 flex items-center justify-between">
            <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 font-semibold transition-colors">Cerrar</button>
            {session.currentStep < STEPS.length - 1 && session.status === 'SELECTING' && (
              <button onClick={skipStep} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 font-bold transition-colors">
                Saltear paso <SkipForward size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
