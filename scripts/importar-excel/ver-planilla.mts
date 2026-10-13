/** Solo lectura: qué lee el lector de una planilla, sin nombres. npx tsx --tsconfig apps/web2/tsconfig.json scripts/importar-excel/ver-planilla.mts "ruta.xlsx" */
import { readFileSync } from 'node:fs';
import { celdasDesdeArrayBuffer } from '../../apps/web2/src/lib/planificacion/importarExcelXlsx';
import { detectarCuadros, proponerRegla, claveCodigo } from '../../apps/web2/src/lib/planificacion/importarExcel';
import { proponerServicioDesdePlanilla, etiquetaDias, letraDia } from '../../apps/web2/src/lib/planificacion/servicioDesdePlanilla';

const file = process.argv[2];
const buf = readFileSync(file);
const celdas = celdasDesdeArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const cuadros = detectarCuadros(celdas, 2026, 10);
console.log('cuadros:', cuadros.length);
for (const c of cuadros) {
  console.log(`\n== cuadro ${c.indice} · titulo «${c.titulo}» · filas ${c.filas.length} · refs ${c.referencias.length}`);
  for (const r of c.referencias) console.log(`  ref ${r.codigo}${r.color === 'red' ? '(rojo)' : ''} ${r.inicio}–${r.fin} «${String(r.descripcion || '').slice(0, 30)}»`);
  c.filas.forEach((f, i) => {
    const linea = Array.from({ length: 31 }, (_, d) => {
      const x = f.celdas.find((y) => y.dia === d + 1);
      if (!x) return '.';
      return `${x.raw}${x.color === 'red' ? '*' : x.color && x.color !== 'none' ? '~' : ''}`;
    }).join(' ');
    console.log(`  fila ${i + 1} puesto «${f.puesto}»: ${linea}`);
  });
  const porDia: Record<number, Record<string, number>> = {};
  for (const f of c.filas) for (const x of f.celdas) {
    const r = proponerRegla(x.raw, x.color === 'red' ? 'red' : 'none', c.referencias);
    let b = claveCodigo(r.code || x.raw);
    if (r.accion !== 'turno' && r.accion !== 'doce') continue;
    if (b === 'D12') b = 'M'; if (b === 'N12') b = 'N';
    const k = ['M', 'T', 'N'].includes(b) ? b : b;
    (porDia[x.dia] ||= {})[k] = (porDia[x.dia][k] || 0) + 1;
  }
  console.log('  conteo por día:');
  for (let d = 1; d <= 31; d++) console.log(`   ${String(d).padStart(2)} ${letraDia(2026, 10, d)} ${JSON.stringify(porDia[d] || {})}`);
  const prop = proponerServicioDesdePlanilla(c, 2026, 10);
  console.log('  PROPUESTA ACTUAL:');
  for (const f of prop.franjas) console.log(`   ${f.puesto} · ${f.code} ${f.startTime}–${f.endTime} ×${f.cantidad} · ${f.fechas?.length ? 'fechas ' + f.fechas.join(',') : etiquetaDias(f.dias)}`);
  for (const p of prop.parciales || []) console.log('   parcial:', p);
}
