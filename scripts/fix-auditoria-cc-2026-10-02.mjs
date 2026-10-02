/**
 * Auditoría CC 02/10/2026 (pruebas_sa) — corrección de datos. SOLO LECTURA por defecto.
 * Informe: docs/AUDITORIA-CC-2026-10-02.md §4
 *
 * ABALLAY (eventual 20334141463) faltó a T+30 en el evento «pumas» y el operador revirtió la
 * ausencia a las 12:41 con un `revertirAusencia` anterior a `0b3c286d`: el turno quedó presente
 * pero la falta no se deshizo (jornada sin pagar, AT quitados, contrato anulado, desempeño
 * FALTA_SIN_AVISO). Este script replica lo que hoy hace `deshacerEventualNoSePresento`.
 *
 *   node scripts/fix-auditoria-cc-2026-10-02.mjs
 *   node scripts/fix-auditoria-cc-2026-10-02.mjs --apply --allow-prod
 *   node scripts/fix-auditoria-cc-2026-10-02.mjs --apply --allow-prod --sin-arca   (no reencola el AT)
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowProd = args.includes('--allow-prod');
const sinArca = args.includes('--sin-arca');
const FIX_TAG = 'fix-auditoria-cc-2026-10-02';

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const EMPRESA = 'pruebas_sa';
const SHIFT_ID = 'YuSTKGsC91W9aksQ3lTb';
const CUIL = '20334141463';
const CONTRATO_ID = 'pruebas_sa_20334141463_2026-10';
const AT_VIVO = 'kTWqhnLUfGM2AQhXkWB7';
const AT_DUPLICADO = 'qpMd762lmZ5dQOi8pYFU';
const DESEMPENO_FALTA = `FALTA_SIN_AVISO_${SHIFT_ID}_${CUIL}`;
const DESEMPENO_TARDE = `LLEGADA_TARDE_SIN_AVISO_${SHIFT_ID}_${CUIL}`;

const ms = (v) => v?.toMillis?.() ?? 0;
const ar = (v) => (ms(v) ? new Date(ms(v) - 3 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') : '-');
const hmAr = (t) => ar(t).slice(11, 16);
const ops = [];
const pushPatch = (col, id, label, patch) => ops.push({ kind: 'update', col, id, label, patch });

const shiftSnap = await db.collection('turnos').doc(SHIFT_ID).get();
if (!shiftSnap.exists) { console.log('SKIP turno no existe'); process.exit(0); }
const shift = shiftSnap.data();
if (shift.empresaId !== EMPRESA || shift.bolsaCuil !== CUIL) { console.log('SKIP turno no es el esperado', shift.empresaId, shift.bolsaCuil); process.exit(1); }

const revertedMs = ms(shift.absenceRevertedAt);
const lateMinutes = Math.max(0, Math.round(Number(shift.lateMinutes) || 0));
const yaDeshecho = !shift.eventualNoSePresentoAt && shift.pagaJornada !== false && shift.noSePresento !== true;
console.log([
  yaDeshecho ? 'OK ' : 'FIX', SHIFT_ID, shift.employeeName, `status=${shift.status}`,
  `AA=${ar(shift.absenceDetectedAt || shift.absenceAt)}`, `revertida=${ar(shift.absenceRevertedAt)} por ${shift.absenceRevertedBy}`,
  `late=${lateMinutes}`, `pagaJornada=${shift.pagaJornada}`, `noSePresento=${shift.noSePresento}`,
  `isUnassigned=${shift.isUnassigned} isSinCobertura=${shift.isSinCobertura} vacanteEscalada=${shift.vacanteEscalada}`,
  `excluir=${JSON.stringify(shift.excluirBolsaCuils || [])}`,
].join(' | '));

if (yaDeshecho) {
  console.log('Nada que corregir: la falta ya está deshecha.');
} else {
  if (!revertedMs || shift.isAbsent === true) { console.log('   → no se toca: el turno no está revertido'); process.exit(1); }
  const revertedAt = Timestamp.fromMillis(revertedMs);
  const actor = String(shift.absenceRevertedBy || 'OPERACIONES');
  const nota = `Ausencia revertida por el operador: ingresó ${hmAr(shift.absenceRevertedAt)}${lateMinutes > 0 ? ` (${lateMinutes} min tarde)` : ''}.`;

  pushPatch('turnos', SHIFT_ID, `${shift.employeeName} deshacer falta eventual`, {
    noSePresento: FieldValue.delete(),
    pagaJornada: true,
    eventualNoSePresentoAt: FieldValue.delete(),
    eventualNoSePresentoMotivo: FieldValue.delete(),
    eventualArcaAccion: FieldValue.delete(),
    eventualDesempeno: FieldValue.delete(),
    eventualNoSePresentoRevertidoAt: revertedAt,
    eventualNoSePresentoRevertidoPor: actor,
    eventualArcaReversion: sinArca ? 'SIN_AT' : 'AT_REENCOLADO',
    excluirBolsaCuils: FieldValue.arrayRemove(CUIL),
    isUnassigned: false,
    isSinCobertura: false,
    vacanteEscalada: false,
    isDescubierto: FieldValue.delete(),
    correctedBy: FIX_TAG,
    correctionNote: 'revertirAusencia (código previo a 0b3c286d) no deshizo aplicarEventualNoSePresento.',
    correctedAt: FieldValue.serverTimestamp(),
  });

  const envios = await db.collection('arca_envios').where('contratoIds', 'array-contains', CONTRATO_ID).get();
  for (const d of envios.docs) {
    const r = d.data();
    console.log(`   AT ${d.id} tipo=${r.tipo} estado=${r.estado} canal=${r.canal} quitado=${r.quitadoDelLote} ${r.quitadoMotivo || ''} ${r.canceladoMotivo || ''} creado=${ar(r.createdAt)}`);
  }
  const vivo = envios.docs.find((d) => d.id === AT_VIVO);
  const dup = envios.docs.find((d) => d.id === AT_DUPLICADO);
  if (vivo && vivo.data().quitadoDelLote === true && vivo.data().estado !== 'CONFIRMADO') {
    if (sinArca) {
      console.log(`   AT ${AT_VIVO} se deja quitado (--sin-arca)`);
    } else {
      pushPatch('arca_envios', AT_VIVO, 'AT URGENTE reencolado por reversión', {
        quitadoDelLote: false,
        quitadoMotivo: FieldValue.delete(),
        canceladoMotivo: FieldValue.delete(),
        canal: 'URGENTE',
        estado: 'PENDIENTE',
        urgentePorReversion: true,
        reencoladoAt: FieldValue.serverTimestamp(),
        reencoladoMotivo: 'AUSENCIA_REVERTIDA',
        correctedBy: FIX_TAG,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  if (dup && dup.data().quitadoMotivo !== 'DUPLICADO') {
    pushPatch('arca_envios', AT_DUPLICADO, 'AT gemelo marcado DUPLICADO', {
      quitadoDelLote: true,
      quitadoMotivo: 'DUPLICADO',
      correctedBy: FIX_TAG,
      correctionNote: `Creado el mismo segundo que ${AT_VIVO} (sincronizarContratoEventual corrió dos veces).`,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const contratoSnap = await db.collection('contratos_eventuales').doc(CONTRATO_ID).get();
  if (contratoSnap.exists) {
    const c = contratoSnap.data();
    console.log(`   CONTRATO estado=${c.estado} status=${c.status} jornadas=${(c.jornadas || []).length} cierre=${c.cierre?.motivo || '-'}`);
    const jornada = {
      fecha: String(shift.scheduleDate || '2026-10-02'),
      horaInicio: hmAr(shift.startTime),
      horaFin: hmAr(shift.endTime),
      horas: Number(shift.hours) || Math.round((ms(shift.endTime) - ms(shift.startTime)) / 3600e3),
    };
    const jornadas = (c.jornadas || []).filter(Boolean);
    const yaEsta = jornadas.some((j) => j.fecha === jornada.fecha && j.horaInicio === jornada.horaInicio);
    const nuevas = yaEsta ? jornadas : [...jornadas, jornada];
    if (c.estado !== 'CONFIRMADO' || !yaEsta) {
      ops.push({
        kind: 'set', col: 'contratos_eventuales', id: CONTRATO_ID, label: 'contrato reabierto CONFIRMADO con la jornada del 02/10',
        patch: {
          estado: 'CONFIRMADO',
          status: 'ACTIVE',
          jornadas: nuevas,
          fechaBaja: nuevas.map((j) => String(j.fecha || '')).sort().pop() || jornada.fecha,
          cierre: FieldValue.delete(),
          reabiertoAt: FieldValue.serverTimestamp(),
          reabiertoMotivo: 'AUSENCIA_REVERTIDA',
          correctedBy: FIX_TAG,
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  const anexoCod = await db.collection('anexo_codigos').doc(CONTRATO_ID).get();
  if (anexoCod.exists && anexoCod.data().sinEfecto === true) {
    ops.push({ kind: 'set', col: 'anexo_codigos', id: CONTRATO_ID, label: 'anexo_codigos reactivado', patch: { sinEfecto: false, sinEfectoAt: FieldValue.delete(), reactivadoAt: FieldValue.serverTimestamp(), correctedBy: FIX_TAG } });
  }
  const anexos = await db.collection('anexos_eventuales').where('contratoId', '==', CONTRATO_ID).get();
  for (const a of anexos.docs) {
    if (a.data().sinEfecto === true) {
      ops.push({ kind: 'set', col: 'anexos_eventuales', id: a.id, label: 'anexo reactivado', patch: { sinEfecto: false, sinEfectoAt: FieldValue.delete(), sinEfectoMotivo: FieldValue.delete(), reactivadoAt: FieldValue.serverTimestamp(), correctedBy: FIX_TAG } });
    }
  }

  const falta = await db.collection('guardia_desempeno_eventos').doc(DESEMPENO_FALTA).get();
  if (falta.exists) ops.push({ kind: 'delete', col: 'guardia_desempeno_eventos', id: DESEMPENO_FALTA, label: 'desempeño FALTA_SIN_AVISO borrado' });
  const tarde = await db.collection('guardia_desempeno_eventos').doc(DESEMPENO_TARDE).get();
  if (lateMinutes > 5 && !tarde.exists) {
    ops.push({
      kind: 'set', col: 'guardia_desempeno_eventos', id: DESEMPENO_TARDE, label: `desempeño LLEGADA_TARDE_SIN_AVISO (${lateMinutes} min)`,
      patch: {
        empleadoId: String(shift.employeeId || ''),
        bolsaCuil: CUIL,
        tipo: 'LLEGADA_TARDE_SIN_AVISO',
        fecha: String(shift.scheduleDate || '2026-10-02'),
        turnoId: SHIFT_ID,
        eventoId: shift.eventoId || null,
        empresaId: EMPRESA,
        esEventual: true,
        lateMinutes,
        revertidaDesdeFalta: true,
        correctedBy: FIX_TAG,
        createdAt: revertedAt,
      },
    });
  }

  const novs = await db.collection('novedades').where('shiftId', '==', SHIFT_ID).where('type', '==', 'AUSENCIA_EVENTUAL').get();
  for (const n of novs.docs) {
    const r = n.data();
    console.log(`   NOVEDAD ${n.id} status=${r.status} resolved=${r.resolved}`);
    if (r.resolved === true) continue;
    pushPatch('novedades', n.id, 'AUSENCIA_EVENTUAL resuelta por la reversión', {
      status: 'ATENDIDA',
      resolved: true,
      resolvedAt: revertedAt,
      resolvedBy: actor,
      reversionNota: nota,
      description: `${String(r.description || '')} ${nota}`.trim(),
      correctedBy: FIX_TAG,
    });
  }

  ops.push({
    kind: 'add', col: 'audit_logs', label: 'audit DATA_FIX',
    patch: {
      action: 'DATA_FIX',
      module: 'OPERACIONES',
      empresaId: EMPRESA,
      shiftId: SHIFT_ID,
      employeeId: shift.employeeId || null,
      actorUid: 'SYSTEM',
      actorName: FIX_TAG,
      details: `Reversión de ABALLAY (12:41, ${actor}) completada a posteriori: jornada pagada, AT ${sinArca ? 'sin reencolar' : AT_VIVO + ' reencolado'}, contrato ${CONTRATO_ID} confirmado, desempeño FALTA_SIN_AVISO → LLEGADA_TARDE_SIN_AVISO.`,
      timestamp: FieldValue.serverTimestamp(),
    },
  });
}

console.log(`\n${ops.length} operación(es)${apply ? '' : ' (dryRun, no se escribe nada)'}:`);
for (const op of ops) console.log(` - ${op.kind} ${op.col}/${op.id || '(nuevo)'} — ${op.label}`);

if (!apply) process.exit(0);
if (!allowProd) { console.log('\nFalta --allow-prod: no se escribe en comtroldata.'); process.exit(1); }
for (const op of ops) {
  const col = db.collection(op.col);
  if (op.kind === 'update') await col.doc(op.id).update(op.patch);
  else if (op.kind === 'set') await col.doc(op.id).set(op.patch, { merge: true });
  else if (op.kind === 'delete') await col.doc(op.id).delete();
  else if (op.kind === 'add') await col.add(op.patch);
  console.log(`OK ${op.kind} ${op.col}/${op.id || ''}`);
}
console.log('Listo.');
