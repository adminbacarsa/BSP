/**
 * Cupo por género en servicios de eventos: el cupo de cada grupo (Hombres / Mujeres, o uno solo si es
 * Indistinto) se llena POR ORDEN DE ACEPTACIÓN en una transacción; los pendientes del grupo lleno se
 * cierran como «Cupo completo» con aviso a la app; sin género no se convoca en un servicio por género;
 * la cascada del hueco reconvoca al mismo grupo; la asignación directa cuenta al momento.
 *   firebase emulators:exec --only firestore,storage --config firebase.e2e-p2.json --project demo-ev-cupo "node scripts/eval-eventos-cupo-genero-emulator.mjs"
 * Antes: `npm run build` en apps/functions.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-cupo';
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore();

const { convocarEventualEvento } = requireFn('./lib/eventuales/planificacionEventuales.js');
const { respondEventoConvocatoria, noPuedoAsistirEventual } = requireFn('./lib/eventos/eventoPortalCallables.js');
const { assignGuardToEventAdmin } = requireFn('./lib/eventos/eventoAssignAdmin.js');
const { estadoCupoServicio } = requireFn('./lib/eventos/cupoEvento.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err), details: err?.details || null }; }
}
const ctxSuper = (uid = 'uid-coordinador') => ({ auth: { uid, token: { role: 'SuperAdmin' } }, rawRequest: { ip: '10.0.0.5', headers: {} } });
const ctxEventual = (uid, cuil) => ({ auth: { uid, token: { role: 'EVENTUAL', bolsaCuil: cuil } }, rawRequest: { ip: '10.0.0.9', headers: {} } });

function arParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, hora: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}
function jornadaDesde(startMs, horas) {
  const i = arParts(startMs);
  const f = arParts(startMs + horas * 3600000);
  return { fecha: i.fecha, horaInicio: i.hora, horaFin: f.hora, horas };
}

const EMPRESA = 'cg_emp';
function bolsa(cuil, extra) {
  return {
    cuil,
    nombre: extra.nombre,
    genero: extra.genero ?? '',
    disponibilidad: 'DISPONIBLE',
    empresasHabilitadas: [EMPRESA],
    credencialVencimiento: '2027-06-01',
    aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    domicilioGeo: { lat: -31.41, lon: -64.19 },
    confiabilidad: extra.confiabilidad ?? 5,
    uid: extra.uid,
    dni: cuil.slice(2, 10),
    mail: '',
    status: 'ACTIVE',
    marcos: { [EMPRESA]: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } },
  };
}
async function docsDe(coleccion, cuil) {
  const snap = await db.collection(coleccion).where('bolsaCuil', '==', cuil).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function sinNada(cuil) {
  const [t, c, a] = await Promise.all([docsDe('turnos', cuil), docsDe('contratos_eventuales', cuil), docsDe('arca_envios', cuil)]);
  return { ok: t.length === 0 && c.length === 0 && a.length === 0, detalle: `turnos=${t.length} contratos=${c.length} arca=${a.length}` };
}
async function sol(id) {
  return (await db.collection('solicitudes_evento').doc(id).get()).data() || {};
}
async function notifs(uid, type) {
  const snap = await db.collection('user_notifications').where('uid', '==', uid).get();
  return snap.docs.map((d) => d.data()).filter((n) => !type || n.type === type);
}

async function main() {
  const jornadaPg = jornadaDesde(Date.now() + 48 * 3600000, 6);
  const jornadaInd = jornadaDesde(Date.now() + 96 * 3600000, 6);
  const EVENTO = 'cg-evento';
  const SRV_PG = 'srv-puerta';
  const SRV_IND = 'srv-molinete';
  await db.collection('empresas').doc(EMPRESA).set({ nombre: 'Empresa CG', razonSocial: 'Empresa CG S.A.', cuit: '30111111118', centroControlEnabled: true });
  await db.collection('eventos').doc(EVENTO).set({
    empresaId: EMPRESA,
    nombre: 'Campus',
    clienteId: 'cg_cli',
    clienteNombre: 'Universidad',
    status: 'ACTIVE',
    servicios: [
      { id: SRV_PG, nombre: 'Puerta campus', fecha: jornadaPg.fecha, horaInicio: jornadaPg.horaInicio, horaFin: jornadaPg.horaFin, cupo: 3, cupoModo: 'POR_GENERO', cupoPorGenero: { M: 2, F: 1 } },
      { id: SRV_IND, nombre: 'Molinete', fecha: jornadaInd.fecha, horaInicio: jornadaInd.horaInicio, horaFin: jornadaInd.horaFin, cupo: 1, cupoModo: 'INDISTINTO', cupoPorGenero: null },
    ],
  });

  const H1 = '20111111119', H2 = '20222222228', H3 = '20333333337', H4 = '20123456786';
  const M1 = '27444444446', M2 = '27555555555', M3 = '27666666664';
  const S1 = '20777777773';
  const N1 = '20888888882', N2 = '27999999991';
  const fichas = [
    [H1, { nombre: 'Hombre, Uno', genero: 'M', uid: 'uid-h1' }],
    [H2, { nombre: 'Hombre, Dos', genero: 'M', uid: 'uid-h2' }],
    [H3, { nombre: 'Hombre, Tres', genero: 'M', uid: 'uid-h3', confiabilidad: 100 }],
    [H4, { nombre: 'Hombre, Cuatro', genero: 'M', uid: 'uid-h4', confiabilidad: 100 }],
    [M1, { nombre: 'Mujer, Una', genero: 'F', uid: 'uid-m1' }],
    [M2, { nombre: 'Mujer, Dos', genero: 'F', uid: 'uid-m2' }],
    [M3, { nombre: 'Mujer, Tres', genero: 'F', uid: 'uid-m3' }],
    [S1, { nombre: 'Sin, Dato', genero: '', uid: 'uid-s1' }],
    [N1, { nombre: 'Indi, Uno', genero: 'M', uid: 'uid-n1' }],
    [N2, { nombre: 'Indi, Sin', genero: '', uid: 'uid-n2' }],
  ];
  for (const [cuil, extra] of fichas) await db.collection('eventuales_bolsa').doc(cuil).set(bolsa(cuil, extra));

  const evPg = { eventoId: EVENTO, eventoNombre: 'Campus', servicioId: SRV_PG, servicioNombre: 'Puerta campus' };
  const evInd = { eventoId: EVENTO, eventoNombre: 'Campus', servicioId: SRV_IND, servicioNombre: 'Molinete' };
  const basePg = { empresaId: EMPRESA, evento: evPg, jornada: jornadaPg, clientId: 'cg_cli', clientName: 'Universidad', positionName: 'Puerta campus' };
  const baseInd = { empresaId: EMPRESA, evento: evInd, jornada: jornadaInd, clientId: 'cg_cli', clientName: 'Universidad', positionName: 'Molinete' };

  // ── 1) Sin especificar no se convoca a un servicio por género ──
  const convS = await intentar(() => convocarEventualEvento.run({ ...basePg, cuil: S1 }, ctxSuper()));
  report('por género: sin género en la ficha no se convoca (completar la ficha)', !convS.ok && convS.code === 'failed-precondition' && convS.details?.codigo === 'GENERO_SIN_ESPECIFICAR', convS.ok ? 'convocó' : `${convS.code} ${convS.details?.codigo || ''}`);

  // ── 2) Se puede convocar a más que el cupo: 3 hombres (cupo 2) y 3 mujeres (cupo 1) ──
  const convs = {};
  for (const cuil of [H1, H2, H3, M1, M2, M3]) {
    const r = await intentar(() => convocarEventualEvento.run({ ...basePg, cuil }, ctxSuper()));
    convs[cuil] = r;
  }
  const todasOk = Object.values(convs).every((r) => r.ok);
  const solH1 = todasOk ? await sol(convs[H1].value.solicitudId) : {};
  const solM1 = todasOk ? await sol(convs[M1].value.solicitudId) : {};
  report('convocar más que el cupo: 6 convocatorias pendientes con genero y cupoGrupo', todasOk && solH1.status === 'convocado' && solH1.genero === 'M' && solH1.cupoGrupo === 'M' && solM1.cupoGrupo === 'F', todasOk ? `H1=${solH1.cupoGrupo} M1=${solM1.cupoGrupo}` : Object.values(convs).map((r) => r.message).join(' | '));
  const estado0 = await estadoCupoServicio(db, EVENTO, SRV_PG);
  report('estado inicial: Hombres 0/2 · Mujeres 0/1', estado0?.grupos?.length === 2 && estado0.grupos.every((g) => g.ocupados === 0) && estado0.cupo === 3, JSON.stringify(estado0?.grupos?.map((g) => `${g.grupo} ${g.ocupados}/${g.cupo}`)));

  // ── 3) Tres hombres aceptan a la vez: quedan los dos primeros, el tercero recibe «Cupo completo» ──
  const carreras = await Promise.all([H1, H2, H3].map((cuil) => intentar(() => respondEventoConvocatoria.run({ solicitudId: convs[cuil].value.solicitudId, accept: true }, ctxEventual(fichas.find((f) => f[0] === cuil)[1].uid, cuil)))));
  const aceptados = carreras.filter((r) => r.ok && r.value?.status === 'aprobada');
  const rechazadosPorCupo = carreras.filter((r) => !r.ok && r.code === 'failed-precondition' && r.details?.codigo === 'CUPO_COMPLETO');
  const solsH = await Promise.all([H1, H2, H3].map((c) => sol(convs[c].value.solicitudId)));
  const turnosH = (await Promise.all([H1, H2, H3].map((c) => docsDe('turnos', c)))).map((t) => t.length);
  const contratosH = (await Promise.all([H1, H2, H3].map((c) => docsDe('contratos_eventuales', c)))).map((t) => t.length);
  const perdedor = [H1, H2, H3][solsH.findIndex((s) => s.status === 'cupo_completo')];
  const nadaPerdedor = perdedor ? await sinNada(perdedor) : { ok: false, detalle: 'sin perdedor' };
  report(
    'aceptaciones concurrentes: exactamente 2 aprobadas y 1 cupo_completo (transacción)',
    aceptados.length === 2 && rechazadosPorCupo.length === 1 && solsH.filter((s) => s.status === 'aprobada').length === 2 && solsH.filter((s) => s.status === 'cupo_completo').length === 1
      && turnosH.reduce((a, b) => a + b, 0) === 2 && contratosH.reduce((a, b) => a + b, 0) === 2 && nadaPerdedor.ok,
    `ok=${aceptados.length} cupo=${rechazadosPorCupo.length} status=${solsH.map((s) => s.status).join(',')} turnos=${turnosH.join(',')} ${nadaPerdedor.detalle}`,
  );
  const turnoGanador = (await docsDe('turnos', [H1, H2, H3].find((c) => c !== perdedor)))[0] || {};
  report('el turno EV lleva cupoGrupo M y genero M (para la cascada)', turnoGanador.cupoGrupo === 'M' && turnoGanador.genero === 'M' && turnoGanador.code === 'EV', `grupo=${turnoGanador.cupoGrupo}`);
  const estadoH = await estadoCupoServicio(db, EVENTO, SRV_PG);
  const gH = estadoH.grupos.find((g) => g.grupo === 'M');
  const gF = estadoH.grupos.find((g) => g.grupo === 'F');
  report('contadores: Hombres 2/2 completo · Mujeres 0/1', gH.ocupados === 2 && gH.completo === true && gF.ocupados === 0 && gF.completo === false && estadoH.completo === false, `H ${gH.ocupados}/${gH.cupo} F ${gF.ocupados}/${gF.cupo}`);
  const convH4 = await intentar(() => convocarEventualEvento.run({ ...basePg, cuil: H4 }, ctxSuper()));
  report('grupo lleno: no se convocan más hombres (CUPO_COMPLETO)', !convH4.ok && convH4.code === 'failed-precondition' && convH4.details?.codigo === 'CUPO_COMPLETO', convH4.ok ? 'convocó' : `${convH4.details?.codigo || convH4.message}`);

  // ── 4) Una mujer acepta: las otras dos pendientes se cierran solas como «Cupo completo» con aviso ──
  const acM1 = await intentar(() => respondEventoConvocatoria.run({ solicitudId: convs[M1].value.solicitudId, accept: true }, ctxEventual('uid-m1', M1)));
  const solM2 = await sol(convs[M2].value.solicitudId);
  const solM3 = await sol(convs[M3].value.solicitudId);
  const avisoM2 = await notifs('uid-m2', 'EVENTO_CUPO_COMPLETO');
  const avisoM3 = await notifs('uid-m3', 'EVENTO_CUPO_COMPLETO');
  const nadaM2 = await sinNada(M2);
  report(
    'grupo se llena: pendientes del grupo pasan a cupo_completo, sin venceAt, aviso «Ya se cubrió el cupo, gracias»',
    acM1.ok && solM2.status === 'cupo_completo' && solM3.status === 'cupo_completo' && !solM2.venceAt && !!solM2.cupoCerradoAt && solM2.cupoGrupo === 'F'
      && avisoM2.length === 1 && /Ya se cubrió el cupo, gracias/.test(avisoM2[0].body) && avisoM2[0].title === 'Cupo completo' && avisoM3.length === 1 && nadaM2.ok,
    acM1.ok ? `M2=${solM2.status} M3=${solM3.status} avisos=${avisoM2.length}/${avisoM3.length} ${nadaM2.detalle}` : acM1.message,
  );
  const tardeM2 = await intentar(() => respondEventoConvocatoria.run({ solicitudId: convs[M2].value.solicitudId, accept: true }, ctxEventual('uid-m2', M2)));
  report('aceptar una cerrada por cupo no genera nada', !tardeM2.ok && tardeM2.code === 'failed-precondition' && (await sinNada(M2)).ok, tardeM2.ok ? 'aceptó' : tardeM2.message);
  const estadoLleno = await estadoCupoServicio(db, EVENTO, SRV_PG);
  report('contadores: Hombres 2/2 · Mujeres 1/1 → cupo completo', estadoLleno.completo === true && estadoLleno.ocupados === 3, JSON.stringify(estadoLleno.grupos.map((g) => `${g.grupo} ${g.ocupados}/${g.cupo}`)));

  // ── 5) Asignación directa de nómina cuenta al momento (grupo lleno → rechazo) ──
  await db.collection('empleados').doc('emp-h').set({ empresaId: EMPRESA, name: 'Nomina, Hombre', status: 'ACTIVE', genero: 'M', uid: 'uid-emp-h' });
  await db.collection('empleados').doc('emp-f').set({ empresaId: EMPRESA, name: 'Nomina, Mujer', status: 'ACTIVE', genero: 'F', uid: 'uid-emp-f' });
  await db.collection('empleados').doc('emp-x').set({ empresaId: EMPRESA, name: 'Nomina, Sin', status: 'ACTIVE', uid: 'uid-emp-x' });
  const directa = (empleadoId, nombre) => assignGuardToEventAdmin(db, {
    empresaId: EMPRESA, empleadoId, empleadoNombre: nombre, eventoId: EVENTO, eventoNombre: 'Campus', clienteId: 'cg_cli', clienteNombre: 'Universidad',
    servicioId: SRV_PG, servicioNombre: 'Puerta campus', servicioFecha: jornadaPg.fecha, horaInicio: jornadaPg.horaInicio, horaFin: jornadaPg.horaFin, horas: 6, respondidoPor: 'uid-coordinador',
  });
  const dirH = await intentar(() => directa('emp-h', 'Nomina, Hombre'));
  const dirX = await intentar(() => directa('emp-x', 'Nomina, Sin'));
  report('asignación directa: hombre con grupo lleno → CUPO_COMPLETO; sin género → GENERO_SIN_ESPECIFICAR', !dirH.ok && dirH.details?.codigo === 'CUPO_COMPLETO' && !dirX.ok && dirX.details?.codigo === 'GENERO_SIN_ESPECIFICAR', `${dirH.details?.codigo || dirH.message} / ${dirX.details?.codigo || dirX.message}`);

  // ── 6) Falta una mujer («No puedo asistir»): la cascada reconvoca MUJERES aunque haya un hombre con mejor confiabilidad ──
  const turnoM1 = (await docsDe('turnos', M1))[0] || {};
  const noVa = await intentar(() => noPuedoAsistirEventual.run({ solicitudId: convs[M1].value.solicitudId }, ctxEventual('uid-m1', M1)));
  const turnoM1b = (await db.collection('turnos').doc(turnoM1.id).get()).data() || {};
  const convCob = (await db.collection('convocatorias_cobertura').where('shiftId', '==', turnoM1.id).get()).docs.map((d) => d.data());
  const pendCob = convCob.find((c) => c.status === 'PENDING');
  const generoReconvocado = pendCob ? String(((await db.collection('eventuales_bolsa').doc(String(pendCob.bolsaCuil || '')).get()).data() || {}).genero || '') : '';
  report(
    'cascada por grupo: si falta una mujer se reconvoca una mujer (hueco cupoGrupo F)',
    noVa.ok && turnoM1b.employeeId === 'VACANTE' && turnoM1b.cupoGrupo === 'F' && pendCob?.type === 'EVENTUAL' && generoReconvocado === 'F' && pendCob.bolsaCuil !== H3,
    noVa.ok ? `vacante=${turnoM1b.employeeId} conv=${pendCob?.type || 'ninguna'} cuil=${pendCob?.bolsaCuil || ''} genero=${generoReconvocado}` : noVa.message,
  );
  const estadoTrasBaja = await estadoCupoServicio(db, EVENTO, SRV_PG);
  report('la baja libera el lugar del grupo: Mujeres 0/1', estadoTrasBaja.grupos.find((g) => g.grupo === 'F').ocupados === 0 && estadoTrasBaja.grupos.find((g) => g.grupo === 'M').ocupados === 2, JSON.stringify(estadoTrasBaja.grupos.map((g) => `${g.grupo} ${g.ocupados}/${g.cupo}`)));
  const dirF = await intentar(() => directa('emp-f', 'Nomina, Mujer'));
  const turnoF = dirF.ok ? (await db.collection('turnos').doc(dirF.value.turnoId).get()).data() || {} : {};
  report('asignación directa de una mujer entra en el lugar libre y el turno lleva cupoGrupo F', dirF.ok && turnoF.cupoGrupo === 'F' && turnoF.genero === 'F' && turnoF.employeeId === 'emp-f', dirF.ok ? `grupo=${turnoF.cupoGrupo}` : dirF.message);

  // ── 7) Indistinto: un solo cupo, sin especificar sí cuenta, el pendiente se cierra ──
  const convN1 = await intentar(() => convocarEventualEvento.run({ ...baseInd, cuil: N1 }, ctxSuper()));
  const convN2 = await intentar(() => convocarEventualEvento.run({ ...baseInd, cuil: N2 }, ctxSuper()));
  report('indistinto: se convoca con y sin género', convN1.ok && convN2.ok && (await sol(convN2.value.solicitudId)).cupoGrupo === 'TODOS', `${convN1.message || ''} ${convN2.message || ''}`);
  const carreraInd = await Promise.all([
    intentar(() => respondEventoConvocatoria.run({ solicitudId: convN1.value.solicitudId, accept: true }, ctxEventual('uid-n1', N1))),
    intentar(() => respondEventoConvocatoria.run({ solicitudId: convN2.value.solicitudId, accept: true }, ctxEventual('uid-n2', N2))),
  ]);
  const solN1 = await sol(convN1.value.solicitudId);
  const solN2 = await sol(convN2.value.solicitudId);
  const estadoInd = await estadoCupoServicio(db, EVENTO, SRV_IND);
  report(
    'indistinto: dos aceptan a la vez, queda uno (cupo 1) y el otro cupo_completo',
    carreraInd.filter((r) => r.ok).length === 1 && [solN1.status, solN2.status].sort().join(',') === 'aprobada,cupo_completo' && estadoInd.grupos.length === 1 && estadoInd.grupos[0].grupo === 'TODOS' && estadoInd.completo === true,
    `N1=${solN1.status} N2=${solN2.status} ${JSON.stringify(estadoInd.grupos.map((g) => `${g.grupo} ${g.ocupados}/${g.cupo}`))}`,
  );
  const audit = await db.collection('audit_logs').where('action', 'in', ['EVENTUAL_CONVOCADO_EVENTO', 'EVENTUAL_ACEPTO_EVENTO']).get();
  report('audit_logs de convocatorias y aceptaciones', audit.size >= 6, `n=${audit.size}`);

  const fallas = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fallas.length}/${results.length} OK`);
  if (fallas.length) {
    console.error('FALLAS:', fallas.map((f) => f.name).join(' | '));
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
