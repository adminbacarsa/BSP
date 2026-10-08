import { addDoc, collection, doc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch, type Firestore } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { belongsToEmpresaView, queryAndDeleteForEmpresa, stampEmpresaId, TenantIsolationError } from '@/lib/multiempresa';
import { inferAbsenceCode, validateAbsenceDateRange } from '@/lib/planificacion/absenceCodes';
import { camposBandaConservada, ymdLocalDeValor } from '@/lib/planificacion/bandaLicencia';
import type { Absence } from '@/services/absenceService';

type EmpleadoRef = { id?: string; preferredObjectiveId?: string };
type ObjetivoRef = { id?: string; docId?: string; clientId?: string; name?: string };

export async function replicarAusenciaPlanificador(input: {
  empresaId: string;
  migracionCompleta: boolean;
  absenceId: string;
  data: Absence;
  employees: EmpleadoRef[];
  objectives: ObjetivoRef[];
  notify: (message: string) => void;
  firestore?: Firestore;
}): Promise<void> {
  const store = input.firestore || db;
  const { empresaId, migracionCompleta, absenceId, data, notify } = input;
  try {
    if (!data.employeeId?.trim()) {
      notify('No se puede replicar: la ausencia no tiene empleado asignado.');
      return;
    }
    const range = validateAbsenceDateRange(data.startDate, data.endDate);
    if (!range.ok) return;
    const turnosQ = query(collection(store, 'turnos'), where('absenceId', '==', absenceId));
    await queryAndDeleteForEmpresa('turnos', turnosQ, empresaId, migracionCompleta);
    const [sY, sM, sD] = range.startDate.split('-').map(Number);
    const [eY, eM, eD] = range.endDate.split('-').map(Number);
    const start = new Date(sY, sM - 1, sD);
    const end = new Date(eY, eM - 1, eD);
    const code = inferAbsenceCode(data);
    const emp = input.employees.find((e) => e.id === data.employeeId);
    const portal = data as Absence & { objectiveId?: string; objectiveName?: string; clientId?: string };
    const objectiveId =
      String(portal.objectiveId ?? '').trim() ||
      String(emp?.preferredObjectiveId ?? '').trim();
    const objRow = input.objectives.find((o) => o.id === objectiveId || o.docId === objectiveId);
    const clientId =
      String(portal.clientId ?? '').trim() ||
      String(objRow?.clientId ?? '').trim();
    const objectiveName =
      String(portal.objectiveName ?? '').trim() ||
      objRow?.name ||
      (objectiveId ? `Objetivo ${objectiveId}` : `NOVEDAD - ${data.type}`);
    const absenceCreatedAt = new Date().toISOString();
    const batch = writeBatch(store);
    const bandaPorDia = new Map<string, Record<string, string>>();

    const rangeStartTs = Timestamp.fromDate(new Date(sY, sM - 1, sD, 0, 0, 0));
    const rangeEndTs = Timestamp.fromDate(new Date(eY, eM - 1, eD, 23, 59, 59));
    try {
      const originalTurnosSnap = await getDocs(query(
        collection(store, 'turnos'),
        where('employeeId', '==', data.employeeId),
        where('startTime', '>=', rangeStartTs),
        where('startTime', '<=', rangeEndTs),
      ));
      originalTurnosSnap.forEach((docSnap) => {
        const t = docSnap.data();
        if (!belongsToEmpresaView(t, empresaId, migracionCompleta)) return;
        if (t.type === 'NOVEDAD' || t.hasNovedad || t.isAbsent || t.isFranco) return;
        const ymd = ymdLocalDeValor(t.startTime);
        const banda = camposBandaConservada(t);
        if (ymd && banda.originalCode && !bandaPorDia.has(ymd)) bandaPorDia.set(ymd, banda);
        batch.update(docSnap.ref, {
          hasNovedad: true,
          isAbsent: true,
          absenceId,
          absenceType: data.type,
          absenceCreatedAt,
        });
      });
    } catch (queryErr) {
      console.warn('[replicarAusencia] No se pudieron marcar turnos originales (índice o permisos):', queryErr);
    }

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const isPeriodOnly = code === 'V';
      const dayEnd = isPeriodOnly
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
        : new Date(dayStart.getTime() + 8 * 3600000);
      const turnoRef = doc(collection(store, 'turnos'));
      const turnoPayload: Record<string, unknown> = {
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        startTime: Timestamp.fromDate(dayStart),
        endTime: Timestamp.fromDate(dayEnd),
        hours: isPeriodOnly ? 0 : 8,
        type: 'NOVEDAD',
        code,
        status: 'Approved',
        absenceId,
        isFranco: false,
        hasNovedad: true,
        plannedNovedad: data.type?.includes('Licencia') ? 'LICENCIA' : 'AVISO',
        comments: data.reason || '',
        ...(bandaPorDia.get(ymd) || {}),
      };
      if (objectiveId) turnoPayload.objectiveId = objectiveId;
      if (objectiveName) turnoPayload.objectiveName = objectiveName;
      if (clientId) turnoPayload.clientId = clientId;
      batch.set(turnoRef, stampEmpresaId(turnoPayload, empresaId));
    }
    await batch.commit();
  } catch (e) {
    console.error('[replicarAusencia]', e);
    const msg =
      e instanceof TenantIsolationError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Error replicando';
    notify(msg.length > 120 ? `${msg.slice(0, 120)}…` : msg);
  }
}

export async function avisarNovedadDeAusencia(input: {
  empresaId: string;
  ausenciaId: string;
  reportedBy: string;
  data: { type: string; employeeId: string; employeeName: string; startDate: string; endDate: string };
}): Promise<void> {
  await addDoc(collection(db, 'novedades'), stampEmpresaId({
    source: 'AUSENCIA',
    type: input.data.type,
    status: 'pending',
    employeeId: input.data.employeeId,
    employeeName: input.data.employeeName,
    startDate: input.data.startDate,
    endDate: input.data.endDate,
    ausenciaId: input.ausenciaId,
    description: `${input.data.type} de ${input.data.employeeName} — ${input.data.startDate} al ${input.data.endDate}`,
    reportedBy: input.reportedBy,
    createdAt: serverTimestamp(),
  }, input.empresaId));
}
