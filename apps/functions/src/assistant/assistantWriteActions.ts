import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export type AgentActionPayload = Record<string, unknown>;

function startOfDayAr(dateYmd: string): Date {
  const [y, m, d] = dateYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
}

function addHours(date: Date, h: number): Date {
  return new Date(date.getTime() + h * 3600 * 1000);
}

function codigoToHoras(code: string): number {
  if (code === 'D12' || code === 'N12') return 12;
  return 8;
}

export async function ejecutarExtenderJornada(
  empresaId: string,
  payload: AgentActionPayload,
): Promise<{ ok: boolean; message: string }> {
  const { shiftId, nuevoCodigo } = payload as { shiftId: string; nuevoCodigo: string; empleadoNombre: string };
  if (!shiftId || !nuevoCodigo) throw new Error('Payload incompleto: falta shiftId o nuevoCodigo.');

  const db = admin.firestore();
  const ref = db.collection('turnos').doc(shiftId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Turno ${shiftId} no encontrado.`);

  const data = snap.data()!;
  const startTime: Timestamp = data.startTime;
  const startDate = startTime.toDate();
  const newEndTime = Timestamp.fromDate(addHours(startDate, codigoToHoras(nuevoCodigo)));

  await ref.update({
    code: nuevoCodigo,
    endTime: newEndTime,
    modifiedByAgent: true,
    modifiedByAgentAt: Timestamp.now(),
    modifiedByAgentEmpresaId: empresaId,
  });

  return { ok: true, message: `✓ Jornada extendida a **${nuevoCodigo}** correctamente.` };
}

export async function ejecutarCubrirAusencia(
  empresaId: string,
  payload: AgentActionPayload,
): Promise<{ ok: boolean; message: string }> {
  const { empleadoId, objetivoId, clientId, banda, fecha, empleadoNombre, objetivoNombre } = payload as {
    empleadoId: string;
    objetivoId: string;
    clientId?: string;
    banda: string;
    fecha: string;
    empleadoNombre?: string;
    objetivoNombre?: string;
  };
  if (!empleadoId || !objetivoId || !banda || !fecha) throw new Error('Payload incompleto para cubrir_ausencia.');

  const [y, m, d] = fecha.split('-').map(Number);
  const startAr = new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));

  const bandaOffsets: Record<string, [number, number]> = {
    M: [0, 8], T: [8, 16], N: [16, 24],
    D12: [0, 12], N12: [12, 24],
  };
  const [startH, endH] = bandaOffsets[banda] ?? [0, 8];
  const startTime = Timestamp.fromDate(addHours(startAr, startH));
  const endTime = Timestamp.fromDate(addHours(startAr, endH));

  const db = admin.firestore();
  await db.collection('turnos').add({
    employeeId: empleadoId,
    objectiveId: objetivoId,
    clientId: clientId ?? '',
    empresaId,
    code: banda,
    startTime,
    endTime,
    origin: 'OPERATIONS_COVERAGE',
    isPresent: false,
    isAbsent: false,
    isCompleted: false,
    draft: false,
    createdByAgent: true,
    createdByAgentAt: Timestamp.now(),
  });

  const nombreDisplay = empleadoNombre ?? empleadoId;
  const sitioDisplay = objetivoNombre ?? objetivoId;
  return { ok: true, message: `✓ Cobertura creada: **${nombreDisplay}** cubrirá turno **${banda}** el ${fecha} en **${sitioDisplay}**.` };
}

export async function ejecutarCrearTurnoRefuerzo(
  empresaId: string,
  payload: AgentActionPayload,
): Promise<{ ok: boolean; message: string }> {
  const { empleadoId, objetivoId, clientId, banda, fecha, empleadoNombre, objetivoNombre } = payload as {
    empleadoId: string;
    objetivoId: string;
    clientId?: string;
    banda: string;
    fecha: string;
    empleadoNombre?: string;
    objetivoNombre?: string;
  };
  if (!empleadoId || !objetivoId || !banda || !fecha) throw new Error('Payload incompleto para crear_turno_refuerzo.');

  const [y, m, d] = fecha.split('-').map(Number);
  const startAr = new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
  const bandaOffsets: Record<string, [number, number]> = {
    M: [0, 8], T: [8, 16], N: [16, 24],
    D12: [0, 12], N12: [12, 24],
  };
  const [startH, endH] = bandaOffsets[banda] ?? [0, 8];
  const startTime = Timestamp.fromDate(addHours(startAr, startH));
  const endTime = Timestamp.fromDate(addHours(startAr, endH));

  const db = admin.firestore();
  await db.collection('turnos').add({
    employeeId: empleadoId,
    objectiveId: objetivoId,
    clientId: clientId ?? '',
    empresaId,
    code: banda,
    startTime,
    endTime,
    origin: 'OPERATIONS_COVERAGE',
    isPresent: false,
    isAbsent: false,
    isCompleted: false,
    draft: false,
    createdByAgent: true,
    createdByAgentAt: Timestamp.now(),
  });

  const nombreDisplay = empleadoNombre ?? empleadoId;
  const sitioDisplay = objetivoNombre ?? objetivoId;
  return { ok: true, message: `✓ Refuerzo creado: **${nombreDisplay}** turno **${banda}** el ${fecha} en **${sitioDisplay}**.` };
}
