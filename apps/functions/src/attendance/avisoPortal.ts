import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

const TZ = 'America/Argentina/Cordoba';
const FRANCO = new Set(['F', 'FF', 'FP']);
const LICENCIA = new Set(['V', 'L', 'E', 'A', 'AA', 'ART', 'PG', 'SGS', 'SUS']);

type Reglas = {
  esAvisoPortal: (doc: Record<string, unknown> | null | undefined) => boolean;
  esVacacionesDeAviso: (doc: Record<string, unknown> | null | undefined) => boolean;
  patchActivacionAviso: (doc: Record<string, unknown>) => Record<string, unknown> | null;
  patchJustificarAviso: (input: {
    code: string;
    label: string;
    tieneCertificado: boolean;
    requiereVerificacionMedica: boolean;
  }) => Record<string, unknown>;
  fechaEnRango: (fecha: string, start: string, end: string) => boolean;
  DETECTED_BY_AVISO: string;
  NOVEDAD_REVISION_RRHH: string;
};

function reglas(): Promise<Reglas> {
  return import('./avisoPortal.mjs') as Promise<Reglas>;
}

function ymdTurno(turno: Record<string, unknown>): string {
  const sched = String(turno.scheduleDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sched)) return sched;
  const start = turno.startTime as { toMillis?: () => number } | undefined;
  const ms = typeof start?.toMillis === 'function' ? start.toMillis() : 0;
  if (!ms) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function entraEnAviso(turno: Record<string, unknown>, id: string, data: Record<string, unknown>, lib: Reglas): boolean {
  if (id && id === String(data.shiftId || '')) return true;
  return lib.fechaEnRango(ymdTurno(turno), String(data.startDate || ''), String(data.endDate || data.startDate || ''));
}

function sePuedeMarcar(turno: Record<string, unknown>, lib: Reglas): boolean {
  if (turno.draft === true || turno.isFranco === true || turno.isPresent === true || turno.isCompleted === true) return false;
  const code = String(turno.code || '').toUpperCase();
  if (FRANCO.has(code) || LICENCIA.has(code)) return false;
  if (String(turno.absenceDetectedBy || '') === lib.DETECTED_BY_AVISO) return false;
  if (turno.isAbsent === true) return false;
  const emp = String(turno.employeeId || '').trim();
  if (!emp || emp === 'VACANTE') return false;
  return true;
}

/**
 * El aviso del portal queda operativo al toque: la ausencia pasa a Avisada y
 * los turnos de esos días quedan ausentes con aviso. No llama a markShiftAbsent
 * (eso fabricaría una AA «No Presentacion») ni abre la vacante: el trigger del
 * turno ausente sigue con la cascada de siempre.
 * `corregirVacaciones` solo lo usa el script de datos: un pedido real de vacaciones
 * no trae el caso corto plazo y el trigger no lo convierte.
 */
