export const colors = {
  indigo950: '#1e1b4b',
  indigo900: '#312e81',
  indigo800: '#3730a3',
  indigo600: '#4f46e5',
  indigo500: '#6366f1',
  indigo200: '#c7d2fe',
  indigo100: '#e0e7ff',
  emerald600: '#059669',
  emerald500: '#10b981',
  emerald200: '#a7f3d0',
  slate950: '#0f172a',
  slate900: '#1e293b',
  slate800: '#334155',
  slate600: '#475569',
  slate500: '#64748b',
  slate200: '#e2e8f0',
  slate100: '#f1f5f9',
  slate50: '#f8fafc',
  amber600: '#d97706',
  amber100: '#fef3c7',
  red600: '#dc2626',
  red100: '#fee2e2',
  white: '#ffffff',
};

export const radius = {
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
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
