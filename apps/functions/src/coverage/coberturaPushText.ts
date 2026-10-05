/**
 * Texto del push / `user_notifications` de una convocatoria de cobertura.
 * Lógica pura (sin Firebase) para testearla sola.
 */

/** «HH:MM» en 24 h, hora AR. Sin `hourCycle: 'h23'` es-AR devuelve «05:00 p. m.». */
export function formatHoraAr24(d: Date, tz = 'America/Argentina/Buenos_Aires'): string {
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
}

/**
 * «Laura, ¿nos das una mano? Necesitamos cubrir Puesto 1 en Peaje 9 Norte de 16:00 a 17:00.»
 * La app arma la misma frase cuando tiene que mostrarla sin el servidor
 * (`apps/mobile-guardia/src/lib/convocatoriaCard.ts`).
 */
export function coberturaBody(input: {
  name?: string;
  objectiveName?: string | null;
  positionName?: string | null;
  clientName?: string | null;
  horaInicio: string;
  horaFin?: string;
}): string {
  const puesto = String(input.positionName || '').trim();
  const objetivo = String(input.objectiveName || '').trim();
  const cliente = String(input.clientName || '').trim();
  const lugar =
    puesto && objetivo ? `${puesto} en ${objetivo}` : puesto || objetivo || cliente || 'el puesto';
  const hi = String(input.horaInicio || '').trim();
  const hf = String(input.horaFin || '').trim();
  const rango = hi && hi !== '--:--' ? (hf ? ` de ${hi} a ${hf}` : ` a las ${hi}`) : '';
  const frase = `¿nos das una mano? Necesitamos cubrir ${lugar}${rango}.`;
  return input.name ? `${input.name}, ${frase}` : `¿Nos das una mano? Necesitamos cubrir ${lugar}${rango}.`;
}
