/** Cronómetro del armado de un objetivo-mes. Pausa mayor a 5 min no suma al tiempo activo. */

export const PAUSA_ARMADO_MS = 5 * 60 * 1000;

export type OrigenArmado = 'MANUAL' | 'COPIA_MES_ANTERIOR' | 'CONTINUAR_MES_ANTERIOR' | 'ROTACION_SLA';

export interface UsuarioArmado {
  uid: string;
  nombre: string;
}

export interface ArmadoCronograma {
  iniciadoAt: string | null;
  completadoAt: string | null;
  publicadoAt: string | null;
  minutosActivos: number;
  minutosTranscurridos: number;
  cambios: number;
  usuarios: UsuarioArmado[];
  origen: OrigenArmado;
  correccionesPostPublicacion: number;
  /** Última acción guardada: la pausa de la sesión siguiente se mide contra esto. */
  ultimaAccionAt: string | null;
}

export interface AccionArmado {
  cambios: number;
  uid: string;
  nombre: string;
  origen: OrigenArmado;
  /** El mes ya estaba publicado: esta guardada cuenta aparte, no reemplaza al armado. */
  contarCorreccion: boolean;
  /** Puestos sin cerrar = 0 (la misma cuenta de la fila COBERTURA). */
  slaCompleto: boolean;
}

export function armadoVacio(): ArmadoCronograma {
  return {
    iniciadoAt: null,
    completadoAt: null,
    publicadoAt: null,
    minutosActivos: 0,
    minutosTranscurridos: 0,
    cambios: 0,
    usuarios: [],
    origen: 'MANUAL',
    correccionesPostPublicacion: 0,
    ultimaAccionAt: null,
  };
}

function minutosDeMs(ms: number): number {
  return Math.round((Math.max(0, ms) / 60000) * 100) / 100;
}

