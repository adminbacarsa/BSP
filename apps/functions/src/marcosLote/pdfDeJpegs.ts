/** PDF A4 con una imagen JPEG por hoja (DCTDecode). Para armar el marco escaneado de cada persona. */
export type HojaJpeg = { jpeg: Buffer; width: number; height: number; components: number };

const ANCHO = 595;
const ALTO = 842;
const MARGEN = 18;

export function pdfDeJpegs(hojas: HojaJpeg[]): Buffer {
  const partes: Buffer[] = [];
  const offsets: number[] = [];
  let total = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    partes.push(buf);
    total += buf.length;
  };
  const objetos: Array<Buffer | string> = [];
  objetos.push('<< /Type /Catalog /Pages 2 0 R >>');
  objetos.push('PENDIENTE');
  const idsPaginas: number[] = [];
  hojas.forEach((h) => {
    const escala = Math.min((ANCHO - 2 * MARGEN) / Math.max(1, h.width), (ALTO - 2 * MARGEN) / Math.max(1, h.height));
    const w = Math.max(1, h.width * escala);
    const hh = Math.max(1, h.height * escala);
    const x = (ANCHO - w) / 2;
    const y = (ALTO - hh) / 2;
    const cs = h.components === 1 ? '/DeviceGray' : h.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const imgIdx = objetos.length + 1;
    objetos.push(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${h.width} /Height ${h.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${h.jpeg.length}${h.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} >>\nstream\n`, 'latin1'),
      h.jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ]));
    const contenido = `q ${w.toFixed(2)} 0 0 ${hh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q`;
    const contIdx = objetos.length + 1;
    objetos.push(`<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`);
    const pagIdx = objetos.length + 1;
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Contents ${contIdx} 0 R /Resources << /XObject << /Im1 ${imgIdx} 0 R >> >> >>`);
    idsPaginas.push(pagIdx);
  });
  objetos[1] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${idsPaginas.length} >>`;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  objetos.forEach((obj, i) => {
    offsets.push(total);
    push(`${i + 1} 0 obj\n`);
    push(obj);
    push('\nendobj\n');
  });
  const xrefAt = total;
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { xref += `${String(off).padStart(10, '0')} 00000 n \n`; });
  push(`${xref}trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return Buffer.concat(partes);
}
