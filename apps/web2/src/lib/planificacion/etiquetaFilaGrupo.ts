/**
 * Etiqueta de la fila en la vista agrupada: puesto principal + objetivo,
 * y el resto (otros puestos u objetivos del mes) en el tooltip.
 */

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'en']);

export type FuenteFilaGrupo = {
  puesto: string;
  objetivoId: string;
};

export type ObjetivoDeGrupo = {
  id: string;
  nombre: string;
};

export type EtiquetaFilaGrupo = {
  puesto: string;
  objetivoId: string;
  objetivoCorto: string;
  objetivoSigla: string;
  /** Lo que se muestra: el corto, o la sigla si el corto no entra. */
  objetivoVisible: string;
  objetivoNombre: string;
  tooltip: string;
};

export function puestoDeTurno(turno: {
  positionName?: unknown;
  originalPositionName?: unknown;
} | null | undefined): string {
  const orig = String(turno?.originalPositionName || '').trim();
  const pos = String(turno?.positionName || '').trim();
  if (orig && orig.toLowerCase() !== 'general') return orig;
  return pos;
}

export function partesObjetivo(nombre: string): { corto: string; sigla: string } {
  const raw = String(nombre || '').trim();
  if (!raw) return { corto: '', sigla: '' };
  const tokens = raw.split(/\s+/).filter(Boolean);
  const esUtil = (t: string) => {
    const limpio = t.replace(/\./g, '');
    if (limpio.length <= 1) return false;
    return !PALABRAS_VACIAS.has(limpio.toLowerCase());
  };
  const utiles = tokens.filter(esUtil);
  const base = utiles.length ? utiles : tokens;
  const sigla = base.map((t) => t.replace(/\./g, '').charAt(0)).join('').slice(0, 4).toUpperCase();
  const primeroEsInicial = !!tokens[0] && tokens[0].replace(/\./g, '').length <= 1;
  let corto: string;
  if (primeroEsInicial || base.length <= 1) {
    corto = base[base.length - 1] || raw;
  } else {
    corto = base.slice(0, 2).join(' ');
    if (corto.length > 14) corto = base[0];
  }
  return { corto, sigla };
}

export function etiquetaFilaGrupo(
  fuentes: FuenteFilaGrupo[],
  objetivos: ObjetivoDeGrupo[],
): EtiquetaFilaGrupo | null {
  const nombres = new Map(objetivos.map((o) => [o.id, o.nombre]));
  const permitidos = new Set(objetivos.map((o) => o.id));
  const conteo = new Map<string, { puesto: string; objetivoId: string; n: number }>();
  for (const f of fuentes) {
    const puesto = String(f.puesto || '').trim();
    const objetivoId = String(f.objetivoId || '').trim();
    if (!puesto || !objetivoId || !permitidos.has(objetivoId)) continue;
    const key = `${puesto}\0${objetivoId}`;
    const prev = conteo.get(key);
    if (prev) prev.n += 1;
    else conteo.set(key, { puesto, objetivoId, n: 1 });
  }
  const ranked = [...conteo.values()].sort(
    (a, b) => b.n - a.n || a.puesto.localeCompare(b.puesto, 'es'),
  );
  if (!ranked.length) return null;
  const top = ranked[0];
  const nombre = nombres.get(top.objetivoId) || top.objetivoId;
  const { corto, sigla } = partesObjetivo(nombre);
  const visible = corto.length > 12 ? sigla : corto;
  const otros = ranked.slice(1).map((r) => {
    const nom = nombres.get(r.objetivoId) || r.objetivoId;
    return `${r.puesto} · ${nom}`;
  });
  const linea = `${top.puesto} · ${nombre}`;
  const tooltip = otros.length ? `${linea}. También: ${otros.join(' · ')}` : linea;
  return {
    puesto: top.puesto,
    objetivoId: top.objetivoId,
    objetivoCorto: corto,
    objetivoSigla: sigla,
    objetivoVisible: visible,
    objetivoNombre: nombre,
    tooltip,
  };
}
