/** Aviso manual del CC: entrante (¿Venís?) y retenido (tarjeta informativa). */

export function isRetencionAviso(type: string | undefined): boolean {
  return String(type || '').trim().toUpperCase() === 'RETENCION_AVISO';
}

export function isAvisoEntrante(input: {
  type?: string;
  title?: string;
  convType?: string;
}): boolean {
  if (String(input.convType || '').trim().toUpperCase() === 'LLEGADA_TARDE') return true;
  const type = String(input.type || '').trim().toUpperCase();
  const title = String(input.title || '').trim().toLowerCase();
  const venis =
    title === '¿venís?' ||
    title === '¿venis?' ||
    title.startsWith('¿venís') ||
    title.startsWith('¿venis');
  if (venis && (type === 'CONVOCATORIA_COBERTURA' || type === 'LLEGADA_TARDE' || type === '')) {
    return true;
  }
  return type === 'LLEGADA_TARDE';
}

/** Texto del push ENTRANTE. Si el server mandó body, se muestra ese. */
export function avisoEntranteTexto(input: {
  body?: string | null;
  objectiveName?: string | null;
  positionName?: string | null;
}): string {
  const body = String(input.body || '').trim();
  if (body) return body;
  const lugar = [input.objectiveName, input.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  return lugar ? `Te esperan en ${lugar}, ¿venís?` : 'Te esperan en el puesto, ¿venís?';
}
