import { addDoc, collection, getDocs, query, serverTimestamp, updateDoc, doc, where, arrayUnion } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { normalizeCuil } from '@/lib/eventuales/cuil.mjs';
import { type AltaForm, type LegajoConocido, decidirAlta, docDeAlta } from '@/lib/planificacion/padronAlta';

async function auditar(accion: string, detalle: string, empresaId: string): Promise<void> {
  try {
    const u = getAuth().currentUser;
    await addDoc(collection(db, 'audit_logs'), {
      timestamp: serverTimestamp(),
      actorUid: u?.uid || 'unknown',
      actorName: u?.displayName || u?.email || 'Desc',
      action: accion,
      module: 'RRHH',
      details: detalle,
      empresaId,
      metadata: { platform: 'web', via: 'ALTA_DESDE_PADRON' },
    });
  } catch {
    /* la auditoría no frena el alta */
  }
}

function deDoc(id: string, data: Record<string, unknown>): LegajoConocido {
  return {
    id,
    empresaId: String(data.empresaId || ''),
    dni: String(data.dni || ''),
    cuil: String(data.cuil || ''),
    fileNumber: String(data.fileNumber || data.legajo || ''),
    name: String(data.name || `${data.lastName || ''}, ${data.firstName || ''}`),
  };
}

/** Legajos de la empresa (legajo) y de cualquier empresa (DNI y CUIL), para no duplicar. */
export async function buscarLegajosExistentes(form: Pick<AltaForm, 'dni' | 'cuil' | 'legajo' | 'empresaId'>): Promise<LegajoConocido[]> {
  const porId = new Map<string, LegajoConocido>();
  const sumar = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
    for (const d of snap.docs) porId.set(d.id, deDoc(d.id, d.data()));
  };
  const dni = String(form.dni || '').replace(/\D/g, '');
  const cuil = normalizeCuil(form.cuil) || '';
  const legajo = String(form.legajo || '').trim();
  if (dni) sumar(await getDocs(query(collection(db, 'empleados'), where('dni', '==', dni))));
  if (cuil) sumar(await getDocs(query(collection(db, 'empleados'), where('cuil', '==', cuil))));
  if (legajo && form.empresaId) {
    sumar(await getDocs(query(collection(db, 'empleados'), where('empresaId', '==', form.empresaId), where('fileNumber', '==', legajo))));
  }
  return [...porId.values()];
}

export type AltaHecha = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  fileNumber: string;
  dni: string;
  cuil: string;
  genero: string;
  status: string;
  preferredObjectiveId: string;
  preferredClientId: string;
  habilitado: boolean;
};

function hecho(id: string, docAlta: Record<string, unknown>, habilitado: boolean): AltaHecha {
  return {
    id,
    name: String(docAlta.name || ''),
    firstName: String(docAlta.firstName || ''),
    lastName: String(docAlta.lastName || ''),
    fileNumber: String(docAlta.fileNumber || ''),
    dni: String(docAlta.dni || ''),
    cuil: String(docAlta.cuil || ''),
    genero: String(docAlta.genero || ''),
    status: String(docAlta.status || 'activo'),
    preferredObjectiveId: String(docAlta.preferredObjectiveId || ''),
    preferredClientId: String(docAlta.preferredClientId || ''),
    habilitado,
  };
}

/**
 * Crea el legajo (mismo documento que el alta de RRHH) o habilita el que ya existe en otra empresa.
 * Devuelve el mensaje si la validación no deja seguir.
 */
export async function confirmarAltaLegajo(form: AltaForm, auditoria: 'CREATE_EMPLOYEE' | 'PADRON_ALTA' = 'CREATE_EMPLOYEE'): Promise<{ ok: true; empleado: AltaHecha; avisos: string[] } | { ok: false; mensaje: string }> {
  const existentes = await buscarLegajosExistentes(form);
  const decision = decidirAlta(form, existentes, form.empresaId);
  if (decision.accion === 'bloquear') return { ok: false, mensaje: decision.mensaje };
  if (decision.accion === 'habilitar') {
    const ref = doc(db, 'empleados', decision.existente.id);
    const objetivo = form.objectiveId;
    await updateDoc(ref, {
      habilitadoEn: arrayUnion(form.empresaId),
      ...(objetivo ? { [`planificacionDotacion.${objetivo}`]: { positionName: 'Vigilador' } } : {}),
    });
    await auditar('HABILITAR_EMPLEADO', `Habilitó en ${form.empresaId} el legajo ${decision.existente.fileNumber} - ${decision.existente.name}`, form.empresaId);
    const docAlta = docDeAlta(form);
    return {
      ok: true,
      avisos: decision.avisos,
      empleado: hecho(decision.existente.id, { ...docAlta, name: decision.existente.name, fileNumber: decision.existente.fileNumber }, true),
    };
  }
  const ref = await addDoc(collection(db, 'empleados'), decision.doc);
  await auditar(auditoria, `Creó legajo: ${decision.doc.fileNumber} - ${decision.doc.lastName}`, form.empresaId);
  return { ok: true, avisos: decision.avisos, empleado: hecho(ref.id, decision.doc, false) };
}
