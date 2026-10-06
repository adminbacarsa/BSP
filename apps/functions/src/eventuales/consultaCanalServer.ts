/**
 * Entrega de la consulta: push si hay app, mail si hay casilla.
 * Si a nadie le llega, cierra SIN_DESTINATARIOS y avisa a Planificación en el momento.
 */
import * as admin from 'firebase-admin';
import { MailNotConfiguredError, sendSystemMail } from '../common/mailer';

const COL = 'consultas_disponibilidad';
const INV = 'consultas_disponibilidad_invitaciones';

type Canal = {
  app: boolean;
  mail: string;
  codigoApp: string | null;
  motivoApp: string | null;
  sinApp: boolean;
  sinCanal: boolean;
  puedeRecibir: boolean;
  chip: string | null;
  porMail: boolean;
};

type LibCanal = {
  canalDeConsulta: (p: { uid?: string; mail?: string; pushEstado?: string; tieneToken?: boolean }) => Canal;
  textoMailConsulta: (texto: string) => string;
  textoNoLlego: (nombre: string, motivo: string) => string;
  cierreSiNadieRecibio: (entregados: number) => { cerrar: boolean; status: string };
  entregaTrasFcm: (p: { mailOk: boolean; fcmOk: boolean }) => { llego: boolean; motivo?: string };
};

type Respuesta = {
  cuil: string;
  employeeId?: string | null;
  tipo?: string | null;
  nombre: string;
  estado: string;
  orden: number | null;
  hora: string | null;
  motivo: string | null;
  entregaNota?: string | null;
};

export type DestinoEntrega = {
  invitacionId: string;
  nombre: string;
  uid: string;
  mail: string;
  pushEstado: string;
  employeeId: string | null;
  bolsaCuil: string | null;
  texto: string;
  cuil: string;
  tipo: 'EVENTUAL' | 'GUARDIA' | null;
};

export type ContextoEntrega = {
  consultaId: string;
  empresaId: string;
  actorUid: string;
  objectiveId: string | null;
  objectiveName: string | null;
  positionName: string | null;
  clientName: string | null;
  lugar: string;
};

function db() {
  return admin.firestore();
}

async function lib(): Promise<LibCanal> {
  return import('../eventuales-shared/consultaCanal.mjs') as Promise<LibCanal>;
}

async function textoEstado(respuestas: Respuesta[]): Promise<string> {
  const m = await import('../eventuales-shared/consultaDisponibilidad.mjs') as {
    textoEstadoConsulta: (rows: Respuesta[]) => string;
  };
  return m.textoEstadoConsulta(respuestas);
}

function sirveToken(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return String(data?.token || '').length > 10;
}

export async function tieneTokenConsulta(uid: string, employeeId: string | null): Promise<boolean> {
  if (uid) {
    const [porUid, directo] = await Promise.all([
      db().collection('device_tokens').where('uid', '==', uid).limit(5).get(),
      db().collection('device_tokens').doc(uid).get(),
    ]);
    if (porUid.docs.some((d) => sirveToken(d.data())) || sirveToken(directo.data())) return true;
  }
  if (employeeId) {
    const porEmp = await db().collection('device_tokens').where('employeeId', '==', employeeId).limit(5).get();
    if (porEmp.docs.some((d) => sirveToken(d.data()))) return true;
  }
  return false;
}

/** Lo que ve el panel: chip y si se puede tildar. Sin el token crudo. */
export async function canalVisible(p: { uid: string; mail: string; pushEstado: string; employeeId: string | null }) {
  const reglas = await lib();
  const canal = reglas.canalDeConsulta({
    uid: p.uid,
    mail: p.mail,
    pushEstado: p.pushEstado,
    tieneToken: await tieneTokenConsulta(p.uid, p.employeeId),
  });
  return {
    sinApp: canal.sinApp,
    motivo: canal.motivoApp,
    sinCanal: canal.sinCanal,
    puedeRecibir: canal.puedeRecibir,
    chip: canal.chip,
    porMail: canal.porMail,
  };
}

async function evento(consultaId: string, tipo: string, extra: Record<string, unknown>) {
  await db().collection(COL).doc(consultaId).collection('eventos').add({
    tipo,
    atMs: Date.now(),
    at: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });
}

function esDestino(r: Respuesta, d: DestinoEntrega): boolean {
  if (d.tipo === 'GUARDIA') return r.tipo === 'GUARDIA' && String(r.employeeId || '') === String(d.employeeId || '');
  return r.tipo !== 'GUARDIA' && r.cuil === d.cuil;
}

