/**
 * Compara el lector de la planilla de Tadicor octubre con una lectura simulada de la IA.
 * No llama a Gemini: en esta PC no está apps/functions/.env con GEMINI_API_KEY.
 */
import { readFileSync } from 'node:fs';
import { detectarCuadros } from '../../apps/web2/src/lib/planificacion/importarExcel';
import { celdasDesdeArrayBuffer } from '../../apps/web2/src/lib/planificacion/importarExcelXlsx';
import { armarGrillaIa, compararLecturaIa, contieneNombrePersona, validarLecturaIa } from '../../apps/web2/src/lib/planificacion/planillaIa';
import { proponerServicioDesdePlanilla } from '../../apps/web2/src/lib/planificacion/servicioDesdePlanilla';

const archivo = process.argv[2] || 'C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre/A. TADICOR OCTUBRE.xlsx';
const buf = readFileSync(archivo);
const cuadros = detectarCuadros(celdasDesdeArrayBuffer(buf), 2026, 10);
const cuadro = cuadros.slice().sort((a, b) => b.filas.reduce((n, f) => n + f.celdas.length, 0) - a.filas.reduce((n, f) => n + f.celdas.length, 0))[0];
if (!cuadro) throw new Error('Sin cuadro');
const propuesta = proponerServicioDesdePlanilla(cuadro, 2026, 10);
const grilla = armarGrillaIa(cuadro, 2026, 10);
const lectura = validarLecturaIa(JSON.parse(readFileSync(new URL('./tadicor-simulada.json', import.meta.url), 'utf8')));
const items = compararLecturaIa(propuesta, lectura);

console.log('cuadro', cuadro.indice, 'celdas', cuadro.filas.reduce((n, f) => n + f.celdas.length, 0));
console.log('nombres en el payload', contieneNombrePersona(grilla) ? 'SI' : 'no');
console.log('dotacion', grilla.dotacion.length, 'bloques', grilla.bloquesPuesto.map((b) => b.nombre).join(', '));
console.log('\nLector:');
for (const f of propuesta.franjas) console.log(`  ${f.puesto} · ${f.code} ${f.startTime}–${f.endTime} ×${f.cantidad}`);
for (const f of propuesta.funciones || []) console.log(`  función ${f}`);
for (const p of propuesta.parciales || []) console.log(`  parcial ${p}`);
console.log('\nMezcla con la lectura simulada:');
for (const item of items) console.log(`  ${item.clase} ${Math.round(item.confianza * 100)}% ${item.titulo} | lector: ${item.lector} | ia: ${item.ia}`);
