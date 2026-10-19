/**
 * «Preparar el mes» contra producción. SOLO LECTURA: corre la misma tanda que la pantalla (correrTanda) y muestra
 * la tabla por objetivo.
 *
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/preparar-mes/medir-prod.mts --empresa pruebas_sa --mes 2026-11 [--modo auto|continuar|armar] [--cliente ID]
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { correrTanda, unidadesDelMes, ymdAr } from '../../apps/web2/src/lib/planificacion/prepararMesTanda';
import { buildAbsencesMapFromDocs } from '../../apps/web2/src/lib/planificacion/absenceCodes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const admin = createRequire(path.join(__dirname, '../../apps/functions/package.json'))('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const args = process.argv.slice(2);
const arg = (k: string, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const EMPRESA = arg('--empresa', 'pruebas_sa');
const MES = arg('--mes', '2026-11');
const MODO = arg('--modo', 'auto') as 'auto' | 'continuar' | 'armar';
const CLIENTE = arg('--cliente');
const [Y, M] = MES.split('-').map(Number);

const clients = (await db.collection('clients').where('empresaId', '==', EMPRESA).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
// Como la grilla: los legajos de la empresa y los habilitados desde otra empresa del grupo.
const empMap = new Map<string, any>();
for (const q of [db.collection('empleados').where('empresaId', '==', EMPRESA), db.collection('empleados').where('habilitadoEn', 'array-contains', EMPRESA)]) {
  (await q.get()).docs.forEach((d: any) => empMap.set(d.id, { id: d.id, ...d.data() }));
}
const employees = [...empMap.values()];
const grupos = (await db.collection('grupos_objetivos').where('empresaId', '==', EMPRESA).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const allSla = (await db.collection('servicios_sla').where('empresaId', '==', EMPRESA).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const slaIdToObjId: Record<string, string> = {};
for (const s of allSla) if (s.objectiveId) slaIdToObjId[s.id] = s.objectiveId;

const desde = new Date(`${MES}-01T00:00:00-03:00`);
const hasta = new Date(`${M === 12 ? Y + 1 : Y}-${String(M === 12 ? 1 : M + 1).padStart(2, '0')}-01T00:00:00-03:00`);
const mesDocs = (await db.collection('turnos').where('empresaId', '==', EMPRESA).where('startTime', '>=', desde).where('startTime', '<', hasta).get()).docs;
const shiftsMap: Record<string, any> = {};
for (const d of mesDocs) {
  const t = { id: d.id, ...d.data() };
  if (t.isDeleted || !t.employeeId) continue;
  const ds = ymdAr(t.startTime);
  if (!ds) continue;
  const key = `${t.employeeId}_${ds}`;
  const prev = shiftsMap[key];
  const franco = (x: any) => !!x?.isFranco || ['F', 'FF', 'FP'].includes(String(x?.code || '').toUpperCase());
  if (!prev || (franco(prev) && !franco(t))) shiftsMap[key] = t;
}
const ausDocs = (await db.collection('ausencias').where('empresaId', '==', EMPRESA).get()).docs.map((d: any) => ({ id: d.id, data: d.data() }));
const absencesMap = buildAbsencesMapFromDocs(ausDocs, (d: Date) => ymdAr(d) || '');

const unidades = unidadesDelMes(clients, grupos).filter((u) => !CLIENTE || u.objetivos.some((o) => o.clientId === CLIENTE));
const t0 = Date.now();
const filas = await correrTanda({
  unidades,
  year: Y,
  month: M - 1,
  modo: MODO,
  allSla,
  clients,
  employees,
  slaIdToObjId,
  shiftsMap,
  absencesMap,
  historia: async (oid, a, b) => (await db.collection('turnos').where('objectiveId', '==', oid).where('startTime', '>=', a).where('startTime', '<=', b).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })),
  publicado: async (oid) => {
    for (const id of [`${EMPRESA}_${oid}_${Y}_${M}`, `${oid}_${Y}_${M}`]) {
      const s = await db.collection('planificacion_estados').doc(id).get();
      if (s.exists && s.data()?.publishedAt) return true;
    }
    return false;
  },
});
const pad = (v: unknown, n: number) => String(v ?? '—').padStart(n);
console.log(`${EMPRESA} ${MES} modo ${MODO} · ${filas.length} unidades · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`${'Objetivo'.padEnd(34)} ${'pide'.padStart(5)} | copia: sinC 12h al50 RET cambios | armar: sinC 12h al50 RET cambios | usa`);
for (const f of filas) {
  const m = (x?: any) => (x ? `${pad(x.horasSinCubrir, 5)} ${pad(x.doce, 3)} ${pad(x.horasAl50, 4)} ${pad(x.ret, 3)} ${pad(x.cambios, 7)}` : ' '.repeat(26));
  const nombre = `${f.grupo ? '[G] ' : ''}${f.nombre}`.slice(0, 34).padEnd(34);
  if (f.estado !== 'ok') { console.log(`${nombre} ${f.estado}${f.notas.length ? ` · ${f.notas.join(' · ')}` : ''}`); continue; }
  console.log(`${nombre} ${pad(f.continuar?.horasPedidas, 5)} | ${m(f.continuar)} | ${m(f.armar)} | ${f.elegida} (${f.porQue})${f.notas.length ? ` · ${f.notas.join(' · ')}` : ''}`);
}
const ok = filas.filter((f) => f.estado === 'ok');
const el = (f: any) => (f.elegida === 'armar' ? f.armar : f.continuar);
console.log(`TOTAL elegidas: pide ${ok.reduce((a, f) => a + el(f).horasPedidas, 0)} · sin cubrir ${ok.reduce((a, f) => a + el(f).horasSinCubrir, 0)} · 12h ${ok.reduce((a, f) => a + el(f).doce, 0)} · al 50 % ${ok.reduce((a, f) => a + el(f).horasAl50, 0)} · RET ${ok.reduce((a, f) => a + el(f).ret, 0)}`);
process.exit(0);
