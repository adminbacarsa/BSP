/**
 * Escritura de la bolsa y acceso a la app. El cliente no escribe eventuales_bolsa.
 * El permiso es el módulo EVENTUALES; SuperAdmin pasa siempre.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { isEventualPreviewSuperAdmin, resolveBolsaCuilForListar } from './eventualPreviewAuth';

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];

function db() {
  return admin.firestore();
}

async function permisosDe(uid: string, claimRole: string): Promise<{ super: boolean; acciones: string[] }> {
  if (SUPER.includes(claimRole)) return { super: true, acciones: [] };
  const sys = await db().collection('system_users').doc(uid).get();
  const roleId = String(sys.data()?.role || claimRole || '');
  if (SUPER.includes(roleId)) return { super: true, acciones: [] };
  if (!roleId) return { super: false, acciones: [] };
  const rol = await db().collection('roles').doc(roleId).get();
  const acciones = (rol.data()?.permissions?.EVENTUALES || []) as string[];
  return { super: false, acciones };
}

async function exigir(context: functions.https.CallableContext, accion: string) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const permiso = await permisosDe(context.auth.uid, String(context.auth.token.role || ''));
  if (permiso.super || permiso.acciones.includes(accion)) return context.auth;
  throw new functions.https.HttpsError('permission-denied', 'No tenés permiso de eventuales.');
}

async function auditar(action: string, actorUid: string, cuil: string, details: string) {
  await db().collection('audit_logs').add({
    action,
    module: 'EVENTUALES',
    actorUid,
    actorName: actorUid,
    empresaId: null,
    bolsaCuil: cuil,
    details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function plantaTieneCuil(cuil: string): Promise<boolean> {
  const { COTEJO_EMPRESA_IDS } = await import('../eventuales-shared/grupo.mjs') as { COTEJO_EMPRESA_IDS: string[] };
  const { esPlantaPermanente } = await import('../eventuales-shared/planilla.mjs') as {
    esPlantaPermanente: (e: Record<string, unknown>) => boolean;
  };
  const snap = await db().collection('empleados').where('cuil', '==', cuil).limit(20).get();
  return snap.docs.some((d) => COTEJO_EMPRESA_IDS.includes(String(d.data().empresaId || '')) && esPlantaPermanente(d.data()));
}

export const gestionarEventual = functions.https.onCall(async (data, context) => {
  const accion = String(data?.accion || '');
  const mapa: Record<string, string> = { crear: 'create', editar: 'update', baja: 'delete', reactivar: 'update', detalle: 'read' };
  const permiso = mapa[accion];
  if (!permiso) throw new functions.https.HttpsError('invalid-argument', 'Acción desconocida.');
  const auth = await exigir(context, permiso);
  const { validarFicha, planBaja, planReactivar, sugerirObraSocial } = await import('../eventuales-shared/ficha.mjs') as {
    validarFicha: (input: unknown, ctx: unknown) => { ok: boolean; codigo?: string; doc?: Record<string, unknown> };
    planBaja: (motivo: string, fecha: string) => { ok: boolean; codigo?: string; patch?: Record<string, unknown> };
    planReactivar: () => Record<string, unknown>;
    sugerirObraSocial: (fichaRnos: unknown, legajos: { empresaId?: string; obraSocialRnos?: string }[]) => Record<string, unknown>;
  };

  if (accion === 'detalle') {
    const cuil = String(data?.cuil || '');
    const ficha = await db().collection('eventuales_bolsa').doc(cuil).get();
    if (!ficha.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
    const [contratos, envios, historial, legajosOs] = await Promise.all([
      db().collection('contratos_eventuales').where('bolsaCuil', '==', cuil).get(),
      db().collection('arca_envios').where('bolsaCuil', '==', cuil).get(),
      db().collection('audit_logs').where('bolsaCuil', '==', cuil).limit(30).get(),
      db().collection('empleados').where('cuil', '==', cuil).limit(20).get(),
    ]);
    return {
      ficha: { id: ficha.id, ...ficha.data() },
      contratos: contratos.docs.map((d) => ({ id: d.id, ...d.data() })),
      arca: envios.docs.map((d) => {
        const e = d.data();
        return { id: d.id, tipo: e.tipo, estado: e.estado, fechaAlta: e.fechaAlta, fechaBaja: e.fechaBaja, nroTransaccion: e.nroTransaccion || null };
      }),
      historial: historial.docs.map((d) => {
        const h = d.data();
        return { id: d.id, action: h.action, details: h.details || '', at: h.timestamp?.toDate?.()?.toISOString?.() || null };
      }),
      rnos: sugerirObraSocial(ficha.data()?.obraSocialRnos, legajosOs.docs.map((d) => ({
        empresaId: String(d.data().empresaId || ''),
        obraSocialRnos: String(d.data().obraSocialRnos || ''),
      }))),
    };
  }

  if (accion === 'baja' || accion === 'reactivar') {
    const cuil = String(data?.cuil || '');
    const ref = db().collection('eventuales_bolsa').doc(cuil);
    if (!(await ref.get()).exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
    const patch = accion === 'baja' ? planBaja(data?.motivo, data?.fecha) : { ok: true, patch: planReactivar() };
    if (!patch.ok) throw new functions.https.HttpsError('invalid-argument', patch.codigo || 'DATOS');
    await ref.set({ ...patch.patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await auditar(accion === 'baja' ? 'EVENTUAL_BAJA' : 'EVENTUAL_REACTIVAR', auth.uid, cuil, String(data?.motivo || 'reactivado'));
    return { ok: true };
  }

  const cuilAnterior = String(data?.cuilAnterior || '');
  const validado = validarFicha(data, {
    bolsaCuils: (await db().collection('eventuales_bolsa').select('nombre').get()).docs.map((d) => d.id),
    plantaCuils: [],
  });
  if (!validado.ok || !validado.doc) throw new functions.https.HttpsError('invalid-argument', validado.codigo || 'DATOS');
  if (await plantaTieneCuil(String(validado.doc.cuil))) {
    throw new functions.https.HttpsError('already-exists', 'DUPLICADO_PLANTA');
  }
  const cuil = String(validado.doc.cuil);
  if (accion === 'crear' && (await db().collection('eventuales_bolsa').doc(cuil).get()).exists) {
    throw new functions.https.HttpsError('already-exists', 'DUPLICADO_BOLSA');
  }
  const ref = db().collection('eventuales_bolsa').doc(cuil);
  const prev = await ref.get();
  await ref.set({
    ...validado.doc,
    disponibilidad: accion === 'editar' && prev.exists ? prev.data()?.disponibilidad || 'DISPONIBLE' : 'DISPONIBLE',
    uid: prev.data()?.uid || null,
    legajos: prev.data()?.legajos || [],
    createdAt: prev.exists ? prev.data()?.createdAt : admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  if (cuilAnterior && cuilAnterior !== cuil) {
    await db().collection('eventuales_bolsa').doc(cuilAnterior).set({
      disponibilidad: 'NO_DISPONIBLE',
      bajaBolsa: { motivo: 'CUIL corregido', fecha: new Date().toISOString().slice(0, 10), reemplazadoPor: cuil },
    }, { merge: true });
  }
  await auditar(accion === 'crear' ? 'EVENTUAL_ALTA' : 'EVENTUAL_EDIT', auth.uid, cuil, String(validado.doc.nombre));
  return { ok: true, cuil };
});

export const crearAccesoEventual = functions.https.onCall(async (data, context) => {
  const auth = await exigir(context, 'update');
  const cuil = String(data?.cuil || '');
  const ref = db().collection('eventuales_bolsa').doc(cuil);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
  const { planAccesoEventual } = await import('../eventuales-shared/ficha.mjs') as {
    planAccesoEventual: (b: Record<string, unknown>) => { ok: boolean; codigo?: string; mail?: string; claims?: Record<string, string> };
  };
  const plan = planAccesoEventual({ cuil, ...snap.data() });
  if (!plan.ok || !plan.mail || !plan.claims) throw new functions.https.HttpsError('failed-precondition', plan.codigo || 'DATOS');

  let uid: string;
  try {
    const existing = await admin.auth().getUserByEmail(plan.mail);
    uid = existing.uid;
    await admin.auth().setCustomUserClaims(uid, plan.claims);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code !== 'auth/user-not-found') throw e;
    const temp = Math.random().toString(36).slice(2, 14);
    const created = await admin.auth().createUser({ email: plan.mail, password: temp, displayName: String(snap.data()?.nombre || plan.mail) });
    uid = created.uid;
    await admin.auth().setCustomUserClaims(uid, plan.claims);
  }

  const crypto = await import('crypto');
  const token = crypto.randomUUID();
  await db().collection('device_activations').doc(token).set({
    bolsaCuil: cuil,
    uid,
    email: plan.mail,
    tipo: 'EVENTUAL',
    expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1000)),
    used: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await ref.set({
    uid,
    portalInvite: { sent: true, email: plan.mail, sentBy: auth.uid, sentAt: admin.firestore.FieldValue.serverTimestamp() },
  }, { merge: true });
  await auditar('EVENTUAL_ACCESO', auth.uid, cuil, plan.mail);
  return { ok: true, uid, activacion: `https://comtroldata.web.app/app/activar?t=${token}` };
});

export const listarTurnosEventual = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const token = context.auth.token as { role?: unknown; type?: unknown };
  const isSuper = isEventualPreviewSuperAdmin(token.role, token.type);
  const ownSnap = await db().collection('eventuales_bolsa').where('uid', '==', context.auth.uid).limit(1).get();
  const target = resolveBolsaCuilForListar({
    isSuperAdmin: isSuper,
    ownBolsaCuil: ownSnap.empty ? null : ownSnap.docs[0].id,
    requestedBolsaCuil: String((data as { bolsaCuil?: string } | null)?.bolsaCuil || ''),
  });
  if (!target) throw new functions.https.HttpsError('permission-denied', 'No es un eventual.');
  const bolsaSnap = target.preview
    ? await db().collection('eventuales_bolsa').doc(target.bolsaCuil).get()
    : ownSnap.docs[0];
  if (!bolsaSnap.exists) throw new functions.https.HttpsError('not-found', 'Eventual no encontrado.');
  const bolsa = bolsaSnap;
  const cuil = bolsa.id;
  const legajos = ((bolsa.data()?.legajos) || []) as { empresaId?: string; employeeId?: string }[];
  const porCuil = await db().collection('turnos').where('bolsaCuil', '==', cuil).limit(200).get();
  const vistos = new Set(porCuil.docs.map((d) => d.id));
  const extra: { id: string; data: () => Record<string, unknown> }[] = [];
  for (const leg of legajos) {
    if (!leg.employeeId) continue;
    const snap = await db().collection('turnos').where('employeeId', '==', leg.employeeId).limit(100).get();
    snap.docs.forEach((d) => { if (!vistos.has(d.id)) extra.push(d); });
  }
  const turnos = [...porCuil.docs, ...extra].map((d) => {
    const t = d.data();
    return {
      id: d.id,
      empresaId: t.empresaId || null,
      fecha: t.fecha || null,
      code: t.code || null,
      objectiveName: t.objectiveName || null,
      startTime: t.startTime || null,
      endTime: t.endTime || null,
    };
  });
  const empresas = [...new Set(turnos.map((t) => t.empresaId).filter(Boolean))];
  return { bolsaCuil: cuil, empresas, turnos };
});
