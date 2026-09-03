export type OperacionesMarkerPreset = 'GREEN' | 'YELLOW' | 'RED' | 'ORANGE' | 'BLUE' | 'GRAY' | 'VIOLET' | 'AMBER';

const COLORS: Record<OperacionesMarkerPreset, string> = {
  GREEN: '#10b981',
  YELLOW: '#f59e0b',
  RED: '#e11d48',
  ORANGE: '#f97316',
  BLUE: '#3b82f6',
  GRAY: '#64748b',
  VIOLET: '#7c3aed',
  AMBER: '#d97706',
};

function shieldSvg(color: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="${color}" stroke="white" stroke-width="2"/>
    ${inner}
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
};

export function buildOperacionesMarkerIcon(preset: OperacionesMarkerPreset): {
  url: string;
  scaledSize: { width: number; height: number };
  anchor: { x: number; y: number };
} {
  const color = COLORS[preset];
  const svg = shieldSvg(color, INNER[preset]);
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: 36, height: 36 },
    anchor: { x: 18, y: 36 },
  };
}

/** Convierte el descriptor a Icon de Google Maps (requiere API cargada). */
export function toGoogleMapsIcon(preset: OperacionesMarkerPreset): google.maps.Icon {
  const base = buildOperacionesMarkerIcon(preset);
  return {
    url: base.url,
    scaledSize: new google.maps.Size(base.scaledSize.width, base.scaledSize.height),
    anchor: new google.maps.Point(base.anchor.x, base.anchor.y),
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
} as const satisfies Record<OperacionesMarkerPreset, OperacionesMarkerPreset>;

export const MARKER_PRESET_COLOR: Record<OperacionesMarkerPreset, string> = COLORS;
