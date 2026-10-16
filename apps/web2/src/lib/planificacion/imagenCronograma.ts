/**
 * Imagen del cronograma para mandar por WhatsApp (mientras la app del guardia no está en producción).
 * Se dibuja desde los datos, no es una captura: nombre, días y código de cada celda, con la leyenda de horarios.
 */

export type CeldaImagen = { code: string; horario?: string; /** Color del puesto (el borde de la grilla). */ color?: string };
/** Referencia por puesto, como la de abajo de la grilla: nombre en su color y sus turnos con horario. */
export type PuestoImagen = { nombre: string; color?: string; franjas: Array<{ code: string; horario: string }> };
export type DatosImagen = {
  puestos?: PuestoImagen[];
  titulo: string;
  subtitulo: string;
  aviso?: string;
  dias: Array<{ dateStr: string; num: number; letra: string; finde: boolean }>;
  filas: Array<{ nombre: string; celdas: Record<string, CeldaImagen> }>;
  pie: string;
};

type Colores = { bg: string; fg: string; borde: string };

const COLORES: Record<string, Colores> = {
  M: { bg: '#ffffff', fg: '#1d4ed8', borde: '#60a5fa' },
  T: { bg: '#ffffff', fg: '#ea580c', borde: '#fb923c' },
  N: { bg: '#ffffff', fg: '#4338ca', borde: '#6366f1' },
  D12: { bg: '#dc2626', fg: '#ffffff', borde: '#991b1b' },
  N12: { bg: '#dc2626', fg: '#ffffff', borde: '#991b1b' },
  F: { bg: '#000000', fg: '#ffffff', borde: '#000000' },
  FF: { bg: '#000000', fg: '#ffffff', borde: '#000000' },
  FP: { bg: '#000000', fg: '#ffffff', borde: '#000000' },
  FT: { bg: '#ff00ff', fg: '#000000', borde: '#c000c0' },
  RET: { bg: '#f1f5f9', fg: '#334155', borde: '#94a3b8' },
  ESC: { bg: '#e0f2fe', fg: '#075985', borde: '#0ea5e9' },
  EV: { bg: '#f59e0b', fg: '#451a03', borde: '#b45309' },
  V: { bg: '#92d050', fg: '#000000', borde: '#6fa838' },
  E: { bg: '#ff9900', fg: '#000000', borde: '#cc7a00' },
  A: { bg: '#0000ff', fg: '#ffffff', borde: '#0000b0' },
  ART: { bg: '#ffff00', fg: '#000000', borde: '#c8c800' },
  L: { bg: '#7b3f00', fg: '#ffffff', borde: '#5a2e00' },
  PG: { bg: '#8064a2', fg: '#000000', borde: '#5f4a7a' },
  SUS: { bg: '#ff0000', fg: '#000000', borde: '#b00000' },
  AA: { bg: '#ffffff', fg: '#b45309', borde: '#fbbf24' },
  RFZ: { bg: '#450a0a', fg: '#ffffff', borde: '#450a0a' },
  RFZF: { bg: '#065f46', fg: '#ffffff', borde: '#065f46' },
  RFZE: { bg: '#c2410c', fg: '#ffffff', borde: '#c2410c' },
  TURA: { bg: '#881337', fg: '#ffffff', borde: '#881337' },
};
const OTRO: Colores = { bg: '#ffffff', fg: '#334155', borde: '#94a3b8' };

export function coloresDe(code: string): Colores {
  const c = String(code || '').toUpperCase();
  if (c.startsWith('FT')) return COLORES.FT;
  return COLORES[c] || OTRO;
}

/** Código → horario, para la leyenda (solo los que tienen horario y aparecen). */
export function leyendaHorarios(datos: DatosImagen): Array<{ code: string; horario: string }> {
  const vistos = new Map<string, Set<string>>();
  for (const f of datos.filas) {
    for (const c of Object.values(f.celdas)) {
      if (!c.code || !c.horario) continue;
      const set = vistos.get(c.code) || new Set<string>();
      set.add(c.horario);
      vistos.set(c.code, set);
    }
  }
  return [...vistos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, hs]) => ({ code, horario: [...hs].join(' / ') }));
}

