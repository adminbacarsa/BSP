/**
 * Guía de etapas VPLAN — qué validar antes de avanzar a la siguiente fase.
 * Sincronizado con apps/functions/src/vplan/vplan.orchestrator.ts (PHASE_ORDER).
 */

import type { VplanIntent, VplanRunMode } from './vplan.types';

export interface VplanStageDef {
  intent: VplanIntent;
  phase: string;
  title: string;
  shortLabel: string;
  /** Qué produce esta etapa (salida del context). */
  output: string;
  /** Qué revisar en la UI / JSON antes de pasar a la siguiente. */
  checks: string[];
  /** Modo de corrida recomendado para la primera validación. */
  recommendedMode: VplanRunMode;
  /** Etapa anterior obligatoria (null = primera). */
  prerequisite: VplanIntent | null;
}

export const VPLAN_STAGES: VplanStageDef[] = [
  {
    intent: 'intake',
    phase: '0_intake',
    title: 'Intake — carga de contexto',
    shortLabel: '0 · Intake',
    output: 'context.intake — objetivo, modo, puestos, guardias',
    checks: [
      'Objetivo y mes coinciden con lo que querés planificar.',
      'Cantidad de puestos SLA coherente con el contrato (ej. 4 puestos Obrador).',
      'Cantidad de guardias > 0 (dotación objetivo o empresa).',
      'Modo CONTINUE: debe existir mes anterior con turnos (incl. draft).',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: null,
  },
  {
    intent: 'demand',
    phase: '1_demand',
    title: 'Demanda — SLA → horas y bandas',
    shortLabel: '1 · Demanda',
    output: 'context.demand — monthDemandHours, slaVendidas, dayDemands',
    checks: [
      'Horas estructura (~3413h) vs vendidas (~3413h) sin delta absurdo.',
      'Puestos 24hs: demanda M+T+N por día activo.',
      'Puestos EN/RO: activeDays L–V detectados (no 7 días).',
      'Warnings de demanda vacíos o explicables.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'intake',
  },
  {
    intent: 'supply',
    phase: '2_supply',
    title: 'Oferta — dotación y disponibilidad',
    shortLabel: '2 · Oferta',
    output: 'context.supply — empleados, días bloqueados, headcount',
    checks: [
      'employeeCount ≈ plantilla esperada (~18 para Obrador 6+2).',
      'Ausencias del mes reflejadas en blockedDates.',
      'Turnos existentes en mes objetivo contados (COMPLETE/RESTORE).',
      'Scope objective vs empresa: elegir el que usarás en prod.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'demand',
  },
  {
    intent: 'feasibility',
    phase: '3_feasibility',
    title: 'Viabilidad — ¿alcanza la dotación?',
    shortLabel: '3 · Viabilidad',
    output: 'context.feasibility — ok, suggestedCycle, offerHours',
    checks: [
      'ok = true (si false, NO avanzar — ajustar dotación o SLA).',
      'Ciclo sugerido = el que querés probar (6+2 o 4+2).',
      'offerHours ≥ effectiveTargetHours (margen razonable).',
      'suggestedHeadcount coherente (~18 guardias).',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'supply',
  },
  {
    intent: 'strategy',
    phase: '4_strategy',
    title: 'Estrategia — cómo planificar',
    shortLabel: '4 · Estrategia',
    output: 'context.strategy — engine, cycle, planningMethod (CÓMO)',
    checks: [
      'engine = FixedBandFloater para 6+2 estándar.',
      'planningMethod.mandates: ciclo → cobertura → horas.',
      'CONTINUE: useTrailing = true y capa OFFSET_RACHA con guardias.',
      'positionRules: 24hs rotativo vs custom L–V explicados.',
      'Escalera de cobertura documentada (5 pasos).',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'feasibility',
  },
  {
    intent: 'generate',
    phase: '5_generate',
    title: 'Generación — grilla determinística',
    shortLabel: '5 · Generación',
    output: 'context.draft — assignments, openingSlotByEmp, stats',
    checks: [
      'Paso 5_generate ok (✓) sin error.',
      'slotCoverage: X/418 turnos/slot cubiertos (ideal 100%).',
      'Celdas ≈ guardias × días activos (menos ausencias).',
      'CONTINUE: trailing + apertura jul-01 coherente con mes anterior.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'strategy',
  },
  {
    intent: 'coverage',
    phase: '7_verify',
    title: 'Cobertura — asignar guardias a turnos/slot',
    shortLabel: '5–7 · Cobertura',
    output: 'context.draft + verification.coverage — slots cubiertos vs manifiesto',
    checks: [
      'Manifiesto fase 1 = turnos/slot requeridos (ej. 418 Obrador).',
      'draft.stats.slotCoverage.ok = true (0 faltantes, 0 exceso).',
      'verification: cobertura 418/418 (o ratio ≥ 98%).',
      'Por puesto: P1 186/186, P2 93/93, RO 23/23, EN 23/23.',
      'Si falla: revisar dotación o CCT antes de fix/Gemini.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'strategy',
  },
  {
    intent: 'exceptions',
    phase: '6_exceptions',
    title: 'Excepciones — ausencias sobre borrador',
    shortLabel: '6 · Excepciones',
    output: 'context.draft parcheado — días V/L/E',
    checks: [
      'Días con ausencia aprobada marcados (V, L, E, etc.).',
      'No se borró cobertura de días sin ausencia.',
      'patchedDays coincide con ausencias del mes.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'generate',
  },
  {
    intent: 'verify',
    phase: '7_verify',
    title: 'Verificación — cobertura + reglas CCT',
    shortLabel: '7 · Verificación',
    output: 'context.verification — issues, coverageRatio, hoursGap',
    checks: [
      'Cobertura puestos ≥ 98% (ideal 100%).',
      '0 bloqueantes BAND_SKIP_ILLEGAL (N→M, M→N, T→N sin F).',
      '0 bloqueantes WORK_STREAK_TOO_LONG (máx 6 trabajo en 6+2).',
      'hoursGap dentro de ±8h vs SLA vendidas.',
      'Si hay bloqueantes: volver a fase 5, NO pasar a fix/optimize.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'exceptions',
  },
  {
    intent: 'fix',
    phase: '8_fix',
    title: 'Fixer CCT — ajustes determinísticos',
    shortLabel: '8 · Fix CCT',
    output: 'context.draft + fixerLog',
    checks: [
      'Solo ejecutar si fase 7 tiene pocos bloqueantes o warnings CCT.',
      'fixerLog documenta cada swap (no silencioso).',
      'Re-ejecutar intent verify después para confirmar mejora.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'verify',
  },
  {
    intent: 'optimize',
    phase: '9_optimize',
    title: 'Optimización Gemini (opcional)',
    shortLabel: '9 · Gemini',
    output: 'context.optimization — correcciones IA',
    checks: [
      'Solo si fase 7 casi OK (gaps menores) y GEMINI_API_KEY en emulador.',
      'runOptimization = true en parámetros.',
      'Tras aplicar: verification re-corre automáticamente.',
      'No usar para arreglar cobertura < 90% — es síntoma de fase 5 rota.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'fix',
  },
  {
    intent: 'full',
    phase: '10_deliver',
    title: 'Pipeline completo + entrega',
    shortLabel: '0–10 · Full',
    output: 'context.deliverable — diff, reportSummary',
    checks: [
      'Todas las fases anteriores pasaron individualmente.',
      'status = ok (no verification_failed).',
      'Diff coherente vs grilla actual del planificador.',
      'Sin escritura Firestore en lab — solo revisión humana.',
    ],
    recommendedMode: 'CONTINUE',
    prerequisite: 'optimize',
  },
];

export const VPLAN_STAGE_BY_INTENT = Object.fromEntries(
  VPLAN_STAGES.map((s) => [s.intent, s]),
) as Record<VplanIntent, VplanStageDef>;

/** Orden sugerido para validar CASISA Obrador (jul 2026). */
export const VPLAN_VALIDATION_PLAYBOOK = [
  { step: 1, intent: 'feasibility' as VplanIntent, mode: 'CONTINUE' as VplanRunMode, note: 'Confirmar viable con dotación actual' },
  { step: 2, intent: 'strategy' as VplanIntent, mode: 'CONTINUE' as VplanRunMode, note: 'Confirmar trailing > 0' },
  { step: 3, intent: 'generate' as VplanIntent, mode: 'CONTINUE' as VplanRunMode, note: 'Grilla + primer cierre slot' },
  { step: 4, intent: 'coverage' as VplanIntent, mode: 'CONTINUE' as VplanRunMode, note: '418/418 turnos/slot + verify' },
  { step: 5, intent: 'full' as VplanIntent, mode: 'CONTINUE' as VplanRunMode, note: 'Solo si cobertura pasó' },
  { step: 6, intent: 'generate' as VplanIntent, mode: 'GREENFIELD' as VplanRunMode, note: 'Contraste arranque en frío vs CONTINUE' },
];

export function stagesUpToIntent(intent: VplanIntent): VplanStageDef[] {
  const idx = VPLAN_STAGES.findIndex((s) => s.intent === intent);
  if (idx < 0) return VPLAN_STAGES;
  return VPLAN_STAGES.slice(0, idx + 1);
}
