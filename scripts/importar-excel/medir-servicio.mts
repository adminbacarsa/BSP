/**
 * Solo lectura de prod. Compara la propuesta de servicio con el SLA de octubre.
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/importar-excel/medir-servicio.mts
 * No escribe en producción ni copia planillas al repo. No imprime nombres de personas.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { celdasDesdeArrayBuffer } from '../../apps/web2/src/lib/planificacion/importarExcelXlsx';
import { claveCodigo, detectarCuadros, normPlanilla, proponerRegla, sugerirCuadros, type CuadroPlanilla } from '../../apps/web2/src/lib/planificacion/importarExcel';
import { toYyyyMmDd } from '../../apps/web2/src/lib/firestoreDates';
import { compararConVigente, etiquetaDias, letraDia, proponerServicioDesdePlanilla, type FranjaServicioPlanilla, type FranjaVigente } from '../../apps/web2/src/lib/planificacion/servicioDesdePlanilla';

const require = createRequire(fileURLToPath(new URL('../../apps/functions/package.json', import.meta.url)));
const admin = require('firebase-admin');

const DIR = 'C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre/';
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Este script lee producción. Sacá FIRESTORE_EMULATOR_HOST.');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

function hm(v: unknown): string {
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

type Obj = { id: string; nombre: string; cliente: string };
const clients = await db.collection('clients').where('empresaId', '==', 'bacarsa').get();
const objetivos: Obj[] = [];
for (const c of clients.docs) {
  for (const o of (c.data().objetivos || []) as Array<{ id?: string; name?: string; status?: string }>) {
    const status = String(o.status || 'ACTIVE').toUpperCase();
    if (status === 'INACTIVE' || status === 'INACTIVO') continue;
    const id = String(o.id || '');
    if (!id) continue;
    objetivos.push({ id, nombre: String(o.name || id), cliente: String(c.data().name || '') });
  }
}

function mejor(texto: string): { obj: Obj; score: number } | null {
  const n = normPlanilla(texto);
  let best: { obj: Obj; score: number } | null = null;
  for (const obj of objetivos) {
    const on = normPlanilla(obj.nombre);
    if (!on || on.length < 4) continue;
    let score = 0;
    if (n.includes(on) || on.includes(n)) score = Math.min(n.length, on.length);
    if (score > (best?.score || 0)) best = { obj, score };
  }
  return best && best.score >= 6 ? best : null;
}

async function vigenteDe(oid: string): Promise<FranjaVigente[]> {
  const snap = await db.collection('servicios_sla').where('objectiveId', '==', oid).get();
  const out: FranjaVigente[] = [];
  for (const d of snap.docs) {
    const s = d.data();
    const desde = toYyyyMmDd(s.startDate) || '1970-01-01';
    const hasta = toYyyyMmDd(s.endDate) || '9999-12-31';
    if (desde > '2026-10-31' || hasta < '2026-10-01') continue;
    if (s.closed === true) continue;
    for (const p of s.positions || []) {
      if (p.status === 'INACTIVE' || p.coverageType === 'eventos') continue;
      for (const st of p.allowedShiftTypes || []) {
        const a = hm(st.startTime);
        const b = hm(st.endTime);
        if (!a || !b || !st.code) continue;
        out.push({
          puesto: String(p.name || 'Puesto'),
          code: String(st.code),
          startTime: a,
          endTime: b,
          cantidad: Number(st.quantity ?? p.quantity ?? 1),
          dias: Array.isArray(st.days) ? st.days.map((x: unknown) => String(x)) : [],
        });
      }
    }
  }
  return out;
}

async function medir(archivo: string, oid: string, nombre: string) {
  const buf = readFileSync(DIR + archivo);
  const cuadros = detectarCuadros(celdasDesdeArrayBuffer(new Uint8Array(buf)), 2026, 10);
  const ids = sugerirCuadros(cuadros);
  const vigente = await vigenteDe(oid);
  console.log(`\n${nombre} (${oid}) · cuadros ${cuadros.length} · sugeridos ${ids.join(',')} · vigente ${vigente.length}`);
  for (const v of vigente) console.log(`  sla: ${v.puesto} ${v.code} ${v.startTime}-${v.endTime} x${v.cantidad} ${etiquetaDias(v.dias)}`);
  const lista = ids.length ? ids : cuadros.map((_, i) => i);
  for (const i of lista) {
    const cuadro = cuadros[i];
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const diff = compararConVigente(prop.franjas, vigente);
    const cuenta = (e: string) => diff.filter((d) => d.estado === e).length;
    console.log(`  cuadro ${i} «${cuadro.titulo || '—'}» filas ${cuadro.filas.length} · franjas ${prop.franjas.length} · coincide ${cuenta('coincide')} distinto ${cuenta('distinto')} falta ${cuenta('falta')} sobra ${cuenta('sobra')}`);
    for (const d of diff.filter((x) => x.estado !== 'coincide').slice(0, 8)) console.log(`    ${d.estado}: ${d.detalle}`);
    const cob = cobertura(cuadro, prop.franjas);
    console.log(`    propuesta: ${prop.franjas.slice(0, 6).map((f) => `${f.puesto} ${f.code} ${f.startTime}-${f.endTime} x${f.cantidad} ${etiquetaDias(f.dias)}`).join(' | ')}`);
    console.log(`    cobertura ${cob.pct}% · huecos ${cob.huecos} · ${cob.cubiertos}/${cob.pedidos}`);
  }
}

function cobertura(cuadro: CuadroPlanilla, franjas: FranjaServicioPlanilla[]) {
  let pedidos = 0;
  let cubiertos = 0;
  let huecos = 0;
  const ultimo = 31;
  for (const f of franjas) {
    const letras = new Set(f.dias.length ? f.dias : ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    for (let dia = 1; dia <= ultimo; dia++) {
      const letra = letraDia(2026, 10, dia);
      if (!letras.has(letra)) continue;
      let n = 0;
      for (const fila of cuadro.filas) {
        if (normPlanilla(fila.puesto || 'Puesto') !== normPlanilla(f.puesto)) continue;
        const c = fila.celdas.find((x) => x.dia === dia);
        if (!c) continue;
        const color = c.color === 'red' ? 'red' : 'none';
        const regla = proponerRegla(c.raw, color, cuadro.referencias);
        const code = claveCodigo(regla.code || c.raw);
        if (code === claveCodigo(f.code)) n += 1;
      }
      pedidos += f.cantidad;
      cubiertos += Math.min(n, f.cantidad);
      if (n < f.cantidad) huecos += 1;
    }
  }
  const pct = pedidos ? Math.round(1000 * cubiertos / pedidos) / 10 : 0;
  return { pedidos, cubiertos, huecos, pct };
}

const buscar = process.argv.includes('--buscar');
const archivos = buscar ? readdirSync(DIR).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$') && /casino|casisa/i.test(f)) : [];
console.log('Candidatos sin SLA de octubre:');
const sin: Array<{ archivo: string; oid: string; nombre: string }> = [];
for (const archivo of archivos) {
  const titulo = archivo.replace(/\.xlsx$/i, '').replace(/octubre.*/i, '').replace(/casisa\s+\d+\.\s*/i, '').replace(/casino\s+/i, '');
  const hit = mejor(titulo) || mejor(archivo);
  if (!hit) {
    console.log(`  ${archivo}: sin objetivo`);
    continue;
  }
  const vig = await vigenteDe(hit.obj.id);
  if (!vig.length) {
    sin.push({ archivo, oid: hit.obj.id, nombre: `${hit.obj.cliente} · ${hit.obj.nombre}` });
    console.log(`  SIN ${hit.obj.id} ${hit.obj.nombre} ← ${archivo}`);
  }
}

await medir('A. CORBLOCK OCTUBRE.xlsx', 'eipPkdpurtIoAp1UpoSs', 'Corblock');
await medir('A. TADICOR OCTUBRE.xlsx', 'FA0p5IQ7ythf1GYpDJ58', 'Tadicor');
const peaje = sin.find((s) => /ruta 20/i.test(s.nombre)) || { archivo: 'Casisa 1. Ruta 20 OCTUBRE.xlsx', oid: 'AUOMjDCashPHdrTBFef2', nombre: 'CASISA · Peaje Ruta 20' };
await medir(peaje.archivo, peaje.oid, peaje.nombre);
process.exit(0);
