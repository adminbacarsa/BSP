# Ejemplos de uso de la skill

## Ejemplo 1: Cobertura 2/3 con SLA 2160h

**Síntoma:** fila COBERTURA en 2/3, vendidas 2160, planificadas 2016.

**Orden de diagnóstico:**

1. `coberturaPorDia` — ¿`deficit > 0` por puesto?
2. ¿Francos alineados en todos los del mismo puesto?
3. ¿Tope R10 ya lleno y Gemini agregó turnos de más?

**Fix típico:** motor V2 (reasignar banda M/T/N), no prompt más largo.

## Ejemplo 2: Gemini devuelve correcciones que rompen descanso

**Fix:** validar en UI antes de aplicar; reforzar P4 en prompt; añadir chequeo en `coverageVerification` si falta.

## Ejemplo 3: Nuevo rol puede usar IA planificación

**Archivos:** `ALLOWED_PLANNING_AI_ROLES` en `index.ts`, `resolveAssistantUser.ts`, `isSuperAdminRole` en `role.util.ts`, token `SP` en custom claims.

## Ejemplo 4: Tarea para Cursor

Prompt sugerido:

```text
@cosp-planificacion-agent
Después de generateScheduleV2, si hay déficit en menos de 5 días,
ejecutar coverageFixer antes de llamar a Gemini.
```
