/**
 * Reglas `turnos`: una pestaña vieja no puede cerrar turnos con los motivos que P1 sacó del navegador.
 *
 * Corre contra el emulador de Firestore (:8080) bajo proyectos aislados, así que no pisa
 * las reglas ni los datos del lab. No necesita el emulador de Auth: usa el JWT sin firma
 * que el emulador acepta (mismo mecanismo que @firebase/rules-unit-testing).
 *
 * La misma batería corre con las reglas de `origin/main` y con las del working tree:
 * los motivos retirados tienen que pasar de permitido a denegado y todo lo demás
 * (cierre manual del CC, edición normal, fichada del guardia) tiene que quedar igual.
 *
 *   node scripts/eval-turnos-close-reason-rules-e2e.mjs
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT = 'demo-p1b-rules';
const EMPRESA = 'e_p1b';

const RETIRED = [
  'AUTO_SHIFT_END',
  'AUTO_SHIFT_END_CUSTOM',
  'AUTO_ZOMBIE_SHIFT_END',
  'AUTO_ZOMBIE_12H',
  'AUTO_COVERAGE_COMPLETE',
  'AUTO_OVERTIME_LIMIT',
  'AUTO_MANUAL_RETENTION_END',
  'AUTO_END_CF_RETENTION_TIMEOUT',
];

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** JWT sin firma: el emulador no valida la firma, solo lee los claims. */
function fakeToken(project, uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: 'none', typ: 'JWT' }),
    b64url({
      iss: `https://securetoken.google.com/${project}`,
      aud: project,
      sub: uid,
      user_id: uid,
      auth_time: now,
      iat: now,
      exp: now + 3600,
      firebase: { sign_in_provider: 'password', identities: {} },
      ...claims,
    }),
    '',
  ].join('.');
}

function toValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}

