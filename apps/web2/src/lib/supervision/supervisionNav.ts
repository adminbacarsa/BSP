import type { SupervisionCampoSection, SupervisionMainTab } from '@/lib/supervision/supervisionUtils';

/** Config de navegación principal — reutilizable en portal/app supervisores. */
export type SupervisionNavTab = {
  id: SupervisionMainTab;
  label: string;
  labelKey: string;
};

export type SupervisionCampoNavSection = {
  id: SupervisionCampoSection;
  label: string;
  labelKey: string;
};

/** Orden pensado para app móvil: pulse operativo → pedidos → campo. */
export const SUPERVISION_MAIN_TABS: SupervisionNavTab[] = [
  { id: 'TABLERO', label: 'Tablero', labelKey: 'supervision.tablero' },
  { id: 'BANDEJA', label: 'Pedidos', labelKey: 'supervision.pedidos' },
  { id: 'CAMPO', label: 'Campo', labelKey: 'supervision.campo' },
];

export const SUPERVISION_CAMPO_SECTIONS: SupervisionCampoNavSection[] = [
  { id: 'NOVEDADES', label: 'Novedades', labelKey: 'supervision.campo.novedades' },
  { id: 'VISITAS', label: 'Visitas', labelKey: 'supervision.campo.visitas' },
  { id: 'CONSIGNAS', label: 'Consignas', labelKey: 'supervision.campo.consignas' },
];

export const SUPERVISION_PEDIDOS_MES_STORAGE_KEY = 'cosp:sup:pedidosMes';

export const SUPERVISION_DEFAULT_MAIN_TAB: SupervisionMainTab = 'TABLERO';

export const SUPERVISION_PEDIDO_CTA = {
  label: 'Nuevo pedido',
  labelKey: 'supervision.nuevo_pedido',
  modalTitle: 'Nuevo pedido',
  modalSubtitle: 'RFZ · TURA · +pax',
} as const;
