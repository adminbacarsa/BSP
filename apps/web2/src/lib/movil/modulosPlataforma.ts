import { registrarModuloMovil, tipoAlerta, type MovilAlerta } from './modulos';
import { esAlertaDeSupervision } from './supervisionMovil';

const ARCA_EN_OPERACION = new Set(['ALTA_ARCA_PENDIENTE']);
// CRONOGRAMA_* es de Planificación: Operación solo muestra una línea agrupada (`cronogramaAlertas.ts`).
const FUERA_DE_OPERACION = /^(IA_ALERTA_|INTEGRIDAD_DATOS|CERTIFICADO_|MARCO_|CONTRATO_|EVENTUAL_|CRONOGRAMA_|SUPERVISION_)/;

/** Alertas operativas: lo que afecta una fichada o un puesto hoy. ARCA solo si frena la fichada. */
export function esAlertaDeOperacion(alerta: MovilAlerta): boolean {
  const type = tipoAlerta(alerta);
  if (!type) return false;
  if (String(alerta.source || '').toUpperCase() === 'AUSENCIA') return false;
  if (type.startsWith('ARCA_') || type.includes('ARCA')) return ARCA_EN_OPERACION.has(type);
  return !FUERA_DE_OPERACION.test(type);
}

export function esAlertaDePlanificacion(alerta: MovilAlerta): boolean {
  const type = tipoAlerta(alerta);
  if (String(alerta.source || '').toUpperCase() === 'AUSENCIA') return true;
  return /^(CRONOGRAMA_|VACANTE|REFUERZO_|SLA_)/.test(type);
}

registrarModuloMovil({
  id: 'operacion',
  label: 'Operación',
  desc: 'Centro de Control',
  href: '/admin/operaciones/',
  path: '/admin/operaciones',
  moduleKeys: ['OPERATIONS'],
  secciones: [
    { id: 'objetivos', label: 'Objetivos', href: '/admin/operaciones/', icono: 'objetivos', panel: '' },
    { id: 'alertas', label: 'Alertas', href: '/admin/operaciones/?panel=alertas', icono: 'alertas', panel: 'alertas' },
    { id: 'sala', label: 'Sala', href: '/admin/operaciones/?panel=sala', icono: 'sala', panel: 'sala' },
  ],
  esAlertaDelModulo: esAlertaDeOperacion,
});

// Supervisión es un módulo propio del supervisor que recorre: visitas, novedades con foto y
// alertas de objetivos sin visita. No actúa sobre turnos (eso es Operación).
registrarModuloMovil({
  id: 'supervision',
  label: 'Supervisión',
  desc: 'Recorrida y visitas',
  href: '/admin/movil/supervision/',
  path: '/admin/movil/supervision',
  moduleKeys: ['SUPERVISION'],
  secciones: [
    { id: 'objetivos', label: 'Objetivos', href: '/admin/movil/supervision/', icono: 'objetivos', panel: '' },
    { id: 'alertas', label: 'Alertas', href: '/admin/movil/supervision/?panel=alertas', icono: 'alertas', panel: 'alertas' },
  ],
  esAlertaDelModulo: esAlertaDeSupervision,
});

registrarModuloMovil({
  id: 'planificacion',
  label: 'Planificación',
  desc: 'Próximos días y huecos',
  href: '/admin/movil/planificacion/',
  path: '/admin/movil/planificacion',
  // En el celular /admin/planificacion también monta la pantalla básica.
  alias: ['/admin/planificacion'],
  moduleKeys: ['PLANNING'],
  secciones: [
    { id: 'dias', label: 'Próximos días', href: '/admin/movil/planificacion/', icono: 'dias', panel: '' },
    { id: 'huecos', label: 'Huecos', href: '/admin/movil/planificacion/?panel=huecos', icono: 'huecos', panel: 'huecos' },
  ],
  esAlertaDelModulo: esAlertaDePlanificacion,
});

registrarModuloMovil({
  id: 'servicios',
  label: 'Servicios',
  desc: 'Contratos por objetivo',
  href: '/admin/servicios/',
  path: '/admin/servicios',
  moduleKeys: ['SERVICES', 'CLIENTS'],
  secciones: [
    { id: 'lista', label: 'Lista', href: '/admin/servicios/', icono: 'lista', panel: '' },
  ],
  esAlertaDelModulo: () => false,
});
