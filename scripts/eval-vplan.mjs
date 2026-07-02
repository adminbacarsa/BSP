#!/usr/bin/env node
/**
 * Smoke check del módulo VPLAN (paralelo, emulador).
 * Uso: npm run eval:vplan
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'docs/VPLAN.md',
  'apps/functions/src/vplan/vplan.engine-bridge.ts',
  'apps/functions/src/vplan/phases/phase4-strategy.ts',
  'apps/functions/src/vplan/phases/phase5-generate.ts',
  'apps/functions/src/vplan/phases/phase6-exceptions.ts',
  'apps/functions/src/vplan/phases/phase7-verify.ts',
  'apps/functions/src/vplan/phases/phase8-fix.ts',
  'apps/functions/src/vplan/phases/phase9-optimize.ts',
  'apps/functions/src/vplan/phases/phase10-deliver.ts',
  'apps/functions/src/vplan/vplan.types.ts',
  'apps/functions/src/vplan/vplan.orchestrator.ts',
  'apps/functions/src/vplan/vplan.handler.ts',
  'apps/functions/src/vplan/vplan.firestore.ts',
  'apps/functions/src/vplan/phases/phase1-demand.ts',
  'apps/functions/src/vplan/phases/phase2-supply.ts',
  'apps/functions/src/vplan/phases/phase3-feasibility.ts',
  'apps/functions/src/vplan/index.ts',
  'apps/web2/src/lib/vplan/vplan.types.ts',
  'apps/web2/src/lib/vplan/vplan.client.ts',
  'apps/web2/src/pages/admin/vplan/index.tsx',
];

let ok = true;
console.log('COSP — eval VPLAN (pipeline completo)\n');
for (const rel of required) {
  const p = path.join(root, rel);
  const exists = fs.existsSync(p);
  console.log(`${exists ? '✓' : '✗'} ${rel}`);
  if (!exists) ok = false;
}

const indexTs = fs.readFileSync(path.join(root, 'apps/functions/src/index.ts'), 'utf8');
if (!indexTs.includes('vplanRun')) {
  console.log('✗ vplanRun no exportada en apps/functions/src/index.ts');
  ok = false;
} else {
  console.log('✓ vplanRun exportada en index.ts');
}

const handler = fs.readFileSync(
  path.join(root, 'apps/functions/src/vplan/vplan.handler.ts'),
  'utf8',
);
if (!handler.includes('FUNCTIONS_EMULATOR')) {
  console.log('✗ vplan.handler sin guard de emulador');
  ok = false;
} else {
  console.log('✓ Guard emulador en vplan.handler');
}

const planificacion = fs.readFileSync(
  path.join(root, 'apps/web2/src/pages/admin/planificacion/index.tsx'),
  'utf8',
);
if (planificacion.includes('vplan') || planificacion.includes('VPLAN')) {
  console.log('✗ planificacion/index.tsx importa VPLAN (debe permanecer aislado)');
  ok = false;
} else {
  console.log('✓ planificacion/index.tsx sin wire VPLAN');
}

console.log('\nDocumentación cerebro: docs/VPLAN.md');
console.log('Callable lab (emulador): vplanRun');
console.log('UI lab: /admin/vplan (sidebar si emulador o SuperAdmin)');
console.log('\nPipeline: intake → demand → supply → feasibility → … → deliver');
console.log(ok ? '\nOK' : '\nFALTAN ARCHIVOS O AISLAMIENTO ROTO');
process.exit(ok ? 0 : 1);
