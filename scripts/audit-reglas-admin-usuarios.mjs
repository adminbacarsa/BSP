/**
 * Inventario READ-ONLY de Auth + system_users (prod comtroldata).
 * No llama setCustomUserClaims, update ni delete.
 *
 *   node scripts/audit-reglas-admin-usuarios.mjs
 */
import admin from 'firebase-admin';

const STAFF_ROLES = new Set([
  'admin', 'Admin', 'ADMIN',
  'SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP', 'superadmin',
  'Manager', 'MANAGER',
  'Scheduler', 'SCHEDULER',
  'Supervisor', 'SUPERVISOR',
  'Operator', 'OPERATOR', 'Operador', 'operador', 'OPERADOR', 'OPERADOR_CC',
  'HR_Manager', 'HR_MANAGER',
  'ADMIN_EMPRESA', 'ADMIN_PRUEBA',
  'ADMIN_CAPACITACION', 'SEGP', 'SOPORTE',
  'PLANIFICACION', 'PLANIFICADOR',
  'RRHH',
  'SUPERVISION',
]);

const SYSTEM_TYPES = new Set(['system_user', 'SYSTEM', 'SYSTEM_USER', 'system']);

function isEmployeeClaim(claims) {
  const role = claims?.role;
  const type = claims?.type;
  return role === 'employee' || role === 'EMPLOYEE' || type === 'employee' || type === 'EMPLOYEE';
}

function isEventual(claims) {
  const role = String(claims?.role || '');
  const type = String(claims?.type || '');
  return role.toUpperCase() === 'EVENTUAL' || type.toLowerCase() === 'eventual';
}

function isClientClaim(claims) {
  const role = String(claims?.role || '');
  const type = String(claims?.type || '');
  return role.toLowerCase() === 'client' || type === 'client_user' || type === 'CLIENT_USER';
}

function tally(map, key) {
  const k = key == null || key === '' ? '(vacio)' : String(key);
  map[k] = (map[k] || 0) + 1;
}

async function listAllUsers(auth) {
  const users = [];
  let token;
  do {
    const page = await auth.listUsers(1000, token);
    users.push(...page.users);
    token = page.pageToken;
  } while (token);
  return users;
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
  }
  const auth = admin.auth();
  const db = admin.firestore();

  const [users, sysSnap, clientSnap, rolesSnap] = await Promise.all([
    listAllUsers(auth),
    db.collection('system_users').get(),
    db.collection('client_users').get(),
    db.collection('roles').get(),
  ]);

  const sysByUid = new Map();
  const sysRoles = {};
  for (const d of sysSnap.docs) {
    const role = d.get('role');
    sysByUid.set(d.id, { role: role == null ? '' : String(role), email: d.get('email') || '' });
    tally(sysRoles, role);
  }
  const clientUids = new Set(clientSnap.docs.map((d) => d.id));

  const byRole = {};
  const byType = {};
  const losers = [];
  let panel = 0;
  let panelKeep = 0;
  let coveredOnlyByDoc = 0;

  for (const u of users) {
    const claims = u.customClaims || {};
    tally(byRole, claims.role);
    tally(byType, claims.type);
    const staff = STAFF_ROLES.has(claims.role);
    const systemType = SYSTEM_TYPES.has(claims.type);
    const hasDoc = sysByUid.has(u.uid);
    const oldAdmin = staff || systemType || hasDoc || !isEmployeeClaim(claims);
    const newAdmin = staff || systemType || hasDoc;
    const isPanel = hasDoc || systemType || staff;
    if (isPanel) {
      panel += 1;
      if (newAdmin) panelKeep += 1;
      if (hasDoc && !staff && !systemType) coveredOnlyByDoc += 1;
    }
    if (oldAdmin && !newAdmin) {
      let clase = 'desconocido';
      if (isEventual(claims)) clase = 'eventual';
      else if (isClientClaim(claims) || clientUids.has(u.uid)) clase = 'cliente';
      else if (!claims.role && !claims.type) clase = 'sin-claims';
      losers.push({
        clase,
        uid: u.uid,
        email: u.email || '',
        role: claims.role || '',
        type: claims.type || '',
        disabled: u.disabled === true,
      });
    }
  }

  const authUids = new Set(users.map((u) => u.uid));
  let sysSinAuth = 0;
  for (const uid of sysByUid.keys()) {
    if (!authUids.has(uid)) sysSinAuth += 1;
  }

  const rolesFueraCount = {};
  for (const d of sysSnap.docs) {
    const r = String(d.get('role') || '');
    if (r && !STAFF_ROLES.has(r)) tally(rolesFueraCount, r);
  }

  const porClase = {};
  for (const l of losers) tally(porClase, l.clase);
  const revisar = losers.filter((l) => l.clase === 'desconocido');

  console.log(JSON.stringify({
    auth: users.length,
    system_users: sysSnap.size,
    client_users: clientSnap.size,
    rolesDocs: rolesSnap.docs.map((d) => d.id).sort(),
    claimsRole: byRole,
    claimsType: byType,
    systemUsersRole: sysRoles,
    systemUsersRoleFueraDeLista: rolesFueraCount,
    panelHoy: panel,
    panelSigueAdmin: panelKeep,
    panelSoloPorSystemUsersDoc: coveredOnlyByDoc,
    pierdenAdmin: losers.length,
    pierdenPorClase: porClase,
    revisarAntesDePublicar: revisar.map((l) => ({
      uid: l.uid,
      email: l.email,
      role: l.role,
      type: l.type,
      disabled: l.disabled,
    })),
    systemUsersSinAuth: sysSinAuth,
  }, null, 2));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
