/** Decodifica JPEG/PNG a RGBA y lee el QR con jsQR. Reduce la imagen antes para no gastar segundos por hoja. */
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jsqrMod = require('jsqr');
const jsQR: (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null = jsqrMod.default || jsqrMod;

export type Rgba = { data: Uint8ClampedArray; width: number; height: number };

export function esJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function esPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

export function esPdf(buf: Buffer): boolean {
  return buf.subarray(0, 1024).toString('latin1').includes('%PDF');
}

/** Ancho, alto y componentes del SOF del JPEG. */
export function infoJpeg(buf: Buffer): { width: number; height: number; components: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

export function decodificarImagen(buf: Buffer): Rgba | null {
  try {
    if (esJpeg(buf)) {
      const out = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 80 });
      return { data: new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length), width: out.width, height: out.height };
    }
    if (esPng(buf)) {
      const png = PNG.sync.read(buf);
      return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), width: png.width, height: png.height };
    }
  } catch (e) {
    console.warn('[leerQr] imagen ilegible', e instanceof Error ? e.message : e);
  }
  return null;
}

export function reducir(img: Rgba, factor: number): Rgba {
  if (factor <= 1) return img;
  const width = Math.floor(img.width / factor);
  const height = Math.floor(img.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = y * factor;
    for (let x = 0; x < width; x += 1) {
      const si = (sy * img.width + x * factor) * 4;
      const di = (y * width + x) * 4;
      data[di] = img.data[si]; data[di + 1] = img.data[si + 1]; data[di + 2] = img.data[si + 2]; data[di + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Primero a ~1400 px de lado, después a tamaño completo. */
export function leerQr(img: Rgba): string | null {
  const mayor = Math.max(img.width, img.height);
  const factores = [...new Set([Math.max(1, Math.ceil(mayor / 1400)), Math.max(1, Math.ceil(mayor / 2400)), 1])];
  for (const f of factores) {
    const chica = reducir(img, f);
    const r = jsQR(chica.data, chica.width, chica.height);
    if (r?.data) return r.data;
  }
  return null;
}

export function aJpeg(img: Rgba, calidad = 82): Buffer {
  return Buffer.from(jpeg.encode({ data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), width: img.width, height: img.height }, calidad).data);
}
