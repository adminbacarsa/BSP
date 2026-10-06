/**
 * Endpoint HTTPS (no callable) para el n8n local y para el link manual.
 *
 *  Robot (header `x-arca-key` = secreto ARCA_ROBOT_KEY):
 *    GET  ?action=pendientes[&empresaId=]     → envíos PENDIENTE/ERROR con su TXT
 *    GET  ?action=lote&tipo=AT|BT&canal=LOTE|URGENTE[&empresaId=]
 *                                             → un TXT por empresa (reclama: SUBIENDO + loteId)
 *    GET  ?action=vencidos&minutos=N          → AT/BT/ANULACION urgentes sin cerrar hace más de N min (sin TXT). ENVIADO no entra; VERIFICAR y MANUAL sí.
 *    POST ?action=resultado                   → { envioId | loteId, estado, nroTransaccion?, constanciaUrl?, error?, arcaCodigoNovedad?, codigoControl?, nroVerificador?, constanciaBase64? }
 *    POST ?action=arca-codigo                 → { loteId | envioId, arcaCodigoNovedad } guarda Código de Carga Masiva (sin cambiar estado)
 *    GET  ?action=credencial&empresaId=       -> CUIT de ingreso, CUIT representado y clave (solo HTTPS, no se loguea)
 *    GET  ?action=anulacion&envioId=          -> CUIL, fecha AAAAMMDD, nro del alta y cuitRepresentado
 *    POST ?action=resultado                   -> anulación: { envioId, estado: ANULADO, acuse } o ERROR con fallosRobot
 *
 *  Link mágico (sin login, token de un solo uso):
 *    GET  ?action=link&token=                 → resumen + TXT
 *    POST ?action=link-resultado&token=       → { nroTransaccion, constanciaUrl? }
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import {
  ESTADOS_ENVIO,
  type EstadoEnvio,
  type FilaLote,
  armarLotes,
  esUrgenteVencido,
  nuevoToken,
  rateLimitHit,
  transicionEnvio,
  validarToken,
  vistaPublicaEnvio,
} from './arcaEnviosCore';
import { propagarAltaEnTurnos } from './altaArcaDenorm';
import { leerCredencialParaRobot } from './arcaClaveFiscalCallable';
import { motivoLegible, planRespuestaAnulacion, planTrasError } from './anulacionRobot';

const ARCA_ROBOT_KEY = defineSecret('ARCA_ROBOT_KEY');

const COLL = 'arca_envios';
const MAX_PENDIENTES = 25;

function db() {
  return admin.firestore();
}

function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  return fwd.split(',')[0].trim() || req.ip || 'desconocida';
}

async function auditar(action: string, details: string, extra: Record<string, unknown> = {}) {
  await db().collection('audit_logs').add({
    action,
    actorName: 'ARCA envíos (endpoint)',
    actorUid: 'SYSTEM',
    module: 'RRHH',
    details,
    timestamp: FieldValue.serverTimestamp(),
    ...extra,
  });
}

export async function aplicarTransicion(
  envioId: string,
  input: {
    estado: EstadoEnvio;
    origen: 'ROBOT' | 'LINK' | 'MANUAL';
    nroTransaccion?: string;
    constanciaUrl?: string;
    error?: string;
    acuse?: string;
    fallosRobot?: number;
    actor: string;
    marcarTokenUsado?: boolean;
    arcaCodigoNovedad?: string;
    codigoControl?: string;
    nroVerificador?: string;
    constanciaBase64?: string;
    cat?: string;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ref = db().collection(COLL).doc(envioId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: 'NO_EXISTE' } };
  const envio = snap.data() || {};

  const out = transicionEnvio(envio, input);
  if (!out.ok) return { status: 409, body: { error: out.codigo } };
  if ((input.estado === 'CONFIRMADO' || input.estado === 'ENVIADO') && envio.enviable === false) {
    return { status: 409, body: { error: 'NO_ENVIABLE' } };
  }

  const patch: Record<string, unknown> = { ...out.patch, updatedAt: FieldValue.serverTimestamp() };
  if (input.marcarTokenUsado) patch.tokenUsadoAt = FieldValue.serverTimestamp();
  if (input.arcaCodigoNovedad) patch.arcaCodigoNovedad = String(input.arcaCodigoNovedad);
  if (input.codigoControl) patch.codigoControl = String(input.codigoControl).slice(0, 40);
  if (input.nroVerificador) patch.nroVerificador = String(input.nroVerificador).slice(0, 40);
  if (input.cat) patch.catAlta = String(input.cat).slice(0, 40);
  if (input.constanciaBase64) {
    try {
      const buf = Buffer.from(String(input.constanciaBase64), 'base64');
      if (buf.length > 0 && buf.length < 8_000_000) {
        const path = `arca-constancias/${envioId}.png`;
        await admin.storage().bucket().file(path).save(buf, { contentType: 'image/png', resumable: false });
        patch.constanciaStoragePath = path;
      }
    } catch (e) {
      console.error('[arcaEnviosApi] constancia storage', (e as Error)?.message || e);
    }
  }
  const trasError = input.estado === 'ERROR' && envio.tipo === 'ANULACION'
    ? planTrasError(envio, Date.now(), Number(input.fallosRobot || 0))
    : null;
  if (trasError) patch.fallosRobot = trasError.fallosRobot;
  await ref.update(patch);

  if (trasError) {
    const hacia = transicionEnvio(
      { ...envio, estado: 'ERROR', tipo: 'ANULACION', intentos: patch.intentos as never },
      {
        estado: trasError.estado,
        origen: trasError.estado === 'MANUAL' ? 'MANUAL' : 'ROBOT',
        actor: 'sistema',
        error: trasError.motivo || null,
      },
    );
    if (hacia.ok && hacia.patch) {
      await ref.update({
        ...hacia.patch,
        fallosRobot: trasError.fallosRobot,
        ...(trasError.estado === 'MANUAL' ? { manualMotivo: trasError.motivo, carga: 'MANUAL_WEB' } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (trasError.estado === 'MANUAL') {
        await avisarAnulacionManual(String(envio.empresaId || ''), envioId, trasError.motivo);
      }
    }
    await auditar(`ARCA_ENVIO_${trasError.estado}`, `Anulación ${envioId} tras error del robot`, {
      empresaId: envio.empresaId || null,
      envioId,
    });
    return { status: 200, body: { ok: true, estado: trasError.estado, motivo: trasError.motivo || null } };
  }

  if (input.estado === 'CONFIRMADO' || input.estado === 'ENVIADO') {
    const contratoIds = Array.isArray(envio.contratoIds) ? envio.contratoIds.map(String) : [];
    const encender = envio.tipo === 'AT';
    if (envio.tipo === 'AT' || envio.tipo === 'BT' || envio.tipo === 'NA') {
      await propagarAltaEnTurnos(db(), {
        contratoIds,
        nroTransaccion: input.nroTransaccion || envio.nroTransaccion,
        encender,
      });
    }
    if (envio.loteId) {
      const hermanos = await db().collection(COLL).where('loteId', '==', envio.loteId).get();
      for (const doc of hermanos.docs) {
        const estHermano = String(doc.data().estado || '');
        if (doc.id === envioId || estHermano === 'CONFIRMADO' || estHermano === input.estado || doc.data().enviable === false) continue;
        const data = doc.data();
        await doc.ref.update({
          estado: input.estado,
          nroTransaccion: String(input.nroTransaccion || '').trim(),
          constanciaUrl: String(input.constanciaUrl || '').trim() || null,
          origen: input.origen,
          enviadaAtMs: input.estado === 'ENVIADO' ? Date.now() : (data.enviadaAtMs || null),
          verificacionPendiente: input.estado === 'ENVIADO',
          updatedAt: FieldValue.serverTimestamp(),
        });
        await propagarAltaEnTurnos(db(), {
          contratoIds: Array.isArray(data.contratoIds) ? data.contratoIds.map(String) : [],
          nroTransaccion: input.nroTransaccion,
          encender: data.tipo === 'AT',
        });
      }
    }
  }

  if (input.estado === 'VERIFICAR') {
    try {
      await db().collection('novedades').add({
        empresaId: envio.empresaId || null,
        type: 'ARCA_ALTA_VERIFICAR',
        priority: 'ALTA',
        title: 'Alta ARCA sin relación visible',
        body: `Envío ${envioId}: pasado 48 h no aparece la relación eventual (mod 012). Revisar Domicilio Fiscal Electrónico.`,
        envioId,
        bolsaCuil: envio.bolsaCuil || null,
        nroTransaccion: envio.nroTransaccion || input.nroTransaccion || null,
        createdAt: FieldValue.serverTimestamp(),
        status: 'OPEN',
      });
    } catch (e) {
      console.error('[arcaEnviosApi] novedad VERIFICAR', (e as Error)?.message || e);
    }
  }

  if ((input.estado === 'CONFIRMADO' || input.estado === 'ENVIADO') && !envio.driveFileId && envio.txt) {
    try {
      const { subirTxtADrive } = await import('./arcaEnvioDrive');
      const drive = await subirTxtADrive({
        envioId,
        empresaId: String(envio.empresaId || ''),
        tipo: envio.tipo === 'BT' ? 'BT' : 'AT',
        txt: String(envio.txt),
      });
      if (drive.ok) await ref.update({ driveFileId: drive.driveFileId, driveLink: drive.driveLink });
      else await ref.update({ driveSkipReason: drive.reason });
    } catch (e) {
      await ref.update({ driveSkipReason: (e as Error)?.message || 'DRIVE_ERROR' });
    }
  }

  await auditar(`ARCA_ENVIO_${input.estado}`, `Envío ${envioId} (${envio.tipo}) por ${input.origen}`, {
    empresaId: envio.empresaId || null,
    envioId,
  });
  return { status: 200, body: { ok: true, estado: input.estado } };
}

export const arcaEnviosApi = onRequest(
  { region: 'us-central1', secrets: [ARCA_ROBOT_KEY], timeoutSeconds: 60, memory: '256MiB', cors: true },
  async (req, res) => {
    const nowMs = Date.now();
    const action = String(req.query.action || '');
    const token = String(req.query.token || '');
    const ip = clientIp(req as never);

    try {
      if (action === 'link' || action === 'link-resultado') {
        if (!rateLimitHit(`link:${ip}`, nowMs, 20)) {
          res.status(429).json({ error: 'RATE_LIMIT' });
          return;
        }
        const snap = await db().collection(COLL).where('token', '==', token).limit(1).get();
        const doc = token ? snap.docs[0] : undefined;
        const envio = doc?.data();
        const check = validarToken(envio ? (envio as never) : null, token, nowMs);
        if (!check.ok) {
          res.status(403).json({ error: check.codigo });
          return;
        }

        if (action === 'link') {
          res.status(200).json({ envio: vistaPublicaEnvio(envio as never), txt: String(envio!.txt || '') });
          return;
        }

        const nroTransaccion = String((req.body as Record<string, unknown>)?.nroTransaccion || '').trim();
        if (!nroTransaccion) {
          res.status(400).json({ error: 'FALTA_NRO_TRANSACCION' });
          return;
        }
        await doc!.ref.update({
          cargaManual: {
            ip,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
            at: FieldValue.serverTimestamp(),
          },
        });
        const out = await aplicarTransicion(doc!.id, {
          estado: 'CONFIRMADO',
          origen: 'LINK',
          nroTransaccion,
          constanciaUrl: String((req.body as Record<string, unknown>)?.constanciaUrl || '') || undefined,
          actor: `link ${ip}`,
          marcarTokenUsado: true,
        });
        res.status(out.status).json(out.body);
        return;
      }

      const key = String(req.headers['x-arca-key'] || '');
      if (!key || key !== ARCA_ROBOT_KEY.value()) {
        await auditar('ARCA_ENVIO_AUTH_FALLIDA', `Clave inválida desde ${ip}`);
        res.status(401).json(action === 'credencial'
          ? { error: 'NO_AUTORIZADO', mensaje: 'Falta o no coincide x-arca-key.' }
          : { error: 'NO_AUTORIZADO' });
        return;
      }
      if (!rateLimitHit(`robot:${ip}`, nowMs, 30)) {
        res.status(429).json({ error: 'RATE_LIMIT' });
        return;
      }

      if (action === 'credencial' && req.method === 'GET') {
        const out = await leerCredencialParaRobot({
          key,
          expectedKey: ARCA_ROBOT_KEY.value(),
          empresaId: String(req.query.empresaId || ''),
          nowMs,
        });
        res.status(out.status).json(out.body);
        return;
      }

      if (action === 'anulacion' && req.method === 'GET') {
        const envioId = String(req.query.envioId || '').trim();
        if (!envioId) {
          res.status(400).json({ error: 'PARAMETROS' });
          return;
        }
        const ref = db().collection(COLL).doc(envioId);
        const snap = await ref.get();
        if (!snap.exists) {
          res.status(404).json({ error: 'NO_EXISTE' });
          return;
        }
        const envio = snap.data() || {};
        let nroAlta = String(envio.nroTransaccionAlta || '');
        const contratoId = Array.isArray(envio.contratoIds) ? String(envio.contratoIds[0] || '') : '';
        if (envio.tipo === 'ANULACION' && !nroAlta && contratoId) {
          const hermanos = await db().collection(COLL).where('contratoIds', 'array-contains', contratoId).get();
          const alta = hermanos.docs.find((d) => d.data().tipo === 'AT' && d.data().estado === 'CONFIRMADO');
          nroAlta = String(alta?.data()?.nroTransaccion || '');
        }
        const empresaId = String(envio.empresaId || '');
        const empresa = empresaId ? await db().collection('empresas').doc(empresaId).get() : null;
        const meta = (empresa?.data()?.arcaRobotAcceso || {}) as { cuitRepresentado?: string };
        const cuitRepresentado = String(meta.cuitRepresentado || empresa?.data()?.cuit || '');
        const plan = planRespuestaAnulacion(
          { ...envio, nroTransaccionAlta: nroAlta || envio.nroTransaccionAlta },
          { nowMs, envioId, cuitRepresentado },
        );
        if (plan.patch) {
          const via = plan.patch.estado === 'MANUAL'
            ? transicionEnvio(envio as never, {
              estado: 'MANUAL',
              origen: 'MANUAL',
              actor: 'sistema',
              error: String(plan.patch.manualMotivo || ''),
            })
            : null;
          await ref.update({
            ...(via?.ok ? via.patch : {}),
            ...plan.patch,
            updatedAt: FieldValue.serverTimestamp(),
          });
          if (plan.avisar) {
            await avisarAnulacionManual(empresaId, envioId, String(plan.patch.manualMotivo || plan.body.motivo || ''));
          }
        }
        res.status(plan.status).json(plan.body);
        return;
      }

      if (action === 'config-avisos' && req.method === 'GET') {
        const empresaId = String(req.query.empresaId || '');
        if (!empresaId) {
          res.status(400).json({ error: 'PARAMETROS' });
          return;
        }
        const resuelto = await resolverAvisosEmpresa(empresaId);
        const tipo = String(req.query.tipo || '');
        res.status(200).json(tipo ? { empresaId, tipo, ...(resuelto[tipo] || vacioAviso()) } : { empresaId, avisos: resuelto });
        return;
      }

      if (action === 'pendientes' && req.method === 'GET') {
        const empresaId = String(req.query.empresaId || '');
        let q = db().collection(COLL).where('estado', 'in', ['PENDIENTE', 'ERROR']);
        if (empresaId) q = q.where('empresaId', '==', empresaId);
        const snap = await q.limit(MAX_PENDIENTES).get();
        res.status(200).json({
          envios: snap.docs
            .filter((d) => d.data().enviable !== false && d.data().tipo !== 'ANULACION')
            .map((d) => ({
              envioId: d.id,
              empresaId: d.data().empresaId,
              tipo: d.data().tipo,
              estado: d.data().estado,
              txt: d.data().txt,
            })),
        });
        return;
      }

      // n8n Cloud pide el link para mandarlo por WhatsApp/mail. El token lo emite COSP, no n8n.
      if (action === 'link-emitir' && req.method === 'POST') {
        const envioId = String((req.body as Record<string, unknown>)?.envioId || '');
        if (!envioId) {
          res.status(400).json({ error: 'PARAMETROS' });
          return;
        }
        const ref = db().collection(COLL).doc(envioId);
        const snap = await ref.get();
        if (!snap.exists) {
          res.status(404).json({ error: 'NO_EXISTE' });
          return;
        }
        if (snap.data()?.estado === 'CONFIRMADO') {
          res.status(409).json({ error: 'YA_CONFIRMADO' });
          return;
        }
        const t = nuevoToken(nowMs);
        const marcarRespaldo = (req.body as Record<string, unknown>)?.marcarRespaldo === true;
        await ref.update({
          ...t,
          updatedAt: FieldValue.serverTimestamp(),
          ...(marcarRespaldo ? { respaldoAvisadoAt: FieldValue.serverTimestamp() } : {}),
        });
        await auditar('ARCA_ENVIO_LINK_EMITIDO', `Link de un solo uso para el envío ${envioId}`, {
          empresaId: snap.data()?.empresaId || null,
          envioId,
        });
        const base = String(process.env.ARCA_LINK_BASE_URL || 'https://comtroldata.web.app/arca-envio/');
        const linkUrl = `${base}?token=${t.token}`;
        const tipoAviso = snap.data()?.tipo === 'BT' ? 'ARCA_BAJA_PENDIENTE' : 'ARCA_ALTA_PENDIENTE';
        const sinEscala = Array.isArray(snap.data()?.advertencias) && snap.data()!.advertencias.includes('RETRIBUCION_PENDIENTE');
        const pushes = await enviarPushAviso(String(snap.data()?.empresaId || ''), tipoAviso, linkUrl, sinEscala);
        res.status(200).json({
          envioId,
          tipo: snap.data()?.tipo || null,
          linkUrl,
          venceAt: t.tokenExpiraAt,
          pushes,
        });
        return;
      }

      if (action === 'lote' && req.method === 'GET') {
        const tipo = String(req.query.tipo || '');
        const canal = String(req.query.canal || 'LOTE');
        const empresaId = String(req.query.empresaId || '');
        if ((tipo !== 'AT' && tipo !== 'BT') || (canal !== 'LOTE' && canal !== 'URGENTE')) {
          res.status(400).json({ error: 'PARAMETROS' });
          return;
        }
        const docs = await enviosAbiertos();
        const filas = docs.map(filaDe);
        const armados = armarLotes(filas, { tipo, canal, empresaId: empresaId || undefined }, nowMs);
        const lotes = [];
        for (const lote of armados) {
          const reclamado = await reclamarLote(lote, nowMs);
          if (!reclamado) continue;
          const empresa = await db().collection('empresas').doc(lote.empresaId).get();
          const data = empresa.data() || {};
          const meta = (data.arcaRobotAcceso || {}) as { cuitRepresentado?: string };
          let arcaCodigoNovedad = '';
          for (const id of lote.envioIds) {
            const prev = docs.find((d) => d.id === id)?.data()?.arcaCodigoNovedad;
            if (prev) {
              arcaCodigoNovedad = String(prev);
              break;
            }
          }
          lotes.push({
            ...lote,
            loteId: reclamado,
            cuit: String(meta.cuitRepresentado || data.cuit || '').replace(/\D/g, ''),
            empresaNombre: String(data.nombre || data.name || data.razonSocial || ''),
            arcaCodigoNovedad: arcaCodigoNovedad || null,
          });
        }
        res.status(200).json({ lotes });
        return;
      }

      if (action === 'vencidos' && req.method === 'GET') {
        const minutos = Number(req.query.minutos || 30);
        const docs = await enviosAbiertos();
        const envios = docs
          .map((d) => ({ id: d.id, data: d.data() || {} }))
          .filter((d) => esUrgenteVencido({
            canal: String(d.data.canal || ''),
            tipo: String(d.data.tipo || ''),
            estado: String(d.data.estado || ''),
            createdAtMs: createdAtMs(d.data),
            respaldoAvisadoAt: d.data.respaldoAvisadoAt,
            quitadoDelLote: d.data.quitadoDelLote === true,
          }, nowMs, minutos))
          .map((d) => ({
            envioId: d.id,
            empresaId: d.data.empresaId || null,
            tipo: d.data.tipo,
            estado: d.data.estado,
            canal: d.data.canal || 'URGENTE',
            minutos: Math.round((nowMs - createdAtMs(d.data)) / 60000),
            fechaAlta: d.data.fechaAlta || null,
            fechaBaja: d.data.fechaBaja || null,
            enviable: d.data.enviable !== false,
            ultimoError: d.data.ultimoError || null,
          }));
        res.status(200).json({ minutos: Math.min(1440, Math.max(1, Number(minutos) || 30)), envios });
        return;
      }

      if (action === 'arca-codigo' && req.method === 'POST') {
        const body = (req.body || {}) as Record<string, unknown>;
        const envioId = String(body.envioId || '').trim();
        const loteId = String(body.loteId || '').trim();
        const codigo = String(body.arcaCodigoNovedad || '').trim();
        if ((!envioId && !loteId) || !/^\d{4,}$/.test(codigo)) {
          res.status(400).json({ error: 'PARAMETROS' });
          return;
        }
        const refs: admin.firestore.DocumentReference[] = [];
        if (loteId && !envioId) {
          const snap = await db().collection(COLL).where('loteId', '==', loteId).get();
          if (snap.empty) {
            res.status(404).json({ error: 'NO_EXISTE' });
            return;
          }
          snap.docs.forEach((d) => refs.push(d.ref));
        } else {
          refs.push(db().collection(COLL).doc(envioId));
        }
        const batch = db().batch();
        for (const ref of refs) {
          batch.update(ref, {
            arcaCodigoNovedad: codigo,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
        await auditar('ARCA_CODIGO_NOVEDAD', `Código Carga Masiva ${codigo}`, {
          loteId: loteId || null,
          envioId: envioId || null,
        });
        res.status(200).json({ ok: true, arcaCodigoNovedad: codigo, actualizados: refs.length });
        return;
      }



      if (action === 'verificacion' && req.method === 'GET') {
        const envioId = String(req.query.envioId || '').trim();
        if (!envioId) {
          res.status(400).json({ error: 'PARAMETROS' });
          return;
        }
        const snap = await db().collection(COLL).doc(envioId).get();
        if (!snap.exists) {
          res.status(404).json({ error: 'NO_EXISTE' });
          return;
        }
        const data = snap.data() || {};
        if (!['ENVIADO', 'VERIFICAR'].includes(String(data.estado || ''))) {
          res.status(409).json({ error: 'NO_ENVIADO', estado: data.estado || null });
          return;
        }
        const empresa = await db().collection('empresas').doc(String(data.empresaId || '')).get();
        const emp = empresa.data() || {};
        const meta = (emp.arcaRobotAcceso || {}) as { cuitRepresentado?: string };
        res.status(200).json({
          envioId,
          empresaId: data.empresaId || null,
          cuil: String(data.bolsaCuil || '').replace(/\D/g, ''),
          bolsaCuil: data.bolsaCuil || null,
          fechaAlta: data.fechaAlta || null,
          nroTransaccion: data.nroTransaccion || null,
          enviadaAtMs: Number(data.enviadaAtMs || 0) || null,
          cuitRepresentado: String(meta.cuitRepresentado || emp.cuit || '').replace(/\D/g, ''),
        });
        return;
      }

      if (action === 'verificacion-pendientes' && req.method === 'GET') {
        const empresaId = String(req.query.empresaId || '');
        const snap = await db().collection(COLL).where('estado', '==', 'ENVIADO').limit(80).get();
        const envios = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
          .filter((d) => d.tipo === 'AT' && (!empresaId || d.empresaId === empresaId))
          .map((d) => ({
            envioId: d.id,
            empresaId: d.empresaId || null,
            bolsaCuil: d.bolsaCuil || null,
            fechaAlta: d.fechaAlta || null,
            nroTransaccion: d.nroTransaccion || null,
            enviadaAtMs: Number(d.enviadaAtMs || 0) || null,
            cuitRepresentado: null,
          }));
        res.status(200).json({ envios });
        return;
      }

      if (action === 'resultado' && req.method === 'POST') {
        const body = (req.body || {}) as Record<string, unknown>;
        const envioId = String(body.envioId || '').trim();
        const loteId = String(body.loteId || '').trim();
        const estado = String(body.estado || '') as EstadoEnvio;
        if ((!envioId && !loteId) || !ESTADOS_ENVIO.includes(estado)) {
          res.status(400).json({ error: 'PARAMETROS' });
          return;
        }
        const arcaCodigoNovedad = String(body.arcaCodigoNovedad || '').trim();
        const input = {
          estado,
          origen: 'ROBOT' as const,
          nroTransaccion: nroDeBody(body) || undefined,
          constanciaUrl: String(body.constanciaUrl || '').slice(0, 500) || undefined,
          error: String(body.error || '').slice(0, 500) || undefined,
          acuse: String(body.acuse || '').slice(0, 120) || undefined,
          fallosRobot: Number(body.fallosRobot || 0) || undefined,
          actor: 'n8n-local',
          arcaCodigoNovedad: arcaCodigoNovedad || undefined,
          codigoControl: String(body.codigoControl || '').trim().slice(0, 40) || undefined,
          nroVerificador: String(body.nroVerificador || '').trim().slice(0, 40) || undefined,
          constanciaBase64: String(body.constanciaBase64 || '') || undefined,
          cat: String(body.cat || '').trim().slice(0, 40) || undefined,
        };
        if (loteId && !envioId) {
          const snap = await db().collection(COLL).where('loteId', '==', loteId).get();
          if (snap.empty) {
            res.status(404).json({ error: 'NO_EXISTE' });
            return;
          }
          const pendientes = snap.docs.filter((d) => d.data().estado !== 'CONFIRMADO');
          if (!pendientes.length) {
            res.status(409).json({ error: 'YA_CONFIRMADO', loteId });
            return;
          }
          if (estado === 'CONFIRMADO') {
            const primero = pendientes.find((d) => d.data().enviable !== false) || pendientes[0];
            const out = await aplicarTransicion(primero.id, input);
            res.status(out.status).json({ ...out.body, loteId, envios: snap.size });
            return;
          }
          const resultados = [];
          for (const doc of pendientes) {
            resultados.push(await aplicarTransicion(doc.id, input));
          }
          const fallo = resultados.find((r) => r.status >= 400);
          res.status(fallo ? fallo.status : 200).json({
            ok: !fallo,
            loteId,
            resultados: resultados.map((r) => r.body),
          });
          return;
        }
        const out = await aplicarTransicion(envioId, input);
        res.status(out.status).json(out.body);
        return;
      }

      res.status(400).json({ error: 'ACCION_DESCONOCIDA' });
    } catch (e) {
      console.error('[arcaEnviosApi]', e);
      res.status(500).json({ error: 'ERROR_INTERNO' });
    }
  },
);


const ESTADOS_ABIERTOS = ['PENDIENTE', 'ERROR', 'SUBIENDO', 'MANUAL', 'VERIFICAR'];
const MAX_ABIERTOS = 200;

function createdAtMs(data: Record<string, unknown>): number {
  const c = data.createdAt as { toMillis?: () => number } | string | undefined;
  if (c && typeof c === 'object' && typeof c.toMillis === 'function') return c.toMillis();
  const n = Number(data.createdAtMs);
  if (Number.isFinite(n) && n > 0) return n;
  const p = Date.parse(String(c || ''));
  return Number.isFinite(p) ? p : 0;
}

function filaDe(doc: { id: string; data: () => Record<string, unknown> }): FilaLote {
  const data = doc.data() || {};
  return {
    id: doc.id,
    empresaId: data.empresaId ? String(data.empresaId) : undefined,
    tipo: data.tipo ? String(data.tipo) : undefined,
    estado: data.estado ? String(data.estado) : undefined,
    canal: data.canal ? String(data.canal) : undefined,
    txt: data.txt ? String(data.txt) : undefined,
    canalCarga: data.canalCarga === 'ALTAS_TEXTO' ? 'ALTAS_TEXTO' : undefined,
    enviable: data.enviable !== false,
    quitadoDelLote: data.quitadoDelLote === true,
    loteReclamadoAtMs: Number(data.loteReclamadoAtMs || 0) || undefined,
  };
}

async function enviosAbiertos() {
  const snap = await db().collection(COLL).where('estado', 'in', ESTADOS_ABIERTOS).limit(MAX_ABIERTOS).get();
  return snap.docs;
}

function nroDeBody(body: Record<string, unknown>): string {
  const extra = Array.isArray(body.nrosTransaccion) ? body.nrosTransaccion.map((n) => String(n).trim()) : [];
  return [...new Set([String(body.nroTransaccion || '').trim(), ...extra].filter(Boolean))].join(',');
}

async function reclamarLote(lote: { empresaId: string; tipo: string; envioIds: string[] }, ahora: number): Promise<string | null> {
  const loteId = `lote_${lote.empresaId}_${lote.tipo}_${ahora}_${Math.random().toString(16).slice(2, 8)}`.replace(/[^a-zA-Z0-9_]/g, '_');
  try {
    await db().runTransaction(async (tx) => {
      const snaps = [];
      for (const id of lote.envioIds) snaps.push(await tx.get(db().collection(COLL).doc(id)));
      for (const snap of snaps) {
        const estado = String(snap.data()?.estado || '');
        if (!['PENDIENTE', 'ERROR', 'SUBIENDO'].includes(estado)) throw new Error('LOTE_CAMBIO');
        tx.update(snap.ref, {
          loteId,
          estado: 'SUBIENDO',
          loteReclamadoAtMs: ahora,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (e) {
    console.error('[arcaEnviosApi] lote', lote.empresaId, (e as Error)?.message || e);
    return null;
  }
  await auditar('ARCA_LOTE_RECLAMADO', `Lote ${loteId} ${lote.tipo} (${lote.envioIds.length})`, {
    empresaId: lote.empresaId,
    loteId,
  });
  return loteId;
}

type AvisoResuelto = { pushes: { uid: string; token: string }[]; mails: string[]; whatsapps: string[] };

function vacioAviso(): AvisoResuelto {
  return { pushes: [], mails: [], whatsapps: [] };
}

async function resolverAvisosEmpresa(empresaId: string): Promise<Record<string, AvisoResuelto>> {
  const { resolverAvisos, TIPOS_AVISO } = await import('../eventuales-shared/avisos.mjs') as {
    resolverAvisos: (input: Record<string, unknown>) => AvisoResuelto;
    TIPOS_AVISO: string[];
  };
  const empresa = await db().collection('empresas').doc(empresaId).get();
  const avisos = (empresa.data()?.avisos || {}) as Record<string, unknown>;
  const usersSnap = await db().collection('system_users').where('empresaId', '==', empresaId).get();
  const usuarios = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const roleIds = [...new Set(usuarios.map((u) => String((u as { role?: string }).role || '')).filter(Boolean))];
  const roleSnaps = roleIds.length
    ? await db().getAll(...roleIds.map((id) => db().collection('roles').doc(id)))
    : [];
  const roles = roleSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
  const uids = usuarios.map((u) => u.uid);
  const tokens: { uid: string; token: string }[] = [];
  for (let i = 0; i < uids.length; i += 10) {
    const slice = uids.slice(i, i + 10);
    if (!slice.length) continue;
    const snap = await db().collection('device_tokens').where('uid', 'in', slice).get();
    snap.forEach((d) => {
      const data = d.data();
      tokens.push({ uid: String(data.uid || ''), token: String(data.token || d.id) });
    });
  }
  const out: Record<string, AvisoResuelto> = {};
  for (const tipo of TIPOS_AVISO) {
    out[tipo] = resolverAvisos({ avisos, tipo, usuarios, roles, tokens });
  }
  return out;
}

async function avisarAnulacionManual(empresaId: string, envioId: string, motivo: string): Promise<void> {
  await auditar('ARCA_ANULACION_MANUAL', `Anulación ${envioId} pasó a manual: ${motivo}`, { empresaId, envioId });
  try {
    await enviarPushAviso(empresaId, 'ARCA_ALTA_PENDIENTE', '/admin/rrhh/eventuales/', false, {
      titulo: 'Anulación ARCA manual',
      body: `Requiere acción manual (${motivoLegible(motivo)}).`,
    });
  } catch (e) {
    console.error('[arca anulacion] no se pudo avisar a RRHH', (e as Error)?.message || e);
  }
}

async function enviarPushAviso(
  empresaId: string,
  tipo: string,
  linkUrl: string,
  sinEscala = false,
  copy?: { titulo: string; body: string },
): Promise<number> {
  if (!empresaId) return 0;
  const avisos = await resolverAvisosEmpresa(empresaId);
  const tokens = (avisos[tipo]?.pushes || []).map((p) => p.token).filter(Boolean);
  if (!tokens.length) return 0;
  const titulo = copy?.titulo || (tipo === 'ARCA_BAJA_PENDIENTE' ? 'Baja ARCA pendiente' : 'Alta ARCA pendiente');
  const body = copy?.body || (sinEscala
    ? 'RETRIBUCION_PENDIENTE: no se puede enviar hasta aprobar la escala salarial.'
    : 'Hay un envío de carga masiva esperando.');
  const result = await admin.messaging().sendEachForMulticast({
    tokens: tokens.slice(0, 500),
    data: { title: titulo, body, url: linkUrl, tipo },
    webpush: { fcmOptions: { link: linkUrl } },
  });
  return result.successCount;
}
