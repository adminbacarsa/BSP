/**
 * Entrega de la consulta: bandeja siempre, push si hay token, mail si hay casilla.
 * No cerrar SIN_DESTINATARIOS por no tener la app.
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
  sinPush: boolean;
  puedeRecibir: boolean;
  chip: string | null;
  porMail: boolean;
};

type LibCanal = {
  canalDeConsulta: (p: { uid?: string; mail?: string; pushEstado?: string; tieneToken?: boolean }) => Canal;
  textoMailConsulta: (texto: string) => string;
  entregaDeConsulta: (p: { app: boolean; mailOk: boolean }) => {
    pushEnviado: boolean;
    entregaPush: string;
    entregaMail: string | null;
  };
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
  pushEnviado?: boolean;
  entregaPush?: string | null;
  entregaMail?: string | null;
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

/** Lo que ve el panel: ícono «sin push» si no hay token. Sin el token crudo. Todos se pueden tildar. */
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
    sinCanal: false,
    puedeRecibir: true,
    chip: null,
    porMail: false,
    sinPush: canal.sinPush,
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
 * Bandeja para todos. Push si hay token. Mail además, si hay casilla.
 * La invitación queda PENDIENTE: la persona la ve al entrar a la app.
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
    const canalesOk: string[] = [];
    const uid = String(d.uid || '').trim();
    const notif: Record<string, unknown> = {
      employeeId: d.employeeId || null,
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
    };
    if (uid) notif.uid = uid;
    await db().collection('user_notifications').add(notif);
    const previo = reglas.entregaDeConsulta({ app: canal.app, mailOk: false });
    await evento(ctx.consultaId, 'PUSH', {
      bolsaCuil: d.bolsaCuil,
      employeeId: d.employeeId,
      uid: uid || null,
      resultado: canal.app ? 'ENVIADO' : (canal.codigoApp || 'SIN_PUSH'),
      entrega: previo.entregaPush,
    });
    if (canal.app) canalesOk.push('PUSH');

    let mailOk = false;
    if (canal.mail) {
      try {
        await sendSystemMail({
          to: canal.mail,
          subject: '¿Estás disponible?',
          text: reglas.textoMailConsulta(d.texto),
        });
        await evento(ctx.consultaId, 'MAIL', {
          bolsaCuil: d.bolsaCuil, employeeId: d.employeeId, resultado: 'ENVIADO', entrega: 'mail enviado',
        });
        canalesOk.push('MAIL');
        mailOk = true;
      } catch (err) {
        const codigo = err instanceof MailNotConfiguredError ? 'MAIL_NO_CONFIGURADO' : 'MAIL_ERROR';
        await evento(ctx.consultaId, 'MAIL', {
          bolsaCuil: d.bolsaCuil, employeeId: d.employeeId, resultado: codigo,
        });
      }
    }

    const nota = reglas.entregaDeConsulta({ app: canal.app, mailOk });
    const idx = respuestas.findIndex((r) => esDestino(r, d));
    if (idx >= 0) {
      respuestas[idx] = {
        ...respuestas[idx],
        estado: 'PENDIENTE',
        motivo: null,
        pushEnviado: nota.pushEnviado,
        entregaPush: nota.entregaPush,
        entregaMail: nota.entregaMail,
      };
    }
    const venceAtMs = Number(data.venceAtMs || data.venceAt?.toMillis?.() || 0);
    await db().collection(INV).doc(d.invitacionId).set({
      estado: 'PENDIENTE',
      motivo: null,
      canales: canalesOk,
      mailOk,
      pushEnviado: nota.pushEnviado,
      entregaPush: nota.entregaPush,
      entregaMail: nota.entregaMail,
      ...(venceAtMs > 0 ? { venceAtMs } : {}),
    }, { merge: true });
  }

  const resumen = await textoEstado(respuestas);
  await parentRef.update({ respuestas, resumen, status: 'ABIERTA' });
  return { resumen, status: 'ABIERTA', entregados: respuestas.length };
}

/**
 * El trigger de FCM no pudo entregar el push.
 * La bandeja ya está: no se pasa a NO_LLEGO ni se cierra la consulta.
 */
export async function anotarFalloPushConsulta(p: { consultaId: string; invitacionId: string; motivo: string }) {
  const invRef = db().collection(INV).doc(p.invitacionId);
  const inv = await invRef.get();
  if (!inv.exists) return;
  const estado = String(inv.data()?.estado || '');
  if (estado !== 'PENDIENTE' && estado !== 'AVISO_MAIL') return;
  await invRef.set({ pushFallo: p.motivo }, { merge: true });
}