export async function aplicarAvisoPortal(
  db: Firestore,
  ausenciaId: string,
  data: Record<string, unknown>,
  opts?: { corregirVacaciones?: boolean },
): Promise<{ aplicado: boolean; turnos: number }> {
  const lib = await reglas();
  const esAviso = lib.esAvisoPortal(data) || (opts?.corregirVacaciones === true && lib.esVacacionesDeAviso(data));
  if (!esAviso) return { aplicado: false, turnos: 0 };

  const patch = lib.patchActivacionAviso(data);
  const ref = db.collection('ausencias').doc(ausenciaId);
  if (patch) {
    const historial = Array.isArray(data.historial) ? data.historial : [];
    const primera = historial.length === 0
      ? {
          historial: [{
            texto: 'Registrada · RRHH revisando',
            por: String(data.employeeName || 'Guardia'),
            at: new Date().toISOString(),
          }],
        }
      : {};
    await ref.update({ ...patch, ...primera, operativo: true, updatedAt: FieldValue.serverTimestamp() });
  }

  const employeeId = String(data.employeeId || '').trim();
  const empresaId = String(data.empresaId || '').trim();
  const vistos = new Map<string, Record<string, unknown>>();
  if (employeeId) {
    const snap = await db.collection('turnos').where('employeeId', '==', employeeId).get();
    snap.docs.forEach((d) => vistos.set(d.id, d.data()));
  }
  const shiftId = String(data.shiftId || '').trim();
  if (shiftId && !vistos.has(shiftId)) {
    const uno = await db.collection('turnos').doc(shiftId).get();
    if (uno.exists) vistos.set(uno.id, uno.data() || {});
  }

  const now = Timestamp.now();
  let turnos = 0;
  for (const [id, turno] of vistos) {
    if (empresaId && String(turno.empresaId || '').trim() && String(turno.empresaId || '').trim() !== empresaId) continue;
    if (!entraEnAviso(turno, id, data, lib)) continue;
    if (!sePuedeMarcar(turno, lib)) continue;
    const patchTurno: Record<string, unknown> = {
      isAbsent: true,
      status: 'ABSENT',
      absenceType: 'AA',
      absenceDetectedAt: turno.absenceDetectedAt || now,
      absenceDetectedBy: lib.DETECTED_BY_AVISO,
      ausenciaId,
      notifiedAbsent: true,
      ausenciaConAviso: true,
    };
    const cuil = String(turno.bolsaCuil || data.bolsaCuil || '').trim();
    if (turno.esEventual === true || cuil) {
      const inicio = (turno.startTime as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
      const horasAntes = inicio > Date.now() ? (inicio - Date.now()) / 3600000 : 0;
      const tipo = horasAntes >= 24 ? 'CANCELACION_ANTICIPADA' : 'CANCELACION_TARDIA';
      patchTurno.pagaJornada = false;
      patchTurno.eventualDesempeno = tipo;
      patchTurno.eventualNoSePresentoMotivo = 'NO_PUEDE_ASISTIR';
      await db.collection('guardia_desempeno_eventos').doc(`${tipo}_${id}`).set({
        empleadoId: String(turno.employeeId || employeeId),
        bolsaCuil: cuil || null,
        tipo,
        fecha: ymdTurno(turno) || String(data.startDate || ''),
        turnoId: id,
        eventoId: turno.eventoId || null,
        empresaId: String(turno.empresaId || empresaId || ''),
        esEventual: true,
        aviso: true,
        createdAt: now,
      }, { merge: true });
    }
    await db.collection('turnos').doc(id).update(patchTurno);
    turnos += 1;
  }

  const novId = `aviso_portal_${ausenciaId}`;
  const novRef = db.collection('novedades').doc(novId);
  const ya = await novRef.get();
  if (!ya.exists) {
    const nombre = String(data.employeeName || 'Guardia');
    const motivo = String(data.reason || '').trim();
    await novRef.set({
      type: lib.NOVEDAD_REVISION_RRHH,
      source: 'AUSENCIA',
      status: 'pending',
      handledBy: 'RRHH',
      title: 'Aviso de ausencia para revisar',
      description: motivo ? `${nombre} avisó que no va. Motivo: ${motivo}` : `${nombre} avisó que no va.`,
      employeeId,
      employeeName: nombre,
      shiftId: shiftId || null,
      empresaId: empresaId || null,
      objectiveId: data.objectiveId || null,
      objectiveName: data.objectiveName || '',
      startDate: data.startDate || null,
      endDate: data.endDate || data.startDate || null,
      ausenciaId,
      createdAt: now,
    });
  }

  return { aplicado: true, turnos };
}

/** RRHH justifica el aviso (E/L/A). El turno sigue ausente; cambia el código. */
export async function aplicarJustificacionAviso(
  db: Firestore,
  ausenciaId: string,
  input: { code: string; label: string; tieneCertificado: boolean },
): Promise<{ ok: boolean }> {
  const lib = await reglas();
  const ref = db.collection('ausencias').doc(ausenciaId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false };
  const label = String(input.label || '');
  const patch = lib.patchJustificarAviso({
    code: input.code,
    label,
    tieneCertificado: input.tieneCertificado,
    requiereVerificacionMedica: label === 'Enfermedad' || label === 'ART',
  });
  await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
  const shifts = await db.collection('turnos').where('ausenciaId', '==', ausenciaId).get();
  for (const d of shifts.docs) {
    await d.ref.update({ absenceType: patch.absenceType });
  }
  const shiftId = String(snap.data()?.shiftId || '').trim();
  if (shiftId) {
    const uno = await db.collection('turnos').doc(shiftId).get();
    if (uno.exists && String(uno.data()?.ausenciaId || '') !== ausenciaId) {
      await uno.ref.update({ absenceType: patch.absenceType, ausenciaId });
    }
  }
  return { ok: true };
}

/**
 * El portal adjuntó un certificado a una ausencia que ya existía.
 * No justifica ni paga: deja la revisión abierta para RRHH y anota el historial.
 * Si el mismo write cambió el tipo o el estado (lo hizo RRHH), no reabre.
 */
export async function aplicarCertificadoSubido(
  db: Firestore,
  ausenciaId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<{ aplicado: boolean }> {
  const urlNueva = String(after.certificateUrl || '') !== '' && String(after.certificateUrl || '') !== String(before.certificateUrl || '');
  const pathNuevo = String(after.certificateStoragePath || '') !== '' && String(after.certificateStoragePath || '') !== String(before.certificateStoragePath || '');
  if (!urlNueva && !pathNuevo) return { aplicado: false };
  if (String(before.status || '') !== String(after.status || '')) return { aplicado: false };
  if (String(before.type || '') !== String(after.type || '')) return { aplicado: false };
  if (String(after.revisionEstado || '') === 'JUSTIFICADA' || after.status === 'Justificada') return { aplicado: false };

  const ref = db.collection('ausencias').doc(ausenciaId);
  await ref.update({
    revisionEstado: 'POR_REVISAR',
    historial: FieldValue.arrayUnion({
      texto: 'Subió certificado',
      por: String(after.employeeName || 'Guardia'),
      at: new Date().toISOString(),
    }),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const novId = `aviso_portal_${ausenciaId}`;
  const novRef = db.collection('novedades').doc(novId);
  const ya = await novRef.get();
  const nombre = String(after.employeeName || 'Guardia');
  const descripcion = `${nombre} subió un certificado. RRHH lo revisa.`;
  if (ya.exists) {
    await novRef.set({
      status: 'pending',
      description: descripcion,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    await novRef.set({
      type: 'AVISO_AUSENCIA_PORTAL',
      source: 'AUSENCIA',
      status: 'pending',
      handledBy: 'RRHH',
      title: 'Certificado para revisar',
      description: descripcion,
      employeeId: after.employeeId || '',
      employeeName: nombre,
      empresaId: after.empresaId || null,
      ausenciaId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { aplicado: true };
}
