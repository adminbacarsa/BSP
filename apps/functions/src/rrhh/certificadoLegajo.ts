import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { Readable } from 'stream';
import * as admin from 'firebase-admin';
import { resolveOrCreateDriveFolder } from '../backup/backup.service';

type Reglas = {
  lecturaLimpia: (raw: unknown) => Lectura;
  compararCertificado: (ausencia: Record<string, unknown>, lectura: Lectura) => Comparacion;
  decidirCertificado: (input: {
    modo: string;
    lectura: Lectura;
    comparacion: Comparacion;
    esEventual: boolean;
  }) => Decision;
  nombreCarpetaLegajo: (input: { apellido: string; nombre: string; cuil: string; legajo: string }) => string;
  nombreArchivoCertificado: (input: { fecha: string; tipo: string; desde: string; hasta: string; ext: string }) => string;
  PROMPT_CERTIFICADO: string;
  parseRespuestaGemini: (text: string) => Lectura;
};

type Lectura = {
  fechaEmision: string;
  medico: string;
  matricula: string;
  reposoDesde: string;
  reposoHasta: string;
  tipo: string;
  firmaVisible: boolean | null;
  selloVisible: boolean | null;
  legible: boolean | null;
  nombre: string;
  dni: string;
  confianza: Record<string, number>;
};

type Comparacion = {
  coincidePersona: boolean;
  coincideDias: boolean;
  rangoDifiere: boolean;
  dudas: string[];
  confianzaAlta: boolean;
};

type Decision = {
  accion: string;
  texto: string;
  tocaAusencia: boolean;
  paga?: boolean;
  dudas?: string[];
  code?: string;
  label?: string;
  ajustarRango?: boolean;
  reposoDesde?: string;
  reposoHasta?: string;
  justificadaPor?: string;
};

type DriveLike = {
  files: {
    create: (req: Record<string, unknown>) => Promise<{ data: { id?: string | null; webViewLink?: string | null } }>;
    list?: (req: Record<string, unknown>) => Promise<{ data: { files?: { id?: string }[] } }>;
  };
};

export type ProcesarDeps = {
  bytes?: Buffer | null;
  mime?: string;
  drive?: DriveLike | null;
  lector?: ((bytes: Buffer) => Promise<unknown>) | null;
  forzarLectura?: boolean;
  ahora?: () => string;
};

function reglas(): Promise<Reglas> {
  return import('./certificadoIa.mjs') as Promise<Reglas>;
}

function extDe(nombre: string, mime: string): string {
  const parte = nombre.split('.').pop() || '';
  if (parte && parte !== nombre && parte.length <= 5) return parte.toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  return 'jpg';
}

async function bajarStorage(storagePath: string): Promise<Buffer | null> {
  if (!storagePath) return null;
  const file = admin.storage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  return buf;
}

async function clienteDriveReal(): Promise<DriveLike> {
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
  return google.drive({ version: 'v3', auth }) as unknown as DriveLike;
}

async function marcarPendiente(db: Firestore, ausenciaId: string, error?: string) {
  await db.collection('ausencias').doc(ausenciaId).set({
    certificateDrivePendiente: true,
    ...(error ? { certificateDriveMigrateError: error.slice(0, 500) } : { certificateDriveMigrateError: FieldValue.delete() }),
  }, { merge: true });
}

