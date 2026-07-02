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
];

let ok = true;
console.log('COSP — eval VPLAN (Ola 1)\n');
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
console.log('Cliente: import { runVplan } from "@/lib/vplan/vplan.client"');
console.log('\nPipeline: intake → demand → supply → feasibility → … → deliver');
console.log(ok ? '\nOK' : '\nFALTAN ARCHIVOS O AISLAMIENTO ROTO');
process.exit(ok ? 0 : 1);