/** Lo que no es turno de un puesto (F, RET, licencias) y aparece en el mes. */
export function otrosCodigos(datos: DatosImagen): string[] {
  const propios = new Set((datos.puestos || []).flatMap((p) => p.franjas.map((f) => f.code.toUpperCase())));
  const vistos = new Set<string>();
  for (const f of datos.filas) for (const c of Object.values(f.celdas)) {
    const code = String(c.code || '').toUpperCase();
    if (code && !c.horario && !propios.has(code)) vistos.add(code.startsWith('FT') ? 'FT' : code);
  }
  return [...vistos].sort();
}

/** Celda del color del puesto: fondo blanco, borde del puesto. D12/N12, francos y licencias quedan con su color. */
function coloresCelda(c: CeldaImagen): Colores {
  const code = String(c.code || '').toUpperCase();
  if (c.color && c.horario && !['D12', 'N12'].includes(code) && !code.startsWith('FT')) return { bg: '#ffffff', fg: '#0f172a', borde: c.color };
  return coloresDe(code);
}

const NOMBRE_W = 230;
const COL_W = 42;
const FILA_H = 34;
const CAB_H = 92;
const DIAS_H = 44;

/** Dibuja en un canvas nuevo (escala 2 para que se lea nítido en el celular). */
export function dibujarCronograma(datos: DatosImagen, escala = 2): HTMLCanvasElement {
  const puestos = (datos.puestos || []).filter((p) => p.franjas.length);
  const otros = puestos.length ? otrosCodigos(datos) : [];
  const leyenda = puestos.length ? [] : leyendaHorarios(datos);
  const porLinea = 4;
  const leyendaH = puestos.length
    ? 30 + (puestos.length + (otros.length ? 1 : 0)) * 26
    : leyenda.length ? 30 + Math.ceil(leyenda.length / porLinea) * 24 : 0;
  const ancho = NOMBRE_W + COL_W * datos.dias.length + 24;
  const alto = CAB_H + DIAS_H + FILA_H * datos.filas.length + leyendaH + 44;
  const canvas = document.createElement('canvas');
  canvas.width = ancho * escala;
  canvas.height = alto * escala;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(escala, escala);
  const fuente = (peso: number, tam: number) => `${peso} ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);

  ctx.fillStyle = '#0f172a';
  ctx.font = fuente(800, 22);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(datos.titulo, 12, 34);
  ctx.fillStyle = '#475569';
  ctx.font = fuente(600, 15);
  ctx.fillText(datos.subtitulo, 12, 58);
  if (datos.aviso) {
    ctx.fillStyle = '#b45309';
    ctx.font = fuente(700, 13);
    ctx.fillText(datos.aviso, 12, 80);
  }

  const x0 = 12;
  const y0 = CAB_H;
  datos.dias.forEach((d, i) => {
    const x = x0 + NOMBRE_W + i * COL_W;
    if (d.finde) {
      ctx.fillStyle = '#fef2f2';
      ctx.fillRect(x, y0, COL_W, DIAS_H + FILA_H * datos.filas.length);
    }
    ctx.fillStyle = d.finde ? '#e11d48' : '#334155';
    ctx.textAlign = 'center';
    ctx.font = fuente(700, 11);
    ctx.fillText(d.letra, x + COL_W / 2, y0 + 16);
    ctx.font = fuente(800, 15);
    ctx.fillText(String(d.num), x + COL_W / 2, y0 + 36);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#334155';
  ctx.font = fuente(800, 12);
  ctx.fillText('GUARDIA', x0 + 4, y0 + 36);

  datos.filas.forEach((f, r) => {
    const y = y0 + DIAS_H + r * FILA_H;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + NOMBRE_W + COL_W * datos.dias.length, y);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = fuente(700, 13);
    let nombre = f.nombre;
    while (nombre.length > 3 && ctx.measureText(nombre).width > NOMBRE_W - 10) nombre = `${nombre.slice(0, -2)}…`;
    ctx.textAlign = 'left';
    ctx.fillText(nombre, x0 + 4, y + FILA_H / 2 + 5);
    datos.dias.forEach((d, i) => {
      const c = f.celdas[d.dateStr];
      if (!c?.code) return;
      const x = x0 + NOMBRE_W + i * COL_W;
      const col = coloresCelda(c);
      const bx = x + 3;
      const by = y + 4;
      const bw = COL_W - 6;
      const bh = FILA_H - 8;
      ctx.fillStyle = col.bg;
      ctx.strokeStyle = col.borde;
      ctx.lineWidth = c.color && col.borde === c.color ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col.fg;
      ctx.textAlign = 'center';
      const tam = c.code.length > 4 ? 9 : c.code.length > 2 ? 11 : 13;
      ctx.font = fuente(800, tam);
      ctx.fillText(c.code, bx + bw / 2, by + bh / 2 + tam / 3);
    });
  });
  const yFin = y0 + DIAS_H + FILA_H * datos.filas.length;
  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(x0, yFin);
  ctx.lineTo(x0 + NOMBRE_W + COL_W * datos.dias.length, yFin);
  ctx.stroke();

  ctx.textAlign = 'left';
  if (puestos.length) {
    ctx.fillStyle = '#0f172a';
    ctx.font = fuente(800, 12);
    ctx.fillText('HORARIOS', x0 + 4, yFin + 22);
    const fila = (y: number, titulo: string, colorTitulo: string | undefined, chips: Array<{ code: string; horario?: string; col: Colores }>) => {
      ctx.font = fuente(800, 11);
      const tw = Math.max(60, ctx.measureText(titulo).width + 12);
      ctx.fillStyle = colorTitulo || '#e2e8f0';
      ctx.beginPath();
      ctx.roundRect(x0 + 4, y, tw, 18, 4);
      ctx.fill();
      ctx.fillStyle = colorTitulo ? '#ffffff' : '#334155';
      ctx.textAlign = 'center';
      ctx.fillText(titulo, x0 + 4 + tw / 2, y + 13);
      let x = x0 + 4 + tw + 10;
      for (const ch of chips) {
        ctx.fillStyle = ch.col.bg;
        ctx.strokeStyle = ch.col.borde;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, 40, 18, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = ch.col.fg;
        ctx.textAlign = 'center';
        ctx.font = fuente(800, 10);
        ctx.fillText(ch.code, x + 20, y + 13);
        x += 44;
        if (ch.horario) {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#334155';
          ctx.font = fuente(600, 11);
          ctx.fillText(ch.horario, x, y + 13);
          x += ctx.measureText(ch.horario).width + 14;
        }
      }
      ctx.textAlign = 'left';
    };
    puestos.forEach((p, i) => {
      fila(yFin + 30 + i * 26, p.nombre.toUpperCase(), p.color, p.franjas.map((f) => {
        const code = f.code.toUpperCase();
        const col = p.color && !['D12', 'N12'].includes(code) ? { bg: '#ffffff', fg: '#0f172a', borde: p.color } : coloresDe(code);
        return { code, horario: f.horario, col };
      }));
    });
    if (otros.length) fila(yFin + 30 + puestos.length * 26, 'OTROS', undefined, otros.map((code) => ({ code, col: coloresDe(code) })));
  } else if (leyenda.length) {
    ctx.fillStyle = '#0f172a';
    ctx.font = fuente(800, 12);
    ctx.fillText('HORARIOS', x0 + 4, yFin + 22);
    const colW = (ancho - 24) / porLinea;
    leyenda.forEach((l, i) => {
      const x = x0 + 4 + (i % porLinea) * colW;
      const y = yFin + 30 + Math.floor(i / porLinea) * 24;
      const col = coloresDe(l.code);
      ctx.fillStyle = col.bg;
      ctx.strokeStyle = col.borde;
      ctx.beginPath();
      ctx.roundRect(x, y, 44, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col.fg;
      ctx.textAlign = 'center';
      ctx.font = fuente(800, 10);
      ctx.fillText(l.code, x + 22, y + 13);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#334155';
      ctx.font = fuente(600, 12);
      ctx.fillText(l.horario, x + 50, y + 13);
    });
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = fuente(500, 11);
  ctx.fillText(datos.pie, x0 + 4, alto - 14);
  return canvas;
}

export function nombreArchivo(titulo: string, mes: string): string {
  const limpio = `${titulo} ${mes}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  return `cronograma-${limpio.toLowerCase()}.png`;
}