export async function archivarCertificadoLegajo(
  db: Firestore,
  ausenciaId: string,
  data: Record<string, unknown>,
  deps: ProcesarDeps = {},
): Promise<{ drivePendiente: boolean; driveFileId: string | null; driveLink: string | null }> {
  if (String(data.certificateDriveFileId || '').trim()) {
    return {
      drivePendiente: false,
      driveFileId: String(data.certificateDriveFileId),
      driveLink: String(data.certificateDriveLink || '') || null,
    };
  }
  const lib = await reglas();
  const empresaId = String(data.empresaId || '').trim();
  const employeeId = String(data.employeeId || '').trim();
  const empresa = empresaId ? await db.collection('empresas').doc(empresaId).get() : null;
  const root = String(empresa?.data()?.legajosDriveFolderId || '').trim();
  const empleadoSnap = employeeId ? await db.collection('empleados').doc(employeeId).get() : null;
  const empleado = empleadoSnap?.data() || {};
  const cuil = String(data.bolsaCuil || empleado.cuil || empleado.bolsaCuil || '').replace(/\D/g, '');
  const bolsaSnap = cuil ? await db.collection('eventuales_bolsa').doc(cuil).get() : null;
  const bolsa = bolsaSnap?.data() || {};
  const folderExistente = String(bolsa.driveFolderId || empleado.driveFolderId || '').trim();
  const folderNameExistente = String(bolsa.driveFolderName || empleado.driveFolderName || '');

  if (!folderExistente && !root) {
    await marcarPendiente(db, ausenciaId);
    return { drivePendiente: true, driveFileId: null, driveLink: null };
  }

  const bytes = deps.bytes || await bajarStorage(String(data.certificateStoragePath || '')).catch(() => null);
  if (!bytes?.length) {
    await marcarPendiente(db, ausenciaId, 'Sin archivo en Storage');
    return { drivePendiente: true, driveFileId: null, driveLink: null };
  }

  let drive = deps.drive;
  if (!drive) {
    try {
      drive = await clienteDriveReal();
    } catch (e) {
      await marcarPendiente(db, ausenciaId, (e as Error).message || 'Sin Drive');
      return { drivePendiente: true, driveFileId: null, driveLink: null };
    }
  }

  try {
    let folderId = folderExistente;
    let folderName = folderNameExistente;
    if (!folderId) {
      folderName = lib.nombreCarpetaLegajo({
        apellido: String(empleado.lastName || empleado.apellido || ''),
        nombre: String(empleado.firstName || empleado.nombre || data.employeeName || ''),
        cuil,
        legajo: String(empleado.fileNumber || empleado.legajo || ''),
      });
      folderId = await resolveOrCreateDriveFolder(drive, root, folderName);
    }
    const anio = String(data.startDate || '').slice(0, 4) || String(new Date().getFullYear());
    const certs = await resolveOrCreateDriveFolder(drive, folderId, 'Certificados');
    const anioId = await resolveOrCreateDriveFolder(drive, certs, anio);
    const nombre = lib.nombreArchivoCertificado({
      fecha: String(data.startDate || ''),
      tipo: String(data.type || 'certificado'),
      desde: String(data.startDate || ''),
      hasta: String(data.endDate || data.startDate || ''),
      ext: extDe(String(data.certificateName || ''), deps.mime || ''),
    });
    const mime = deps.mime || 'application/octet-stream';
    const creado = await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: nombre, parents: [anioId], mimeType: mime },
      media: { mimeType: mime, body: Readable.from(bytes) },
      fields: 'id, webViewLink',
    });
    const driveFileId = String(creado.data.id || '');
    const driveLink = creado.data.webViewLink || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : '');
    await db.collection('ausencias').doc(ausenciaId).set({
      certificateDriveFileId: driveFileId,
      certificateDriveLink: driveLink,
      certificateDrivePendiente: false,
      certificateDriveMigrateError: FieldValue.delete(),
      certificateMigratedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const sync = { driveFolderId: folderId, driveFolderName: folderName || folderId };
    if (employeeId) await db.collection('empleados').doc(employeeId).set(sync, { merge: true });
    if (cuil) await db.collection('eventuales_bolsa').doc(cuil).set(sync, { merge: true });
    const storagePath = String(data.certificateStoragePath || '');
    if (storagePath && !deps.bytes) {
      await admin.storage().bucket().file(storagePath).delete().catch(() => {});
    }
    return { drivePendiente: false, driveFileId, driveLink };
  } catch (e) {
    await marcarPendiente(db, ausenciaId, (e as Error).message || 'Drive');
    return { drivePendiente: true, driveFileId: null, driveLink: null };
  }
}

function evidencia(lectura: Lectura, comparacion: Comparacion, decision: Decision) {
  return {
    fechaEmision: lectura.fechaEmision,
    medico: lectura.medico,
    matricula: lectura.matricula,
    reposoDesde: lectura.reposoDesde,
    reposoHasta: lectura.reposoHasta,
    tipo: lectura.tipo,
    firmaVisible: lectura.firmaVisible,
    selloVisible: lectura.selloVisible,
    legible: lectura.legible,
    confianza: lectura.confianza,
    coincidePersona: comparacion.coincidePersona,
    coincideDias: comparacion.coincideDias,
    rangoDifiere: comparacion.rangoDifiere,
    dudas: comparacion.dudas,
    decision: decision.accion,
    texto: decision.texto,
    code: decision.code || null,
    label: decision.label || null,
  };
}

