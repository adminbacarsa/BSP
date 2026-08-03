/** COSP Guardia Core (light) + Dark Ops — Stitch / DESIGN.md */
export type ThemeMode = 'core' | 'darkOps';

export type AppPalette = {
  mode: ThemeMode;
  background: string;
  surface: string;
  card: string;
  cardBorder: string;
  onSurface: string;
  onSurfaceMuted: string;
  header: string;
  headerTint: string;
  primary: string;
  primaryContainer: string;
  onPrimary: string;
  success: string;
  successMuted: string;
  error: string;
  errorContainer: string;
  onError: string;
  warning: string;
  warningContainer: string;
  outline: string;
  inputBg: string;
  heroGradient: [string, string];
  heroText: string;
  heroSubtext: string;
  chipBg: string;
  chipText: string;
  useCardShadow: boolean;
  heroBorderAccent?: string;
};

export const corePalette: AppPalette = {
  mode: 'core',
  background: '#f9f9ff',
  surface: '#f9f9ff',
  card: '#ffffff',
  cardBorder: '#e2e8f0',
  onSurface: '#1e293b',
  onSurfaceMuted: '#64748b',
  header: '#312e81',
  headerTint: '#ffffff',
  primary: '#4f46e5',
  primaryContainer: '#4f46e5',
  onPrimary: '#ffffff',
  success: '#059669',
  successMuted: '#a7f3d0',
  error: '#dc2626',
  errorContainer: '#fee2e2',
  onError: '#dc2626',
  warning: '#d97706',
  warningContainer: '#fef3c7',
  outline: '#c7c4d8',
  inputBg: '#f1f5f9',
  heroGradient: ['#4f46e5', '#312e81'],
  heroText: '#ffffff',
  heroSubtext: '#c7d2fe',
  chipBg: 'rgba(255,255,255,0.12)',
  chipText: '#e0e7ff',
  useCardShadow: true,
};

export const darkOpsPalette: AppPalette = {
  mode: 'darkOps',
  background: '#0b1326',
  surface: '#0b1326',
  card: '#131b2e',
  cardBorder: '#171e2e',
  onSurface: '#f1f5f9',
  onSurfaceMuted: '#94a3b8',
  header: '#131b2e',
  headerTint: '#dae2fd',
  primary: '#10b981',
  primaryContainer: '#10b981',
  onPrimary: '#003824',
  success: '#10b981',
  successMuted: '#6ffbbe',
  error: '#ffb4ab',
  errorContainer: '#3f1d1d',
  onError: '#fecaca',
  warning: '#ffb95f',
  warningContainer: '#472a00',
  outline: '#3c4a42',
  inputBg: '#171f33',
  heroGradient: ['#131b2e', '#131b2e'],
  heroText: '#f1f5f9',
  heroSubtext: '#94a3b8',
  chipBg: 'rgba(78, 222, 163, 0.12)',
  chipText: '#4edea3',
  useCardShadow: false,
  heroBorderAccent: 'rgba(16, 185, 129, 0.35)',
};

export function paletteForMode(mode: ThemeMode): AppPalette {
  return mode === 'darkOps' ? darkOpsPalette : corePalette;
}
