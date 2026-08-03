import { corePalette } from './palettes';

/** Legacy flat map (Core) — prefer `useTheme().palette` en UI nueva */
export const colors = {
  indigo950: '#1e1b4b',
  indigo900: '#312e81',
  indigo800: '#3730a3',
  indigo700: '#4338ca',
  indigo600: corePalette.primary,
  indigo500: '#6366f1',
  indigo200: '#c7d2fe',
  indigo100: '#e0e7ff',
  emerald600: corePalette.success,
  emerald500: '#10b981',
  emerald200: '#a7f3d0',
  slate950: '#0f172a',
  slate900: '#1e293b',
  slate800: '#334155',
  slate600: '#475569',
  slate500: '#64748b',
  slate200: '#e2e8f0',
  slate100: '#f1f5f9',
  slate50: corePalette.background,
  amber600: '#d97706',
  amber100: '#fef3c7',
  red600: '#dc2626',
  red100: '#fee2e2',
  white: '#ffffff',
};

export const radius = {
  sm: 8,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  container: 16,
};

export const shadow = {
  hero: {
    shadowColor: colors.indigo900,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  card: {
    shadowColor: colors.slate950,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
};

export const typography = {
  heroTitle: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  cardTitle: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 14, lineHeight: 20 },
};

export const layout = {
  buttonMinHeight: 52,
  touchTarget: 48,
};
