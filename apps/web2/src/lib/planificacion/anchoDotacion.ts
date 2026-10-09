/** Ancho de la columna Dotación (escritorio). El arrastre pinta solo la variable CSS. */

export const ANCHO_MIN = 160;
export const ANCHO_MAX = 520;
export const ANCHO_COMPACTA = 252;
export const ANCHO_ANCHA = 440;

export type VistaAnchoDotacion = 'agrupada' | 'objetivo';
export type ModoAnchoDotacion = 'compacta' | 'auto' | 'ancha' | 'manual';
export type PresentacionDotacion = 'compacta' | 'completa';

export type PrefAnchoDotacion = {
  modo: ModoAnchoDotacion;
  ancho: number;
  presentacion: PresentacionDotacion;
};

const MODOS = new Set<ModoAnchoDotacion>(['compacta', 'auto', 'ancha', 'manual']);

/** 9px negrita: mayúscula ~6,2 px; espacio y puntuación más chicos. Determinista (sin canvas). */
const PX_LETRA = 6.2;
const PX_FINO = 3;

export function claveAnchoDotacion(vista: VistaAnchoDotacion): string {
  return `cosp-planif-ancho-dotacion:${vista}`;
}

export function clampAnchoDotacion(px: number): number {
  if (!Number.isFinite(px)) return ANCHO_ANCHA;
  return Math.max(ANCHO_MIN, Math.min(ANCHO_MAX, Math.round(px)));
}

export function anchoTextoNombre(texto: string): number {
  let n = 0;
  for (const ch of String(texto || '')) {
    n += ch === ' ' || ch === '.' || ch === ',' ? PX_FINO : PX_LETRA;
  }
  return Math.ceil(n);
}

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'das', 'dos']);

function iniciales(palabras: string[]): string {
  return palabras.map((p) => `${p.charAt(0).toUpperCase()}.`).join(' ');
}

/** Apellido completo + iniciales; si no entra, el segundo apellido en inicial; al final «…». */
export function abreviarNombreGuardia(nombre: string, anchoPx: number): string {
  const full = String(nombre || '').trim().replace(/\s+/g, ' ');
  if (!full) return '';
  const limite = Number.isFinite(anchoPx) ? anchoPx : 0;
  if (anchoTextoNombre(full) <= limite) return full;

  const variantes: string[] = [];
  const partes = full.split(',').map((s) => s.trim());
  const apellidos = (partes[0] || '').split(/\s+/).filter(Boolean);
  const nombres = (partes[1] || '').split(/\s+/).filter((w) => w && !PARTICULAS.has(w.toLowerCase()));
  if (apellidos.length && nombres.length) {
    const ini = iniciales(nombres);
    variantes.push(`${apellidos.join(' ')}, ${ini}`);
    if (apellidos.length >= 2) {
      variantes.push(`${apellidos[0]} ${iniciales(apellidos.slice(1))}, ${ini}`.replace(/\s+/g, ' '));
    }
  }

  for (const v of variantes) {
    if (anchoTextoNombre(v) <= limite) return v;
  }
  const base = variantes[variantes.length - 1] || full;
  return cortarConPuntos(base, limite);
}

function cortarConPuntos(texto: string, anchoPx: number): string {
  const ell = '…';
  if (anchoTextoNombre(ell) > anchoPx) return ell;
  let s = texto;
  while (s.length > 0 && anchoTextoNombre(`${s}${ell}`) > anchoPx) {
    s = s.slice(0, -1).trimEnd();
  }
  return s ? `${s}${ell}` : ell;
}

export type FlagsAnchoFila = {
  compacta?: boolean;
  conPuesto?: boolean;
  conHoras?: boolean;
  conKm?: boolean;
  conExt?: boolean;
  conPuntaje?: boolean;
  conTope?: boolean;
};

const RESERVA = {
  padding: 16,
  grip: 14,
  puntaje: 28,
  ext: 52,
  horas: 36,
  km: 40,
  tope: 36,
  puestoLinea: 72,
  puestoLado: 96,
};

function reserva(flags: FlagsAnchoFila): number {
  const compacta = !!flags.compacta;
  return RESERVA.padding + RESERVA.grip
    + (flags.conPuntaje ? RESERVA.puntaje : 0)
    + (!compacta && flags.conExt ? RESERVA.ext : 0)
    + (!compacta && flags.conHoras ? RESERVA.horas : 0)
    + (!compacta && flags.conKm ? RESERVA.km : 0)
    + (!compacta && flags.conTope ? RESERVA.tope : 0)
    + (flags.conPuesto ? (compacta ? RESERVA.puestoLinea : RESERVA.puestoLado) : 0);
}

/** Píxeles que le quedan al texto del nombre dentro de la columna. */
export function anchoCajaNombre(anchoColumna: number, flags: FlagsAnchoFila = {}): number {
  return Math.max(24, Math.round(anchoColumna - reserva(flags)));
}

/** Columna necesaria para el nombre completo más los chips de la fila (modo Auto). */
export function anchoContenidoFila(nombre: string, flags: FlagsAnchoFila = {}): number {
  const texto = anchoTextoNombre(String(nombre || ''));
  const extra = reserva({ ...flags, compacta: false, conPuntaje: flags.conPuntaje !== false });
  return texto + extra + 12;
}

export function anchoAutoDotacion(anchos: readonly number[]): number {
  const validos = anchos.filter((n) => Number.isFinite(n) && n > 0);
  if (!validos.length) return ANCHO_ANCHA;
  return clampAnchoDotacion(Math.max(...validos));
}

export function anchosEnVista(
  filas: readonly { top: number; bottom: number; ancho: number }[],
  vistaTop: number,
  vistaBottom: number,
): number[] {
  return filas.filter((f) => f.bottom > vistaTop && f.top < vistaBottom).map((f) => f.ancho);
}

const FALLBACK: PrefAnchoDotacion = { modo: 'ancha', ancho: ANCHO_ANCHA, presentacion: 'completa' };

export function leerAnchoDotacion(
  storage: { getItem(k: string): string | null } | null | undefined,
  vista: VistaAnchoDotacion,
): PrefAnchoDotacion {
  try {
    if (!storage) return FALLBACK;
    const raw = storage.getItem(claveAnchoDotacion(vista));
    if (!raw) return FALLBACK;
    const parsed = JSON.parse(raw) as Partial<PrefAnchoDotacion>;
    if (!parsed.modo || !MODOS.has(parsed.modo)) return FALLBACK;
    if (!Number.isFinite(Number(parsed.ancho))) return FALLBACK;
    const presentacion: PresentacionDotacion = parsed.presentacion === 'compacta' || parsed.modo === 'compacta'
      ? 'compacta'
      : 'completa';
    return { modo: parsed.modo, ancho: clampAnchoDotacion(Number(parsed.ancho)), presentacion };
  } catch {
    return FALLBACK;
  }
}

export function guardarAnchoDotacion(
  storage: { setItem(k: string, v: string): void } | null | undefined,
  vista: VistaAnchoDotacion,
  pref: PrefAnchoDotacion,
): void {
  try {
    storage?.setItem(claveAnchoDotacion(vista), JSON.stringify({
      modo: pref.modo,
      ancho: clampAnchoDotacion(pref.ancho),
      presentacion: pref.presentacion,
    }));
  } catch {
    /* almacenamiento privado o lleno */
  }
}
