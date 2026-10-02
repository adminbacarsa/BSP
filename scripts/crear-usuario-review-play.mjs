/**
 * Usuario de revisión de Google Play en pruebas_sa.
 * dryRun por defecto: no toca Auth ni Firestore.
 *
 *   node scripts/crear-usuario-review-play.mjs
 *   node scripts/crear-usuario-review-play.mjs --apply --allow-prod
 *
 * La clave se genera al aplicar y se imprime una sola vez. No se guarda en el repo.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVIEW_EMAIL = 'cosp@bacarsa.com.ar';
export const REVIEW_EMPRESA = 'pruebas_sa';
export const REVIEW_EMPLOYEE_ID = 'play_review_01';
export const REVIEW_FILE_NUMBER = 'PLAY-01';
export const REVIEW_CLIENT_ID = 'client_play_review';
export const REVIEW_OBJECTIVE_ID = 'obj_play_review';
export const REVIEW_SHIFT_DAYS = 30;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function arParts(date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-')
    .map(Number);
  return { y, m, d };
}

export function addCalendarDays(y, m, d, n) {
  const utc = new Date(Date.UTC(y, m - 1, d + n));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

/** 07:00–15:00 hora Argentina (UTC−3). */
export function morningShiftBounds(y, m, d) {
  return {
    start: new Date(Date.UTC(y, m - 1, d, 10, 0, 0)),
    end: new Date(Date.UTC(y, m - 1, d, 18, 0, 0)),
  };
}

export function reviewDays(from = new Date(), count = REVIEW_SHIFT_DAYS) {
  const start = arParts(from);
  const days = [];
  for (let i = 0; i < count; i++) days.push(addCalendarDays(start.y, start.m, start.d, i));
  return days;
}

export function reviewMonths(days) {
  const seen = new Set();
  const months = [];
  for (const day of days) {
    const key = `${day.y}-${day.m}`;
    if (seen.has(key)) continue;
    seen.add(key);
    months.push({ year: day.y, month: day.m });
  }
  return months;
}

/** Legajo de revisión. Sin clave. La excepción de dispositivo y la fichada remota son solo de este doc. */
export function buildReviewEmployee(uid) {
  return {
    uid,
    email: REVIEW_EMAIL,
    firstName: 'Review',
    lastName: 'Play',
    fileNumber: REVIEW_FILE_NUMBER,
    legajo: REVIEW_FILE_NUMBER,
    category: 'Vigilador',
    status: 'ACTIVE',
    empresaId: REVIEW_EMPRESA,
    laborAgreement: 'SUVICO',
    portalInvite: { sent: true },
    bypassDeviceCheck: true,
    fichadaRemota: true,
    reviewPlay: true,
  };
}

/** Objetivo de ejemplo: sin SLA y fuera del Centro de Control y de los crons. */
export function buildReviewObjective() {
  return {
    id: REVIEW_OBJECTIVE_ID,
    name: 'Objetivo Revisión Play',
    empresaId: REVIEW_EMPRESA,
    clientId: REVIEW_CLIENT_ID,
    clientName: 'Cliente Revisión Play',
    address: 'Objetivo de prueba para la revisión de Google Play',
    lat: -31.4201,
    lng: -64.1888,
    active: true,
    status: 'ACTIVE',
    allowRemoteCheckIn: false,
    excluirDeOperacion: true,
    reviewPlay: true,
  };
}

export function buildReviewClient() {
  const objective = buildReviewObjective();
  return {
    name: 'Cliente Revisión Play',
    empresaId: REVIEW_EMPRESA,
    status: 'ACTIVE',
    active: true,
    reviewPlay: true,
    excluirDeOperacion: true,
    objetivos: [
      {
        id: objective.id,
        name: objective.name,
        active: true,
        status: 'ACTIVE',
        address: objective.address,
        lat: objective.lat,
        lng: objective.lng,
        allowRemoteCheckIn: false,
        excluirDeOperacion: true,
      },
    ],
  };
}

function ymd(day) {
  return `${day.y}${String(day.m).padStart(2, '0')}${String(day.d).padStart(2, '0')}`;
}

