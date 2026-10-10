/**
 * «Continuar desde el mes anterior» contra el mes armado a mano en producción. SOLO LECTURA.
 *
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/continuar-mes/comparar-prod.mts --obj 9CbYIDmsUGnabENKvXZt --mes 2026-10
 *   ... --json salida.json   (deja el detalle por guardia)
 *
 * Lee turnos (3 meses antes + el mes), ausencias y servicios_sla del objetivo. No escribe nada.
 * El mes nuevo se simula vacío salvo las licencias (lo que ya estaría cargado al planificar).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  codigoDeCiclo,
  cupoDelServicio,
  diaDelCiclo,
  diaIndex,
  observacionesDelGuardia,
  proponerContinuacion,
  sobrantesPorDia,
  alertasDescansoCambioMes,
  textoDias,
  ymdDeIndex,
  type PuestoSla,
  type TurnoPrevio,
} from '../../apps/web2/src/lib/planificacion/continuarMesAnterior';
import { LICENCIA_CODES } from '../../apps/web2/src/lib/planificacion/bandaLicencia';
import { buildPlanningPositionStructure } from '../../apps/web2/src/lib/slaPlanningMatch';
import { toYyyyMmDd } from '../../apps/web2/src/lib/firestoreDates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const arg = (k: string, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OBJ = arg('--obj');
const MES = arg('--mes', '2026-10');
const JSON_OUT = arg('--json');
const SOLO_RESUMEN = args.includes('--resumen');
if (!OBJ) { console.error('Falta --obj'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const AR = 'America/Argentina/Buenos_Aires';
const ymdAr = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: AR }).format(d);
const [Y, M] = MES.split('-').map(Number);
const primerDia = `${MES}-01`;
const nDias = new Date(Date.UTC(Y, M, 0)).getUTCDate();
const dias = Array.from({ length: nDias }, (_, i) => `${MES}-${String(i + 1).padStart(2, '0')}`);
const desde = new Date(`${ymdDeIndex(diaIndex(primerDia) - 92)}T00:00:00-03:00`);
const hasta = new Date(`${ymdDeIndex(diaIndex(dias[nDias - 1]) + 1)}T00:00:00-03:00`);

const snap = await db.collection('turnos').where('objectiveId', '==', OBJ)
  .where('startTime', '>=', desde).where('startTime', '<', hasta).get();
type T = TurnoPrevio & { employeeId: string; employeeName?: string; endTime?: unknown; hours?: number };
const turnos: T[] = snap.docs.map((d: any) => {
  const s = d.data();
  return { ...s, id: d.id, dateStr: ymdAr(s.startTime.toDate()), employeeId: String(s.employeeId || '') } as T;
}).filter((t: T) => t.employeeId && t.employeeId !== 'VACANTE' && t.isDeleted !== true);

const previos = turnos.filter((t) => t.dateStr < primerDia);
const delMes = turnos.filter((t) => t.dateStr >= primerDia);

// Rows: quien tiene algo en el mes armado a mano o trabajó en el objetivo el mes anterior.
const ids = [...new Set([...delMes.map((t) => t.employeeId), ...previos.filter((t) => t.dateStr >= ymdDeIndex(diaIndex(primerDia) - 31)).map((t) => t.employeeId)])];
const nombres = new Map<string, string>();
for (let i = 0; i < ids.length; i += 10) {
  const chunk = ids.slice(i, i + 10);
  const es = await db.collection('empleados').where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
  es.docs.forEach((d: any) => {
    const e = d.data();
    nombres.set(d.id, String(e.name || e.fullName || `${e.lastName || e.apellido || ''}, ${e.firstName || e.nombre || ''}`).trim());
  });
}
for (const t of turnos) if (!nombres.has(t.employeeId) && t.employeeName) nombres.set(t.employeeId, String(t.employeeName));

// Licencias que ya estarían cargadas al planificar: turnos de licencia del mes + ausencias activas.
const licencia = new Set<string>();
for (const t of delMes) if (LICENCIA_CODES.has(String(t.code || '').toUpperCase())) licencia.add(`${t.employeeId}_${t.dateStr}`);
for (let i = 0; i < ids.length; i += 10) {
  const chunk = ids.slice(i, i + 10);
  const as = await db.collection('ausencias').where('employeeId', 'in', chunk).get();
  as.docs.forEach((d: any) => {
    const a = d.data();
    const st = String(a.status || '').toUpperCase();
    if (['RECHAZADA', 'CANCELADA', 'ANULADA', 'REJECTED', 'CANCELLED'].includes(st)) return;
    const ini = a.startDate?.toDate ? ymdAr(a.startDate.toDate()) : String(a.startDate || '').slice(0, 10);
    const fin = a.endDate?.toDate ? ymdAr(a.endDate.toDate()) : String(a.endDate || '').slice(0, 10);
    if (!ini || !fin) return;
    for (const dd of dias) if (dd >= ini && dd <= fin) licencia.add(`${a.employeeId}_${dd}`);
  });
}

// SLA del mes nuevo.
const slas = (await db.collection('servicios_sla').where('objectiveId', '==', OBJ).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const delMesSla = slas.find((s: any) => toYyyyMmDd(s.startDate) <= primerDia && (toYyyyMmDd(s.endDate) || '9999') >= primerDia && s.status !== 'INACTIVE')
  || slas.find((s: any) => toYyyyMmDd(s.startDate).slice(0, 7) === MES);
// Sin servicio en el mes, para medir se usa el último anterior (la grilla diría «No hay servicio en este mes»).
const respaldo = delMesSla ? null : slas
  .filter((s: any) => toYyyyMmDd(s.startDate) < primerDia && s.status !== 'INACTIVE')
  .sort((a: any, b: any) => toYyyyMmDd(b.startDate).localeCompare(toYyyyMmDd(a.startDate)))[0];
const vigente = delMesSla || respaldo;
if (!vigente) { console.error(`Sin servicio para ${MES}`); process.exit(1); }
if (respaldo) console.log(`Sin servicio en ${MES}: se mide con el servicio ${respaldo.id} (${toYyyyMmDd(respaldo.startDate)})`);
const { structure } = buildPlanningPositionStructure(vigente as any, { monthHasSla: true, hasExactMatch: true });
const estructura = structure as unknown as PuestoSla[];

// Dotación = quien tiene algo en el mes armado; salientes = trabajaron el mes anterior y no siguen.
const enMes = new Set(delMes.map((t) => t.employeeId));
const previosDe = (id: string) => previos.filter((t) => t.employeeId === id);
const altas = new Set(ids.filter((id) => enMes.has(id) && observacionesDelGuardia(previosDe(id), OBJ).length === 0));
const base = {
  objectiveId: OBJ,
  dias,
  guardias: ids.filter((id) => enMes.has(id)).map((id) => ({ id, nombre: nombres.get(id) || id, previos: previosDe(id) })),
  salientes: ids.filter((id) => !enMes.has(id)).map((id) => ({ id, nombre: nombres.get(id) || id, previos: previosDe(id) })),
  estructura,
  estadoCelda: (e: string, d: string) => (licencia.has(`${e}_${d}`) ? 'licencia' as const : null),
  cupoDia: (d: string) => cupoDelServicio(estructura, d),
};
const anteriores = proponerContinuacion({ ...base, regla: 'anterior' });
const resultados = proponerContinuacion(base);

// Lo armado a mano, normalizado igual que el ciclo (puntuales y licencias afuera).
const aMano = new Map<string, { code: string; pos: string }>();
for (const t of delMes) {
  const code = codigoDeCiclo({ ...t, originalCode: undefined }, OBJ);
  if (!code) continue;
  const k = `${t.employeeId}_${t.dateStr}`;
  const prev = aMano.get(k);
  if (!prev || (prev.code === 'F' && code !== 'F')) aMano.set(k, { code, pos: String(t.positionName || '') });
}

// Métrica: celdas de turno y franco del mes armado (sin licencias, eventos ni coberturas), sin altas ni bajas.
const predDe = (rs: typeof resultados, niv: boolean) => new Map(rs.map((r) => {
  const m = new Map(r.propuestas.map((c) => [c.dateStr, c.isFranco ? 'F' : c.code]));
  if (niv) for (const s of r.sugerencias) m.set(s.dateStr, s.a);
  return [r.employeeId, m];
}));
const pAnt = predDe(anteriores, false);
const pC2 = predDe(resultados, false);
const pNiv = predDe(resultados, true);
let nCel = 0; let okAnt = 0; let okC2 = 0; let okNiv = 0;
const porGuardia: string[] = [];
for (const id of enMes) {
  if (altas.has(id)) continue;
  let n = 0; let a = 0; let c = 0;
  let mano = ''; let ant = ''; let nue = '';
  for (const d of dias) {
    const h = aMano.get(`${id}_${d}`);
    const lic = licencia.has(`${id}_${d}`);
    mano += lic ? 'L' : (h?.code || '.').slice(0, 1);
    ant += (pAnt.get(id)?.get(d) || '.').slice(0, 1);
    nue += (pC2.get(id)?.get(d) || '.').slice(0, 1);
    if (!h || lic) continue;
    nCel += 1; n += 1;
    if (pAnt.get(id)?.get(d) === h.code) { okAnt += 1; a += 1; }
    if (pC2.get(id)?.get(d) === h.code) { okC2 += 1; c += 1; }
    if (pNiv.get(id)?.get(d) === h.code) okNiv += 1;
  }
  const r = resultados.find((x) => x.employeeId === id);
  const obs = new Map(observacionesDelGuardia(previosDe(id), OBJ).map((o) => [o.idx, o.code]));
  const hist = Array.from({ length: 62 }, (_, k) => (obs.get(diaIndex(primerDia) - 62 + k) || '.').slice(0, 1)).join('');
  if (a !== c) porGuardia.push(`  ${id.slice(0, 8)} ant ${a}/${n} c2 ${c}/${n} · ${r?.plantilla?.via || r?.origenCiclo || '—'} ${r?.continuaEn || ''}\n    hist ${hist}\n    mano ${mano}\n    ant  ${ant}\n    c2   ${nue}`);
}
const p1 = (a: number) => (nCel ? `${((100 * a) / nCel).toFixed(1)}%` : '—');
const vias = resultados.reduce<Record<string, number>>((a, r) => {
  const k = r.plantilla?.via || `anterior:${r.origenCiclo || 'sin ciclo'}`;
  a[k] = (a[k] || 0) + 1;
  return a;
}, {});
console.log(`RESUMEN ${OBJ} ${MES} · celdas ${nCel} · anterior ${p1(okAnt)} · c2 ${p1(okC2)} · c2+niv ${p1(okNiv)} · sugerencias ${resultados.reduce((a, r) => a + r.sugerencias.length, 0)} · altas ${altas.size} · bajas ${base.salientes.length} · ${JSON.stringify(vias)}`);
if (args.includes('--difs')) console.log(porGuardia.join('\n'));
if (SOLO_RESUMEN) process.exit(0);

const fam = (c: string) => (c === 'D12' ? 'M' : c === 'N12' ? 'N' : c);
type Fila = {
  id: string; nombre: string; ciclo: string; continua: string; comparadas: number; iguales: number; igualesFam: number;
  sinPropuesta: number; distintas: number; puestoDistinto: number; desfase: number | null; desfaseIguales: number; motivo: string;
  muestra: string;
};
const filas: Fila[] = [];
for (const r of resultados) {
  const prop = new Map(r.propuestas.map((c) => [c.dateStr, c]));
  let comparadas = 0; let iguales = 0; let igualesFam = 0; let sinPropuesta = 0; let distintas = 0; let puestoDistinto = 0;
  const diasDistintos: string[] = [];
  for (const d of dias) {
    const h = aMano.get(`${r.employeeId}_${d}`);
    if (!h) continue;
    if (licencia.has(`${r.employeeId}_${d}`)) continue;
    comparadas += 1;
    const p = prop.get(d);
    if (!p) { sinPropuesta += 1; continue; }
    if (p.code === h.code) {
      iguales += 1; igualesFam += 1;
      if (!p.isFranco && h.pos && p.positionName !== h.pos) puestoDistinto += 1;
    } else if (fam(p.code) === fam(h.code)) igualesFam += 1;
    else { distintas += 1; diasDistintos.push(d); }
  }
  // ¿Lo armado a mano es el mismo ciclo corrido unos días?
  let desfase: number | null = null; let desfaseIguales = 0;
  if (r.ciclo && comparadas > 0) {
    let mejor = iguales; let mejorK = 0;
    for (let k = -12; k <= 12; k += 1) {
      if (k === 0) continue;
      let n = 0;
      for (const d of dias) {
        const h = aMano.get(`${r.employeeId}_${d}`);
        if (!h || licencia.has(`${r.employeeId}_${d}`)) continue;
        const c = diaDelCiclo(r.ciclo, ymdDeIndex(diaIndex(d) + k));
        if (c && c.code === h.code) n += 1;
      }
      if (n > mejor) { mejor = n; mejorK = k; }
    }
    if (mejorK !== 0 && mejor - iguales >= Math.max(3, comparadas * 0.2)) { desfase = mejorK; desfaseIguales = mejor; }
  }
  let motivo = '';
  if (comparadas === 0) motivo = r.propuestas.length ? 'No está en el mes armado a mano (o solo licencia)' : 'Sin datos';
  else if (!r.ciclo) motivo = `Sin ciclo: ${r.motivoSinCiclo}`;
  else if (desfase != null) motivo = `Mismo ciclo corrido ${desfase > 0 ? '+' : ''}${desfase} día(s) (${desfaseIguales}/${comparadas} con el corrimiento)`;
  else if (distintas > 0) motivo = `Difiere los días ${textoDias(diasDistintos)}`;
  if (r.revisar.length) motivo += `${motivo ? ' · ' : ''}Revisar: ${r.revisar.map((x) => `${x.positionName} ${x.code}${x.propuestoEn ? ` → ${x.propuestoEn}` : ''}`).join(', ')}`;
  const seq = (fn: (d: string) => string) => dias.map(fn).join('');
  const muestra = `mano ${seq((d) => (aMano.get(`${r.employeeId}_${d}`)?.code || '.').slice(0, 1))}\n         prop ${seq((d) => (licencia.has(`${r.employeeId}_${d}`) ? 'L' : (prop.get(d)?.code || '.').slice(0, 1)))}`;
  filas.push({
    id: r.employeeId, nombre: r.nombre, ciclo: r.ciclo ? `${r.ciclo.etiqueta} (p=${r.ciclo.periodo}, ${Math.round(r.ciclo.consistencia * 100)}%)` : '—',
    continua: r.continuaEn, comparadas, iguales, igualesFam, sinPropuesta, distintas, puestoDistinto, desfase, desfaseIguales, motivo, muestra,
  });
}

const tot = filas.reduce((a, f) => ({ c: a.c + f.comparadas, i: a.i + f.iguales, f: a.f + f.igualesFam, s: a.s + f.sinPropuesta }), { c: 0, i: 0, f: 0, s: 0 });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const suma = (pred: (r: typeof resultados[number]) => boolean) => resultados.filter(pred).reduce((a, r) => {
  const f = filas.find((x) => x.id === r.employeeId);
  return { c: a.c + (f?.comparadas || 0), i: a.i + (f?.iguales || 0), s: a.s + (f?.sinPropuesta || 0), n: a.n + 1 };
}, { c: 0, i: 0, s: 0, n: 0 });
const fijo = suma((r) => r.origenCiclo === 'fijo');
const estimado = suma((r) => r.estimado);
console.log(`Objetivo ${OBJ} · ${MES} · SLA ${vigente.id} (${estructura.map((p) => `${p.positionName}×${p.qty}`).join(', ')})`);
console.log(`Guardias ${filas.length} · con ciclo ${resultados.filter((r) => r.ciclo).length} · estimados ${resultados.filter((r) => r.estimado).length} · celdas comparadas ${tot.c} · iguales ${tot.i} (${pct(tot.i, tot.c)}) · iguales contando D12≈M/N12≈N ${pct(tot.f, tot.c)} · sin propuesta ${tot.s} · aciertos sobre lo propuesto ${pct(tot.i, tot.c - tot.s)}`);
console.log(`Período fijo: ${fijo.n} guardias · ${fijo.i}/${fijo.c} (${pct(fijo.i, fijo.c)}) · sobre lo propuesto ${pct(fijo.i, fijo.c - fijo.s)}`);
console.log(`Estimado: ${estimado.n} guardias · ${estimado.i}/${estimado.c} (${pct(estimado.i, estimado.c)}) · sobre lo propuesto ${pct(estimado.i, estimado.c - estimado.s)}`);
for (const f of filas.sort((a, b) => b.comparadas - a.comparadas)) {
  const origen = resultados.find((r) => r.employeeId === f.id);
  const marca = origen?.estimado ? ` · ${origen.notaEstimado}` : '';
  console.log(`\n${f.nombre.slice(0, 30).padEnd(30)} ${pct(f.iguales, f.comparadas).padStart(6)} (${f.iguales}/${f.comparadas}) · ciclo ${f.ciclo}${marca} · continúa en ${f.continua || '—'}`);
  if (f.motivo) console.log(`   ${f.motivo}`);
  console.log(`   ${f.muestra}`);
}
const prop = resultados.flatMap((r) => r.propuestas.filter((c) => !c.isFranco).map((c) => ({ dateStr: c.dateStr, positionName: c.positionName, code: c.code })));
const sob = sobrantesPorDia(estructura, prop);
console.log(`\nAlertas: sobrados ${sob.length} turno·día; revisar ${resultados.reduce((a, r) => a + r.revisar.length, 0)}`);
const ultimos = previos.filter((t) => t.dateStr >= ymdDeIndex(diaIndex(primerDia) - 2)).map((t: any) => ({ employeeId: t.employeeId, code: t.code, startTime: t.startTime, endTime: t.endTime, hours: t.hours }));
const desc = alertasDescansoCambioMes(ultimos, resultados, primerDia);
console.log(`Descanso < 12 h en el cambio de mes: ${desc.length}`);
desc.forEach((d) => console.log(`   ${d.nombre}: ${d.texto}`));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ obj: OBJ, mes: MES, sla: vigente.id, total: tot, filas }, null, 2));
process.exit(0);
