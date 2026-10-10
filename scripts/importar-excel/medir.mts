/**
 * Solo lectura de prod. Mide la importación de octubre contra lo cargado en COSP.
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/importar-excel/medir.mts
 * No escribe en producción ni copia planillas al repo.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { celdasDesdeArrayBuffer } from '../../apps/web2/src/lib/planificacion/importarExcelXlsx';
import {
  compararServicio,
  cruzarGuardias,
  detectarCuadros,
  proponerReglas,
  resumenPreview,
  sugerirCuadros,
  unirCuadros,
  vistaPrevia,
  type EmpleadoCruce,
  type TurnoServicio,
} from '../../apps/web2/src/lib/planificacion/importarExcel';

const require = createRequire(fileURLToPath(new URL('../../apps/functions/package.json', import.meta.url)));
const admin = require('firebase-admin');

const DIR = 'C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre/';
const CASOS = [
  { archivo: 'A. CORBLOCK OCTUBRE.xlsx', oid: 'eipPkdpurtIoAp1UpoSs', nombre: 'Corblock' },
  { archivo: 'BANCO-CASA MATRIZ OCTUBRE.xlsx', oid: '1787231046789', nombre: 'Casa Matriz / Centro Cultural' },
  { archivo: 'BANCO-NVO EDIFICIO CORPORATIVO OCTUBRE.xlsx', oid: '3vWeMDkmhcFm7RrjcBAY', nombre: 'Nuevo Edificio Corporativo' },
];

if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Este script lee producción. Sacá FIRESTORE_EMULATOR_HOST.');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

function ymd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}
function hhmm(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') {
    const m = v.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '';
  }
  const d = typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : null;
  if (!d) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return p;
}

const empleadosSnap = await db.collection('empleados').where('empresaId', '==', 'bacarsa').get();
const empleados: EmpleadoCruce[] = empleadosSnap.docs.map((d) => {
  const e = d.data();
  return {
    id: d.id,
    nombre: String(e.name || `${e.lastName || ''}, ${e.firstName || ''}`),
    legajo: String(e.fileNumber || e.legajo || ''),
    empresaId: 'bacarsa',
    objetivoPreferido: String(e.preferredObjectiveId || ''),
  };
});

for (const caso of CASOS) {
  const buf = readFileSync(DIR + caso.archivo);
  const cuadros = detectarCuadros(celdasDesdeArrayBuffer(new Uint8Array(buf)), 2026, 10);
  console.log(`\n${caso.nombre} · cuadros ${cuadros.length} · sugeridos ${sugerirCuadros(cuadros).join(',')}`);
  const sugeridos = sugerirCuadros(cuadros);
  const slaSnap = await db.collection('servicios_sla').where('objectiveId', '==', caso.oid).get();
  const turnos: TurnoServicio[] = [];
  for (const d of slaSnap.docs) {
    const s = d.data();
    const desde = String(s.startDate || '');
    const hasta = String(s.endDate || '9999');
    if (desde > '2026-10-31' || hasta < '2026-10-01') continue;
    for (const p of s.positions || []) {
      for (const st of p.allowedShiftTypes || p.shifts || []) {
        turnos.push({
          positionName: String(p.name || 'Puesto'),
          code: String(st.code || ''),
          startTime: hhmm(st.startTime) || String(st.startTime || ''),
          endTime: hhmm(st.endTime) || String(st.endTime || ''),
          quantity: st.quantity ?? null,
        });
      }
    }
  }
  const aMedir = [unirCuadros(sugeridos.map((i) => cuadros[i]))];
  for (let qi = 0; qi < aMedir.length; qi++) {
  const cuadro = aMedir[qi];
  const reglas = proponerReglas(cuadro);
  const cruce = cruzarGuardias(cuadro.filas, empleados, 'bacarsa');
  const turSnap = await db.collection('turnos').where('objectiveId', '==', caso.oid).where('startTime', '>=', new Date('2026-09-30T03:00:00Z')).where('startTime', '<', new Date('2026-11-01T03:00:00Z')).get();
  const actuales: Array<{ employeeId: string; dateStr: string; code: string }> = [];
  for (const d of turSnap.docs) {
    const t = d.data();
    if (t.isDeleted) continue;
    const start = t.startTime?.toDate?.() as Date | undefined;
    if (!start) continue;
    const dateStr = ymd(start);
    if (!dateStr.startsWith('2026-10')) continue;
    actuales.push({ employeeId: String(t.employeeId || ''), dateStr, code: String(t.code || '') });
  }
  const items = vistaPrevia({
    year: 2026, month: 10, cuadro, reglas, cruce, incluirDudosos: true, turnos, actuales,
  });
  const res = resumenPreview(items);
  const aplicables = items.filter((i) => i.estado !== 'no_toca' && i.destino.accion !== 'ignorar');
  const iguales = aplicables.filter((i) => i.estado === 'igual').length;
  const cmp = compararServicio(cuadro, turnos, reglas);
  const diffs = new Map<string, number>();
  for (const i of items.filter((x) => x.estado === 'cambia')) {
    const k = `${i.codeActual || '—'} → ${i.destino.code || i.destino.accion}`;
    diffs.set(k, (diffs.get(k) || 0) + 1);
  }
  const top = [...diffs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  unión · filas ${cuadro.filas.length} · aviso ${cuadro.avisoMes || '—'}`);
  console.log(`  cruce ok ${cruce.filter((c) => c.estado === 'encontrado').length} dudoso ${cruce.filter((c) => c.estado === 'dudoso').length} no ${cruce.filter((c) => c.estado === 'no').length}`);
  console.log(`  servicio ${cmp.veredicto} · ${cmp.diferencias.slice(0, 4).join(' | ') || 'sin diferencias'}`);
  console.log(`  celdas ${items.length} · iguales ${iguales}/${aplicables.length} (${aplicables.length ? Math.round(1000 * iguales / aplicables.length) / 10 : 0}%) · nuevas ${res.nuevas} cambian ${res.cambian} no toca ${res.noToca}`);
  console.log(`  cambios: ${top.map(([k, n]) => `${k} ×${n}`).join(' · ') || '—'}`);
  }
}
process.exit(0);