function isDirectRun() {
  const argv = process.argv[1];
  if (!argv) return false;
  return path.resolve(argv) === fileURLToPath(import.meta.url);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const allowProd = process.argv.includes('--allow-prod');
  const days = reviewDays();
  const months = reviewMonths(days);

  console.log(`Usuario de revisión Play — ${apply ? 'APPLY' : 'dryRun'}`);
  console.log(`  empresa:     ${REVIEW_EMPRESA}`);
  console.log(`  email:       ${REVIEW_EMAIL}`);
  console.log(`  legajo:      ${REVIEW_EMPLOYEE_ID} (${REVIEW_FILE_NUMBER})`);
  console.log(`  flags:       bypassDeviceCheck + fichadaRemota (solo este legajo)`);
  console.log(`  objetivo:    ${REVIEW_OBJECTIVE_ID} (excluirDeOperacion, sin SLA; geocerca normal)`);
  console.log(`  turnos M:    ${days.length} días desde ${ymd(days[0])} hasta ${ymd(days[days.length - 1])}`);
  console.log(`  publicados:  ${months.map((x) => `${x.year}-${x.month}`).join(', ')}`);
  console.log('  clave:       se genera al aplicar y se imprime una vez; no se guarda en el repo');

  if (!apply) {
    console.log('\ndryRun: no se escribió nada. Para crear: node scripts/crear-usuario-review-play.mjs --apply --allow-prod');
    return;
  }
  if (!allowProd) {
    console.error('Falta --allow-prod. No se escribió nada.');
    process.exit(1);
  }

  const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
  const admin = requireFn('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
  }
  const db = admin.firestore();
  const auth = admin.auth();
  const { FieldValue, Timestamp } = admin.firestore;

  const empresa = await db.collection('empresas').doc(REVIEW_EMPRESA).get();
  if (!empresa.exists) {
    console.error(`No existe empresas/${REVIEW_EMPRESA}. No se escribió nada.`);
    process.exit(1);
  }

  const password = crypto.randomBytes(18).toString('base64url');
  let uid;
  try {
    const existing = await auth.getUserByEmail(REVIEW_EMAIL);
    uid = existing.uid;
    await auth.updateUser(uid, { password, displayName: 'Review Play' });
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
    const created = await auth.createUser({
      email: REVIEW_EMAIL,
      password,
      displayName: 'Review Play',
      emailVerified: true,
    });
    uid = created.uid;
  }
  await auth.setCustomUserClaims(uid, { role: 'employee', type: 'employee' });

  await db.collection('empleados').doc(REVIEW_EMPLOYEE_ID).set(
    { ...buildReviewEmployee(uid), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection('clients').doc(REVIEW_CLIENT_ID).set(buildReviewClient(), { merge: true });
  await db.collection('objetivos').doc(REVIEW_OBJECTIVE_ID).set(buildReviewObjective(), { merge: true });

  for (const day of days) {
    const bounds = morningShiftBounds(day.y, day.m, day.d);
    await db.collection('turnos').doc(`play_review_m_${ymd(day)}`).set(
      {
        employeeId: REVIEW_EMPLOYEE_ID,
        employeeName: 'Play, Review',
        empresaId: REVIEW_EMPRESA,
        clientId: REVIEW_CLIENT_ID,
        clientName: 'Cliente Revisión Play',
        objectiveId: REVIEW_OBJECTIVE_ID,
        objectiveName: 'Objetivo Revisión Play',
        positionName: 'Puesto Revisión',
        code: 'M',
        status: 'Assigned',
        draft: false,
        isPresent: false,
        isCompleted: false,
        isAbsent: false,
        isFranco: false,
        excluirDeOperacion: true,
        startTime: Timestamp.fromDate(bounds.start),
        endTime: Timestamp.fromDate(bounds.end),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  for (const month of months) {
    const payload = {
      objetivoId: REVIEW_OBJECTIVE_ID,
      objectiveId: REVIEW_OBJECTIVE_ID,
      empresaId: REVIEW_EMPRESA,
      año: month.year,
      mes: month.month,
      year: month.year,
      month: month.month,
      publishedAt: FieldValue.serverTimestamp(),
      publishedBy: 'play-review-script',
    };
    const ids = [
      `${REVIEW_EMPRESA}_${REVIEW_OBJECTIVE_ID}_${month.year}_${month.month}`,
      `${REVIEW_OBJECTIVE_ID}_${month.year}_${month.month}`,
    ];
    for (const id of ids) {
      await db.collection('planificacion_estados').doc(id).set(payload, { merge: true });
    }
  }

  console.log('\nListo. Copiá la clave ahora: no queda guardada en ningún archivo.');
  console.log(`EMAIL ${REVIEW_EMAIL}`);
  console.log(`CLAVE ${password}`);
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
