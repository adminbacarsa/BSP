/**
 * Carga la escala ene–jun 2026 (Disposición DNRYRT 120/2026, Acuerdo 305/26) como primera versión
 * PENDIENTE DE APROBACIÓN en `escalas_cct` (estado PROPUESTA). No toca `escalas_salariales`: eso lo hace
 * la aprobación desde Eventuales → Escala salarial (callable `gestionarEscalaCct`).
 *
 *   node scripts/escalas-cct/seed-escala-120-2026.mjs                  dry-run (muestra el doc, no escribe)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node ... --apply           emulador aislado
 *   node scripts/escalas-cct/seed-escala-120-2026.mjs --apply --allow-prod   producción (lo corre Mauro)
 *
 * Idempotente: si el doc ya existe (mismo hash del documento) no se pisa. Se niega a usar :8080 (lab compartido).
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');
const emu = process.env.FIRESTORE_EMULATOR_HOST || '';
if (emu.endsWith(':8080')) {
  console.error('Este script no corre contra el emulador compartido :8080.');
  process.exit(1);
}
if (apply && !emu && !allowProd) {
  console.error('Falta --allow-prod (o FIRESTORE_EMULATOR_HOST). No se escribió.');
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'disp-120-2026.extraido.json'), 'utf8'));
const docId = `${fixture.cct}_${fixture.vigenciaDesde}_${fixture.documentoHash.slice(0, 8)}`;
const doc = {
  ...fixture,
  estado: 'PROPUESTA',
  modelo: null,
  empresaId: null,
  origen: 'SEED',
  version: null,
  historial: [],
  creadoPor: 'SEED_DISP_120_2026',
  creadoPorEmail: null,
  aprobadoPor: null,
  aprobadoEn: null,
  payloadHash: createHash('sha256').update(JSON.stringify(fixture.tramos)).digest('hex'),
};

const vig = (mes) => fixture.tramos.find((t) => t.mes === mes).categorias.find((c) => c.codigo === 'VIGILADOR');
console.log(`Doc: escalas_cct/${docId}`);
console.log(`Fuente: ${fixture.fuente.disposicion} · Acuerdo ${fixture.fuente.acuerdoNro} · ${fixture.fuente.url}`);
console.log(`Vigencia: ${fixture.vigenciaDesde} → ${fixture.vigenciaHasta} · ${fixture.tramos.length} tramos · ${fixture.tramos[0].categorias.length} categorías · confianza ${fixture.confianzaGlobal}`);
for (const t of fixture.tramos) {
  const v = vig(t.mes);
  console.log(`  ${t.mes} Vigilador: básico ${v.basico.valor} · presentismo ${v.presentismo.valor} · viático ${v.viatico.valor} · no rem ${v.noRemunerativo.valor} · total ${v.total.valor}`);
}

if (!apply) {
  console.log('dryRun: no se escribió nada. Queda PENDIENTE DE APROBACIÓN cuando se aplique; se aprueba en Eventuales → Escala salarial.');
  process.exit(0);
}

admin.initializeApp({ credential: emu ? undefined : admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
const db = admin.firestore();
const ref = db.collection('escalas_cct').doc(docId);
const prev = await ref.get();
if (prev.exists) {
  console.log(`Ya existe (estado ${prev.data().estado}). No se pisa.`);
  process.exit(0);
}
await ref.set({ ...doc, creadoEn: admin.firestore.FieldValue.serverTimestamp() });
await db.collection('audit_logs').add({
  action: 'ESCALA_CCT_PROPUESTA',
  collection: 'escalas_cct',
  docId,
  empresaId: null,
  userId: 'SEED_DISP_120_2026',
  details: { cct: fixture.cct, extraccion: fixture.extraccion, origen: 'SEED', vigenciaDesde: fixture.vigenciaDesde, vigenciaHasta: fixture.vigenciaHasta, confianzaGlobal: fixture.confianzaGlobal },
  timestamp: admin.firestore.FieldValue.serverTimestamp(),
});
console.log('Escrito como PROPUESTA (pendiente de aprobación).');
