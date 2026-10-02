/**
 * Cupo por género en servicios de eventos — lado servidor.
 *
 * El cupo se llena POR ORDEN DE ACEPTACIÓN dentro de cada grupo (Hombres / Mujeres, o un solo
 * grupo si es Indistinto). `reservarCupo` corre en una transacción: lee el servicio, cuenta los
 * confirmados del grupo (solicitudes aprobadas o reservadas + turnos EV sin solicitud) y, si hay
 * lugar, marca la solicitud como reservada; dos aceptaciones simultáneas no pasan el cupo porque
 * la segunda transacción vuelve a leer y ve la reserva de la primera. Cuando el grupo se llena,
 * `cerrarPendientesPorCupo` deja las convocadas de ese grupo en `cupo_completo` y avisa a la app.
 *
 * La lógica pura está en `eventuales-shared/cupoGenero.mjs` (misma copia que usa el panel).
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

type Genero = 'M' | 'F' | '';
type Grupo = 'TODOS' | 'M' | 'F';

export type ServicioCupo = {
  id?: string;
  nombre?: string;
  cupo?: number;
  cupoModo?: string;
  cupoPorGenero?: { M?: number; F?: number } | null;
};

type ItemCupo = { genero?: string; cupoGrupo?: string; status?: string; id?: string };

type GrupoEstado = { grupo: Grupo; label: string; cupo: number; ocupados: number; disponibles: number; completo: boolean };
export type EstadoCupo = { grupos: GrupoEstado[]; cupo: number; ocupados: number; sinGrupo: number; completo: boolean };

type LibCupo = {
  STATUS_CUPO_COMPLETO: string;
  MENSAJE_CUPO_COMPLETO: string;
  TITULO_CUPO_COMPLETO: string;
  NOTIF_CUPO_COMPLETO: string;
  CUPO_MOTIVOS: Record<string, string>;
  normalizarGenero: (v: unknown) => Genero;
  esPorGenero: (s: unknown) => boolean;
  grupoDeGenero: (s: unknown, g: unknown) => Grupo | null;
  estadoCupo: (s: unknown, ocupados: ItemCupo[]) => EstadoCupo;
  puedeConfirmar: (s: unknown, ocupados: ItemCupo[], genero: unknown) => { ok: boolean; grupo: Grupo | null; motivo: string | null; mensaje: string | null; ocupados: number; cupo: number };
  pendientesACerrar: (s: unknown, ocupados: ItemCupo[], pendientes: ItemCupo[]) => ItemCupo[];
};

export async function libCupo(): Promise<LibCupo> {
  return await import('../eventuales-shared/cupoGenero.mjs') as unknown as LibCupo;
}

type Reader = { get: (ref: admin.firestore.DocumentReference) => Promise<admin.firestore.DocumentSnapshot> };
type QueryReader = { get: (q: admin.firestore.Query) => Promise<admin.firestore.QuerySnapshot> };

function readerDoc(tx: admin.firestore.Transaction | null): Reader {
  return tx ? { get: (ref) => tx.get(ref) } : { get: (ref) => ref.get() };
}
function readerQuery(tx: admin.firestore.Transaction | null): QueryReader {
  return tx ? { get: (q) => tx.get(q) } : { get: (q) => q.get() };
}

/** Servicio del evento (o el sintético legacy con `cupoGuardias`). */
export async function servicioDeEvento(
  db: admin.firestore.Firestore,
  eventoId: string,
  servicioId: string,
  tx: admin.firestore.Transaction | null = null,
): Promise<{ evento: Record<string, unknown>; servicio: ServicioCupo | null }> {
  const snap = await readerDoc(tx).get(db.collection('eventos').doc(String(eventoId || '')));
  const evento = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
  const servicios = Array.isArray(evento.servicios) ? (evento.servicios as ServicioCupo[]) : [];
  const servicio = servicios.find((s) => s && String(s.id || '') === String(servicioId || '')) || null;
  if (servicio) return { evento, servicio };
  if (!servicios.length && snap.exists) {
    return { evento, servicio: { id: String(servicioId || ''), nombre: String(evento.nombre || ''), cupo: Number(evento.cupoGuardias) || 0, cupoModo: 'INDISTINTO', cupoPorGenero: null } };
  }
  return { evento, servicio: null };
}