/**
 * Manda push y/o mail y reescribe las respuestas.
 * Quien no recibe queda NO_LLEGO (no sigue PENDIENTE). Si nadie recibió, cierra.
 */
export async function aplicarEntregasConsulta(ctx: ContextoEntrega, destinos: DestinoEntrega[]): Promise<{
  resumen: string;
  status: string;
  entregados: number;
}> {
  const reglas = await lib();
  const parentRef = db().collection(COL).doc(ctx.consultaId);
  const parent = await parentRef.get();
  const data = parent.data() || {};
  const respuestas = ((data.respuestas || []) as Respuesta[]).map((r) => ({ ...r }));

  for (const d of destinos) {
    const tieneToken = await tieneTokenConsulta(d.uid, d.employeeId);
    const canal = reglas.canalDeConsulta({
      uid: d.uid, mail: d.mail, pushEstado: d.pushEstado, tieneToken,
    });
    let llego = false;
    let estado = 'NO_LLEGO';
    let motivo: string | null = canal.motivoApp || 'sin canal';
    const canalesOk: string[] = [];

    if (canal.app) {
      await db().collection('user_notifications').add({
        uid: d.uid,
        employeeId: d.employeeId,
        empresaId: ctx.empresaId,
        type: 'CONSULTA_DISPONIBILIDAD',
        target: 'employee',
        title: '¿Estás disponible?',
        body: d.texto,
        consultaId: ctx.consultaId,
        invitacionId: d.invitacionId,
        jornadas: Array.isArray(data.jornadas) ? data.jornadas : [],
        objectiveId: ctx.objectiveId,
        objectiveName: ctx.objectiveName,
        positionName: ctx.positionName,
        clientName: ctx.clientName,
        read: false,
        readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await evento(ctx.consultaId, 'PUSH', {
        bolsaCuil: d.bolsaCuil, employeeId: d.employeeId, uid: d.uid, resultado: 'ENVIADO',
      });
      llego = true;
      estado = 'PENDIENTE';
      motivo = null;
      canalesOk.push('PUSH');
    } else {
      await evento(ctx.consultaId, 'PUSH', {
        bolsaCuil: d.bolsaCuil, employeeId: d.employeeId, uid: d.uid || null, resultado: canal.codigoApp || 'SIN_CANAL',
      });
    }

    if (canal.mail) {
      try {
        await sendSystemMail({
          to: canal.mail,
          subject: '¿Estás disponible?',
          text: reglas.textoMailConsulta(d.texto),
        });
        await evento(ctx.consultaId, 'MAIL', { bolsaCuil: d.bolsaCuil, employeeId: d.employeeId, resultado: 'ENVIADO' });
        canalesOk.push('MAIL');
        llego = true;
        if (!canal.app) {
          estado = 'AVISO_MAIL';
          motivo = 'no tiene la app';
        }
      } catch (err) {
        const codigo = err instanceof MailNotConfiguredError ? 'MAIL_NO_CONFIGURADO' : 'MAIL_ERROR';
        await evento(ctx.consultaId, 'MAIL', {
          bolsaCuil: d.bolsaCuil, employeeId: d.employeeId, resultado: codigo,
        });
        if (!llego) {
          estado = 'NO_LLEGO';
          motivo = canal.sinApp ? (canal.motivoApp || 'sin canal') : 'no se pudo enviar el mail';
        }
      }
    }

    const idx = respuestas.findIndex((r) => esDestino(r, d));
    if (idx >= 0) respuestas[idx] = { ...respuestas[idx], estado, motivo };
    const venceAtMs = Number(data.venceAtMs || data.venceAt?.toMillis?.() || 0);
    await db().collection(INV).doc(d.invitacionId).set({
      estado,
      motivo,
      canales: canalesOk,
      mailOk: canalesOk.includes('MAIL'),
      ...(venceAtMs > 0 ? { venceAtMs } : {}),
    }, { merge: true });
  }

  const entregados = respuestas.filter((r) => r.estado === 'PENDIENTE' || r.estado === 'AVISO_MAIL').length;
  const cierre = reglas.cierreSiNadieRecibio(entregados);
  const resumen = await textoEstado(respuestas);
  const patch: Record<string, unknown> = { respuestas, resumen, status: cierre.status };
  if (cierre.cerrar) {
    patch.venceAt = admin.firestore.FieldValue.delete();
    patch.cerradaAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await parentRef.update(patch);

  if (cierre.cerrar) {
    await evento(ctx.consultaId, 'SIN_DESTINATARIOS', { actorUid: ctx.actorUid });
    await db().collection('novedades').add({
      type: 'CONSULTA_DISPONIBILIDAD_SIN_DESTINATARIOS',
      status: 'PENDIENTE',
      empresaId: ctx.empresaId,
      objectiveId: ctx.objectiveId,
      objectiveName: ctx.objectiveName,
      positionName: ctx.positionName,
      clientName: ctx.clientName,
      description: `La consulta de disponibilidad en ${ctx.lugar} no llegó a nadie. ${resumen}`,
      createdAt: admin.firestore.Timestamp.now(),
      source: 'PLANIFICACION',
      consultaId: ctx.consultaId,
    });
    await db().collection('audit_logs').add({
      action: 'CONSULTA_DISPONIBILIDAD_SIN_DESTINATARIOS',
      module: 'PLANNING',
      actorUid: ctx.actorUid,
      actorName: ctx.actorUid,
      empresaId: ctx.empresaId,
      details: resumen,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      consultaId: ctx.consultaId,
    });
    const { cerrarInvitacionesConsulta } = await import('./consultaDisponibilidad');
    await cerrarInvitacionesConsulta(ctx.consultaId, 'SIN_DESTINATARIOS');
  }

  return { resumen, status: cierre.status, entregados };
}

/** El trigger de FCM no pudo entregar. Si tampoco hubo mail, esa persona queda en el estado. */
export async function anotarFalloPushConsulta(p: { consultaId: string; invitacionId: string; motivo: string }) {
  const reglas = await lib();
  const estadoTxt = await import('../eventuales-shared/consultaDisponibilidad.mjs') as {
    textoEstadoConsulta: (rows: Respuesta[]) => string;
  };
  const fallo = reglas.entregaTrasFcm({ mailOk: false, fcmOk: false });
  const invRef = db().collection(INV).doc(p.invitacionId);
  const parentRef = db().collection(COL).doc(p.consultaId);
  let cerrar = false;
  let empresaId = '';
  let resumen = '';
  let lugar = '';
  await db().runTransaction(async (tx) => {
    const invSnap = await tx.get(invRef);
    const parentSnap = await tx.get(parentRef);
    if (!invSnap.exists || !parentSnap.exists) return;
    const inv = invSnap.data() || {};
    if (inv.mailOk === true) return;
    const data = parentSnap.data() || {};
    if (String(data.status || '') !== 'ABIERTA') return;
    const nota = reglas.textoNoLlego(String(inv.nombre || ''), fallo.motivo || p.motivo);
    const respuestas = ((data.respuestas || []) as Respuesta[]).map((r) => {
      const misma = inv.tipo === 'GUARDIA'
        ? r.tipo === 'GUARDIA' && String(r.employeeId || '') === String(inv.employeeId || '')
        : r.tipo !== 'GUARDIA' && r.cuil === String(inv.bolsaCuil || '');
      if (!misma) return r;
      return { ...r, estado: 'NO_LLEGO', motivo: fallo.motivo || p.motivo, entregaNota: nota };
    });
    const entregados = respuestas.filter((r) => r.estado === 'PENDIENTE' || r.estado === 'AVISO_MAIL').length;
    const cierre = reglas.cierreSiNadieRecibio(entregados);
    empresaId = String(data.empresaId || '');
    lugar = [data.clientName, data.objectiveName, data.positionName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ') || 'el puesto';
    resumen = estadoTxt.textoEstadoConsulta(respuestas);
    const patch: Record<string, unknown> = { respuestas, resumen, status: cierre.status };
    if (cierre.cerrar) {
      patch.venceAt = admin.firestore.FieldValue.delete();
      patch.cerradaAt = admin.firestore.FieldValue.serverTimestamp();
      cerrar = true;
    }
    tx.update(parentRef, patch);
    const vence = Number(inv.venceAtMs || data.venceAtMs || 0);
    const invPatch: Record<string, unknown> = { estado: 'NO_LLEGO', motivo: fallo.motivo || p.motivo, pushFallo: p.motivo };
    if (vence > 0) invPatch.venceAtMs = vence;
    tx.update(invRef, invPatch);
  });
  if (!cerrar) return;
  await db().collection('novedades').add({
    type: 'CONSULTA_DISPONIBILIDAD_SIN_DESTINATARIOS',
    status: 'PENDIENTE',
    empresaId,
    description: `La consulta de disponibilidad en ${lugar} no llegó a nadie. ${resumen}`,
    createdAt: admin.firestore.Timestamp.now(),
    source: 'PLANIFICACION',
    consultaId: p.consultaId,
  });
  const { cerrarInvitacionesConsulta } = await import('./consultaDisponibilidad');
  await cerrarInvitacionesConsulta(p.consultaId, 'SIN_DESTINATARIOS');
}
