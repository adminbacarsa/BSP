/**
 * Piezas visuales compartidas por todos los módulos del celular (Operación, RRHH,
 * Planificación, Eventuales, Servicios, selector). Estilo serio y minimalista; el color
 * de la empresa entra solo por las variables `--movil-*` (ver `tones.ts`).
 */
export { MovilBadge } from './MovilBadge';
export { MovilCard, type MovilCardProps } from './MovilCard';
export { MovilHeader, movilFechaLarga } from './MovilHeader';
export { MovilIconBox } from './MovilIconBox';
export { MovilIconButton } from './MovilIconButton';
export { MovilProgress } from './MovilProgress';
export { MovilStat, type MovilStatProps } from './MovilStat';
export { MovilTopBar } from './MovilTopBar';
export {
  MOVIL_BAR, MOVIL_BORDER, MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FILETE, MOVIL_FONT, MOVIL_ICON_BOX, MOVIL_NUMBER, MOVIL_PILL,
  MOVIL_PRIMARY_BG, MOVIL_PRIMARY_BORDER, MOVIL_PRIMARY_TEXT, MOVIL_RING, MOVIL_TEXT, MOVIL_TOPBAR_BG, toneForGuard, toneForPct, type MovilTone,
} from './tones';
