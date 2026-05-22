export const BRAND_STYLE_ID = 'cosp-brand-overrides';
export const LAST_COMPANY_COLOR_KEY = 'cosp_last_primary_color';

export const COMPANY_THEME_VARS = [
  '--sb-bg','--sb-border','--sb-text','--sb-muted','--sb-section',
  '--sb-active-bg','--sb-active-text','--sb-hover-bg','--sb-hover-text',
  '--sb-logo','--sb-logo-sub','--topbar-bg','--topbar-border',
  '--topbar-text','--company-primary','--company-primary-dark',
  '--company-primary-darker','--company-primary-light',
  '--company-primary-lighter','--company-primary-lightest','--company-primary-ring',
  '--company-primary-on-dark','--company-primary-dark-card',
  '--company-primary-dark-card2','--company-primary-dark-border',
  '--company-primary-glow','--company-primary-active-bg',
  '--company-primary-tag-bg','--company-primary-tag-text',
];

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100, ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function buildCompanyTheme(hex: string): Record<string, string> {
  const [h, s] = hexToHsl(hex);
  const sat = Math.min(s, 88);
  return {
    '--sb-bg':                    hslToHex(h, sat, 13),
    '--sb-border':                hslToHex(h, sat - 10, 22),
    '--sb-text':                  hslToHex(h, 22, 83),
    '--sb-muted':                 hslToHex(h, 18, 52),
    '--sb-section':               hslToHex(h, sat - 20, 40),
    '--sb-active-bg':             hex,
    '--sb-active-text':           '#ffffff',
    '--sb-hover-bg':              hslToHex(h, sat - 10, 21),
    '--sb-hover-text':            '#ffffff',
    '--sb-logo':                  hslToHex(h, Math.min(sat + 8, 100), 78),
    '--sb-logo-sub':              hslToHex(h, 18, 55),
    '--sb-logout':                '#f43f5e',
    '--sb-special-bg':            'rgba(239,68,68,0.12)',
    '--sb-special-text':          '#fca5a5',
    '--sb-special-border':        'rgba(239,68,68,0.3)',
    '--topbar-bg':                hslToHex(h, sat - 5, 11),
    '--topbar-border':            hslToHex(h, sat - 10, 18),
    '--topbar-text':              hslToHex(h, 20, 86),
    '--company-primary':          hex,
    '--company-primary-dark':     hslToHex(h, sat, 35),
    '--company-primary-darker':   hslToHex(h, sat, 27),
    '--company-primary-light':    hslToHex(h, Math.min(sat, 70), 65),
    '--company-primary-lighter':  hslToHex(h, Math.min(sat, 55), 92),
    '--company-primary-lightest': hslToHex(h, Math.min(sat, 45), 96),
    '--company-primary-ring':     hex + '80',
    '--company-primary-on-dark':  hslToHex(h, Math.min(sat, 72), 68),
    '--company-primary-dark-card':  hslToHex(h, Math.min(sat, 38), 9),
    '--company-primary-dark-card2': hslToHex(h, Math.min(sat, 32), 14),
    '--company-primary-dark-border':hslToHex(h, sat - 15, 32),
    '--company-primary-glow':       hex + '40',
    '--company-primary-active-bg':  hslToHex(h, Math.min(sat, 60), 94),
    '--company-primary-tag-bg':     hslToHex(h, Math.min(sat, 55), 92),
    '--company-primary-tag-text':   hslToHex(h, sat, 30),
  };
}

