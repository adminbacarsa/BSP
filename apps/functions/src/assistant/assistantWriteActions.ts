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

export async function ejecutarConfirmarPresencia(
  empresaId: string,
  payload: AgentActionPayload,
): Promise<{ ok: boolean; message: string }> {
  const { shiftId, empleadoNombre, objetivoNombre, fecha } = payload as {
    shiftId: string;
    empleadoNombre?: string;
    objetivoNombre?: string;
    fecha?: string;
  };
  if (!shiftId) throw new Error('Payload incompleto: falta shiftId.');
  const db = admin.firestore();
  await db.collection('turnos').doc(shiftId).update({
    isPresent: true,
    presentAt: Timestamp.now(),
    modifiedByAgent: true,
    modifiedByAgentAt: Timestamp.now(),
    modifiedByAgentEmpresaId: empresaId,
  });
  const nombre = empleadoNombre ?? 'Empleado';
  const sitio = objetivoNombre ? ` en **${objetivoNombre}**` : '';
  const dia = fecha ? ` el ${fecha}` : '';
  return { ok: true, message: `✓ Presencia confirmada: **${nombre}**${dia}${sitio} marcado como presente.` };
}

export async function ejecutarRegistrarAusencia(
  empresaId: string,
  payload: AgentActionPayload,
): Promise<{ ok: boolean; message: string }> {
  const { shiftId, empleadoId, objetivoId, fecha, empleadoNombre, objetivoNombre, motivo } = payload as {
    shiftId: string;
    empleadoId: string;
    objetivoId?: string;
    fecha: string;
    empleadoNombre?: string;
    objetivoNombre?: string;
    motivo?: string;
  };
  if (!shiftId || !empleadoId || !fecha) throw new Error('Payload incompleto para registrar_ausencia.');
  const db = admin.firestore();
  await db.collection('turnos').doc(shiftId).update({
    isAbsent: true,
    modifiedByAgent: true,
    modifiedByAgentAt: Timestamp.now(),
    modifiedByAgentEmpresaId: empresaId,
  });
  await db.collection('ausencias').add({
    employeeId: empleadoId,
    objectiveId: objetivoId ?? '',
    shiftId,
    empresaId,
    date: fecha,
    motivo: motivo ?? 'AA',
    origin: 'AGENT',
    createdByAgent: true,
    createdByAgentAt: Timestamp.now(),
  });
  const nombre = empleadoNombre ?? 'Empleado';
  const sitio = objetivoNombre ? ` en **${objetivoNombre}**` : '';
  return { ok: true, message: `✓ Ausencia registrada: **${nombre}** marcado como ausente${sitio} el ${fecha}.` };
}

export async function ejecutarCerrarTurno(
  empresaId: string,
  payload: AgentActionPayload,
): Promise<{ ok: boolean; message: string }> {
  const { shiftId, empleadoId, empleadoNombre, objetivoId, objetivoNombre, fecha } = payload as {
    shiftId: string;
    empleadoId?: string;
    empleadoNombre?: string;
    objetivoId?: string;
    objetivoNombre?: string;
    fecha?: string;
  };
  if (!shiftId) throw new Error('Payload incompleto: falta shiftId.');
  const db = admin.firestore();
  const now = Timestamp.now();

  await db.collection('turnos').doc(shiftId).update({
    status: 'COMPLETED',
    isCompleted: true,
    isPresent: false,
    realEndTime: now,
    modifiedByAgent: true,
    modifiedByAgentAt: now,
    modifiedByAgentEmpresaId: empresaId,
  });

  // Audit log (fire and forget)
  const nombre = empleadoNombre ?? 'Guardia';
  const sitio = objetivoNombre ?? '';
  db.collection('audit_logs').add({
    action: 'CHECKOUT',
    module: 'ASISTENTE_IA',
    actorName: 'Asistente COSP',
    timestamp: now,
    empleadoId: empleadoId ?? '',
    employeeId: empleadoId ?? '',
    empleadoNombre: nombre,
    employeeName: nombre,
    objetivoId: objetivoId ?? '',
    objectiveId: objetivoId ?? '',
    objetivoNombre: sitio,
    objectiveName: sitio,
    shiftId,
    empresaId,
    details: `${nombre} finalizó turno${sitio ? ` en ${sitio}` : ''} (vía Asistente IA).`,
  }).catch(() => {});

  // Auto-descartar novedades de retención/recargo del turno
  const AUTO_DISMISS = ['RETENCION_LARGA', 'RECARGO_12H', 'RETENCION_DETECTADA'];
  db.collection('novedades')
    .where('shiftId', '==', shiftId)
    .where('status', '==', 'pending')
    .limit(20)
    .get()
    .then((snap) => {
      if (snap.empty) return;
      const toUpdate = snap.docs.filter((d) => AUTO_DISMISS.includes(d.data().type));
      if (!toUpdate.length) return;
      const batch = db.batch();
      toUpdate.forEach((d) => batch.update(d.ref, { status: 'ATENDIDA', atendidaAt: now, atendidaPor: 'AUTO_CHECKOUT_AGENT' }));
      return batch.commit();
    })
    .catch(() => {});

  // Notificar al guardia (FCM via onEmployeeNotificationCreated trigger)
  if (empleadoId) {
    db.collection('empleados').doc(empleadoId).get().then((empSnap) => {
      const uid = empSnap.exists ? (empSnap.data()?.uid as string | undefined) : undefined;
      return db.collection('user_notifications').add({
        type: 'TURNO_FINALIZADO',
        title: 'Tu turno fue cerrado',
        body: `Tu turno${sitio ? ` en ${sitio}` : ''}${fecha ? ` del ${fecha}` : ''} fue registrado como finalizado.`,
        employeeId: empleadoId,
        ...(uid ? { uid } : {}),
        shiftId,
        empresaId,
        createdAt: now,
        read: false,
      });
    }).catch(() => {});
  }

  const dia = fecha ? ` del ${fecha}` : '';
  return { ok: true, message: `✓ Turno cerrado: **${nombre}**${dia}${sitio ? ` en **${sitio}**` : ''} — estado COMPLETED, presencia finalizada. El guardia fue notificado.` };
}