function makeClient(project) {
  const base = `http://${HOST}/v1/projects/${project}/databases/(default)/documents`;
  return {
    async seed(docPath, data) {
      const res = await fetch(`${base}/${docPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ fields: toFields(data) }),
      });
      if (!res.ok) throw new Error(`seed ${docPath}: ${res.status} ${await res.text()}`);
    },
    async update(token, docPath, patch) {
      const mask = Object.keys(patch).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
      const res = await fetch(`${base}/${docPath}?${mask}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: toFields(patch) }),
      });
      return res.status;
    },
    async create(token, collection, id, data) {
      const res = await fetch(`${base}/${collection}?documentId=${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: toFields(data) }),
      });
      return res.status;
    },
  };
}

async function uploadRules(project, content) {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${project}:securityRules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!res.ok) {
    throw new Error(
      `rules ${project}: ${res.status} ${await res.text()} (len=${content.length}, head=${JSON.stringify(content.slice(0, 30))})`,
    );
  }
}

const allowed = (status) => status >= 200 && status < 300;

/** Devuelve label → 'PERMITIDO' | 'DENEGADO' para cada escritura de la batería. */
async function runSuite(project, rulesContent) {
  await uploadRules(project, rulesContent);
  const c = makeClient(project);

  const adminUid = 'u_admin_p1b';
  const saUid = 'u_sa_p1b';
  const guardUid = 'u_guard_p1b';

  await c.seed(`empresas/${EMPRESA}`, { nombre: 'Empresa P1b', migracionCompleta: true });
  await c.seed(`system_users/${adminUid}`, { uid: adminUid, role: 'admin', empresaId: EMPRESA });
  await c.seed(`system_users/${saUid}`, { uid: saUid, role: 'SuperAdmin', empresaId: EMPRESA });
  await c.seed(`empleados/${guardUid}`, { uid: guardUid, empresaId: EMPRESA, firstName: 'Guardia', lastName: 'P1b' });

  const adminToken = fakeToken(project, adminUid, { role: 'admin', empresaId: EMPRESA });
  const saToken = fakeToken(project, saUid, { role: 'SuperAdmin', empresaId: EMPRESA });
  const guardToken = fakeToken(project, guardUid, { role: 'employee', empresaId: EMPRESA });

  const baseShift = {
    empresaId: EMPRESA,
    employeeId: guardUid,
    employeeName: 'Guardia P1b',
    objectiveId: 'obj_p1b',
    positionName: 'Puesto 1',
    code: 'M',
    status: 'PRESENT',
    isPresent: true,
    isCompleted: false,
    startTime: new Date('2026-09-27T10:00:00Z'),
    endTime: new Date('2026-09-27T18:00:00Z'),
  };

  const out = {};
  const record = async (label, fn) => {
    out[label] = allowed(await fn()) ? 'PERMITIDO' : 'DENEGADO';
  };

  for (const reason of RETIRED) {
    const id = `t_retired_${reason.toLowerCase()}`;
    await c.seed(`turnos/${id}`, baseShift);
    await record(`panel cierra con completionReason=${reason}`, () =>
      c.update(adminToken, `turnos/${id}`, {
        status: 'COMPLETED',
        isCompleted: true,
        isPresent: false,
        completionReason: reason,
        realEndTime: new Date('2026-09-27T18:00:00Z'),
      }));
  }

  await c.seed('turnos/t_autoclose', baseShift);
  await record('panel cierra con autoCloseReason=AUTO_OVERTIME_LIMIT', () =>
    c.update(adminToken, 'turnos/t_autoclose', {
      status: 'COMPLETED',
      isCompleted: true,
      autoCloseReason: 'AUTO_OVERTIME_LIMIT',
    }));

  await c.seed('turnos/t_sa', baseShift);
  await record('SuperAdmin del panel cierra con AUTO_ZOMBIE_SHIFT_END', () =>
    c.update(saToken, 'turnos/t_sa', { completionReason: 'AUTO_ZOMBIE_SHIFT_END' }));

  await record('panel crea turno con AUTO_SHIFT_END', () =>
    c.create(adminToken, 'turnos', 't_create_retired', { ...baseShift, completionReason: 'AUTO_SHIFT_END' }));

  await c.seed('turnos/t_manual', baseShift);
  await record('cierre manual del CC', () =>
    c.update(adminToken, 'turnos/t_manual', {
      status: 'COMPLETED',
      isCompleted: true,
      isPresent: false,
      realEndTime: new Date('2026-09-27T18:00:00Z'),
      checkoutNote: 'Salida manual operador',
    }));

  await c.seed('turnos/t_relevo', baseShift);
  await record('cierre con motivo vigente RELEVO_PRESENTE', () =>
    c.update(adminToken, 'turnos/t_relevo', {
      status: 'COMPLETED',
      isCompleted: true,
      completionReason: 'RELEVO_PRESENTE',
    }));

  await c.seed('turnos/t_legacy', { ...baseShift, completionReason: 'AUTO_ZOMBIE_SHIFT_END' });
  await record('editar turno que ya trae un motivo retirado viejo', () =>
    c.update(adminToken, 'turnos/t_legacy', { positionName: 'Puesto 2' }));

  await record('panel crea turno normal', () =>
    c.create(adminToken, 'turnos', 't_create_ok', baseShift));

  await c.seed('turnos/t_guardia', { ...baseShift, status: 'PENDING', isPresent: false });
  await record('guardia escribe turnos directo (ficha por callable)', () =>
    c.update(guardToken, 'turnos/t_guardia', {
      status: 'PRESENT',
      isPresent: true,
      checkInTime: new Date('2026-09-27T10:02:00Z'),
    }));

  await record('guardia escribe AUTO_COVERAGE_COMPLETE', () =>
    c.update(guardToken, 'turnos/t_guardia', { completionReason: 'AUTO_COVERAGE_COMPLETE' }));

  return out;
}

async function clearData(project) {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`clear ${project}: ${res.status} ${await res.text()}`);
}

async function run() {
  const nuevas = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
  const base = execFileSync('git', ['show', 'origin/main:firestore.rules'], { cwd: REPO, encoding: 'utf8' });

  // Mismo proyecto aislado para las dos pasadas: el emulador guarda un ruleset por proyecto.
  await clearData(PROJECT);
  const before = await runSuite(PROJECT, base);
  await clearData(PROJECT);
  const after = await runSuite(PROJECT, nuevas);
  await clearData(PROJECT);

  let failed = 0;
  for (const label of Object.keys(after)) {
    const esRetirado = label.includes('AUTO_');
    const esperado = esRetirado ? 'DENEGADO' : before[label];
    const ok = after[label] === esperado;
    if (!ok) failed++;
    const cambio = before[label] === after[label] ? 'sin cambio' : `${before[label]} → ${after[label]}`;
    console.log(`${ok ? 'OK' : 'FALLA'}\t${label}\t${after[label]} (${cambio})`);
  }

  console.log(`\n${failed === 0 ? '✓' : '✗'} reglas turnos motivos retirados: ${Object.keys(after).length - failed}/${Object.keys(after).length}`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error('Error fatal:', e.message);
  process.exit(1);
});