function buildBrandCSS(): string {
  return `
    /* ── LIGHT MODE (default) ── */
    html[data-brand] .bg-indigo-600,
    html[data-brand] .bg-indigo-500 { background-color: var(--company-primary) !important; }
    html[data-brand] .bg-indigo-700 { background-color: var(--company-primary-dark) !important; }
    html[data-brand] .bg-indigo-800 { background-color: var(--company-primary-darker) !important; }
    html[data-brand] .hover\\:bg-indigo-700:hover { background-color: var(--company-primary-dark) !important; }
    html[data-brand] .hover\\:bg-indigo-600:hover { background-color: var(--company-primary) !important; }
    html[data-brand] .bg-indigo-50  { background-color: var(--company-primary-lightest) !important; }
    html[data-brand] .bg-indigo-100 { background-color: var(--company-primary-lighter) !important; }
    html[data-brand] .text-indigo-600,
    html[data-brand] .text-indigo-500 { color: var(--company-primary) !important; }
    html[data-brand] .text-indigo-700 { color: var(--company-primary-dark) !important; }
    html[data-brand] .text-indigo-800 { color: var(--company-primary-darker) !important; }
    html[data-brand] .text-indigo-400 { color: var(--company-primary-light) !important; }
    html[data-brand] .border-indigo-300,
    html[data-brand] .border-indigo-400,
    html[data-brand] .border-indigo-500 { border-color: var(--company-primary) !important; }
    html[data-brand] .border-indigo-200 { border-color: var(--company-primary-lighter) !important; }
    html[data-brand] .ring-indigo-500,
    html[data-brand] .ring-indigo-400,
    html[data-brand] .ring-indigo-300 { --tw-ring-color: var(--company-primary-ring) !important; }
    html[data-brand] .focus\\:ring-indigo-400:focus,
    html[data-brand] .focus\\:ring-indigo-500:focus { --tw-ring-color: var(--company-primary-ring) !important; }
    html[data-brand] .focus\\:border-indigo-500:focus,
    html[data-brand] .focus\\:border-indigo-400:focus { border-color: var(--company-primary) !important; }
    html[data-brand] .from-indigo-500,
    html[data-brand] .from-indigo-600 { --tw-gradient-from: var(--company-primary) !important; }
    html[data-brand] .to-indigo-600,
    html[data-brand] .to-indigo-700 { --tw-gradient-to: var(--company-primary-dark) !important; }
    html[data-brand] .divide-indigo-200 > * + * { border-color: var(--company-primary-lighter) !important; }

    /* ── DARK / AZUL-PRO — usa variantes oscuras del color empresa ── */
    html.dark[data-brand] .bg-indigo-50  { background-color: var(--company-primary-dark-card)  !important; }
    html.dark[data-brand] .bg-indigo-100 { background-color: var(--company-primary-dark-card2) !important; }
    html.dark[data-brand] .border-indigo-200,
    html.dark[data-brand] .border-indigo-300,
    html.dark[data-brand] .border-indigo-400,
    html.dark[data-brand] .border-indigo-500 { border-color: var(--company-primary-dark-border) !important; }
    html.dark[data-brand] .divide-indigo-200 > * + * { border-color: var(--company-primary-dark-border) !important; }
    html.dark[data-brand] .text-indigo-600,
    html.dark[data-brand] .text-indigo-500 { color: var(--company-primary-on-dark) !important; }
    html.dark[data-brand] .text-indigo-700 { color: var(--company-primary-light) !important; }
    html.dark[data-brand] .text-indigo-800 { color: var(--company-primary) !important; }
    html.dark[data-brand] .text-indigo-400 { color: var(--company-primary-light) !important; }
    html.dark[data-brand] .focus\\:border-indigo-500:focus,
    html.dark[data-brand] .focus\\:border-indigo-400:focus { border-color: var(--company-primary-dark-border) !important; }

    /* ── VIOLET / PURPLE — mismas reglas que indigo para componentes que usan esas clases ── */
    html[data-brand] .bg-violet-600,
    html[data-brand] .bg-violet-500,
    html[data-brand] .bg-purple-600,
    html[data-brand] .bg-purple-500 { background-color: var(--company-primary) !important; }
    html[data-brand] .bg-violet-700,
    html[data-brand] .bg-purple-700  { background-color: var(--company-primary-dark) !important; }
    html[data-brand] .bg-violet-50,
    html[data-brand] .bg-purple-50   { background-color: var(--company-primary-lightest) !important; }
    html[data-brand] .bg-violet-100,
    html[data-brand] .bg-purple-100  { background-color: var(--company-primary-lighter) !important; }
    html[data-brand] .text-violet-600,
    html[data-brand] .text-violet-500,
    html[data-brand] .text-purple-600,
    html[data-brand] .text-purple-500 { color: var(--company-primary) !important; }
    html[data-brand] .text-violet-700,
    html[data-brand] .text-purple-700 { color: var(--company-primary-dark) !important; }
    html[data-brand] .text-violet-400,
    html[data-brand] .text-purple-400 { color: var(--company-primary-light) !important; }
    html[data-brand] .border-violet-300,
    html[data-brand] .border-violet-400,
    html[data-brand] .border-violet-500,
    html[data-brand] .border-purple-300,
    html[data-brand] .border-purple-400,
    html[data-brand] .border-purple-500 { border-color: var(--company-primary) !important; }
    html.dark[data-brand] .bg-violet-50,
    html.dark[data-brand] .bg-violet-100,
    html.dark[data-brand] .bg-purple-50,
    html.dark[data-brand] .bg-purple-100 { background-color: var(--company-primary-dark-card) !important; }
    html.dark[data-brand] .text-violet-600,
    html.dark[data-brand] .text-violet-500,
    html.dark[data-brand] .text-purple-600,
    html.dark[data-brand] .text-purple-500 { color: var(--company-primary-on-dark) !important; }
    html.theme-custom[data-brand] .bg-violet-50,
    html.theme-custom[data-brand] .bg-violet-100,
    html.theme-custom[data-brand] .bg-purple-50,
    html.theme-custom[data-brand] .bg-purple-100 { background-color: var(--company-primary-dark-card) !important; }
    html.theme-custom[data-brand] .text-violet-600,
    html.theme-custom[data-brand] .text-violet-500,
    html.theme-custom[data-brand] .text-purple-600,
    html.theme-custom[data-brand] .text-purple-500 { color: var(--company-primary-on-dark) !important; }

    /* ── ZINC / PERSONALIZADO — usa variantes oscuras del color empresa ── */
    html.theme-custom[data-brand] .bg-indigo-50  { background-color: var(--company-primary-dark-card)  !important; }
    html.theme-custom[data-brand] .bg-indigo-100 { background-color: var(--company-primary-dark-card2) !important; }
    html.theme-custom[data-brand] .border-indigo-200,
    html.theme-custom[data-brand] .border-indigo-300,
    html.theme-custom[data-brand] .border-indigo-400,
    html.theme-custom[data-brand] .border-indigo-500 { border-color: var(--company-primary-dark-border) !important; }
    html.theme-custom[data-brand] .text-indigo-600,
    html.theme-custom[data-brand] .text-indigo-500 { color: var(--company-primary-on-dark) !important; }
    html.theme-custom[data-brand] .text-indigo-700 { color: var(--company-primary-light) !important; }
    html.theme-custom[data-brand] .text-indigo-400 { color: var(--company-primary-light) !important; }
    html.theme-custom[data-brand] .focus\\:border-indigo-500:focus,
    html.theme-custom[data-brand] .focus\\:border-indigo-400:focus { border-color: var(--company-primary-dark-border) !important; }

    /* ── CONTRASTE — respeta accesibilidad, solo mantiene botones en color empresa ── */
    html.theme-contrast[data-brand] .bg-indigo-50,
    html.theme-contrast[data-brand] .bg-indigo-100 { background-color: #000000 !important; border-color: #FFD700 !important; }
    html.theme-contrast[data-brand] .border-indigo-200,
    html.theme-contrast[data-brand] .border-indigo-300,
    html.theme-contrast[data-brand] .border-indigo-400,
    html.theme-contrast[data-brand] .border-indigo-500 { border-color: #FFD700 !important; }
    html.theme-contrast[data-brand] .divide-indigo-200 > * + * { border-color: #FFD700 !important; }
    html.theme-contrast[data-brand] .text-indigo-600,
    html.theme-contrast[data-brand] .text-indigo-500,
    html.theme-contrast[data-brand] .text-indigo-700,
    html.theme-contrast[data-brand] .text-indigo-800 { color: #ffffff !important; }
    html.theme-contrast[data-brand] .text-indigo-400 { color: #FFD700 !important; }
    html.theme-contrast[data-brand] .focus\\:border-indigo-500:focus,
    html.theme-contrast[data-brand] .focus\\:border-indigo-400:focus { border-color: #FFD700 !important; }
  `;
}

export function applyCompanyTheme(hex: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme = buildCompanyTheme(hex);
  Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v));
  root.setAttribute('data-brand', '1');
  let styleEl = document.getElementById(BRAND_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = BRAND_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = buildBrandCSS();
  try { localStorage.setItem(LAST_COMPANY_COLOR_KEY, hex); } catch { /* ignore */ }
}

export function removeCompanyTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  COMPANY_THEME_VARS.forEach(k => root.style.removeProperty(k));
  root.removeAttribute('data-brand');
  document.getElementById(BRAND_STYLE_ID)?.remove();
}

export function applyCompanyThemeFromStorage(): void {
  try {
    const hex = localStorage.getItem(LAST_COMPANY_COLOR_KEY);
    if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) applyCompanyTheme(hex);
  } catch { /* ignore */ }
}