export async function ejecutarPlanificarObjetivoMes(
  empresaId: string,
  payload: AgentActionPayload,
): Promise<{ ok: boolean; message: string }> {
  const { objetivoId, clientId, year, month, objetivoNombre } = payload as {
    objetivoId: string;
    clientId?: string;
    year: number;
    month: number;
    objetivoNombre?: string;
  };
  if (!objetivoId || !year || !month) throw new Error('Payload incompleto para planificar_objetivo_mes.');

  const { runAutoScheduleCore } = await import('../scheduling/runAutoSchedule');
  const result = await runAutoScheduleCore({ objectiveId: objetivoId, year, month, empresaId });
  if (!result.ok && result.error) throw new Error(result.error);

  const db = admin.firestore();
  const agentAt = Timestamp.now();
  const BATCH_SIZE = 400;

  function arHhmm(dateStr: string, timeStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, h + 3, min, 0, 0));
  }

  let written = 0;
  let currentBatch = db.batch();
  let batchOps = 0;
  const commits: Promise<FirebaseFirestore.WriteResult[]>[] = [];

  for (const a of result.assignments) {
    if (batchOps >= BATCH_SIZE) {
      commits.push(currentBatch.commit());
      currentBatch = db.batch();
      batchOps = 0;
    }
    const startUtc = arHhmm(a.dateStr, a.startTime);
    let endUtc = a.endTime ? arHhmm(a.dateStr, a.endTime) : new Date(startUtc.getTime() + a.hours * 3600000);
    if (endUtc <= startUtc) endUtc = new Date(endUtc.getTime() + 86400000);

    currentBatch.set(db.collection('turnos').doc(), {
      employeeId: a.empId,
      objectiveId: objetivoId,
      clientId: clientId ?? '',
      empresaId,
      code: a.code,
      startTime: Timestamp.fromDate(startUtc),
      endTime: Timestamp.fromDate(endUtc),
      isFranco: a.isFranco ?? false,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft: true,
      createdByAgent: true,
      createdByAgentAt: agentAt,
    });
    batchOps++;
    written++;
  }
  if (batchOps > 0) commits.push(currentBatch.commit());
  await Promise.all(commits);

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const mesNombre = MESES[(month - 1)] ?? String(month);
  const sitio = objetivoNombre ?? objetivoId;
  const pct = Math.round((result.coverage?.coverageRatio ?? 0) * 100);

  return {
    ok: true,
    message: `✓ Planificación generada en borrador para **${sitio}** — ${mesNombre} ${year}.\n- **${written}** turnos creados · Cobertura: **${pct}%** SLA\n- **${result.meta.employeeCount}** empleados · **${result.meta.positionCount}** puestos\n\nRevisá en **Planificación** y publicá cuando estés listo.`,
  };
}
