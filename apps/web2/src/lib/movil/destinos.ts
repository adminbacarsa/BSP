export type MovilDestinoId = 'operacion' | 'supervision' | 'planificacion' | 'eventuales' | 'rrhh' | 'servicios';

/** Una sección de la barra del módulo. `panel` vacío = inicio. `sala` no navega: abre la hoja. */
export interface MovilSeccion {
  id: string;
  label: string;
  panel: string;
  /** Esta sección muestra el contador de alertas del módulo. */
  alertas?: boolean;
}

/**
 * Contrato del shell. Planificación y RRHH/Eventuales registran su módulo acá:
 * `path`, `href`, `mobile`, `secciones` y `alertaTipos`. La barra y el filtro salen de esta lista.
 */
export interface MovilDestino {
  id: MovilDestinoId;
  label: string;
  desc: string;
  href: string;
  /** Prefijo de ruta. Entre dos que matchean gana el más largo. */
  path: string;
  mobile: boolean;
  /** Permiso principal (`roles.permissions`). */
  moduleKey: string;
  /** Otros permisos de lectura que también abren el módulo. */
  tambien?: string[];
  secciones: MovilSeccion[];
  /** Tipos de novedad que son alerta de ESTE módulo. ARCA se resuelve aparte. */
  alertaTipos: readonly string[];
}

const ALERTAS_OPERACION = [
  'AUSENCIA_AUTO',
  'AUSENCIA_OPERATIVA',
  'AUSENCIA_CORTO_PLAZO',
  'AVISO_AUSENCIA_ANTICIPADA',
  'VACANTE_PROTOCOLO_COBERTURA',
  'VACANTE_OPERATIVA',
  'RELEVO_NO_PRESENTADO',
  'POSICION_SIN_RELEVO',
  'RETENCION_LARGA',
  'RELEVO_INMINENTE',
  'LLEGADA_TARDE',
  'CONVOCADO_DEMORADO',
  'PROBLEMA_CONVOCADO',
  'ALTA_ARCA_PENDIENTE',
] as const;

export const MOVIL_DESTINOS: MovilDestino[] = [
  {
    id: 'operacion',
    label: 'Operación',
    desc: 'Centro de Control',
    href: '/admin/operaciones/',
    path: '/admin/operaciones',
    mobile: true,
    moduleKey: 'OPERATIONS',
    secciones: [
      { id: 'objetivos', label: 'Objetivos', panel: '' },
      { id: 'alertas', label: 'Alertas de operación', panel: 'alertas', alertas: true },
      { id: 'sala', label: 'Sala', panel: 'sala' },
    ],
    alertaTipos: ALERTAS_OPERACION,
  },
  {
    id: 'supervision',
    label: 'Supervisión',
    desc: 'Solo lectura',
    href: '/admin/operaciones/?modo=supervision',
    path: '/admin/operaciones',
    mobile: true,
    moduleKey: 'SUPERVISION',
    tambien: ['OPERATIONS'],
    secciones: [
      { id: 'objetivos', label: 'Objetivos', panel: '' },
      { id: 'alertas', label: 'Alertas', panel: 'alertas', alertas: true },
    ],
    alertaTipos: ALERTAS_OPERACION,
  },
  {
    id: 'planificacion',
    label: 'Planificación',
    desc: 'Cronogramas',
    href: '/admin/planificacion/',
    path: '/admin/planificacion',
    mobile: false,
    moduleKey: 'PLANNING',
    secciones: [
      { id: 'dias', label: 'Próximos días', panel: '' },
      { id: 'huecos', label: 'Huecos', panel: 'huecos', alertas: true },
    ],
    alertaTipos: ['VACANTE_A_PLANIFICACION', 'REFUERZO_CLIENTE_PENDIENTE', 'REFUERZO_ESTRUCTURAL', 'CRONOGRAMA_SIN_PUBLICAR'],
  },
  {
    id: 'eventuales',
    label: 'Eventuales',
    desc: 'Bolsa y convocatorias',
    href: '/admin/rrhh/eventuales/',
    path: '/admin/rrhh/eventuales',
    mobile: true,
    moduleKey: 'EVENTUALES',
    tambien: ['RRHH'],
    secciones: [
      { id: 'bolsa', label: 'Bolsa', panel: '' },
      { id: 'arca', label: 'ARCA pendientes', panel: 'arca', alertas: true },
      { id: 'alta', label: 'Alta', panel: 'alta' },
    ],
    alertaTipos: [],
  },
  {
    id: 'rrhh',
    label: 'RRHH',
    desc: 'Legajos y novedades',
    href: '/admin/rrhh/movil/',
    path: '/admin/rrhh/movil',
    mobile: true,
    moduleKey: 'RRHH',
    secciones: [
      { id: 'hoy', label: 'Hoy', panel: '' },
      { id: 'cargar', label: 'Cargar', panel: 'cargar' },
      { id: 'novedades', label: 'Novedades', panel: 'novedades', alertas: true },
    ],
    alertaTipos: ['RRHH_NOVEDAD'],
  },
  {
    id: 'servicios',
    label: 'Servicios',
    desc: 'Contratos por objetivo',
    href: '/admin/servicios/',
    path: '/admin/servicios',
    mobile: true,
    moduleKey: 'SERVICES',
    tambien: ['CLIENTS'],
    secciones: [
      { id: 'lista', label: 'Lista', panel: '' },
    ],
    alertaTipos: [],
  },
];

