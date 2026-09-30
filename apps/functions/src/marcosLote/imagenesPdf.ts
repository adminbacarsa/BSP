/**
 * Saca las imágenes de un PDF escaneado sin librerías de PDF: recorre los objetos `/Subtype /Image`
 * y devuelve el JPEG (DCTDecode) o los píxeles (FlateDecode). Lo que no se puede leer queda marcado.
 */
import * as zlib from 'zlib';

export type ImagenPdf = {
  objeto: number;
  width: number;
  height: number;
  filtro: string;
  jpeg?: Buffer;
  rgba?: { data: Uint8ClampedArray; width: number; height: number };
  legible: boolean;
};

function leerDict(s: string, desde: number): { dict: string; fin: number } | null {
  if (!s.startsWith('<<', desde)) return null;
  let depth = 0;
  let i = desde;
  while (i < s.length) {
    if (s.startsWith('<<', i)) { depth += 1; i += 2; continue; }
    if (s.startsWith('>>', i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return { dict: s.slice(desde, i), fin: i };
      continue;
    }
    i += 1;
  }
  return null;
}

function numero(dict: string, clave: string): number {
  const m = dict.match(new RegExp(`\\/${clave}\\s+(\\d+)(?!\\s+\\d+\\s+R)`));
  return m ? Number(m[1]) : 0;
}

function resolverEntero(s: string, ref: string): number {
  const m = ref.match(/(\d+)\s+(\d+)\s+R/);
  if (!m) return Number(ref) || 0;
  const obj = s.match(new RegExp(`(?:^|\\s)${m[1]}\\s+${m[2]}\\s+obj\\s*(\\d+)\\s*endobj`));
  return obj ? Number(obj[1]) : 0;
}

function filtros(dict: string): string[] {
  const m = dict.match(/\/Filter\s*(\/[A-Za-z0-9]+|\[[^\]]*\])/);
  if (!m) return [];
  return (m[1].match(/\/([A-Za-z0-9]+)/g) || []).map((f) => f.slice(1));
}

function componentesDeColorSpace(dict: string, s: string): number {
  const m = dict.match(/\/ColorSpace\s*(\/[A-Za-z]+|\[[^\]]*\]|\d+\s+\d+\s+R)/);
  const cs = m ? m[1] : '';
  if (/DeviceRGB|CalRGB|Lab/.test(cs)) return 3;
  if (/DeviceGray|CalGray/.test(cs)) return 1;
  if (/DeviceCMYK/.test(cs)) return 4;
  if (/Indexed/.test(cs)) return 0;
  const icc = cs.match(/ICCBased\s+(\d+)\s+(\d+)\s+R/);
  if (icc) {
    const obj = s.match(new RegExp(`(?:^|\\s)${icc[1]}\\s+${icc[2]}\\s+obj\\s*<<([^>]*)>>`));
    const n = obj ? obj[1].match(/\/N\s+(\d)/) : null;
    if (n) return Number(n[1]);
  }
  return 0;
}

/** Deshace los predictores PNG (10–15) de FlateDecode. */
function sinPredictor(data: Buffer, predictor: number, colors: number, bpc: number, columns: number): Buffer {
  if (predictor < 10) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  const filas = Math.floor(data.length / (rowLen + 1));
  const out = Buffer.alloc(filas * rowLen);
  let prev = Buffer.alloc(rowLen);
  for (let f = 0; f < filas; f += 1) {
    const tipo = data[f * (rowLen + 1)];
    const fila = Buffer.from(data.subarray(f * (rowLen + 1) + 1, (f + 1) * (rowLen + 1)));
    for (let i = 0; i < rowLen; i += 1) {
      const a = i >= bpp ? fila[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = fila[i];
      if (tipo === 1) v += a;
      else if (tipo === 2) v += b;
      else if (tipo === 3) v += Math.floor((a + b) / 2);
      else if (tipo === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      fila[i] = v & 0xff;
    }
    fila.copy(out, f * rowLen);
    prev = fila;
  }
  return out;
}

function aRgba(raw: Buffer, width: number, height: number, comps: number, bpc: number, invertir: boolean) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (bpc === 1 && comps === 1) {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = raw[y * rowBytes + (x >> 3)] ?? 0;
        let bit = (byte >> (7 - (x & 7))) & 1;
        if (invertir) bit ^= 1;
        const v = bit ? 255 : 0;
        const i = (y * width + x) * 4;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
      }
    }
    return { data, width, height };
  }
  if (bpc !== 8) return null;
  const px = width * height;
  for (let p = 0; p < px; p += 1) {
    const i = p * 4;
    if (comps === 1) {
      const v = raw[p] ?? 0;
      data[i] = v; data[i + 1] = v; data[i + 2] = v;
    } else if (comps === 3) {
      data[i] = raw[p * 3] ?? 0; data[i + 1] = raw[p * 3 + 1] ?? 0; data[i + 2] = raw[p * 3 + 2] ?? 0;
    } else if (comps === 4) {
      const c = raw[p * 4] ?? 0; const m = raw[p * 4 + 1] ?? 0; const yy = raw[p * 4 + 2] ?? 0; const k = raw[p * 4 + 3] ?? 0;
      data[i] = 255 - Math.min(255, c + k); data[i + 1] = 255 - Math.min(255, m + k); data[i + 2] = 255 - Math.min(255, yy + k);
    } else {
      return null;
    }
    data[i + 3] = 255;
  }
  return { data, width, height };
}

