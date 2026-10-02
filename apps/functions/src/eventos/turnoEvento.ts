/**
 * Único escritor del turno EV. Lo usan la asignación del panel, la aceptación en la app,
 * la aceptación del eventual y la cascada del hueco de evento.
 * El objetivo es el del evento: el que ya tiene el servicio, o uno marcado esEvento en el cliente.
 */
import * as admin from 'firebase-admin';

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const AR_OFFSET = '-03:00';
const FRANCO = new Set(['F', 'FF', 'FP']);

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function esOrigenFranco(data) {
  if (!data) return false;
  const code = String(data.code || '').trim().toUpperCase();
  return data.isFranco === true || FRANCO.has(code);
}

export function esOrigenReten(data) {
  if (!data) return false;
  const code = String(data.code || '').trim().toUpperCase();
  return code === 'RET' || data.isReten === true || String(data.origin || '').toUpperCase() === 'RETEN';
}

export function arDateTimeTs(fecha, hhmm) {
  const time = /^\d{1,2}:\d{2}$/.test(String(hhmm || '')) ? String(hhmm) : '08:00';
  const [hRaw, mRaw] = time.split(':');
  return Timestamp.fromDate(new Date(`${fecha}T${pad2(Number(hRaw))}:${pad2(Number(mRaw))}:00.000${AR_OFFSET}`));
}

function horasDe(horaInicio, horaFin, horas) {
  const n = Number(horas);
  if (Number.isFinite(n) && n > 0) return n;
  const [sh, sm] = String(horaInicio || '00:00').split(':').map(Number);
  const [eh, em] = String(horaFin || '00:00').split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round(mins / 60);
}

function finDelDia(startTs, endTs) {
  if (endTs.toMillis() > startTs.toMillis()) return endTs;
  return Timestamp.fromMillis(endTs.toMillis() + 24 * 3600000);
}

/** Campos que tienen que coincidir en todos los caminos. */
export function camposTurnoEvento(input) {
  const servicioNombre = String(input.servicioNombre || 'Evento');
  const startTs = input.startTime || arDateTimeTs(input.servicioFecha, input.horaInicio);
  const endTs = finDelDia(startTs, input.endTime || arDateTimeTs(input.servicioFecha, input.horaFin));
  return {
    empresaId: input.empresaId || null,
    code: 'EV',
    type: 'Evento',
    origin: 'EVENTO',
    eventoId: input.eventoId || null,
    eventoNombre: input.eventoNombre || null,
    servicioId: input.servicioId || null,
    servicioNombre,
    positionName: servicioNombre,
    clientId: input.clientId || null,
    clientName: input.clientName || null,
    objectiveId: input.objectiveId || null,
    objectiveName: input.objectiveName || null,
    startTime: startTs,
    endTime: endTs,
    scheduleDate: input.servicioFecha || null,
    hours: horasDe(input.horaInicio, input.horaFin, input.horas),
    draft: false,
    sourceShiftId: input.sourceShiftId || null,
  };
}

