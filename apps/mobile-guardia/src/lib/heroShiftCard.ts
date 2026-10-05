/**
 * Contenido legible de la tarjeta «Turno actual» (Hoy).
 * Puro — sin React / Firebase — para testear jerarquía, EV vs puesto y accent AA.
 */
import type { ShiftPlacement } from './shiftPlacement';

/** Subconjunto de EvShiftDisplay (evita importar portal-core en tests Node). */
export type HeroEvDisplay = {
  nombre: string;
  eventoNombre: string | null;
  clienteNombre?: string | null;
  horarioBadge: string | null;
  direccion: string | null;
  mapsUrl: string | null;
  requisitos: string | null;
  instrucciones: string | null;
};

/** Igual que web2 `MOVIL_LIGHT_L` / `MOVIL_GRAY_S`. */
export const HERO_LIGHT_L = 58;
export const HERO_GRAY_S = 20;
export const HERO_FALLBACK_ACCENT = '#D32F2F';

export type HeroCardKind = 'puesto' | 'evento' | 'franco' | 'ausente' | 'retenido' | 'convocado';

export type HeroShiftCardModel = {
  kind: HeroCardKind;
  /** Ej. «TURNO ACTUAL · HOY», «PRÓXIMO TURNO», «RETENIDO». */
  kicker: string;
  /** Horario grande: «12:00–20:00». */
  timeRange: string | null;
  /** Una sola línea de qué/dónde (sin repetir chips). */
  whereTitle: string | null;
  /** Lugar/dirección una sola vez. */
  wherePlace: string | null;
  /** Observaciones del evento: «Nota: test». */
  note: string | null;
  mapsUrl: string | null;
  /** Filete de estado: activo / tarde-aviso / retención / ausencia. */
  fileteTone: 'active' | 'warning' | 'retention' | 'absent' | 'neutral';
};

function clean(v: unknown): string {
  return String(v ?? '').trim();
}

function sameIgnoreCase(a: string, b: string): boolean {
  return a.localeCompare(b, 'es', { sensitivity: 'accent' }) === 0;
}