export function extraerImagenesDePdf(buf: Buffer): ImagenPdf[] {
  const s = buf.toString('latin1');
  const mascaras = new Set<number>();
  for (const m of s.matchAll(/\/SMask\s+(\d+)\s+\d+\s+R/g)) mascaras.add(Number(m[1]));
  const salida: ImagenPdf[] = [];
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const objeto = Number(m[1]);
    let i = re.lastIndex;
    while (i < s.length && /\s/.test(s[i])) i += 1;
    const d = leerDict(s, i);
    if (!d) continue;
    const { dict } = d;
    let j = d.fin;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    if (!s.startsWith('stream', j)) continue;
    if (!/\/Subtype\s*\/Image/.test(dict)) continue;
    if (/\/ImageMask\s+true/.test(dict) || mascaras.has(objeto)) continue;
    let inicio = j + 6;
    if (s[inicio] === '\r') inicio += 1;
    if (s[inicio] === '\n') inicio += 1;
    const lenMatch = dict.match(/\/Length\s+(\d+(?:\s+\d+\s+R)?)/);
    let length = lenMatch ? resolverEntero(s, lenMatch[1]) : 0;
    if (!length || inicio + length > s.length) {
      const fin = s.indexOf('endstream', inicio);
      if (fin < 0) continue;
      length = fin - inicio;
      while (length > 0 && (s[inicio + length - 1] === '\n' || s[inicio + length - 1] === '\r')) length -= 1;
    }
    const data = buf.subarray(inicio, inicio + length);
    const width = numero(dict, 'Width');
    const height = numero(dict, 'Height');
    if (width * height < 10000) continue;
    const lista = filtros(dict);
    const filtro = lista.join('+') || 'RAW';
    const base: ImagenPdf = { objeto, width, height, filtro, legible: false };
    try {
      if (lista.includes('DCTDecode')) {
        const jpeg: Buffer = lista[0] === 'FlateDecode' ? zlib.inflateSync(data) : Buffer.from(data);
        salida.push({ ...base, jpeg, legible: true });
        continue;
      }
      if (lista.length === 0 || (lista.length === 1 && lista[0] === 'FlateDecode')) {
        let raw: Buffer = lista.length ? zlib.inflateSync(data) : Buffer.from(data);
        const bpc = numero(dict, 'BitsPerComponent') || 8;
        let comps = componentesDeColorSpace(dict, s);
        const parms = dict.match(/\/DecodeParms\s*<<([^>]*)>>/);
        if (parms) {
          const pred = Number((parms[1].match(/\/Predictor\s+(\d+)/) || [])[1] || 1);
          const colors = Number((parms[1].match(/\/Colors\s+(\d+)/) || [])[1] || comps || 1);
          const cols = Number((parms[1].match(/\/Columns\s+(\d+)/) || [])[1] || width);
          const pbpc = Number((parms[1].match(/\/BitsPerComponent\s+(\d+)/) || [])[1] || bpc);
          raw = sinPredictor(raw, pred, colors, pbpc, cols);
          if (!comps) comps = colors;
        }
        if (!comps && bpc === 8) comps = Math.round(raw.length / (width * height));
        if (!comps && bpc === 1) comps = 1;
        const invertir = /\/Decode\s*\[\s*1\s+0/.test(dict);
        const rgba = aRgba(raw, width, height, comps, bpc, invertir);
        if (rgba) { salida.push({ ...base, rgba, legible: true }); continue; }
      }
    } catch (e) {
      console.warn('[imagenesPdf] objeto ilegible', objeto, filtro, e instanceof Error ? e.message : e);
    }
    salida.push(base);
  }
  return salida;
}
