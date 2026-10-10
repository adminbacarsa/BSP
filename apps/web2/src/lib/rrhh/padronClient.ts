import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { confirmarAltaLegajo } from '@/lib/rrhh/altaLegajoClient';
import { formDesdeFila, type FilaPadron } from '@/lib/planificacion/padronAlta';
import { idDocPadron, type EmpleadoParaPadron, type ItemCambio, type ItemNuevo } from '@/lib/rrhh/padronComparar';

export type EstadoPadron = {
  empresaId: string;
  fecha: string;
  cantidad: number;
  actualizadoPor: string;
  nombreArchivo: string;
};

export type DocPadron = FilaPadron & {
  empresaId: string;
  enPadron: boolean;
  actualizadoAt: string;
  actualizadoPor: string;
  origenArchivo: { nombre: string; fecha: string };
};

function actor(): string {
  const u = getAuth().currentUser;
  return u?.displayName || u?.email || 'RRHH';
}

async function auditar(action: string, details: string, empresaId: string): Promise<void> {
  const u = getAuth().currentUser;
  await addDoc(collection(db, 'audit_logs'), {
    timestamp: serverTimestamp(),
    actorUid: u?.uid || 'unknown',
    actorName: actor(),
    action,
    module: 'RRHH',
    details,
    empresaId,
    metadata: { platform: 'web', via: 'PADRON' },
  });
}

export async function leerEstadoPadron(empresaId: string): Promise<EstadoPadron | null> {
  const snap = await getDoc(doc(db, 'padron_estado', empresaId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    empresaId,
    fecha: String(d.fecha || ''),
    cantidad: Number(d.cantidad) || 0,
    actualizadoPor: String(d.actualizadoPor || ''),
    nombreArchivo: String(d.nombreArchivo || ''),
  };
}

export async function listarPadron(empresaId: string): Promise<FilaPadron[]> {
  const snap = await getDocs(query(collection(db, 'padron_empleados'), where('empresaId', '==', empresaId), where('enPadron', '==', true)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      legajo: String(x.legajo || ''),
      apellido: String(x.apellido || ''),
      nombre: String(x.nombre || ''),
      dni: String(x.dni || ''),
      cuil: String(x.cuil || ''),
      mail: String(x.mail || ''),
      telefono: String(x.telefono || ''),
      domicilio: String(x.domicilio || ''),
      tipo: String(x.tipo || ''),
      area: String(x.area || ''),
      puesto: String(x.puesto || ''),
      objetivo: String(x.objetivo || ''),
      nacimiento: String(x.nacimiento || ''),
      genero: x.genero === 'F' || x.genero === 'M' ? x.genero : '',
      ingreso: String(x.ingreso || ''),
      estado: String(x.estado || ''),
      ultimaActividad: String(x.ultimaActividad || ''),
    };
  });
}

/** Reemplaza la carga anterior: quien ya no viene queda con enPadron false, sin borrar el doc. */
export async function guardarPadron(empresaId: string, filas: FilaPadron[], archivo: string): Promise<EstadoPadron> {
  const ahora = new Date().toISOString();
  const quien = actor();
  const previos = await getDocs(query(collection(db, 'padron_empleados'), where('empresaId', '==', empresaId)));
  const vigentes = new Set(filas.map((f) => idDocPadron(empresaId, f.legajo)));
  for (const d of previos.docs) {
    if (!vigentes.has(d.id)) await updateDoc(d.ref, { enPadron: false, actualizadoAt: ahora });
  }
  for (const f of filas) {
    const id = idDocPadron(empresaId, f.legajo);
    const docu: DocPadron = {
      ...f,
      empresaId,
      enPadron: true,
      actualizadoAt: ahora,
      actualizadoPor: quien,
      origenArchivo: { nombre: archivo, fecha: ahora.slice(0, 10) },
    };
    await setDoc(doc(db, 'padron_empleados', id), docu);
  }
  const estado: EstadoPadron = {
    empresaId,
    fecha: ahora.slice(0, 10),
    cantidad: filas.length,
    actualizadoPor: quien,
    nombreArchivo: archivo,
  };
  await setDoc(doc(db, 'padron_estado', empresaId), estado);
  await auditar('PADRON_CARGA', `Cargó el padrón ${archivo} (${filas.length} filas)`, empresaId);
  return estado;
}

export async function aplicarAltasYCambios(opts: {
  empresaId: string;
  objectiveId: string;
  clientId: string;
  nuevos: ItemNuevo[];
  cambios: ItemCambio[];
}): Promise<{ altas: number; cambios: number; errores: string[] }> {
  const errores: string[] = [];
  let altas = 0;
  const ctx = { empresaId: opts.empresaId, objectiveId: opts.objectiveId, clientId: opts.clientId };
  for (const n of opts.nuevos) {
    const res = await confirmarAltaLegajo(formDesdeFila(n.fila, ctx), 'PADRON_ALTA');
    if ('mensaje' in res) errores.push(`${n.fila.apellido}: ${res.mensaje}`);
    else altas += 1;
  }
  let cambios = 0;
  for (const c of opts.cambios) {
    const patch: Record<string, string> = {};
    for (const d of c.diffs) {
      if (d.campo === 'mail') patch.email = c.fila.mail;
      if (d.campo === 'teléfono') patch.phone = c.fila.telefono;
      if (d.campo === 'domicilio') patch.address = c.fila.domicilio;
      if (d.campo === 'puesto') patch.category = c.fila.puesto;
      if (d.campo === 'ingreso') patch.startDate = c.fila.ingreso;
      if (d.campo === 'apellido') patch.lastName = c.fila.apellido;
      if (d.campo === 'nombre') patch.firstName = c.fila.nombre;
      if (d.campo === 'DNI') patch.dni = c.fila.dni;
      if (d.campo === 'CUIL') patch.cuil = c.fila.cuil;
    }
    if (patch.firstName || patch.lastName) {
      patch.name = `${patch.lastName || c.empleado.apellido}, ${patch.firstName || c.empleado.nombre}`.toUpperCase();
    }
    await updateDoc(doc(db, 'empleados', c.empleado.id), patch);
    await auditar('PADRON_CAMBIO', `${c.empleado.legajo} ${c.empleado.apellido}: ${c.diffs.map((d) => `${d.campo} ${d.antes} → ${d.despues}`).join('; ')}`, opts.empresaId);
    cambios += 1;
  }
  return { altas, cambios, errores };
}

/** La baja no se aplica sola: esta función solo corre después de confirmar esa persona. */
export async function confirmarBajaPadron(emp: EmpleadoParaPadron, empresaId: string, motivo: string): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);
  await updateDoc(doc(db, 'empleados', emp.id), {
    status: 'inactivo',
    motivoBaja: motivo || 'Padrón',
    fechaBaja: hoy,
  });
  await auditar('BAJA_EMPLEADO', `Baja desde padrón: ${emp.apellido}, ${emp.nombre} | ${motivo || 'Padrón'}`, empresaId);
}