/** Género de una persona: eventual → ficha de la bolsa (fallback legajo); nómina → legajo (fallback bolsa). */
export async function generoDePersona(
  db: admin.firestore.Firestore,
  p: { empleadoId?: string | null; bolsaCuil?: string | null; esEventual?: boolean },
  tx: admin.firestore.Transaction | null = null,
  cache: Map<string, Genero> = new Map(),
): Promise<Genero> {
  const { normalizarGenero } = await libCupo();
  const r = readerDoc(tx);
  const empleadoId = String(p.empleadoId || '').trim();
  const cuil = String(p.bolsaCuil || '').replace(/\D/g, '');
  const key = `${empleadoId}|${cuil}`;
  if (cache.has(key)) return cache.get(key)!;
  const leerBolsa = async (): Promise<Genero> => {
    if (!cuil) return '';
    const s = await r.get(db.collection('eventuales_bolsa').doc(cuil));
    return s.exists ? normalizarGenero(s.data()?.genero) : '';
  };
  const leerLegajo = async (): Promise<Genero> => {
    if (!empleadoId || empleadoId === 'VACANTE') return '';
    const s = await r.get(db.collection('empleados').doc(empleadoId));
    if (!s.exists) return '';
    const d = s.data() || {};
    const g = normalizarGenero(d.genero);
    if (g) return g;
    if (!cuil && d.bolsaCuil) {
      const b = await r.get(db.collection('eventuales_bolsa').doc(String(d.bolsaCuil).replace(/\D/g, '')));
      return b.exists ? normalizarGenero(b.data()?.genero) : '';
    }
    return '';
  };
  const out = p.esEventual ? (await leerBolsa()) || (await leerLegajo()) : (await leerLegajo()) || (await leerBolsa());
  cache.set(key, out);
  return out;
}

const SOL_CONFIRMADA = new Set(['aprobada']);
const SOL_VIVA_RESERVADA = new Set(['convocado', 'pendiente', 'aprobada']);

function turnoCuenta(d: Record<string, unknown>): boolean {
  const emp = String(d.employeeId || '').trim();
  if (!emp || emp === 'VACANTE') return false;
  if (d.isDeleted === true || d.draft === true || d.isUnassigned === true) return false;
  if (String(d.status || '').toUpperCase() === 'INACTIVE') return false;
  if (d.isAbsent === true || d.coverageSuperseded === true) return false;
  return true;
}

/**
 * Confirmados del servicio con su grupo. Solicitudes aprobadas o reservadas (turno en camino) y
 * turnos EV del servicio sin solicitud (planificador / asignación directa). Una persona cuenta una vez.
 * `excluir` saca a la solicitud / persona que se está evaluando.
 */
