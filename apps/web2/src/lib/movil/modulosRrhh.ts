import { registrarModuloMovil, tipoAlerta, type MovilAlerta } from './modulos';

const NOVEDADES_RRHH = new Set(['OBSERVACIÓN', 'OBSERVACION', 'INCIDENTE', 'UNIFORME', 'OTRO']);

export function esAlertaDeRrhh(alerta: MovilAlerta): boolean {
  const type = tipoAlerta(alerta);
  if (String(alerta.source || '').toUpperCase() === 'AUSENCIA') return true;
  return /^(AUSENCIA|CERTIFICADO_|LICENCIA_)/.test(type) || NOVEDADES_RRHH.has(type);
}

export function esAlertaDeEventuales(alerta: MovilAlerta): boolean {
  const type = tipoAlerta(alerta);
  return /^(ARCA_|ALTA_ARCA_|BAJA_ARCA_|CONTRATO_|MARCO_|EVENTUAL_)/.test(type);
}

registrarModuloMovil({
  id: 'rrhh',
  label: 'RRHH',
  desc: 'Lo del día, ausencias y novedades',
  href: '/admin/rrhh/movil/',
  path: '/admin/rrhh',
  moduleKeys: ['RRHH'],
  secciones: [
    { id: 'hoy', label: 'Hoy', href: '/admin/rrhh/movil/', icono: 'hoy', panel: '' },
    { id: 'cargar', label: 'Cargar', href: '/admin/rrhh/movil/?panel=ausencia', icono: 'cargar', panel: 'ausencia' },
    { id: 'novedades', label: 'Novedades', href: '/admin/rrhh/movil/?panel=novedad', icono: 'novedades', panel: 'novedad' },
  ],
  esAlertaDelModulo: esAlertaDeRrhh,
});

registrarModuloMovil({
  id: 'eventuales',
  label: 'Eventuales',
  desc: 'Bolsa, ARCA y altas',
  href: '/admin/rrhh/eventuales/',
  path: '/admin/rrhh/eventuales',
  moduleKeys: ['EVENTUALES', 'RRHH'],
  secciones: [
    { id: 'bolsa', label: 'Bolsa', href: '/admin/rrhh/eventuales/', icono: 'bolsa', panel: '' },
    { id: 'arca', label: 'ARCA', href: '/admin/rrhh/eventuales/?panel=arca', icono: 'arca', panel: 'arca' },
    { id: 'alta', label: 'Alta', href: '/admin/rrhh/eventuales/?panel=alta', icono: 'alta', panel: 'alta' },
  ],
  esAlertaDelModulo: esAlertaDeEventuales,
});
