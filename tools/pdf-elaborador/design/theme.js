/**
 * Sistema de diseño — informes ejecutivos (profesional + moderno).
 * Paleta: slate profundo + acento teal; tipografía sistema Windows.
 */

export const theme = {
  // Fondos y texto
  pageBg: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#94A3B8",
  border: "#E2E8F0",
  rowAlt: "#F8FAFC",

  // Marca / acentos
  accent: "#0D9488",
  accentSoft: "#CCFBF1",
  accentDark: "#0F766E",
  coverBgTop: "#0F172A",
  coverFg: "#F8FAFC",
  coverAccent: "#2DD4BF",

  // Éxitos de roadmap / estados
  status: {
    done: { fill: "#059669", label: "#ECFDF5" },
    progress: { fill: "#D97706", label: "#FFFBEB" },
    planned: { fill: "#6366F1", label: "#EEF2FF" },
    vision: { fill: "#64748B", label: "#F1F5F9" },
    legacy: { fill: "#78716C", label: "#FAFAF9" }
  },

  layout: {
    marginX: 56,
    marginY: 48,
    marginBottom: 56,
    lineHeight: 1.45,
    titleSize: 22,
    h1Size: 14,
    h2Size: 11,
    bodySize: 9.5,
    smallSize: 8,
    radius: 4
  }
};

/** Convierto hex #RRGGBB a valores 0–1 para PDFKit */
export function hexRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255
  };
}