export async function aplicarLecturaCertificado(
  db: Firestore,
  ausenciaId: string,
  raw: unknown,
): Promise<Decision> {
  const lib = await reglas();
  const ref = db.collection('ausencias').doc(ausenciaId);
  const snap = await ref.get();
  const data = snap.data() || {};
  const employeeId = String(data.employeeId || '');
  const empleado = employeeId ? (await db.collection('empleados').doc(employeeId).get()).data() || {} : {};
  const cuil = String(data.bolsaCuil || empleado.cuil || empleado.bolsaCuil || '').replace(/\D/g, '');
  const esEventual = data.esEventual === true
    || !!String(data.bolsaCuil || '').replace(/\D/g, '')
    || empleado.tipo === 'EVENTUAL'
    || empleado.esEventual === true;
  const empresaId = String(data.empresaId || empleado.empresaId || '');
  const empresa = empresaId ? await db.collection('empresas').doc(empresaId).get() : null;
  const modo = String(empresa?.data()?.certificadoIaModo || 'PROPUESTA');
  const lectura = lib.lecturaLimpia(raw);
  const comparacion = lib.compararCertificado({
    ...data,
    employeeName: data.employeeName || `${empleado.lastName || ''} ${empleado.firstName || ''}`,
    dni: empleado.dni || empleado.documento || '',
    cuil: cuil || empleado.cuil || '',
  }, lectura);
  const decision = lib.decidirCertificado({ modo, lectura, comparacion, esEventual });
  const ahora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    certificadoIa: { ...evidencia(lectura, comparacion, decision), modo, leidoAt: ahora },
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (decision.accion === 'JUSTIFICAR') {
    patch.status = 'Justificada';
    patch.type = decision.label;
    patch.absenceType = decision.code;
    patch.revisionEstado = 'JUSTIFICADA';
    patch.justificadaPor = 'IA';
    patch.hasCertificate = true;
    if (decision.ajustarRango && decision.reposoDesde && decision.reposoHasta) {
      patch.startDate = decision.reposoDesde;
      patch.endDate = decision.reposoHasta;
    }
    patch.historial = FieldValue.arrayUnion({ texto: `Justificada (${decision.label})`, por: 'IA', at: ahora });
  } else if (decision.accion === 'RECIBIDO') {
    patch.conCertificado = true;
    patch.historial = FieldValue.arrayUnion({ texto: 'Certificado recibido', por: 'IA', at: ahora });
  } else if (data.status !== 'Justificada') {
    patch.status = 'En verificación';
    patch.historial = FieldValue.arrayUnion({ texto: 'Certificado en verificación', por: 'IA', at: ahora });
  }
  await ref.set(patch, { merge: true });

  if (decision.accion === 'JUSTIFICAR' && decision.code) {
    const turnos = await db.collection('turnos').where('ausenciaId', '==', ausenciaId).get();
    for (const turno of turnos.docs) {
      const cambio: Record<string, unknown> = { absenceType: decision.code };
      if (decision.ajustarRango) cambio.ausenciaRangoAjustadoPor = 'IA';
      await turno.ref.set(cambio, { merge: true });
    }
  }
  if (decision.accion === 'RECIBIDO' && data.shiftId) {
    const ev = await db.collection('guardia_desempeno_eventos').where('turnoId', '==', String(data.shiftId)).limit(5).get();
    for (const doc of ev.docs) await doc.ref.set({ conCertificado: true }, { merge: true });
  }

  const novId = `aviso_portal_${ausenciaId}`;
  const descripcion = decision.ajustarRango
    ? `${decision.texto}. El reposo no coincide con los días cargados.`
    : decision.texto;
  await db.collection('novedades').doc(novId).set({
    type: 'AVISO_AUSENCIA_PORTAL',
    source: 'AUSENCIA',
    status: decision.accion === 'JUSTIFICAR' ? 'ATENDIDA' : 'pending',
    handledBy: 'RRHH',
    title: decision.accion === 'PROPUESTA' ? 'Propuesta de certificado' : 'Certificado para revisar',
    description: descripcion,
    employeeId: employeeId || null,
    employeeName: data.employeeName || '',
    empresaId: empresaId || null,
    ausenciaId,
    certificadoPropuesta: decision.texto,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection('audit_logs').add({
    action: decision.accion === 'JUSTIFICAR' ? 'CERTIFICADO_IA_DECISION' : 'CERTIFICADO_IA_LECTURA',
    module: 'RRHH',
    empresaId: empresaId || null,
    ausenciaId,
    decision: decision.accion,
    texto: decision.texto,
    dudas: decision.dudas || [],
    actorName: 'IA',
    timestamp: FieldValue.serverTimestamp(),
  });
  return decision;
}

export async function aplicarDecisionCertificado(
  db: Firestore,
  input: { ausenciaId: string; decision: 'aprobar' | 'rechazar' | 'revertir'; actor?: string },
): Promise<{ ok: boolean }> {
  const ref = db.collection('ausencias').doc(input.ausenciaId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false };
  const data = snap.data() || {};
  const ia = (data.certificadoIa || {}) as { decision?: string; code?: string; label?: string; texto?: string };
  const actor = input.actor || 'RRHH';
  const ahora = new Date().toISOString();
  const empresaId = String(data.empresaId || '');
  const cuil = String(data.bolsaCuil || '').replace(/\D/g, '');
  if (input.decision === 'aprobar') {
    if (cuil || data.esEventual === true) {
      await ref.set({
        certificadoIa: { ...ia, decision: 'RECIBIDO' },
        conCertificado: true,
        historial: FieldValue.arrayUnion({ texto: 'Certificado recibido', por: actor, at: ahora }),
      }, { merge: true });
    } else if (ia.code && ia.label) {
      await ref.set({
        status: 'Justificada',
        type: ia.label,
        absenceType: ia.code,
        revisionEstado: 'JUSTIFICADA',
        justificadaPor: 'IA',
        certificadoIa: { ...ia, decision: 'APROBADA' },
        historial: FieldValue.arrayUnion({ texto: `Justificada (${ia.label})`, por: actor, at: ahora }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      const turnos = await db.collection('turnos').where('ausenciaId', '==', input.ausenciaId).get();
      for (const turno of turnos.docs) await turno.ref.set({ absenceType: ia.code }, { merge: true });
    }
    if (empresaId) {
      await db.collection('empresas').doc(empresaId).update({
        'certificadoIaMetricas.aprobadas': FieldValue.increment(1),
      }).catch(() => {});
    }
  } else if (input.decision === 'rechazar') {
    await ref.set({
      certificadoIa: { ...ia, decision: 'RECHAZADA' },
      historial: FieldValue.arrayUnion({ texto: 'RRHH rechazó la propuesta', por: actor, at: ahora }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (empresaId) {
      await db.collection('empresas').doc(empresaId).update({
        'certificadoIaMetricas.rechazadas': FieldValue.increment(1),
      }).catch(() => {});
    }
  } else if (input.decision === 'revertir' && data.justificadaPor === 'IA') {
    await ref.set({
      status: 'Avisada',
      revisionEstado: 'POR_REVISAR',
      justificadaPor: FieldValue.delete(),
      certificadoIa: { ...ia, decision: 'REVERTIDA' },
      historial: FieldValue.arrayUnion({ texto: 'RRHH revirtió la justificación', por: actor, at: ahora }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    return { ok: false };
  }
  await db.collection('audit_logs').add({
    action: 'CERTIFICADO_IA_DECISION',
    module: 'RRHH',
    empresaId: empresaId || null,
    ausenciaId: input.ausenciaId,
    decision: input.decision,
    texto: ia.texto || '',
    actorName: actor,
    timestamp: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

export async function procesarCertificadoSubido(
  db: Firestore,
  ausenciaId: string,
  data: Record<string, unknown>,
  deps: ProcesarDeps = {},
): Promise<{ drivePendiente: boolean; decision: string | null }> {
  const archivo = await archivarCertificadoLegajo(db, ausenciaId, data, deps);
  const yaLeido = !!(data.certificadoIa as { leidoAt?: string } | undefined)?.leidoAt;
  if (yaLeido && !deps.forzarLectura) return { drivePendiente: archivo.drivePendiente, decision: null };
  const bytes = deps.bytes || null;
  let raw: unknown = null;
  if (deps.lector && bytes) raw = await deps.lector(bytes);
  else if (bytes && process.env.GEMINI_API_KEY) raw = await leerCertificadoGemini(bytes, deps.mime || 'image/jpeg');
  if (!raw) return { drivePendiente: archivo.drivePendiente, decision: null };
  const decision = await aplicarLecturaCertificado(db, ausenciaId, raw);
  return { drivePendiente: archivo.drivePendiente, decision: decision.accion };
}

export async function leerCertificadoGemini(bytes: Buffer, mime: string): Promise<unknown> {
  const lib = await reglas();
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
  const modelo = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mime, data: bytes.toString('base64') } },
          { text: lib.PROMPT_CERTIFICADO },
        ],
      }],
      generationConfig: { temperature: 0, response_mime_type: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const body = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return lib.parseRespuestaGemini(text);
}

export async function reintentarCertificadosPendientes(
  db: Firestore,
  empresaId: string,
  deps: ProcesarDeps = {},
): Promise<number> {
  const snap = await db.collection('ausencias').where('certificateDrivePendiente', '==', true).limit(40).get();
  let n = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (String(data.empresaId || '') !== empresaId) continue;
    await procesarCertificadoSubido(db, doc.id, { ...data, certificateDriveFileId: data.certificateDriveFileId || '' }, deps);
    n += 1;
  }
  return n;
}