export async function ocupadosDeServicio(
  db: admin.firestore.Firestore,
  p: { eventoId: string; servicioId: string; excluirSolicitudId?: string | null; excluirEmpleadoId?: string | null },
  tx: admin.firestore.Transaction | null = null,
  cache: Map<string, Genero> = new Map(),
): Promise<{ ocupados: ItemCupo[]; pendientes: (ItemCupo & { id: string; data: Record<string, unknown> })[] }> {
  const q = readerQuery(tx);
  const [solsSnap, turnosSnap] = await Promise.all([
    q.get(db.collection('solicitudes_evento').where('eventoId', '==', p.eventoId).where('servicioId', '==', p.servicioId)),
    q.get(db.collection('turnos').where('eventoId', '==', p.eventoId).where('servicioId', '==', p.servicioId)),
  ]);
  const ocupados: ItemCupo[] = [];
  const pendientes: (ItemCupo & { id: string; data: Record<string, unknown> })[] = [];
  const personas = new Set<string>();
  const solicitudesContadas = new Set<string>();
  const excluirSol = String(p.excluirSolicitudId || '');
  const excluirEmp = String(p.excluirEmpleadoId || '');

  for (const d of solsSnap.docs) {
    const s = d.data() as Record<string, unknown>;
    const status = String(s.status || '');
    const emp = String(s.empleadoId || '');
    const item: ItemCupo = { id: d.id, status, genero: String(s.genero || ''), cupoGrupo: String(s.cupoGrupo || '') };
    if (d.id === excluirSol || (excluirEmp && emp === excluirEmp)) continue;
    if (status === 'convocado') {
      pendientes.push({ ...item, data: s, id: d.id });
      continue;
    }
    const reservada = s.cupoReservado === true && SOL_VIVA_RESERVADA.has(status);
    if (!SOL_CONFIRMADA.has(status) && !reservada) continue;
    if (emp && personas.has(emp)) continue;
    if (!item.genero && !item.cupoGrupo) item.genero = await generoDePersona(db, { empleadoId: emp, bolsaCuil: String(s.bolsaCuil || ''), esEventual: s.esEventual === true }, tx, cache);
    if (emp) personas.add(emp);
    solicitudesContadas.add(d.id);
    ocupados.push(item);
  }
  for (const d of turnosSnap.docs) {
    const t = d.data() as Record<string, unknown>;
    if (!turnoCuenta(t)) continue;
    const emp = String(t.employeeId || '');
    if (excluirEmp && emp === excluirEmp) continue;
    const solId = String(t.solicitudEventoId || '');
    if (solId && (solId === excluirSol || solicitudesContadas.has(solId))) continue;
    if (personas.has(emp)) continue;
    const item: ItemCupo = { id: d.id, genero: String(t.genero || ''), cupoGrupo: String(t.cupoGrupo || '') };
    if (!item.genero && !item.cupoGrupo) item.genero = await generoDePersona(db, { empleadoId: emp, bolsaCuil: String(t.bolsaCuil || ''), esEventual: t.esEventual === true }, tx, cache);
    personas.add(emp);
    ocupados.push(item);
  }
  return { ocupados, pendientes };
}

export type ReservaCupo = {
  ok: boolean;
  grupo: Grupo | null;
  genero: Genero;
  /** Solo cuando `ok` es false. */
  motivo: 'CUPO_COMPLETO' | 'GENERO_SIN_ESPECIFICAR' | null;
  mensaje: string;
  servicio: ServicioCupo | null;
  estado: EstadoCupo | null;
  /** El servicio no limita (sin cupo configurado o sin servicio). */
  sinCupo: boolean;
};

const okReserva = (p: Partial<ReservaCupo> & { grupo: Grupo; genero: Genero }): ReservaCupo => ({
  ok: true, motivo: null, mensaje: '', servicio: null, estado: null, sinCupo: false, ...p,
});

/**
 * Reserva un lugar del cupo para la persona (transacción). Si hay solicitud, la marca `cupoReservado`
 * y guarda `cupoGrupo` / `genero`; si el grupo está lleno y la solicitud estaba convocada, la cierra
 * como `cupo_completo`. Sin cupo configurado (0) no limita. Idempotente: una solicitud ya reservada o
 * aprobada vuelve a dar ok.
 */
