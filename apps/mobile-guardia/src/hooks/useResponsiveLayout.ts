import { useWindowDimensions } from 'react-native';

const TABLET_MIN_WIDTH = 600;
const COMPACT_MAX_WIDTH = 360;

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isCompact = width < COMPACT_MAX_WIDTH;
  const isTablet = width >= TABLET_MIN_WIDTH;

  return {
    width,
    height,
    isCompact,
    isTablet,
    /** Ancho máximo del contenido en tablet (columna centrada). */
    contentMaxWidth: isTablet ? 560 : undefined,
    /** Padding horizontal sugerido para pantallas tab. */
    horizontalPadding: isCompact ? 12 : isTablet ? 24 : 16,
    /** Ancho máximo para formularios (login, activar). */
    formMaxWidth: 480,
  };
}
