/**
 * isAdmin() solo staff explicito. Emulador aislado (no publica reglas).
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8497 node scripts/eval-reglas-admin-e2e.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8497';
const PROJECT = 'demo-reglas-admin';

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

function makeClient(project) {
  const base = `http://${HOST}/v1/projects/${project}/databases/(default)/documents`;
  const call = async (token, url, method, body) => {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.status;
  };
  return {
    async seed(docPath, data) {
      const res = await fetch(`${base}/${docPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ fields: toFields(data) }),
      });
      if (!res.ok) throw new Error(`seed ${docPath}: ${res.status} ${await res.text()}`);
    },
    get: (token, docPath) => call(token, `${base}/${docPath}`, 'GET'),
    async update(token, docPath, patch) {
      const mask = Object.keys(patch).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
      return call(token, `${base}/${docPath}?${mask}`, 'PATCH', { fields: toFields(patch) });
    },
    create: (token, collection, id, data) =>
      call(token, `${base}/${collection}?documentId=${encodeURIComponent(id)}`, 'POST', { fields: toFields(data) }),
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
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`clear: ${res.status} ${await res.text()}`);
}

const ok = (status) => status >= 200 && status < 300;

async function run() {
  const rules = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
  await clearData(PROJECT);
  await uploadRules(PROJECT, rules);
  const c = makeClient(PROJECT);

  const A = 'empA';
  const B = 'empB';
  await c.seed(`empresas/${A}`, { nombre: 'A', migracionCompleta: true });
  await c.seed(`empresas/${B}`, { nombre: 'B', migracionCompleta: true });
  await c.seed('system_users/uA', { role: 'OPERADOR', empresaId: A });
  await c.seed('system_users/uB', { role: 'SEGP', empresaId: B });
  await c.seed('system_users/uDoc', { role: 'OPERADOR', empresaId: A });
  await c.seed('system_users/uSa', { role: 'SUPERADMIN', empresaId: '' });
  await c.seed('empleados/legG', { uid: 'uG', empresaId: A, firstName: 'Guardia' });
  await c.seed('empleados/legE', { uid: 'uE', empresaId: A, bolsaCuil: '20111111112', firstName: 'Eventual' });
  await c.seed('empleados/legB', { uid: 'otro', empresaId: B, firstName: 'B' });
  await c.seed('clients/cA', { empresaId: A, name: 'Cliente A' });
  await c.seed('clients/cB', { empresaId: B, name: 'Cliente B' });
  await c.seed('objetivos/oA', { empresaId: A, name: 'Objetivo A' });
  await c.seed('clientes/kA', { empresaId: A, name: 'Legacy A' });
  await c.seed('client_users/uC', { clientId: 'cA', empresaId: A });
  const shift = (empresaId, employeeId, clientId) => ({
    empresaId, employeeId, clientId, code: 'M', status: 'PENDING',
    startTime: new Date('2026-10-02T10:00:00Z'),
    endTime: new Date('2026-10-02T18:00:00Z'),
  });
  await c.seed('turnos/tA', shift(A, 'legX', 'cX'));
  await c.seed('turnos/tB', shift(B, 'legB', 'cB'));
  await c.seed('turnos/tG', shift(A, 'legG', 'cA'));
  await c.seed('turnos/tE', shift(A, 'legE', 'cA'));
  await c.seed('ausencias/aA', { empresaId: A, employeeId: 'legG', type: 'AA' });
  await c.seed('ausencias/aB', { empresaId: B, employeeId: 'legB', type: 'AA' });
  await c.seed('sesiones_operador/sA', { empresaId: A, operatorId: 'uA', status: 'ACTIVO' });
  await c.seed('sesiones_operador/sB', { empresaId: B, operatorId: 'uB', status: 'ACTIVO' });
  await c.seed('eventuales_bolsa/20111111112', { nombre: 'Eventual', grupoId: 'g1' });
  await c.seed('arca_envios/env1', { empresaId: A, status: 'LISTO' });
  await c.seed('guardia_puntaje/legG', { empresaId: A, total: 80 });
  await c.seed('guardia_puntaje/legB', { empresaId: B, total: 10 });
  await c.seed('escalas_salariales/esc1', { status: 'ACTIVE', vigenciaDesde: '2026-06-01' });
  await c.seed('escalas_cct/cct1', { empresaId: A });
  await c.seed('hours_ledger/hA', { empresaId: A });
  await c.seed('hours_ledger/hB', { empresaId: B });
  await c.seed('hours_ledger_monthly/hmA', { empresaId: A });
  await c.seed('hours_ledger_dirty/hdA', { empresaId: A });
  await c.seed('hours_ledger_jobs/hjA', { empresaId: A });

  const tok = {
    a: fakeToken(PROJECT, 'uA', { role: 'OPERADOR', type: 'SYSTEM' }),
    b: fakeToken(PROJECT, 'uB', { role: 'SEGP', type: 'SYSTEM' }),
    doc: fakeToken(PROJECT, 'uDoc', {}),
    segp: fakeToken(PROJECT, 'uSegp', { role: 'SEGP' }),
    op: fakeToken(PROJECT, 'uOp', { role: 'OPERADOR' }),
    sa: fakeToken(PROJECT, 'uSa', { role: 'SUPERADMIN' }),
    g: fakeToken(PROJECT, 'uG', { role: 'employee', type: 'employee', empresaId: A }),
    e: fakeToken(PROJECT, 'uE', { role: 'EVENTUAL', type: 'eventual', bolsaCuil: '20111111112' }),
    c: fakeToken(PROJECT, 'uC', { role: 'client', type: 'client_user' }),
    n: fakeToken(PROJECT, 'uN', {}),
    h: fakeToken(PROJECT, 'uH', { role: 'HACKER' }),
  };

  const checks = [];
  const add = (name, status, allow) => checks.push({ name, status, allow, pass: ok(status) === allow });

  add('staff A lee turno A', await c.get(tok.a, 'turnos/tA'), true);
  add('staff A no lee turno B', await c.get(tok.a, 'turnos/tB'), false);
  add('staff A escribe turno A', await c.update(tok.a, 'turnos/tA', { positionName: 'P2' }), true);
  add('staff A no escribe turno B', await c.update(tok.a, 'turnos/tB', { positionName: 'P2' }), false);
  add('staff sin claim lee A por system_users', await c.get(tok.doc, 'turnos/tA'), true);
  add('staff sin claim no lee B', await c.get(tok.doc, 'turnos/tB'), false);
  add('SEGP sin doc lee bolsa', await c.get(tok.segp, 'eventuales_bolsa/20111111112'), true);
  add('SEGP sin doc no lee turno A', await c.get(tok.segp, 'turnos/tA'), false);
  add('OPERADOR sin doc lee bolsa', await c.get(tok.op, 'eventuales_bolsa/20111111112'), true);
  add('rol desconocido no lee bolsa', await c.get(tok.h, 'eventuales_bolsa/20111111112'), false);
  add('SuperAdmin lee A y B', await c.get(tok.sa, 'turnos/tA'), true);
  add('SuperAdmin lee B', await c.get(tok.sa, 'turnos/tB'), true);
  add('SuperAdmin escribe B', await c.update(tok.sa, 'turnos/tB', { positionName: 'PB' }), true);

  add('guardia lee su turno', await c.get(tok.g, 'turnos/tG'), true);
  add('guardia no lee turno ajeno', await c.get(tok.g, 'turnos/tA'), false);
  add('guardia no escribe turno', await c.update(tok.g, 'turnos/tG', { positionName: 'X' }), false);
  add('guardia lee ausencia', await c.get(tok.g, 'ausencias/aA'), true);

  add('eventual lee su turno', await c.get(tok.e, 'turnos/tE'), true);
  add('eventual no lee turno ajeno', await c.get(tok.e, 'turnos/tG'), false);
  add('eventual no escribe turno', await c.update(tok.e, 'turnos/tE', { positionName: 'X' }), false);
  add('eventual lee clients', await c.get(tok.e, 'clients/cA'), true);
  add('eventual lee objetivos', await c.get(tok.e, 'objetivos/oA'), true);
  add('eventual lee clientes', await c.get(tok.e, 'clientes/kA'), true);
  add('eventual no escribe clients', await c.update(tok.e, 'clients/cA', { name: 'Hack' }), false);
  add('eventual no escribe objetivos', await c.update(tok.e, 'objetivos/oA', { name: 'Hack' }), false);
  add('eventual ata uid del legajo', await c.update(tok.e, 'empleados/legE', { uid: 'uE' }), true);
  add('eventual no lee bolsa', await c.get(tok.e, 'eventuales_bolsa/20111111112'), false);
  add('eventual no escribe bolsa', await c.create(tok.e, 'eventuales_bolsa', '20999999999', { nombre: 'X' }), false);

  add('cliente lee su cliente', await c.get(tok.c, 'clients/cA'), true);
  add('cliente no lee otro cliente', await c.get(tok.c, 'clients/cB'), false);
  add('cliente lee turno de su cliente', await c.get(tok.c, 'turnos/tG'), true);
  add('cliente no lee turno de otro', await c.get(tok.c, 'turnos/tB'), false);
  add('cliente no escribe clients', await c.update(tok.c, 'clients/cA', { name: 'Hack' }), false);
  add('cliente lee legajo de su empresa', await c.get(tok.c, 'empleados/legG'), true);
  add('cliente no lee legajo de otra empresa', await c.get(tok.c, 'empleados/legB'), false);
  add('cliente no lee ausencias', await c.get(tok.c, 'ausencias/aA'), false);

  const nakedPaths = [
    'turnos/tA', 'empleados/legG', 'ausencias/aA', 'sesiones_operador/sA',
    'eventuales_bolsa/20111111112', 'arca_envios/env1', 'guardia_puntaje/legG',
    'escalas_salariales/esc1', 'escalas_cct/cct1', 'hours_ledger/hA',
    'hours_ledger_monthly/hmA', 'hours_ledger_dirty/hdA', 'hours_ledger_jobs/hjA',
    'clients/cA', 'objetivos/oA',
  ];
  for (const docPath of nakedPaths) {
    add(`sin claims no lee ${docPath}`, await c.get(tok.n, docPath), false);
  }

  add('staff A lee ausencia A', await c.get(tok.a, 'ausencias/aA'), true);
  add('staff A no lee ausencia B', await c.get(tok.a, 'ausencias/aB'), false);
  add('staff A lee su sesion', await c.get(tok.a, 'sesiones_operador/sA'), true);
  add('staff A no lee sesion B', await c.get(tok.a, 'sesiones_operador/sB'), false);
  add('staff A no crea sesion en B', await c.create(tok.a, 'sesiones_operador', 'sNew', {
    empresaId: B, operatorId: 'uA', status: 'ACTIVO',
  }), false);
  add('staff A lee bolsa', await c.get(tok.a, 'eventuales_bolsa/20111111112'), true);
  add('staff A no escribe bolsa', await c.create(tok.a, 'eventuales_bolsa', '20888888888', { nombre: 'N' }), false);
  add('SuperAdmin escribe bolsa', await c.create(tok.sa, 'eventuales_bolsa', '20777777777', { nombre: 'SA' }), true);
  add('staff A no lee arca', await c.get(tok.a, 'arca_envios/env1'), false);
  add('SuperAdmin lee arca', await c.get(tok.sa, 'arca_envios/env1'), true);
  add('nadie escribe arca', await c.update(tok.sa, 'arca_envios/env1', { status: 'X' }), false);
  add('staff A lee puntaje A', await c.get(tok.a, 'guardia_puntaje/legG'), true);
  add('staff A no lee puntaje B', await c.get(tok.a, 'guardia_puntaje/legB'), false);
  add('staff A no escribe puntaje', await c.update(tok.a, 'guardia_puntaje/legG', { total: 1 }), false);
  add('guardia no lee puntaje', await c.get(tok.g, 'guardia_puntaje/legG'), false);
  add('staff A lee escala salarial', await c.get(tok.a, 'escalas_salariales/esc1'), true);
  add('staff A no escribe escala', await c.update(tok.a, 'escalas_salariales/esc1', { status: 'INACTIVE' }), false);
  add('SuperAdmin escribe escala', await c.update(tok.sa, 'escalas_salariales/esc1', { status: 'ACTIVE' }), true);
  add('escalas_cct no tiene match', await c.get(tok.sa, 'escalas_cct/cct1'), false);
  add('staff A lee hours_ledger A', await c.get(tok.a, 'hours_ledger/hA'), true);
  add('staff A no lee hours_ledger B', await c.get(tok.a, 'hours_ledger/hB'), false);
  add('staff A no escribe hours_ledger', await c.update(tok.a, 'hours_ledger/hA', { empresaId: A }), false);
  add('staff A lee hours monthly', await c.get(tok.a, 'hours_ledger_monthly/hmA'), true);
  add('staff A lee hours dirty', await c.get(tok.a, 'hours_ledger_dirty/hdA'), true);
  add('staff A lee hours jobs', await c.get(tok.a, 'hours_ledger_jobs/hjA'), true);
  add('guardia no lee hours', await c.get(tok.g, 'hours_ledger/hA'), false);
  add('eventual no lee hours', await c.get(tok.e, 'hours_ledger/hA'), false);
  add('guardia no lee sesion', await c.get(tok.g, 'sesiones_operador/sA'), false);
  add('guardia no lee arca', await c.get(tok.g, 'arca_envios/env1'), false);

  let failed = 0;
  for (const row of checks) {
    if (!row.pass) failed += 1;
    console.log(`${row.pass ? 'OK' : 'FALLA'}\t${row.name}\t${row.status} ${row.allow ? 'permite' : 'niega'}`);
  }
  console.log(`\n${failed === 0 ? 'ok' : 'falla'} reglas admin: ${checks.length - failed}/${checks.length}`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
