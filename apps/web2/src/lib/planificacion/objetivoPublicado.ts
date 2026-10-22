/**
 * ¿El cronograma del objetivo está publicado?
 * Misma regla que la grilla (`fetchPlanificacionPublishStatus`): el doc tenant sin
 * `publishedAt` no tapa al id legacy. El overlay de puestos crea ese doc tenant vacío.
 */

export const TEXTO_SIN_VERIFICAR_PUBLICACION = 'No se pudo verificar la publicación';

export type DatosPublicacion = { publishedAt?: unknown; publishedBy?: unknown } | null | undefined;

/** Id de `planificacion_estados`. Igual que `buildPlanificacionEstadoDocId`. */
export function idPlanificacionEstado(empresaId: string, objectiveId: string, year: number, month: number): string {
  const e = String(empresaId ?? '').trim();
  const o = String(objectiveId ?? '').trim();
  if (e) return `${e}_${o}_${year}_${month}`;
  return `${o}_${year}_${month}`;
}

/** Primer doc con `publishedAt`. El tenant sin publicar no gana sobre el legacy. */
export function docConPublishedAt(docs: DatosPublicacion[]): { publishedAt: unknown; publishedBy: string } | null {
  for (const d of docs) {
    if (!d) continue;
    const publishedAt = d.publishedAt;
    if (publishedAt != null && publishedAt !== '') {
      return { publishedAt, publishedBy: String(d.publishedBy ?? '') };
    }
  }
  return null;
}

export type LeerEstadoPlanificacion = (docId: string) => Promise<DatosPublicacion>;

/**
 * Lectura fresca. Sin `leer`, usa `fetchPlanificacionPublishStatus` (la grilla).
 * Con `leer`, recorre tenant y después legacy: es la misma regla, para el test.
 */
export async function objetivoPublicado(
  empresaId: string,
  objId: string,
  anio: number,
  mes: number,
  leer?: LeerEstadoPlanificacion,
): Promise<boolean> {
  if (!leer) {
    const { fetchPlanificacionPublishStatus } = await import('@/lib/multiempresa');
    const st = await fetchPlanificacionPublishStatus(empresaId, objId, anio, mes);
    return docConPublishedAt([st]) != null;
  }
  const primary = idPlanificacionEstado(empresaId, objId, anio, mes);
  const legacy = idPlanificacionEstado('', objId, anio, mes);
  const ids = [primary, legacy].filter((id, i, arr) => arr.indexOf(id) === i);
  for (const id of ids) {
    if (docConPublishedAt([await leer(id)])) return true;
  }
  return false;
}

export function avisoCeldaObjetivoPublicado(nombre: string): string {
  return `${nombre} ya está publicado: no se escribió solo. La corrección puntual se hace celda por celda.`;
}

export function avisoCeldaSinVerificarPublicado(nombre: string): string {
  return `No se pudo verificar si ${nombre} está publicado: no se escribió.`;
}

/**
 * Objetivo que hay que re-leer antes de pisar una celda.
 * Manda el turno que ya está en esa fila y columna. Si la celda está vacía,
 * el que usaría un turno nuevo (fuente, lugar o guardia). El objetivo
 * seleccionado del grupo solo entra si no hay otro.
 */
export function objetivoDeLaCelda(
  objectiveIdCelda?: string | null,
  objectiveIdTurno?: string | null,
  respaldo?: string | null,
): string {
  const celda = String(objectiveIdCelda ?? '').trim();
  if (celda) return celda;
  const turno = String(objectiveIdTurno ?? '').trim();
  if (turno) return turno;
  return String(respaldo ?? '').trim();
}