export async function reservarCupo(
  db: admin.firestore.Firestore,
  p: {
    eventoId: string;
    servicioId: string;
    solicitudId?: string | null;
    empleadoId?: string | null;
    bolsaCuil?: string | null;
    esEventual?: boolean;
    genero?: string | null;
  },
): Promise<ReservaCupo> {
  const lib = await libCupo();
  const eventoId = String(p.eventoId || '');
  const servicioId = String(p.servicioId || '');
  if (!eventoId || !servicioId) return okReserva({ grupo: 'TODOS', genero: lib.normalizarGenero(p.genero), sinCupo: true });

  return db.runTransaction<ReservaCupo>(async (tx) => {
    const cache = new Map<string, Genero>();
    const { servicio } = await servicioDeEvento(db, eventoId, servicioId, tx);
    const solRef = p.solicitudId ? db.collection('solicitudes_evento').doc(String(p.solicitudId)) : null;
    const solSnap = solRef ? await tx.get(solRef) : null;
    const sol = (solSnap?.exists ? solSnap.data() : null) as Record<string, unknown> | null;

    let genero: Genero = lib.normalizarGenero(p.genero ?? sol?.genero);
    if (!genero) {
      genero = await generoDePersona(db, {
        empleadoId: p.empleadoId ?? (sol?.empleadoId as string | undefined),
        bolsaCuil: p.bolsaCuil ?? (sol?.bolsaCuil as string | undefined),
        esEventual: p.esEventual ?? sol?.esEventual === true,
      }, tx, cache);
    }

    const estadoBase = servicio ? lib.estadoCupo(servicio, []) : null;
    if (!servicio || !estadoBase || estadoBase.cupo <= 0) {
      if (solRef && sol && (sol.cupoReservado !== true)) tx.update(solRef, { cupoReservado: true, cupoReservadoAt: FieldValue.serverTimestamp(), ...(genero ? { genero } : {}), cupoGrupo: 'TODOS' });
      return okReserva({ grupo: 'TODOS', genero, servicio, estado: estadoBase, sinCupo: true });
    }

    // Ya reservada / aprobada: es la misma aceptación que vuelve a pasar (idempotente).
    if (sol && (sol.cupoReservado === true || String(sol.status || '') === 'aprobada')) {
      const grupoPrev = lib.grupoDeGenero(servicio, genero) || (String(sol.cupoGrupo || '') as Grupo) || 'TODOS';
      return okReserva({ grupo: grupoPrev, genero, servicio });
    }

    const { ocupados } = await ocupadosDeServicio(db, {
      eventoId, servicioId,
      excluirSolicitudId: p.solicitudId || null,
      excluirEmpleadoId: p.empleadoId ?? (sol?.empleadoId as string | undefined) ?? null,
    }, tx, cache);
    const r = lib.puedeConfirmar(servicio, ocupados, genero);
    const estado = lib.estadoCupo(servicio, ocupados);
    if (!r.ok) {
      if (solRef && sol && r.motivo === 'CUPO_COMPLETO' && String(sol.status || '') === 'convocado') {
        tx.update(solRef, {
          status: lib.STATUS_CUPO_COMPLETO,
          cupoCerradoAt: FieldValue.serverTimestamp(),
          cupoGrupo: r.grupo,
          ...(genero ? { genero } : {}),
          venceAt: FieldValue.delete(),
        });
      }
      return {
        ok: false, grupo: r.grupo, genero, motivo: r.motivo as 'CUPO_COMPLETO' | 'GENERO_SIN_ESPECIFICAR',
        mensaje: r.mensaje || lib.MENSAJE_CUPO_COMPLETO, servicio, estado, sinCupo: false,
      };
    }
    if (solRef && sol) {
      tx.update(solRef, { cupoReservado: true, cupoReservadoAt: FieldValue.serverTimestamp(), cupoGrupo: r.grupo, ...(genero ? { genero } : {}) });
    }
    // Marca en el evento: todas las reservas leen este doc, así dos confirmaciones simultáneas sin
    // solicitud (asignación directa / planificador) también chocan y la segunda vuelve a contar.
    tx.set(db.collection('eventos').doc(eventoId), { cupoUltimaReservaAt: FieldValue.serverTimestamp() }, { merge: true });
    return okReserva({ grupo: r.grupo as Grupo, genero, servicio, estado });
  });
}

/** Si la escritura del turno falla después de reservar, se libera el lugar. */
export async function liberarReservaCupo(db: admin.firestore.Firestore, solicitudId: string | null | undefined): Promise<void> {
  if (!solicitudId) return;
  await db.collection('solicitudes_evento').doc(String(solicitudId)).set({ cupoReservado: FieldValue.delete(), cupoReservadoAt: FieldValue.delete() }, { merge: true });
}

/** Campos que se estampan en el turno EV para que la cascada reconvoque al mismo grupo. */
export function camposCupoTurno(r: { grupo: Grupo | null; genero: Genero }): Record<string, unknown> {
  return {
    ...(r.grupo ? { cupoGrupo: r.grupo } : {}),
    ...(r.genero ? { genero: r.genero } : {}),
  };
}

/**
 * Después de confirmar a alguien: si su grupo quedó lleno, las convocadas pendientes de ese grupo
 * pasan a `cupo_completo` y reciben «Ya se cubrió el cupo, gracias». No generan turno, contrato,
 * anexo ni alta ARCA. Devuelve los ids cerrados.
 */
