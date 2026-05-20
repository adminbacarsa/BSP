/**
 * Pruebas locales: fechas SLA (planificación) y remap de migración (functions lib).
 * Ejecutar: node scripts/test-empresa-migrate-fixes.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Timestamp } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);

// --- Web2: firestoreDates (vía ts compilado no existe; replicamos lógica mínima o importamos si hay build)
// Usamos la misma lógica que apps/web2/src/lib/firestoreDates.ts
function toYyyyMmDd(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value instanceof Timestamp) {
    const d = value.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const d = new Timestamp(value.seconds, value.nanoseconds ?? 0).toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(value).trim().slice(0, 10);
}

function slaCoversCalendarMonth(startDate, endDate, year, month) {
  const start = toYyyyMmDd(startDate);
  const end = toYyyyMmDd(endDate);
  if (!start || !end) return false;
  const viewMonthStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const viewMonthEndStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
  return start <= viewMonthEndStr && end >= viewMonthStr;
}

// --- Functions lib (compilado)
const { remapCloneDocumentFields, allocateCloneDocId } = require('../apps/functions/lib/backup/restore.service.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

console.log('Fechas SLA (planificación)');
test('Timestamp cubre mayo 2026', () => {
  const start = Timestamp.fromDate(new Date(2026, 0, 1));
  const end = Timestamp.fromDate(new Date(2026, 11, 31));
  assert.equal(slaCoversCalendarMonth(start, end, 2026, 4), true);
});
test('comparación string legacy sigue funcionando', () => {
  assert.equal(slaCoversCalendarMonth('2026-01-01', '2026-12-31', 2026, 4), true);
});
test('SLA vencido no cubre mes actual', () => {
  assert.equal(slaCoversCalendarMonth('2024-01-01', '2024-12-31', 2026, 4), false);
});
test('comparación cruda Timestamp vs string fallaba (regresión)', () => {
  const start = Timestamp.fromDate(new Date(2026, 0, 1));
  const end = Timestamp.fromDate(new Date(2026, 11, 31));
  const viewMonthEndStr = '2026-05-31';
  const viewMonthStr = '2026-05-01';
  const broken = start <= viewMonthEndStr && end >= viewMonthStr;
  assert.equal(broken, false, 'sin normalizar no debe considerarse vigente');
  assert.equal(slaCoversCalendarMonth(start, end, 2026, 4), true);
});

console.log('Remap migración (servicios_sla / objetivos)');
test('objectiveId por nombre cuando el id no está en el mapa', () => {
  const idMaps = { objetivos: new Map([['old-embed', 'new-embed']]) };
  idMaps.objetivos_by_name = new Map([['planta norte', 'new-embed']]);
  const mockDb = {
    collection: () => ({ doc: () => ({ id: 'should-not-use' }) }),
  };
  const out = remapCloneDocumentFields(
    'servicios_sla',
    {
      clientId: 'c1',
      objectiveId: 'Planta Norte',
      objectiveName: 'Planta Norte',
      startDate: Timestamp.fromDate(new Date(2026, 0, 1)),
      endDate: '2026-12-31',
      empresaId: 'src',
    },
    idMaps,
    mockDb,
  );
  assert.equal(out.objectiveId, 'new-embed');
  assert.equal(out.startDate, '2026-01-01');
  assert.equal(out.endDate, '2026-12-31');
});
test('clients.objetivos registra alias por nombre', () => {
  const idMaps = {};
  const mockDb = {
    collection: (col) => ({
      doc: () => ({ id: col === 'objetivos' ? 'gen-obj-1' : 'x' }),
    }),
  };
  const out = remapCloneDocumentFields(
    'clients',
    {
      objetivos: [{ id: 'oid-1', name: 'Depósito', active: true }],
      empresaId: 'bacarsa',
    },
    idMaps,
    mockDb,
  );
  const obj = out.objetivos[0];
  assert.equal(obj.id, 'gen-obj-1');
  assert.equal(idMaps.objetivos_by_name.get('depósito'), 'gen-obj-1');
});

console.log('Aislamiento por empresa (belongsToEmpresaView)');
function shouldScopeQueriesToEmpresa(empresaId, migracionCompleta) {
  const id = String(empresaId ?? '').trim();
  if (!id) return false;
  if (migracionCompleta) return true;
  return id.toLowerCase() !== 'bacarsa';
}
function belongsToEmpresaView(data, empresaId, migracionCompleta) {
  const id = String(empresaId ?? '').trim();
  const docEmp = String(data?.empresaId ?? '').trim();
  if (shouldScopeQueriesToEmpresa(id, migracionCompleta)) {
    return docEmp.toLowerCase() === id.toLowerCase();
  }
  if (id.toLowerCase() === 'bacarsa') {
    return !docEmp || docEmp.toLowerCase() === 'bacarsa';
  }
  return !docEmp || docEmp.toLowerCase() === id.toLowerCase();
}
test('empresa migrada no ve turnos de otra empresa', () => {
  assert.equal(belongsToEmpresaView({ empresaId: 'bacarsa' }, 'prueba_sa', true), false);
  assert.equal(belongsToEmpresaView({ empresaId: 'prueba_sa' }, 'prueba_sa', true), true);
});
test('bacarsa legacy sin migrar sigue viendo docs sin empresaId', () => {
  assert.equal(belongsToEmpresaView({}, 'bacarsa', false), true);
  assert.equal(belongsToEmpresaView({ empresaId: 'prueba_sa' }, 'bacarsa', false), false);
});

console.log('Matching SLA planificación');
test('vincula SLA por nombre de objetivo (copia con objectiveId viejo)', () => {
  const norm = (s) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  const keys = new Set([norm('new-id'), norm('OBRADOR MALAGÜEÑO')]);
  const sla = { objectiveId: '999-old', objectiveName: 'OBRADOR MALAGUEÑO' };
  const match = [sla.objectiveId, sla.objectiveName].some((c) => keys.has(String(c)) || keys.has(norm(String(c))));
  assert.equal(match, true);
});

console.log(`\n${passed} pruebas OK`);