function hexToHsl(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = m[1];
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100;
  const ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Color de empresa usable como filete/encabezado (contraste AA con blanco).
 * Si es claro (L > 58) o casi gris → tono oscuro (como `buildMovilTheme` en web2).
 */
export function resolveHeroAccentColor(
  empresaHex: string | null | undefined,
  fallback = HERO_FALLBACK_ACCENT,
): string {
  const raw = clean(empresaHex);
  if (!raw.startsWith('#')) return fallback;
  const hsl = hexToHsl(raw);
  if (!hsl) return fallback;
  const [h, s, l] = hsl;
  if (s < HERO_GRAY_S) return '#111827';
  if (l > HERO_LIGHT_L) return hslToHex(h, Math.min(s, 88), 27);
  return raw.length === 7 ? raw : `#${raw.replace('#', '')}`;
}

export type BuildHeroShiftCardInput = {
  sectionBase: string;
  isToday: boolean;
  timeRange: string | null;
  placement: ShiftPlacement;
  ev?: HeroEvDisplay | null;
  mapsUrl?: string | null;
  isFranco?: boolean;
  isAbsent?: boolean;
  isRetention?: boolean;
  isConvocado?: boolean;
  /** Empresa del eventual (opcional, se anexa al kicker). */
  empresaLabel?: string | null;
};

function buildKicker(input: BuildHeroShiftCardInput, kind: HeroCardKind): string {
  const emp = clean(input.empresaLabel);
  const today = input.isToday ? 'HOY' : '';
  let base: string;
  switch (kind) {
    case 'ausente':
      base = today ? `AUSENTE · ${today}` : 'AUSENTE';
      break;
    case 'retenido':
      base = today ? `RETENIDO · ${today}` : 'RETENIDO';
      break;
    case 'convocado':
      base = today ? `EN CAMINO · ${today}` : 'EN CAMINO';
      break;
    case 'franco':
      base = today ? `FRANCO · ${today}` : 'FRANCO';
      break;
    default: {
      const section = clean(input.sectionBase).toUpperCase() || (input.isToday ? 'TURNO ACTUAL' : 'PRÓXIMO TURNO');
      base = today && !section.includes('HOY') ? `${section} · ${today}` : section;
      break;
    }
  }
  return emp ? `${base} · ${emp}` : base;
}

function dedupePlace(place: string | null, title: string | null): string | null {
  const p = clean(place);
  if (!p) return null;
  const t = clean(title);
  if (t && (sameIgnoreCase(p, t) || t.toLowerCase().includes(p.toLowerCase()))) return null;
  return p;
}

/**
 * Arma el contenido de la tarjeta sin duplicar chips / horario / Cómo llegar.
 */
export function buildHeroShiftCardModel(input: BuildHeroShiftCardInput): HeroShiftCardModel {
  const kind: HeroCardKind = input.isAbsent
    ? 'ausente'
    : input.isRetention
      ? 'retenido'
      : input.isConvocado
        ? 'convocado'
        : input.isFranco
          ? 'franco'
          : input.ev
            ? 'evento'
            : 'puesto';

  const kicker = buildKicker(input, kind);
  const timeRange = clean(input.timeRange) || null;

  if (kind === 'evento' && input.ev) {
    const ev = input.ev;
    const evento = clean(ev.eventoNombre) || clean(ev.nombre) || 'Evento';
    const servicio = clean(ev.nombre);
    const whereTitle =
      servicio && clean(ev.eventoNombre) && !sameIgnoreCase(servicio, evento)
        ? `Evento: ${evento} · servicio ${servicio}`
        : `Evento: ${evento}`;
    const place = dedupePlace(ev.direccion || input.placement.objective, whereTitle);
    const noteRaw = clean(ev.requisitos) || clean(ev.instrucciones);
    return {
      kind,
      kicker,
      timeRange: timeRange || clean(ev.horarioBadge) || null,
      whereTitle,
      wherePlace: place,
      note: noteRaw ? `Nota: ${noteRaw}` : null,
      mapsUrl: clean(ev.mapsUrl) || clean(input.mapsUrl) || null,
      fileteTone: 'active',
    };
  }

  if (kind === 'ausente') {
    return {
      kind,
      kicker,
      timeRange,
      whereTitle: input.placement.line,
      wherePlace: null,
      note: null,
      mapsUrl: null,
      fileteTone: 'absent',
    };
  }

  if (kind === 'retenido') {
    const obj = clean(input.placement.objective);
    return {
      kind,
      kicker,
      timeRange,
      whereTitle: obj ? `Retenido en ${obj}` : 'Retenido en tu puesto',
      wherePlace: dedupePlace(input.placement.position, obj),
      note: null,
      mapsUrl: clean(input.mapsUrl) || null,
      fileteTone: 'retention',
    };
  }

  if (kind === 'franco') {
    return {
      kind,
      kicker,
      timeRange,
      whereTitle: 'Día de descanso programado',
      wherePlace: null,
      note: null,
      mapsUrl: null,
      fileteTone: 'neutral',
    };
  }

  // Puesto / convocado
  const client = clean(input.placement.client);
  const objective = clean(input.placement.objective);
  const position = clean(input.placement.position);
  const whereTitle = [client, objective].filter(Boolean).join(' · ') || objective || client || null;
  const wherePlace = dedupePlace(position, whereTitle);
  return {
    kind,
    kicker,
    timeRange,
    whereTitle,
    wherePlace,
    note: null,
    mapsUrl: clean(input.mapsUrl) || null,
    fileteTone: kind === 'convocado' ? 'warning' : 'active',
  };
}

export const HERO_FILETE: Record<HeroShiftCardModel['fileteTone'], string> = {
  active: '', // se pisa con accent de empresa
  warning: '#d97706',
  retention: '#c2410c',
  absent: '#b45309',
  neutral: '#94a3b8',
};