type CanRead = (moduleKey: string) => boolean;

function destinoPermitido(destino: MovilDestino, canRead: CanRead): boolean {
  if (canRead(destino.moduleKey)) return true;
  return (destino.tambien || []).some((key) => canRead(key));
}

/** Módulos que el selector muestra. SuperAdmin ve los seis; sin el permiso, el módulo no aparece. */
export function movilDestinosVisibles(canRead: CanRead, isSuperAdmin = false): MovilDestino[] {
  if (isSuperAdmin) return MOVIL_DESTINOS;
  return MOVIL_DESTINOS.filter((destino) => destinoPermitido(destino, canRead));
}

type Query = Record<string, string | string[] | undefined>;

function queryValue(query: Query | undefined, key: string): string {
  const raw = query?.[key];
  return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
}

/** Módulo de la ruta actual. Supervisión comparte path con Operación y se distingue por `modo`. */
export function movilDestinoForPath(pathname: string, query?: Query): MovilDestino | null {
  const path = String(pathname || '').replace(/\/$/, '');
  if (path.startsWith('/admin/operaciones')) {
    const id: MovilDestinoId = queryValue(query, 'modo') === 'supervision' ? 'supervision' : 'operacion';
    return MOVIL_DESTINOS.find((item) => item.id === id) || null;
  }
  const ordered = MOVIL_DESTINOS.filter((item) => item.id !== 'operacion' && item.id !== 'supervision')
    .slice()
    .sort((a, b) => b.path.length - a.path.length);
  return ordered.find((item) => path === item.path || path.startsWith(`${item.path}/`)) || null;
}

/**
 * La alerta es de este módulo. Cualquier tipo con «ARCA» es de Eventuales,
 * salvo ALTA_ARCA_PENDIENTE, que traba una fichada y por eso es de Operación (y de Supervisión, que mira lo mismo).
 */
export function alertaDelModulo(moduloId: MovilDestinoId, type: unknown): boolean {
  const nombre = String(type ?? '').trim().toUpperCase();
  if (!nombre) return false;
  if (nombre === 'ALTA_ARCA_PENDIENTE') return moduloId === 'operacion' || moduloId === 'supervision';
  if (nombre.includes('ARCA')) return moduloId === 'eventuales';
  const destino = MOVIL_DESTINOS.find((item) => item.id === moduloId);
  return !!destino && destino.alertaTipos.includes(nombre);
}

export function filtrarAlertasDelModulo<T extends { type?: unknown }>(moduloId: MovilDestinoId, items: readonly T[]): T[] {
  return items.filter((item) => alertaDelModulo(moduloId, item.type));
}
