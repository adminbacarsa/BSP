/**
 * Geocodifica el domicilio de legajos activos sin lat/lng.
 * Misma fuente que geocodeAddressProxy: Nominatim (Argentina), sin API key.
 *
 * dryRun por defecto. Escribe solo lat, lng, geoSource y geocodedAt.
 * --apply solo con --empresa=pruebas_sa. bacarsa queda en reporte.
 *
 *   node scripts/geocode-legajos.mjs
 *   node scripts/geocode-legajos.mjs --apply --empresa=pruebas_sa
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installGeocodeWriteGuard } from './geocode-legajos-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const applyFlag = process.argv.includes('--apply');
const empresaArg = (process.argv.find((a) => a.startsWith('--empresa=')) || '').slice('--empresa='.length).trim();
const APPLY_EMPRESA = 'pruebas_sa';
let apply = applyFlag;
if (apply && empresaArg === 'bacarsa') {
  console.log('bacarsa: solo dryRun. No se escribe.');
  apply = false;
}
if (apply && empresaArg !== APPLY_EMPRESA) {
  console.error('--apply solo está habilitado con --empresa=pruebas_sa');
  process.exit(1);
}

installGeocodeWriteGuard(admin, { apply });

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();

function isActive(status) {
  const s = String(status || 'activo').trim().toLowerCase();
  return s === 'activo' || s === 'active';
}

function hasGeo(data) {
  const lat = Number(data.lat ?? data.latitude);
  const lng = Number(data.lng ?? data.longitude ?? data.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function addressOf(data) {
  return String(data.address || data.domicilio || data.direccion || '').trim();
}

function addressSufficient(addr) {
  if (addr.length < 8) return false;
  const low = addr.toLowerCase();
  if (/^(s\/d|s\/n|sin domicilio|sin direccion|sin dirección|n\/a|n\/d|-|\.|x)$/.test(low)) return false;
  return /\d/.test(addr) || addr.includes(',');
}

async function nominatim(params, retry = true) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&${params}`,
    {
      headers: { 'Accept-Language': 'es', 'User-Agent': 'COSP-v1/comtroldata.web.app' },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (r.status === 429) {
    if (!retry) throw new Error('Nominatim 429');
    await new Promise((res) => setTimeout(res, 2500));
    return nominatim(params, false);
  }
  if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
  const d = await r.json();
  return Array.isArray(d) && d.length > 0 ? d[0] : null;
}

async function geocode(address) {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const tc = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const street = parts[0] || '';
  const city = parts[1] ? tc(parts[1]) : 'Córdoba';
  const state = parts[2] ? tc(parts[2]) : city;
  const stateClean = state.toLowerCase() === city.toLowerCase() ? city : state;
  let res = await nominatim(`street=${encodeURIComponent(street)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(stateClean)}&country=Argentina`);
  if (!res) res = await nominatim(`q=${encodeURIComponent(`${street}, ${city}, Argentina`)}`);
  if (!res) res = await nominatim(`q=${encodeURIComponent(address)}`);
  if (!res) {
    const noNum = street.replace(/\s+\d+.*$/, '').trim();
    if (noNum && noNum !== street) res = await nominatim(`q=${encodeURIComponent(`${noNum}, ${city}, Argentina`)}`);
  }
  return res;
}

const snap = await db.collection('empleados').get();
const byEmpresa = new Map();
for (const docSnap of snap.docs) {
  const data = docSnap.data() || {};
  if (!isActive(data.status)) continue;
  const empresaId = String(data.empresaId || '(sin empresa)').trim() || '(sin empresa)';
  const row = byEmpresa.get(empresaId) || { activos: 0, sinGeo: 0, conDireccion: 0, pendientes: [] };
  row.activos += 1;
  if (!hasGeo(data)) {
    row.sinGeo += 1;
    const addr = addressOf(data);
    if (addressSufficient(addr)) {
      row.conDireccion += 1;
      row.pendientes.push({ id: docSnap.id, address: addr, name: String(data.name || `${data.lastName || ''}, ${data.firstName || ''}`).trim() });
    }
  }
  byEmpresa.set(empresaId, row);
}

console.log(apply ? 'APPLY' : 'DRY_RUN', empresaArg ? `empresa=${empresaArg}` : 'todas');
const empresas = [...byEmpresa.keys()].sort();
for (const id of empresas) {
  const row = byEmpresa.get(id);
  console.log(`${id}\tactivos ${row.activos}\tsin geo ${row.sinGeo}\tcon dirección ${row.conDireccion}`);
}

if (!apply) {
  console.log('GEOCODE_LEGAJOS_DRY_OK');
  process.exit(0);
}

const target = byEmpresa.get(APPLY_EMPRESA);
const pendientes = target?.pendientes || [];
console.log(`escribiendo ${pendientes.length} legajos de ${APPLY_EMPRESA}`);
let ok = 0;
let fail = 0;
for (let i = 0; i < pendientes.length; i++) {
  const emp = pendientes[i];
  try {
    const hit = await geocode(emp.address);
    if (!hit) {
      fail += 1;
      console.log(`SIN_RESULTADO ${emp.id} ${emp.name}`);
    } else {
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        fail += 1;
        console.log(`COORD_INVALIDA ${emp.id}`);
      } else {
        await db.collection('empleados').doc(emp.id).update({
          lat,
          lng,
          geoSource: 'nominatim',
          geocodedAt: new Date().toISOString(),
        });
        ok += 1;
        console.log(`OK ${emp.id} ${lat},${lng}`);
      }
    }
  } catch (e) {
    fail += 1;
    console.log(`ERROR ${emp.id} ${e instanceof Error ? e.message : e}`);
  }
  if (i < pendientes.length - 1) await new Promise((res) => setTimeout(res, 1100));
}
console.log(`GEOCODE_LEGAJOS_APPLY ok ${ok} sin_resultado ${fail}`);