export function parcheOrigenCobertura(evId) {
  return {
    coverageUsed: true,
    coverageDocId: evId,
    coverageUsedForShiftId: evId,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function geocodificar(address) {
  const q = String(address || '').trim();
  if (!q) return null;
  const headers = { 'Accept-Language': 'es', 'User-Agent': 'COSP-v1/comtroldata.web.app' };
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`,
    { headers, signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) return null;
  const d = await r.json();
  if (!Array.isArray(d) || !d.length) return null;
  return { lat: num(d[0].lat), lng: num(d[0].lon) };
}

/**
 * Objetivo del evento. Si el servicio apunta a uno del cliente, ese.
 * Si no, uno en clients.objetivos con esEvento (sin SLA), geocodificado desde el lugar.
 */
export async function asegurarObjetivoDeEvento(db, input) {
  const eventoId = String(input.eventoId || '');
  const eventoSnap = eventoId ? await db.collection('eventos').doc(eventoId).get() : null;
  const evento = eventoSnap?.exists ? eventoSnap.data() || {} : {};
  const servicios = Array.isArray(evento.servicios) ? evento.servicios : [];
  const servicio = servicios.find((s) => s && s.id === input.servicioId) || {};
  const ubi = servicio.ubicacion || {};
  const clientId = String(evento.clienteId || input.clientId || '');
  const clientName = String(evento.clienteNombre || input.clientName || '');
  if (ubi.tipo === 'objetivo_existente' && ubi.objectiveId) {
    return {
      objectiveId: String(ubi.objectiveId),
      objectiveName: String(ubi.objectiveNombre || ubi.objectiveId),
      clientId: clientId || null,
      clientName: clientName || null,
      aviso: null,
    };
  }
  if (!clientId) {
    return { objectiveId: null, objectiveName: null, clientId: null, clientName: clientName || null, aviso: 'SIN_CLIENTE' };
  }
  const clientRef = db.collection('clients').doc(clientId);
  const pre = await clientRef.get();
  if (!pre.exists) {
    return { objectiveId: null, objectiveName: input.eventoNombre || evento.nombre || null, clientId, clientName: clientName || null, aviso: 'SIN_CLIENTE' };
  }
  const estable = `evt_${eventoId || 'sin'}`;
  const ya = (Array.isArray(pre.data()?.objetivos) ? pre.data().objetivos : [])
    .find((o) => o && (o.id === estable || (o.esEvento === true && o.eventoId === eventoId)));
  if (ya?.id) {
    return { objectiveId: String(ya.id), objectiveName: String(ya.name || input.eventoNombre || ''), clientId, clientName, aviso: null };
  }
  const address = String(ubi.direccion || evento.direccion || evento.lugar || input.direccion || '').trim();
  let lat = num(ubi.latitud ?? ubi.lat);
  let lng = num(ubi.longitud ?? ubi.lng ?? ubi.lon);
  let aviso = null;
  if (lat == null || lng == null) {
    try {
      const geo = await geocodificar(address);
      if (geo) { lat = geo.lat; lng = geo.lng; }
      else aviso = address ? 'GEO_SIN_RESULTADO' : 'SIN_LUGAR';
    } catch {
      aviso = 'GEO_NO_DISPONIBLE';
    }
  }
  const nombre = String(evento.nombre || input.eventoNombre || address || 'Evento').trim();
  const row = {
    id: estable,
    name: nombre,
    address,
    lat,
    lng,
    esEvento: true,
    eventoId: eventoId || null,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(clientRef);
    const objetivos = Array.isArray(snap.data()?.objetivos) ? [...snap.data().objetivos] : [];
    if (objetivos.some((o) => o && o.id === estable)) return;
    tx.update(clientRef, { objetivos: [...objetivos, row] });
  });
  return { objectiveId: estable, objectiveName: nombre, clientId, clientName, aviso };
}

/**
 * Crea el EV (no pisa el turno de origen). RET y franco quedan con coverageUsed.
 */
export async function escribirTurnoEvento(db, input) {
  const lugar = await asegurarObjetivoDeEvento(db, input);
  if (lugar.aviso) console.warn(`[turnoEvento] ${lugar.aviso} evento=${input.eventoId || ''}`);
  const sourceId = String(input.sourceShiftId || '').trim();
  let source = null;
  if (sourceId) {
    const src = await db.collection('turnos').doc(sourceId).get();
    source = src.exists ? src.data() : null;
  }
  const franco = esOrigenFranco(source);
  const reten = !franco && esOrigenReten(source);
  const ref = db.collection('turnos').doc();
  const base = camposTurnoEvento({
    ...input,
    objectiveId: lugar.objectiveId,
    objectiveName: lugar.objectiveName,
    clientId: lugar.clientId || input.clientId,
    clientName: lugar.clientName || input.clientName,
    sourceShiftId: franco || reten ? sourceId : (sourceId || null),
  });
  const batch = db.batch();
  batch.set(ref, {
    ...base,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    isPresent: false,
    isAbsent: false,
    isCompleted: false,
    isFranco: false,
    ...(input.extra || {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  if (sourceId && (franco || reten)) {
    batch.update(db.collection('turnos').doc(sourceId), parcheOrigenCobertura(ref.id));
  }
  await batch.commit();
  return { turnoId: ref.id, ...base, aviso: lugar.aviso };
}

function ymdAr(ms) {
  return new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
}

function dayBounds(fecha) {
  return {
    start: Timestamp.fromDate(new Date(`${fecha}T00:00:00.000${AR_OFFSET}`)),
    end: Timestamp.fromDate(new Date(`${fecha}T23:59:59.999${AR_OFFSET}`)),
  };
}

async function turnosDelDia(db, empleadoId, fecha, empresaId) {
  const { start, end } = dayBounds(fecha);
  const snap = await db.collection('turnos').where('employeeId', '==', empleadoId).where('startTime', '>=', start).where('startTime', '<=', end).get();
  return snap.docs.filter((d) => !empresaId || !d.data().empresaId || String(d.data().empresaId) === empresaId);
}

/**
 * Asignación del panel y aceptación de la convocatoria (plantilla).
 * Libre: solo el EV. RET/franco: el origen queda y el EV es otro doc.
 */
export async function asignarGuardiaAEvento(db, params) {
  const fecha = String(params.servicioFecha || '');
  const delDia = fecha ? await turnosDelDia(db, params.empleadoId, fecha, params.empresaId) : [];
  const franco = delDia.find((d) => esOrigenFranco(d.data())) || null;
  const reten = delDia.find((d) => esOrigenReten(d.data())) || null;
  const puesto = delDia.find((d) => {
    const code = String(d.data().code || '').toUpperCase();
    return code !== 'EV' && !esOrigenFranco(d.data()) && !esOrigenReten(d.data());
  }) || null;
  const source = franco || reten;
  const escrito = await escribirTurnoEvento(db, {
    empresaId: params.empresaId,
    employeeId: params.empleadoId,
    employeeName: params.empleadoNombre,
    eventoId: params.eventoId,
    eventoNombre: params.eventoNombre,
    servicioId: params.servicioId,
    servicioNombre: params.servicioNombre,
    servicioFecha: fecha,
    horaInicio: params.horaInicio,
    horaFin: params.horaFin,
    horas: params.horas,
    clientId: params.clienteId || params.clientId,
    clientName: params.clienteNombre || params.clientName,
    sourceShiftId: source ? source.id : null,
  });

  const batch = db.batch();
  if (params.solicitudId) {
    batch.update(db.collection('solicitudes_evento').doc(params.solicitudId), {
      status: 'aprobada',
      respondidoAt: FieldValue.serverTimestamp(),
      turnoId: escrito.turnoId,
      ...(params.respondidoPor ? { respondidoPor: params.respondidoPor } : {}),
    });
  }
  if (puesto && !source) {
    const data = puesto.data();
    const vacRef = db.collection('turnos').doc();
    batch.set(vacRef, {
      empresaId: params.empresaId || null,
      employeeId: 'VACANTE',
      employeeName: 'VACANTE',
      isUnassigned: true,
      code: data.code || null,
      type: data.type || data.code || null,
      objectiveId: data.objectiveId || null,
      objectiveName: data.objectiveName || null,
      positionName: data.positionName || null,
      clientId: data.clientId || null,
      clientName: data.clientName || null,
      startTime: data.startTime,
      endTime: data.endTime,
      scheduleDate: fecha,
      status: 'UNCOVERED',
      origin: 'VACANTE_POR_EVENTO',
      vacancyOrigin: 'EVENTO',
      causedByEventoId: params.eventoId,
      causedByEmployeeId: params.empleadoId,
      causedByEmployeeName: params.empleadoNombre,
      draft: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(puesto.ref, {
      employeeId: 'VACANTE',
      employeeName: 'VACANTE',
      isUnassigned: true,
      salioAEventoShiftId: escrito.turnoId,
    });
    batch.set(db.collection('novedades').doc(), {
      empresaId: params.empresaId || null,
      type: 'VACANTE_POR_EVENTO',
      status: 'pending',
      viewed: false,
      priority: 'high',
      actionTarget: 'PLANIFICACION',
      title: `Vacante por evento · ${params.empleadoNombre}`,
      description: `${params.empleadoNombre} sale al evento "${params.eventoNombre}" el ${fecha}.`,
      objectiveId: data.objectiveId || null,
      objectiveName: data.objectiveName || null,
      shiftId: vacRef.id,
      fecha,
      employeeId: params.empleadoId,
      employeeName: params.empleadoNombre,
      eventoId: params.eventoId,
      eventoNombre: params.eventoNombre,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  if (params.solicitudId || (puesto && !source)) await batch.commit();
  return escrito;
}

/** Corrige un EV ya escrito para que quede con el shape único. No recrea un RET cuyo horario se pisó. */
export async function normalizarTurnoEvExistente(db, shiftId, opts: Record<string, any> = {}) {
  const ref = db.collection('turnos').doc(shiftId);
  const snap = await ref.get();
  if (!snap.exists) return { id: shiftId, skip: 'NO_EXISTE' };
  const data = snap.data() || {};
  if (opts.empresaId && String(data.empresaId || '') !== opts.empresaId) return { id: shiftId, skip: 'OTRA_EMPRESA' };
  const eventoId = String(data.eventoId || opts.eventoId || '');
  const servicioId = String(data.servicioId || opts.servicioId || '');
  const lugar = await asegurarObjetivoDeEvento(db, {
    eventoId,
    servicioId,
    clientId: data.clientId || opts.clientId,
    clientName: data.clientName || opts.clientName,
    eventoNombre: data.eventoNombre || opts.eventoNombre,
  });
  const servicioNombre = String(opts.servicioNombre || data.servicioNombre || data.positionName || 'Evento');
  const patch: Record<string, any> = {
    code: 'EV',
    type: 'Evento',
    origin: 'EVENTO',
    eventoId: eventoId || null,
    eventoNombre: data.eventoNombre || opts.eventoNombre || null,
    servicioId: servicioId || null,
    positionName: servicioNombre,
    servicioNombre,
    objectiveId: lugar.objectiveId || data.objectiveId || null,
    objectiveName: lugar.objectiveName || data.objectiveName || null,
    clientId: lugar.clientId || data.clientId || null,
    clientName: lugar.clientName || data.clientName || null,
    draft: false,
    empresaId: data.empresaId || opts.empresaId || null,
  };
  const links = [];
  if (opts.francoShiftId) {
    patch.sourceShiftId = opts.francoShiftId;
    links.push({ id: opts.francoShiftId, patch: parcheOrigenCobertura(shiftId) });
  }
  const pisado = String(data.replacedCode || '').toUpperCase() === 'RET' || /ret[eé]n/i.test(String(data.type || ''));
  const preview = { id: shiftId, nombre: data.employeeName || '', patch, links, aviso: lugar.aviso, retenPisado: pisado };
  if (!opts.apply) return preview;
  await ref.set(patch, { merge: true });
  for (const link of links) await db.collection('turnos').doc(link.id).set(link.patch, { merge: true });
  return { ...preview, applied: true };
}
