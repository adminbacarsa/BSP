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

/** Empresas activas de la plataforma, con el nombre que se muestra. */
async function empresasPlataformaDetalle(): Promise<{ id: string; nombre: string }[]> {
  const snap = await db().collection('empresas').get();
  return snap.docs
    .filter((d) => d.data().active !== false && d.data().status !== 'INACTIVE')
    .map((d) => ({
      id: d.id,
      nombre: String(d.data().name || d.data().razonSocial || d.data().nombre || d.id),
    }));
}

/** Ids de las empresas de la plataforma (activas). Son las que se pueden habilitar en la ficha. */
async function empresasPlataforma(): Promise<string[]> {
  return (await empresasPlataformaDetalle()).map((e) => e.id);
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
  const mapa: Record<string, string> = {
    crear: 'create', editar: 'update', baja: 'delete', reactivar: 'update', detalle: 'read',
    asignarEmpresas: 'update', importarContacto: 'update', habilitarEmpresa: 'update',
    arcaPendientes: 'read', arcaConfirmar: 'update', arcaAcuseAnulacion: 'update', switchesPruebas: 'update',
    horasMes: 'read', guardarTopeEmpresa: 'update', guardarTopeExcepcion: 'update',
    leerArcaEventuales: 'read', guardarArcaEventuales: 'update',
  };
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
        return { id: d.id, tipo: e.tipo, estado: e.estado, fechaAlta: e.fechaAlta, fechaBaja: e.fechaBaja, nroTransaccion: e.nroTransaccion || null, constanciaUrl: e.constanciaUrl || null, codigoControl: e.codigoControl || null, nroVerificador: e.nroVerificador || null };
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

  if (accion === 'arcaPendientes') {
    const empresaId = String(data?.empresaId || '');
    if (!empresaId) throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
    const { vencerAnulacionesPendientes } = await import('./eventualNoSePresento');
    await vencerAnulacionesPendientes(db(), Date.now());
    const snap = await db().collection('arca_envios').where('empresaId', '==', empresaId).limit(80).get();
    const abiertos = snap.docs.filter((doc) => {
      const row = doc.data();
      if (row.quitadoDelLote === true) return false;
      const estado = String(row.estado || '');
      if (['PENDIENTE', 'ERROR', 'MANUAL', 'SUBIENDO'].includes(estado)) return true;
      return row.tipo === 'ANULACION' && estado === 'ANULADO';
    });
    const fichaCache = new Map<string, Promise<admin.firestore.DocumentSnapshot | null>>();
    const fichaDe = (cuil: string): Promise<admin.firestore.DocumentSnapshot | null> => {
      if (!cuil) return Promise.resolve(null);
      let pendiente = fichaCache.get(cuil);
      if (!pendiente) {
        pendiente = db().collection('eventuales_bolsa').doc(cuil).get();
        fichaCache.set(cuil, pendiente);
      }
      return pendiente;
    };
    const fechaDe = (row: admin.firestore.DocumentData): string => {
      const directa = String(row.fecha || row.fechaAlta || row.fechaBaja || '');
      if (/^\d{4}-\d{2}-\d{2}/.test(directa)) return directa.slice(0, 10);
      const created = row.createdAt as { toMillis?: () => number } | undefined;
      const ms = created?.toMillis?.();
      return ms ? new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10) : '';
    };
    const { fechaAaaammdd, PASOS_ANULACION_MANUAL } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
      fechaAaaammdd: (iso: unknown) => string;
      PASOS_ANULACION_MANUAL: string[];
    };
    const envios = await Promise.all(abiertos.slice(0, 30).map(async (doc) => {
      const row = doc.data();
      const cuil = String(row.bolsaCuil || '');
      const ficha = await fichaDe(cuil);
      const fechaInicio = String(row.fechaInicio || row.fechaAlta || '').slice(0, 10);
      let nroAlta = String(row.nroTransaccionAlta || '');
      const contratoId = Array.isArray(row.contratoIds) ? String(row.contratoIds[0] || '') : '';
      if (row.tipo === 'ANULACION' && !nroAlta && contratoId) {
        const hermanos = await db().collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get();
        const alta = hermanos.docs.find((d) => d.data().tipo === 'AT' && d.data().estado === 'CONFIRMADO');
        nroAlta = String(alta?.data().nroTransaccion || '');
      }
      return {
        id: doc.id,
        nombre: String(ficha?.data()?.nombre || cuil || 'Sin nombre'),
        cuil,
        tipo: String(row.tipo || ''),
        estado: String(row.estado || ''),
        canal: String(row.canal || ''),
        fecha: fechaDe(row),
        nroTransaccion: String(row.nroTransaccion || ''),
        constanciaUrl: String(row.constanciaUrl || ''),
        codigoControl: String(row.codigoControl || ''),
        nroVerificador: String(row.nroVerificador || ''),
        fechaInicio,
        fechaInicioArca: fechaAaaammdd(fechaInicio),
        nroTransaccionAlta: nroAlta,
        venceAnulacionMs: Number(row.venceAnulacionMs) || 0,
        carga: String(row.carga || ''),
        observacionesInternas: String(row.observacionesInternas || ''),
        revista: String(row.revista || ''),
        pasos: row.tipo === 'ANULACION' && row.estado === 'MANUAL' ? PASOS_ANULACION_MANUAL : [],
        acuseAnulacion: String(row.acuseAnulacion || ''),
        manualMotivo: String(row.manualMotivo || ''),
      };
    }));
    envios.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    return { envios };
  }

  if (accion === 'arcaConfirmar') {
    const { aplicarTransicion } = await import('../arca/arcaEnviosApi');
    const envioId = String(data?.envioId || '');
    const nroTransaccion = String(data?.nroTransaccion || '').trim();
    if (!envioId || !nroTransaccion) throw new functions.https.HttpsError('invalid-argument', 'Falta el envío o el número de transacción.');
    const out = await aplicarTransicion(envioId, {
      estado: 'CONFIRMADO',
      origen: 'MANUAL',
      nroTransaccion,
      actor: auth.uid,
    });
    if (out.status !== 200) throw new functions.https.HttpsError('failed-precondition', String(out.body.error || 'No se pudo confirmar.'));
    return { ok: true };
  }

  if (accion === 'arcaAcuseAnulacion') {
    const { transicionEnvio } = await import('../arca/arcaEnviosCore');
    const { plazoAnulacionAlta, convertirAnulacionVencida, revistaDesistimientoDe } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
      plazoAnulacionAlta: (i: Record<string, unknown>) => { puedeAnular: boolean };
      convertirAnulacionVencida: (envio: Record<string, unknown>, opts: Record<string, unknown>) => { convertir: boolean };
      revistaDesistimientoDe: (cfg: unknown) => string;
    };
    const envioId = String(data?.envioId || '');
    const acuse = String(data?.acuse || '').trim();
    if (!envioId) throw new functions.https.HttpsError('invalid-argument', 'Falta el envío.');
    const ref = db().collection('arca_envios').doc(envioId);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No existe el envío.');
    const envio = snap.data() || {};
    if (envio.tipo !== 'ANULACION') throw new functions.https.HttpsError('failed-precondition', 'NO_ES_ANULACION');
    const feriados = (await db().collection('feriados').get()).docs.map((d) => d.data());
    const plazo = plazoAnulacionAlta({
      fechaInicio: envio.fechaInicio || envio.fechaAlta,
      horaInicio: envio.horaInicio || '08:00',
      ahoraMs: Date.now(),
      feriados,
    });
    if (!plazo.puedeAnular || convertirAnulacionVencida(envio, { ahoraMs: Date.now(), feriados, revistaDesistimiento: revistaDesistimientoDe(null) }).convertir) {
      const { vencerAnulacionesPendientes } = await import('./eventualNoSePresento');
      await vencerAnulacionesPendientes(db(), Date.now());
      throw new functions.https.HttpsError('failed-precondition', 'PLAZO_VENCIDO');
    }
    const out = transicionEnvio(envio as never, { estado: 'ANULADO', origen: 'MANUAL', acuse, actor: auth.uid });
    if (!out.ok) throw new functions.https.HttpsError('failed-precondition', out.codigo || 'NO_SE_PUDO');
    await ref.update({ ...out.patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await auditar('ARCA_ANULACION_ACUSE', auth.uid, String(envio.bolsaCuil || ''), `Acuse de anulación ${acuse} en ${envioId}`);
    return { ok: true, estado: 'ANULADO' };
  }

  if (accion === 'switchesPruebas') {
    const { planSwitchesPruebas } = await import('../eventuales-shared/pruebasSwitch.mjs') as {
      planSwitchesPruebas: (input: unknown, actual: unknown) => { ok: boolean; codigo?: string; campo?: string; patch?: Record<string, boolean>; patchTurnos?: Record<string, boolean>; cambios?: string[]; detalle?: string };
    };
    const cuil = String(data?.cuil || '').replace(/\D/g, '');
    const ref = db().collection('eventuales_bolsa').doc(cuil);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
    const plan = planSwitchesPruebas({ exigirMarco: data?.exigirMarco, exigirAltaArca: data?.exigirAltaArca }, snap.data() || {});
    if (!plan.ok) throw new functions.https.HttpsError('invalid-argument', plan.codigo || 'DATOS');
    if (!plan.cambios?.length) return { ok: true, cambios: [], turnosActualizados: 0 };
    await ref.set({ ...plan.patch, switchesPruebasAt: admin.firestore.FieldValue.serverTimestamp(), switchesPruebasPor: auth.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    // El gate de fichada lee el turno: los turnos desde hoy heredan el switch de ARCA.
    let turnosActualizados = 0;
    if (plan.patchTurnos && Object.keys(plan.patchTurnos).length) {
      const hoy = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
      const turnos = await db().collection('turnos').where('bolsaCuil', '==', cuil).where('scheduleDate', '>=', hoy).get();
      const batch = db().batch();
      for (const t of turnos.docs) {
        if (t.data().esEventual !== true) continue;
        batch.update(t.ref, plan.patchTurnos);
        turnosActualizados += 1;
      }
      if (turnosActualizados) await batch.commit();
    }
    await auditar('EVENTUAL_SWITCH_PRUEBAS', auth.uid, cuil, `${plan.detalle}${turnosActualizados ? ` · ${turnosActualizados} turno/s actualizados` : ''}`);
    return { ok: true, cambios: plan.cambios, turnosActualizados };
  }

  if (accion === 'horasMes' || accion === 'guardarTopeEmpresa' || accion === 'guardarTopeExcepcion') {
    const { evaluarTopeCuils } = await import('./topeHorasEventual');
    const reglas = await import('../eventuales-shared/topeHoras.mjs') as {
      normalizarTope: (valor: unknown, fallback?: number | null) => number | null;
      normalizarMargen: (valor: unknown, fallback?: number | null, tope?: number) => number | null;
      normalizarPeriodo: (valor: unknown) => string;
      PERIODO_CICLO: string;
      TOPE_MARGEN_DEFAULT: number;
      textoHorasMes: (usadas: number, tope: number) => string;
    };
    const empresaId = String(data?.empresaId || '');
    if (!empresaId) throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
    const empresaRef = db().collection('empresas').doc(empresaId);
    const empresaSnap = await empresaRef.get();
    if (!empresaSnap.exists) throw new functions.https.HttpsError('not-found', 'No está la empresa.');

    if (accion === 'guardarTopeEmpresa') {
      const horas = reglas.normalizarTope(data?.horas, null);
      if (!horas) throw new functions.https.HttpsError('invalid-argument', 'El tope tiene que ser mayor a 0 y hasta 400 h.');
      const periodo = reglas.normalizarPeriodo(data?.periodo);
      const margenIn = data?.margen;
      const margen = margenIn === undefined || margenIn === null || margenIn === ''
        ? reglas.normalizarMargen(empresaSnap.data()?.eventualesTopeMargen, reglas.TOPE_MARGEN_DEFAULT, horas)
        : reglas.normalizarMargen(margenIn, null, horas);
      if (margen === null) throw new functions.https.HttpsError('invalid-argument', 'El margen tiene que ser 0 o más horas.');
      await empresaRef.set({
        eventualesTopeHoras: horas,
        eventualesPeriodoHoras: periodo,
        eventualesTopeMargen: margen,
        eventualesTopeAt: admin.firestore.FieldValue.serverTimestamp(),
        eventualesTopePor: auth.uid,
      }, { merge: true });
      const periodoTxt = periodo === reglas.PERIODO_CICLO ? 'ciclo de liquidación 26→25' : 'mes calendario';
      await db().collection('audit_logs').add({
        action: 'EVENTUAL_TOPE_EMPRESA', module: 'EVENTUALES', actorUid: auth.uid, actorName: auth.uid,
        empresaId, bolsaCuil: null, details: `Tope de horas por mes por eventual: ${horas} h · ${periodoTxt} · margen ${margen} h (no se ofrece desde ${Math.max(0, horas - margen)} h).`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, horas, periodo, margen };
    }

    if (accion === 'guardarTopeExcepcion') {
      const cuil = String(data?.cuil || '').replace(/\D/g, '');
      if (cuil.length !== 11) throw new functions.https.HttpsError('invalid-argument', 'CUIL inválido.');
      const ref = db().collection('eventuales_bolsa').doc(cuil);
      const bolsa = await ref.get();
      if (!bolsa.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
      const quitar = data?.horas === null || data?.horas === '' || Number(data?.horas) === 0;
      const motivo = String(data?.motivo || '').trim();
      if (quitar) {
        await ref.update({ [`topeHorasExcepcion.${empresaId}`]: admin.firestore.FieldValue.delete(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      } else {
        const horas = reglas.normalizarTope(data?.horas, null);
        if (!horas) throw new functions.https.HttpsError('invalid-argument', 'El tope de la excepción tiene que ser mayor a 0 y hasta 400 h.');
        if (motivo.length < 3) throw new functions.https.HttpsError('invalid-argument', 'El motivo de la excepción es obligatorio.');
        await ref.update({
          [`topeHorasExcepcion.${empresaId}`]: { horas, motivo, por: auth.uid, at: new Date().toISOString() },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await db().collection('audit_logs').add({
        action: 'EVENTUAL_TOPE_EXCEPCION', module: 'EVENTUALES', actorUid: auth.uid, actorName: auth.uid,
        empresaId, bolsaCuil: cuil,
        details: quitar ? `Se quitó la excepción de tope en ${empresaId}. Vuelve el tope de la empresa.` : `Excepción de tope: ${reglas.normalizarTope(data?.horas)} h. Motivo: ${motivo}.`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, quitada: quitar };
    }

    const hoy = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(data?.fecha || '')) ? String(data.fecha) : hoy;
    const cuilsPedidos = Array.isArray(data?.cuils) ? (data.cuils as unknown[]).map((c) => String(c).replace(/\D/g, '')).filter((c) => c.length === 11).slice(0, 400) : [];
    const bolsas = new Map<string, { topeHorasExcepcion?: Record<string, { horas?: number; motivo?: string }>; topeHorasReservas?: unknown[] }>();
    if (cuilsPedidos.length) {
      const refs = cuilsPedidos.map((cuil) => db().collection('eventuales_bolsa').doc(cuil));
      for (let i = 0; i < refs.length; i += 10) {
        const got = await db().getAll(...refs.slice(i, i + 10));
        for (const doc of got) {
          if (!doc.exists) continue;
          bolsas.set(doc.id, doc.data() as { topeHorasExcepcion?: Record<string, { horas?: number; motivo?: string }>; topeHorasReservas?: unknown[] });
        }
      }
    } else {
      const snap = await db().collection('eventuales_bolsa').where('empresasHabilitadas', 'array-contains', empresaId).get();
      for (const doc of snap.docs) bolsas.set(doc.id, doc.data() as { topeHorasExcepcion?: Record<string, { horas?: number; motivo?: string }>; topeHorasReservas?: unknown[] });
    }
    const cuils = [...bolsas.keys()];
    const evals = await evaluarTopeCuils(db(), {
      empresaId,
      cuils,
      jornadas: [{ fecha, horaInicio: '00:00', horas: 0 }],
      bolsas,
      empresa: empresaSnap.data() || {},
    });
    const filas = cuils.map((cuil) => {
      const ev = evals.get(cuil);
      return {
        cuil,
        usadas: ev?.usadas || 0,
        tope: ev?.tope || 50,
        texto: ev?.texto || reglas.textoHorasMes(0, ev?.tope || 50),
        aviso: ev?.aviso === true,
        margen: ev?.margen ?? reglas.TOPE_MARGEN_DEFAULT,
        cerca: ev?.cerca === true,
        alcanzado: ev?.alcanzado === true,
        chip: ev?.chip || null,
        excepcion: ev?.excepcion === true,
        motivo: ev?.motivoExcepcion || null,
        topeEmpresa: ev?.topeEmpresa || 50,
      };
    });
    const primero = evals.values().next().value as { periodo?: string; topeEmpresa?: number } | undefined;
    const topeEmpresa = primero?.topeEmpresa ?? reglas.normalizarTope(empresaSnap.data()?.eventualesTopeHoras, 50) ?? 50;
    return {
      ok: true,
      periodo: primero?.periodo || reglas.normalizarPeriodo(empresaSnap.data()?.eventualesPeriodoHoras),
      tope: topeEmpresa,
      margen: reglas.normalizarMargen(empresaSnap.data()?.eventualesTopeMargen, reglas.TOPE_MARGEN_DEFAULT, topeEmpresa),
      filas,
    };
  }

  if (accion === 'leerArcaEventuales' || accion === 'guardarArcaEventuales') {
    const {
      validarParametrosArca, valoresArcaDe, vistaPreviaArca, mensajeErroresArca, AVISO_CCT_PENDIENTE,
    } = await import('../eventuales-shared/arcaParametros.mjs') as {
      validarParametrosArca: (input: unknown) => { ok: boolean; errores: { id: string; mensaje: string }[]; doc: Record<string, unknown> | null };
      valoresArcaDe: (empresa: unknown) => Record<string, string>;
      vistaPreviaArca: (doc: Record<string, unknown>) => { linea: string; enviable: boolean; advertencias: string[]; avisoCct: string };
      mensajeErroresArca: (errores: { mensaje: string }[]) => string;
      AVISO_CCT_PENDIENTE: string;
    };
    const empresaId = String(data?.empresaId || '');
    if (!empresaId) throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
    const empresaRef = db().collection('empresas').doc(empresaId);
    const empresaSnap = await empresaRef.get();
    if (!empresaSnap.exists) throw new functions.https.HttpsError('not-found', 'No está la empresa.');
    const empresa = { id: empresaId, ...(empresaSnap.data() || {}) };

    if (accion === 'guardarArcaEventuales') {
      const plan = validarParametrosArca(data?.valores);
      if (!plan.ok || !plan.doc) throw new functions.https.HttpsError('invalid-argument', mensajeErroresArca(plan.errores));
      const previo = (empresaSnap.data()?.arcaEventuales || {}) as Record<string, unknown>;
      const next = { ...previo, ...plan.doc };
      await empresaRef.set({
        arcaEventuales: next,
        arcaEventualesAt: admin.firestore.FieldValue.serverTimestamp(),
        arcaEventualesPor: auth.uid,
      }, { merge: true });
      const previa = vistaPreviaArca(plan.doc);
      await db().collection('audit_logs').add({
        action: 'EVENTUAL_ARCA_PARAMETROS', module: 'EVENTUALES', actorUid: auth.uid, actorName: auth.uid,
        empresaId, bolsaCuil: null,
        details: `ARCA ${empresaId}: CCT ${plan.doc.cctCodigo || '(vacío)'} · categoría ${plan.doc.categoria} · modalidad ${plan.doc.modalidadContrato} · RNOS ${plan.doc.obraSocialDefault} · revista desistimiento ${plan.doc.situacionRevistaDesistimiento} · motivo baja ${plan.doc.situacionRevistaBaja} · puesto ${plan.doc.puesto} · sucursal ${plan.doc.sucursal} · CIIU ${plan.doc.actividad} · nocturnidad ${plan.doc.nocturnoPct == null ? 'la de la escala' : `${plan.doc.nocturnoPct}%`}.${previa.enviable ? '' : ' TXT no enviable.'}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, valores: valoresArcaDe({ ...empresa, arcaEventuales: next }), ...previa, avisoCct: previa.avisoCct || '' };
    }

    const valores = valoresArcaDe(empresa);
    const plan = validarParametrosArca(valores);
    const previa = plan.ok && plan.doc ? vistaPreviaArca(plan.doc) : { linea: '', enviable: false, advertencias: ['CCT_CODIGO_PENDIENTE'], avisoCct: AVISO_CCT_PENDIENTE };
    return { ok: true, valores, ...previa };
  }

  if (accion === 'habilitarEmpresa') {
    const { planHabilitarEmpresa } = await import('../eventuales-shared/fichaUx.mjs') as {
      planHabilitarEmpresa: (actuales: unknown, empresaId: string, habilitar: boolean, plataforma: string[]) => { ok: boolean; codigo?: string; empresasHabilitadas?: string[] };
    };
    const cuil = String(data?.cuil || '').replace(/\D/g, '');
    const ref = db().collection('eventuales_bolsa').doc(cuil);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
    const plan = planHabilitarEmpresa(snap.data()?.empresasHabilitadas, String(data?.empresaId || ''), data?.habilitar !== false, await empresasPlataforma());
    if (!plan.ok || !plan.empresasHabilitadas) throw new functions.https.HttpsError('invalid-argument', plan.codigo || 'EMPRESA_INVALIDA');
    await ref.set({ empresasHabilitadas: plan.empresasHabilitadas, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await auditar('EVENTUAL_EMPRESAS', auth.uid, cuil, `${data?.habilitar !== false ? 'habilitado en' : 'quitado de'} ${String(data?.empresaId || '')}`);
    return { ok: true, empresasHabilitadas: plan.empresasHabilitadas };
  }

  if (accion === 'asignarEmpresas') {
    const { planAsignarEmpresas } = await import('../eventuales-shared/fichaUx.mjs') as {
      planAsignarEmpresas: (empresas: unknown, plataforma: string[]) => { ok: boolean; codigo?: string; empresasHabilitadas?: string[] };
    };
    const plan = planAsignarEmpresas(data?.empresasHabilitadas, await empresasPlataforma());
    if (!plan.ok || !plan.empresasHabilitadas) throw new functions.https.HttpsError('invalid-argument', plan.codigo || 'SIN_EMPRESA');
    const crudos: unknown[] = Array.isArray(data?.cuils) ? data.cuils : [];
    const cuils: string[] = [...new Set(crudos.map((c) => String(c || '').replace(/\D/g, '')))].filter((c) => c.length === 11);
    if (!cuils.length) throw new functions.https.HttpsError('invalid-argument', 'Elegí al menos una persona.');
    let asignados = 0;
    const ausentes: string[] = [];
    for (const cuil of cuils) {
      const ref = db().collection('eventuales_bolsa').doc(cuil);
      if (!(await ref.get()).exists) { ausentes.push(cuil); continue; }
      await ref.set({ empresasHabilitadas: plan.empresasHabilitadas, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      asignados += 1;
    }
    await auditar('EVENTUAL_EMPRESAS', auth.uid, cuils[0], `${asignados} fichas → ${plan.empresasHabilitadas.join(', ')}`);
    return { ok: true, asignados, ausentes, empresasHabilitadas: plan.empresasHabilitadas };
  }

  if (accion === 'importarContacto') {
    const { planImportNomina, filaNomina } = await import('../eventuales-shared/fichaUx.mjs') as {
      filaNomina: (row: unknown) => { cuil: string };
      planImportNomina: (filas: unknown[], bolsa: Map<string, Record<string, unknown>>, ctx: { empresas: { id: string; nombre: string }[]; plantaCuils: string[] }) => {
        detalle: { cuil: string; nombre?: string; codigo: string; motivo?: string; doc: Record<string, unknown> }[];
        aplicar: { cuil: string; codigo: string; doc: Record<string, unknown> }[];
        resumen: Record<string, number>;
      };
    };
    const { normalizeCuil } = await import('../eventuales-shared/cuil.mjs') as { normalizeCuil: (raw: unknown) => string | null };
    const { COTEJO_EMPRESA_IDS } = await import('../eventuales-shared/grupo.mjs') as { COTEJO_EMPRESA_IDS: string[] };
    const { esPlantaPermanente } = await import('../eventuales-shared/planilla.mjs') as {
      esPlantaPermanente: (e: Record<string, unknown>) => boolean;
    };
    const filas = Array.isArray(data?.filas) ? data.filas.slice(0, 500) : [];
    if (!filas.length) throw new functions.https.HttpsError('invalid-argument', 'El archivo no tiene filas.');
    const cuils = [...new Set(filas.map((f) => normalizeCuil(filaNomina(f).cuil)).filter((c): c is string => !!c))];
    const plantaCuils: string[] = [];
    for (let i = 0; i < cuils.length; i += 10) {
      const chunk = cuils.slice(i, i + 10);
      const emp = await db().collection('empleados').where('cuil', 'in', chunk).get();
      for (const doc of emp.docs) {
        const row = doc.data();
        const cuil = normalizeCuil(row.cuil);
        if (cuil && COTEJO_EMPRESA_IDS.includes(String(row.empresaId || '')) && esPlantaPermanente(row)) plantaCuils.push(cuil);
      }
    }
    const snap = await db().collection('eventuales_bolsa').select(
      'nombre', 'mail', 'telefono', 'domicilio', 'localidad', 'dni', 'legajoPlanilla', 'primerIngreso',
      'obraSocialRnos', 'empresasHabilitadas', 'credencialVencimiento', 'aptoPsicofisico', 'observaciones',
    ).get();
    const bolsa = new Map(snap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
    const plan = planImportNomina(filas, bolsa, { empresas: await empresasPlataformaDetalle(), plantaCuils });
    const dryRun = data?.dryRun !== false;
    if (!dryRun) {
      for (const row of plan.aplicar) {
        const alta = row.codigo === 'NUEVO' ? { uid: null, legajos: [], createdAt: admin.firestore.FieldValue.serverTimestamp() } : {};
        await db().collection('eventuales_bolsa').doc(row.cuil).set({
          ...row.doc, ...alta, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await auditar('EVENTUAL_NOMINA', auth.uid, plan.aplicar[0]?.cuil || '', `${plan.resumen.nuevo || 0} nuevos, ${plan.resumen.actualizar || 0} actualizados`);
    }
    return {
      ok: true,
      dryRun,
      resumen: plan.resumen,
      aplicar: plan.aplicar.length,
      vista: plan.detalle.slice(0, 80).map((d) => ({ cuil: d.cuil, nombre: d.nombre || '', codigo: d.codigo, motivo: d.motivo || '' })),
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
    empresasPlataforma: await empresasPlataforma(),
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