function msDeMinutos(minutos: number): number {
  return Math.round(Math.max(0, minutos) * 60000);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function mergeUsuarios(lista: UsuarioArmado[], uid: string, nombre: string): UsuarioArmado[] {
  const id = uid.trim();
  if (!id) return lista;
  if (lista.some((u) => u.uid === id)) return lista;
  return [...lista, { uid: id, nombre: nombre.trim() || id }];
}

/**
 * Suma las acciones de una guardada al armado previo.
 * No pisa `iniciadoAt`, `origen` ni `completadoAt`. Una pausa de más de 5 min no entra en el activo.
 * Con el SLA ya completo, solo puede subir `correccionesPostPublicacion`.
 */
export function acumularArmado(
  previo: ArmadoCronograma | null,
  accionesMs: number[],
  accion: AccionArmado,
): ArmadoCronograma {
  const base = previo ? { ...previo, usuarios: [...previo.usuarios] } : armadoVacio();
  if (base.completadoAt) {
    return {
      ...base,
      correccionesPostPublicacion: base.correccionesPostPublicacion + (accion.contarCorreccion ? 1 : 0),
    };
  }

  const marcas = [...new Set(accionesMs.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  if (marcas.length === 0) {
    return {
      ...base,
      correccionesPostPublicacion: base.correccionesPostPublicacion + (accion.contarCorreccion ? 1 : 0),
    };
  }

  let activoMs = msDeMinutos(base.minutosActivos);
  let ultima = base.ultimaAccionAt ? Date.parse(base.ultimaAccionAt) : null;
  let iniciado = base.iniciadoAt ? Date.parse(base.iniciadoAt) : null;
  if (iniciado != null && !Number.isFinite(iniciado)) iniciado = null;
  if (ultima != null && !Number.isFinite(ultima)) ultima = null;

  for (const t of marcas) {
    if (iniciado == null) iniciado = t;
    if (ultima != null) {
      const gap = t - ultima;
      if (gap > 0 && gap <= PAUSA_ARMADO_MS) activoMs += gap;
    }
    ultima = t;
  }

  const finMs = marcas[marcas.length - 1];
  const completadoMs = accion.slaCompleto ? finMs : null;
  const hasta = completadoMs ?? finMs;
  const transcurridosMs = iniciado != null ? Math.max(0, hasta - iniciado) : 0;

  return {
    iniciadoAt: iniciado != null ? iso(iniciado) : null,
    completadoAt: completadoMs != null ? iso(completadoMs) : null,
    publicadoAt: base.publicadoAt,
    minutosActivos: minutosDeMs(activoMs),
    minutosTranscurridos: minutosDeMs(transcurridosMs),
    cambios: base.cambios + Math.max(0, Math.round(accion.cambios)),
    usuarios: mergeUsuarios(base.usuarios, accion.uid, accion.nombre),
    origen: base.iniciadoAt ? base.origen : accion.origen,
    correccionesPostPublicacion: base.correccionesPostPublicacion + (accion.contarCorreccion ? 1 : 0),
    ultimaAccionAt: iso(finMs),
  };
}

/** La publicación se anota aunque el SLA no esté completo. No mueve el inicio ni el activo. */
export function registrarPublicacionArmado(
  previo: ArmadoCronograma | null,
  ahoraMs: number,
): ArmadoCronograma {
  const base = previo ? { ...previo, usuarios: [...previo.usuarios] } : armadoVacio();
  if (base.publicadoAt) return base;
  return { ...base, publicadoAt: iso(ahoraMs) };
}

/** Proyección en pantalla de los clics todavía no guardados. No cuenta correcciones. */
export function proyectarArmadoEnCurso(
  previo: ArmadoCronograma | null,
  marcasMs: number[],
): ArmadoCronograma | null {
  if (!previo?.iniciadoAt || previo.completadoAt || marcasMs.length === 0) return previo;
  return acumularArmado(previo, marcasMs, {
    cambios: 0,
    uid: '',
    nombre: '',
    origen: previo.origen,
    contarCorreccion: false,
    slaCompleto: false,
  });
}

export function slaMesCompleto(
  report: { daysFull: number; daysPartial: number; daysEmpty: number } | null | undefined,
): boolean {
  if (!report) return false;
  return report.daysFull > 0 && report.daysPartial === 0 && report.daysEmpty === 0;
}

function textoTranscurrido(minutos: number): string {
  const min = Math.max(0, minutos);
  if (min >= 24 * 60) {
    const dias = Math.max(1, Math.round(min / (24 * 60)));
    return `${dias} día${dias === 1 ? '' : 's'}`;
  }
  if (min >= 60) {
    const h = Math.round(min / 60);
    return `${h} h`;
  }
  return `${Math.round(min)} min`;
}

/** «Armado: 42 min activos · 3 días» o «En curso · 18 min activos». */
export function textoArmado(armado: ArmadoCronograma | null | undefined): string | null {
  if (!armado?.iniciadoAt) return null;
  const activos = Math.round(armado.minutosActivos);
  if (armado.completadoAt) {
    return `Armado: ${activos} min activos · ${textoTranscurrido(armado.minutosTranscurridos)}`;
  }
  return `En curso · ${activos} min activos`;
}

export function detalleArmado(armado: ArmadoCronograma | null | undefined): string {
  if (!armado?.iniciadoAt) return '';
  const quienes = armado.usuarios.map((u) => u.nombre || u.uid).filter(Boolean).join(', ') || '—';
  const origen = armado.origen === 'COPIA_MES_ANTERIOR'
    ? 'Copiar mes anterior'
    : armado.origen === 'CONTINUAR_MES_ANTERIOR'
      ? 'Continuar mes anterior'
      : armado.origen === 'ROTACION_SLA'
      ? 'Rotación del SLA'
      : 'Manual';
  const corr = armado.correccionesPostPublicacion;
  return `${quienes} · ${origen} · ${armado.cambios} cambios${corr > 0 ? ` · ${corr} correcciones después de publicado` : ''}`;
}

function isoDe(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'object') {
    const o = value as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') {
      const d = o.toDate();
      if (d instanceof Date && Number.isFinite(d.getTime())) return d.toISOString();
    }
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000).toISOString();
  }
  return null;
}

const ORIGENES = new Set<OrigenArmado>(['MANUAL', 'COPIA_MES_ANTERIOR', 'CONTINUAR_MES_ANTERIOR', 'ROTACION_SLA']);

export function parseArmado(raw: unknown): ArmadoCronograma | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const iniciadoAt = isoDe(o.iniciadoAt);
  const publicadoAt = isoDe(o.publicadoAt);
  if (!iniciadoAt && !publicadoAt) return null;
  const usuariosRaw = Array.isArray(o.usuarios) ? o.usuarios : [];
  const usuarios: UsuarioArmado[] = [];
  for (const item of usuariosRaw) {
    if (!item || typeof item !== 'object') continue;
    const u = item as { uid?: unknown; nombre?: unknown };
    const uid = String(u.uid || '').trim();
    if (!uid || usuarios.some((x) => x.uid === uid)) continue;
    usuarios.push({ uid, nombre: String(u.nombre || '').trim() || uid });
  }
  const origen = ORIGENES.has(o.origen as OrigenArmado) ? (o.origen as OrigenArmado) : 'MANUAL';
  return {
    iniciadoAt,
    completadoAt: isoDe(o.completadoAt),
    publicadoAt,
    minutosActivos: Number(o.minutosActivos) || 0,
    minutosTranscurridos: Number(o.minutosTranscurridos) || 0,
    cambios: Math.max(0, Math.round(Number(o.cambios) || 0)),
    usuarios,
    origen,
    correccionesPostPublicacion: Math.max(0, Math.round(Number(o.correccionesPostPublicacion) || 0)),
    ultimaAccionAt: isoDe(o.ultimaAccionAt),
  };
}
