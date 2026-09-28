/**
 * Lectura de turnos: el guardia solo ve los suyos, el admin su empresa,
 * el client_user su cliente. El portal (hero/historial) consulta por employeeId.
 *
 *   node scripts/eval-turnos-read-rules-e2e.mjs
 *
 * Emulador Firestore :8080. Proyecto aislado: no pisa el lab.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT = 'demo-i1-turnos-read';
const EMP_A = 'emp_a';
const EMP_B = 'emp_b';

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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

function fieldEq(field, value) {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: 'EQUAL',
      value: { stringValue: value },
    },
  };
}

function fieldGteTs(field, iso) {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: 'GREATER_THAN_OR_EQUAL',
      value: { timestampValue: iso },
    },
  };
}

function fieldLteTs(field, iso) {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: 'LESS_THAN_OR_EQUAL',
      value: { timestampValue: iso },
    },
  };
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
    async get(token, docPath) {
      const res = await fetch(`${base}/${docPath}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    async query(token, filters) {
      const structuredQuery = { from: [{ collectionId: 'turnos' }] };
      if (filters.length === 1) structuredQuery.where = filters[0];
      else if (filters.length > 1) {
        structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
      }
      const res = await fetch(`${base}:runQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ structuredQuery }),
      });
      const text = await res.text();
      return { status: res.status, text };
    },
  };
}

async function uploadRules(project, content) {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${project}:securityRules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!res.ok) throw new Error(`rules: ${res.status} ${await res.text()}`);
}

async function clearData(project) {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    console.warn(`clear ${res.status}: ${body.slice(0, 180)}`);
  }
}

function queryPermitted(result) {
  if (!allowed(result.status)) return false;
  return !/PERMISSION_DENIED|permission-denied/i.test(result.text);
}

const allowed = (status) => status >= 200 && status < 300;

async function run() {
  const rules = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
  await clearData(PROJECT);
  await uploadRules(PROJECT, rules);
  const c = makeClient(PROJECT);

  const guardUid = 'uid_guardia';
  const legajoId = 'legajo_guardia';
  const adminUid = 'uid_admin_a';
  const clientUid = 'uid_cliente';
  const otherLegajo = 'legajo_otra';

  await c.seed(`empresas/${EMP_A}`, { nombre: 'Empresa A', migracionCompleta: true });
  await c.seed(`empresas/${EMP_B}`, { nombre: 'Empresa B', migracionCompleta: true });
  await c.seed(`system_users/${adminUid}`, { uid: adminUid, role: 'admin', empresaId: EMP_A });
  await c.seed(`empleados/${legajoId}`, { uid: guardUid, empresaId: EMP_A, firstName: 'Ana', lastName: 'Guardia' });
  await c.seed(`empleados/${otherLegajo}`, { uid: 'uid_otra', empresaId: EMP_B, firstName: 'Otra', lastName: 'Empresa' });
  await c.seed(`client_users/${clientUid}`, { clientId: 'cli_a', empresaId: EMP_A, nombre: 'Portal cliente' });

  const start = new Date('2026-09-28T11:00:00.000Z');
  const own = {
    empresaId: EMP_A,
    employeeId: legajoId,
    clientId: 'cli_a',
    objectiveId: 'obj_a',
    code: 'M',
    startTime: start,
    endTime: new Date('2026-09-28T19:00:00.000Z'),
  };
  const other = {
    empresaId: EMP_B,
    employeeId: otherLegajo,
    clientId: 'cli_b',
    objectiveId: 'obj_b',
    code: 'N',
    startTime: start,
    endTime: new Date('2026-09-28T19:00:00.000Z'),
  };
  await c.seed('turnos/t_propio', own);
  await c.seed('turnos/t_otra_empresa', other);
  await c.seed('turnos/t_uid', { ...own, employeeId: guardUid });

  const guard = fakeToken(PROJECT, guardUid, { role: 'employee', type: 'employee', empresaId: EMP_A });
  const admin = fakeToken(PROJECT, adminUid, { role: 'admin', empresaId: EMP_A });
  const client = fakeToken(PROJECT, clientUid, { role: 'client', type: 'client_user', empresaId: EMP_A });

  const cases = [];
  const check = async (label, expectAllow, status) => {
    const ok = allowed(status) === expectAllow;
    cases.push({ label, ok, status, expectAllow });
    console.log(`${ok ? 'OK' : 'FALLA'}\t${label}\t${status} (esperado ${expectAllow ? 'PERMITIDO' : 'DENEGADO'})`);
  };

  await check('guardia lee su turno (employeeId = legajo)', true, await c.get(guard, 'turnos/t_propio'));
  await check('guardia no lee turno de otra empresa', false, await c.get(guard, 'turnos/t_otra_empresa'));
  await check('guardia lee turno con employeeId = uid (portal)', true, await c.get(guard, 'turnos/t_uid'));

  const hero = await c.query(guard, [
    fieldEq('employeeId', legajoId),
    fieldGteTs('startTime', '2026-09-01T00:00:00.000Z'),
    fieldLteTs('startTime', '2026-09-30T23:59:59.999Z'),
  ]);
  await check('portal hero/historial: query employeeId + startTime', true, queryPermitted(hero) ? 200 : 403);
  if (allowed(hero.status) && !hero.text.includes('t_propio')) {
    cases.push({ label: 'portal query trae el turno propio', ok: false, status: hero.status, expectAllow: true });
    console.log(`FALLA\tportal query trae el turno propio\tno está t_propio`);
  } else if (allowed(hero.status) && hero.text.includes('t_otra_empresa')) {
    cases.push({ label: 'portal query no trae otra empresa', ok: false, status: hero.status, expectAllow: true });
    console.log('FALLA\tportal query no trae otra empresa');
  } else if (allowed(hero.status)) {
    console.log('OK\tportal query trae el propio y no la otra empresa');
  }

  const byUid = await c.query(guard, [fieldEq('employeeId', guardUid)]);
  await check('portal segunda clave: query employeeId = uid', true, queryPermitted(byUid) ? 200 : 403);

  const ajeno = await c.query(guard, [fieldEq('employeeId', otherLegajo)]);
  await check('guardia no lista turnos de otro legajo', false, queryPermitted(ajeno) ? 200 : 403);

  const all = await c.query(guard, []);
  await check('guardia no lista la colección completa', false, queryPermitted(all) ? 200 : 403);

  await check('admin de empresa lee turno de su empresa', true, await c.get(admin, 'turnos/t_propio'));
  await check('admin de empresa no lee otra empresa', false, await c.get(admin, 'turnos/t_otra_empresa'));

  await check('client_user lee turno de su cliente', true, await c.get(client, 'turnos/t_propio'));
  await check('client_user no lee otro cliente', false, await c.get(client, 'turnos/t_otra_empresa'));
  const byClient = await c.query(client, [fieldEq('clientId', 'cli_a')]);
  await check('client_user lista turnos de su clientId', true, queryPermitted(byClient) ? 200 : 403);

  await clearData(PROJECT);
  const failed = cases.filter((x) => !x.ok).length;
  const total = cases.length;
  console.log(`\n${failed === 0 ? '✓' : '✗'} reglas lectura turnos: ${total - failed}/${total}`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error('Error fatal:', e.message);
  process.exit(1);
});
