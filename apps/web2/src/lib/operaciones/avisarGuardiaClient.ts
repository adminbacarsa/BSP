import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import { buildNotaNovedad, normalizarNota, type OpsNota } from '@/lib/operaciones/opsNota';

export type AvisoManualKind = 'ENTRANTE' | 'RETENIDO';

export interface AvisarGuardiaResult {
  ok: true;
  kind: AvisoManualKind;
  convocatoriaId?: string | null;
  resent?: boolean;
  body: string;
}

/**
 * Aviso manual por la app desde el CC (escritorio o celular). Callable `avisarGuardiaOperaciones`:
 * ENTRANTE = convocatoria LLEGADA_TARDE («te esperan, ¿venís?», responde 10/15/30 o problema);
 * RETENIDO = push «seguís retenido, tu relevo llega ~HH:MM / no llegó». Cooldown 5 min por guardia.
 */
export async function invokeAvisarGuardiaOperaciones(params: {
  shiftId: string;
  kind: AvisoManualKind;
  relatedShiftId?: string | null;
  actorName?: string | null;
  device?: string | null;
}): Promise<AvisarGuardiaResult> {
  const fn = httpsCallable<typeof params, AvisarGuardiaResult>(functions, 'avisarGuardiaOperaciones');
  const res = await fn({
    shiftId: String(params.shiftId || '').trim(),
    kind: params.kind,
    relatedShiftId: params.relatedShiftId || null,
    actorName: params.actorName || null,
    device: params.device || (typeof navigator !== 'undefined' ? (navigator.userAgent.includes('Mobile') ? 'celular' : 'escritorio') : null),
  });
  return res.data;
}

/**
 * Nota rápida del operador: última nota en el turno (`opsNota`, la ve la tarjeta) y una novedad
 * `NOTA_OPERADOR` (bitácora del escritorio). Escritura directa Firestore: el celular la encola sin red.
 */
export async function guardarNotaOperador(params: {
  shift: Record<string, unknown> & { id: string };
  texto: string;
  autor: string;
  autorUid?: string | null;
  empresaId?: string | null;
  source?: 'CC_MOVIL' | 'CC';
}): Promise<OpsNota | null> {
  const texto = normalizarNota(params.texto);
  if (!texto) return null;
  const shiftId = String(params.shift.id || '').trim();
  if (!shiftId || shiftId.startsWith('gap_') || params.shift.isVirtual) return null;
  const empresaId = String(params.empresaId || params.shift.empresaId || '').trim();
  const at = new Date();
  const nota: OpsNota = { texto, autor: params.autor, autorUid: params.autorUid || null, at };
  await updateDoc(doc(db, 'turnos', shiftId), {
    opsNota: { texto, autor: params.autor, autorUid: params.autorUid || null, at: serverTimestamp() },
    opsNotaAt: serverTimestamp(),
  });
  await addDoc(collection(db, 'novedades'), stampEmpresaId({
    ...buildNotaNovedad({ ...params.shift, empresaId }, nota, params.source || 'CC'),
    createdAt: serverTimestamp(),
  }, empresaId));
  return nota;
}
