export type OperacionesMarkerPreset =
  | 'GREEN' | 'YELLOW' | 'RED' | 'ORANGE' | 'BLUE' | 'GRAY' | 'VIOLET' | 'AMBER'
  | 'EVENT' | 'EVENT_LATE' | 'EVENT_ALERT';

const COLORS: Record<OperacionesMarkerPreset, string> = {
  GREEN: '#10b981',
  YELLOW: '#f59e0b',
  RED: '#e11d48',
  ORANGE: '#f97316',
  BLUE: '#3b82f6',
  GRAY: '#64748b',
  VIOLET: '#7c3aed',
  AMBER: '#d97706',
  EVENT: '#d97706',
  EVENT_LATE: '#f59e0b',
  EVENT_ALERT: '#e11d48',
};

/** Presets del evento: pin de gota con estrella (distinto del escudo del objetivo). */
export const EVENT_MARKER_PRESETS: ReadonlySet<OperacionesMarkerPreset> = new Set(['EVENT', 'EVENT_LATE', 'EVENT_ALERT']);

export function isEventMarkerPreset(preset: string): boolean {
  return EVENT_MARKER_PRESETS.has(preset as OperacionesMarkerPreset);
}

function shieldSvg(color: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="${color}" stroke="white" stroke-width="2"/>
    ${inner}
  </svg>`;
}

const STAR = '<path d="M12 4.6l1.55 3.2 3.5.5-2.55 2.45.6 3.5L12 12.6l-3.1 1.65.6-3.5L6.95 8.3l3.5-.5z" fill="white"/>';

/** Pin de gota con estrella: el evento se ve distinto del objetivo aun en blanco y negro. */
function eventPinSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
    <path d="M12 1.5a8 8 0 0 0-8 8c0 5.6 8 13 8 13s8-7.4 8-13a8 8 0 0 0-8-8z" fill="${color}" stroke="white" stroke-width="2"/>
    ${STAR}
  </svg>`;
}

const INNER: Record<OperacionesMarkerPreset, string> = {
  GREEN: '<path d="M9 12l2 2 4-4" stroke="white" stroke-width="3" fill="none"/>',
  YELLOW: '<circle cx="12" cy="12" r="3" fill="white"/>',
  RED: '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" stroke="white" stroke-width="2" fill="none"/>',
  ORANGE: '<circle cx="12" cy="12" r="2.5" fill="white"/>',
  BLUE: '',
  GRAY: '',
  VIOLET: '',
  AMBER: '<path d="M8 14l4-8 4 8H8z" fill="white"/>',
  EVENT: STAR,
  EVENT_LATE: STAR,
  EVENT_ALERT: STAR,
};

export function buildOperacionesMarkerIcon(preset: OperacionesMarkerPreset): {
  url: string;
  scaledSize: { width: number; height: number };
  anchor: { x: number; y: number };
} {
  const color = COLORS[preset] ?? COLORS.GRAY;
  const svg = isEventMarkerPreset(preset) ? eventPinSvg(color) : shieldSvg(color, INNER[preset] ?? '');
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: 36, height: 36 },
    anchor: { x: 18, y: 36 },
  };
}

export function truncateObjectiveLabel(name: string, max = 22): string {
  const t = String(name || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function escapeHtmlLabel(name: string): string {
  return truncateObjectiveLabel(name)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convierte el descriptor a Icon de Google Maps (requiere API cargada). */
export function toGoogleMapsIcon(preset: OperacionesMarkerPreset): google.maps.Icon {
  const base = buildOperacionesMarkerIcon(preset);
  return {
    url: base.url,
    scaledSize: new google.maps.Size(base.scaledSize.width, base.scaledSize.height),
    anchor: new google.maps.Point(base.anchor.x, base.anchor.y),
    labelOrigin: new google.maps.Point(18, 44),
  };
}

export const MARKER_ICON_PRESETS = {
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED',
  ORANGE: 'ORANGE',
  BLUE: 'BLUE',
  GRAY: 'GRAY',
  VIOLET: 'VIOLET',
  AMBER: 'AMBER',
  EVENT: 'EVENT',
  EVENT_LATE: 'EVENT_LATE',
  EVENT_ALERT: 'EVENT_ALERT',
} as const satisfies Record<OperacionesMarkerPreset, OperacionesMarkerPreset>;

export const MARKER_PRESET_COLOR: Record<OperacionesMarkerPreset, string> = COLORS;
