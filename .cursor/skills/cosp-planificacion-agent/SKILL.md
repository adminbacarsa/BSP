---
name: cosp-planificacion-agent
description: >-
  Desarrolla y mejora el agente de planificación automática COSP (motor V2,
  verificación de cobertura, ajuste fino Gemini, callables Firebase). Usar cuando
  el usuario mencione planificación automática, autoV2, optimizePlanningGemini,
  cronograma automático, cobertura SLA, o agente IA de planificación en cronoapp.
---

# Agente de planificación automática COSP

## Objetivo del agente (producto)

Orquestar en un flujo claro:

1. **Viabilidad** — ¿cierra dotación vs SLA + CCT?
2. **Generación** — cronograma base (motor determinístico).
3. **Verificación** — slots, descansos 12h, licencias, horas vendidas.
4. **Ajuste fino IA** — correcciones puntuales JSON (no regenerar todo).
5. **Respuesta al usuario** — resumen + métricas + cambios aplicables.

La IA **no inventa** cronogramas desde cero; el motor V2 y las reglas duras mandan.

## Pipeline (orden obligatorio)

```
planificacion/index.tsx
  → build context (SLA, puestos, empleados, coberturaPorDia)
  → autoScheduleEngineV2.checkFeasibility / generateScheduleV2
  → coverageVerification.verifyCoverage
  → (opcional) scheduleOptimizationSuggestions
  → optimizePlanningGemini (planningGeminiServer.ts)
  → aplicar correcciones en pendingChanges / guardar
```

## Archivos clave

| Capa | Archivo |
|------|---------|
| UI + wizard | `apps/web2/src/pages/admin/planificacion/index.tsx` |
| Motor V2 | `apps/web2/src/lib/planificacion/autoScheduleEngineV2.ts` |
| Verificación | `apps/web2/src/lib/planificacion/coverageVerification.ts` |
| Cliente Gemini | `apps/web2/src/services/geminiPlanificacion.ts` |
| Servidor Gemini | `apps/functions/src/assistant/planningGeminiServer.ts` |
| Callable | `optimizePlanningGemini` en `apps/functions/src/index.ts` |
| Tipos agente | `apps/functions/src/assistant/planningAgent/planningAgentTypes.ts` |
| Protocolo COSP | `CLAUDE.md` (asistente + emuladores) |

Detalle: [reference.md](reference.md). Ejemplos de tareas: [examples.md](examples.md).

## Reglas de negocio (no negociables)

- **Cobertura:** por puesto/día, horas facturables ≥ demanda SLA (`qty` × bandas).
- **Tope diario R10:** no superar horas facturables por puesto/día (ver `maxHorasFacturablesDiaPorPuesto` en `planningGeminiServer.ts`).
- **CCT:** ciclo 26→25, tope `SUVICO_POLICY` / 200h por ciclo (`suvicoPolicy.ts`).
- **Descansos:** `restBetweenShifts.ts` — 12h entre turnos.
- **Multi-empresa:** filtrar por `empresaId` en queries y callables (`empresaAllowed`).
- **Códigos:** M/T/N/D12/N12 facturables; F/RET/licencias según `OBJECTIVE_NON_BILLABLE_CODES` en planificador.
- **Gemini key:** solo servidor; `GEMINI_API_KEY` en Secret Manager / `apps/functions/.env` en emulador.

## Checklist al implementar un cambio

```
- [ ] ¿Afecta viabilidad, generación, verificación o solo Gemini?
- [ ] Si cambia reglas duras → motor V2 o coverageVerification, no solo el prompt
- [ ] Si cambia prompt → actualizar SYSTEM_PROMPT en planningGeminiServer.ts
- [ ] Probar en emulador: npm run emulators + planificador con SLA activo
- [ ] Caso: objetivo con 3 pax 24h → cobertura 3/3 y hs ≈ vendidas
- [ ] Caso: empleado no debe pasar 200h ciclo CCT
- [ ] Rol SP/SUPERADMIN en resolveAssistantUser y firestore.rules si toca permisos
```

## Cómo invocar esta skill

En Cursor: `@cosp-planificacion-agent` + tu tarea (ej. "agregar tool que devuelva déficit por día").

## Implementado en repo (pipeline cliente)

- `apps/web2/src/lib/planificacion/planningAgentPipeline.ts` — `buildPlannerContextFromAutoRun`, `runPlanningAgentOptimizeStep`, aplicar correcciones.
- `planificacion/index.tsx` — tras generar + fixer, paso Gemini si `autoV2RunGemini` (toggle en wizard) y hay déficit/avisos; botón **Re-ejecutar ajuste fino IA**.
- Asistente globo — respuesta determinística si preguntan por **automatizar cronograma** (`assistantDeterministicRouter.ts` + guía en `cospKnowledge.ts`).

Intents en `planningAgentTypes.ts`: `feasibility` → `generate` → `verify` → `optimize`.

No crear callable nueva sin reutilizar auth de `optimizePlanningGeminiHandler`.

## Evaluación rápida

```bash
node scripts/eval-planning-agent.mjs
```

Lista checks estáticos y rutas; no llama a Gemini sin API key.
