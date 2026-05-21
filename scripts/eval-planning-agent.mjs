#!/usr/bin/env node
/**
 * Smoke check del stack de planificación automática (sin llamar a Gemini).
 * Uso: node scripts/eval-planning-agent.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'apps/web2/src/lib/planificacion/autoScheduleEngineV2.ts',
  'apps/web2/src/lib/planificacion/coverageVerification.ts',
  'apps/web2/src/services/geminiPlanificacion.ts',
  'apps/functions/src/assistant/planningGeminiServer.ts',
  'apps/functions/src/assistant/planningAgent/planningAgentTypes.ts',
  'apps/web2/src/lib/planificacion/planningAgentPipeline.ts',
  'apps/functions/src/index.ts',
  '.cursor/skills/cosp-planificacion-agent/SKILL.md',
];

let ok = true;
console.log('COSP — eval planificación automática\n');
for (const rel of required) {
  const p = path.join(root, rel);
  const exists = fs.existsSync(p);
  console.log(`${exists ? '✓' : '✗'} ${rel}`);
  if (!exists) ok = false;
}

const indexTs = fs.readFileSync(path.join(root, 'apps/functions/src/index.ts'), 'utf8');
if (!indexTs.includes('optimizePlanningGemini')) {
  console.log('✗ optimizePlanningGemini no exportada en index.ts');
  ok = false;
} else {
  console.log('✓ optimizePlanningGemini exportada');
}

const geminiServer = fs.readFileSync(
  path.join(root, 'apps/functions/src/assistant/planningGeminiServer.ts'),
  'utf8',
);
for (const rule of ['R10', 'SLA_VENDIDAS', 'coberturaPorDia']) {
  if (!geminiServer.includes(rule)) {
    console.log(`✗ planningGeminiServer sin referencia ${rule}`);
    ok = false;
  }
}
if (ok) console.log('✓ Reglas clave presentes en SYSTEM_PROMPT');

console.log('\nPipeline esperado:');
console.log('  feasibility → generate → verify → optimize (Gemini)');
console.log('\nSkill Cursor: @cosp-planificacion-agent');
console.log(ok ? '\nOK' : '\nFALTAN ARCHIVOS');
process.exit(ok ? 0 : 1);