export async function cerrarPendientesPorCupo(
  db: admin.firestore.Firestore,
  p: { eventoId: string; servicioId: string; actor?: string },
): Promise<string[]> {
  const lib = await libCupo();
  const eventoId = String(p.eventoId || '');
  const servicioId = String(p.servicioId || '');
  if (!eventoId || !servicioId) return [];
  const { servicio } = await servicioDeEvento(db, eventoId, servicioId);
  if (!servicio) return [];
  if (lib.estadoCupo(servicio, []).cupo <= 0) return [];
  const cache = new Map<string, Genero>();
  const { ocupados, pendientes } = await ocupadosDeServicio(db, { eventoId, servicioId }, null, cache);
  for (const pend of pendientes) {
    if (!pend.genero && !pend.cupoGrupo) {
      pend.genero = await generoDePersona(db, { empleadoId: String(pend.data.empleadoId || ''), bolsaCuil: String(pend.data.bolsaCuil || ''), esEventual: pend.data.esEventual === true }, null, cache);
    }
  }
  const cerrar = lib.pendientesACerrar(servicio, ocupados, pendientes) as (ItemCupo & { id: string; data: Record<string, unknown> })[];
  if (!cerrar.length) return [];
  const batch = db.batch();
  const nombreServicio = String(servicio.nombre || '');
  for (const pend of cerrar) {
    const s = pend.data;
    const grupo = lib.grupoDeGenero(servicio, pend.genero) || String(pend.cupoGrupo || 'TODOS');
    batch.update(db.collection('solicitudes_evento').doc(pend.id), {
      status: lib.STATUS_CUPO_COMPLETO,
      cupoCerradoAt: FieldValue.serverTimestamp(),
      cupoCerradoPor: p.actor || 'CUPO',
      cupoGrupo: grupo,
      ...(pend.genero ? { genero: pend.genero } : {}),
      venceAt: FieldValue.delete(),
    });
    const uid = await uidDePersona(db, { empleadoId: String(s.empleadoId || ''), bolsaCuil: String(s.bolsaCuil || ''), esEventual: s.esEventual === true });
    if (uid) {
      batch.set(db.collection('user_notifications').doc(), {
        uid,
        employeeId: String(s.empleadoId || ''),
        empresaId: s.empresaId || null,
        type: lib.NOTIF_CUPO_COMPLETO,
        target: 'employee',
        title: lib.TITULO_CUPO_COMPLETO,
        body: `${lib.MENSAJE_CUPO_COMPLETO.replace(/\.$/, '')}${nombreServicio ? ` (${nombreServicio})` : ''}.`,
        eventoId,
        servicioId,
        solicitudId: pend.id,
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();
  return cerrar.map((c) => c.id);
}

async function uidDePersona(db: admin.firestore.Firestore, p: { empleadoId: string; bolsaCuil: string; esEventual: boolean }): Promise<string> {
  const cuil = String(p.bolsaCuil || '').replace(/\D/g, '');
  if (p.esEventual && cuil) {
    const b = await db.collection('eventuales_bolsa').doc(cuil).get();
    const uid = String(b.data()?.uid || '');
    if (uid) return uid;
  }
  if (p.empleadoId) {
    const e = await db.collection('empleados').doc(p.empleadoId).get();
    const uid = String(e.data()?.uid || '');
    if (uid) return uid;
  }
  if (!p.esEventual && cuil) {
    const b = await db.collection('eventuales_bolsa').doc(cuil).get();
    return String(b.data()?.uid || '');
  }
  return '';
}

/** Estado de cupo del servicio (lectura, sin transacción): para respuestas y auditoría. */
export async function estadoCupoServicio(db: admin.firestore.Firestore, eventoId: string, servicioId: string): Promise<EstadoCupo | null> {
  const lib = await libCupo();
  const { servicio } = await servicioDeEvento(db, eventoId, servicioId);
  if (!servicio) return null;
  const { ocupados } = await ocupadosDeServicio(db, { eventoId, servicioId });
  return lib.estadoCupo(servicio, ocupados);
}

/** Grupo requerido para la cascada de un hueco de evento: el del turno ausente (M/F) o ninguno. */
export function generoRequeridoDeTurno(shift: Record<string, unknown> | null | undefined): 'M' | 'F' | null {
  const g = String(shift?.cupoGrupo || '').toUpperCase();
  if (g === 'M' || g === 'F') return g;
  return null;
}
