# App multi-rol — qué hay y en qué orden seguir

Documento para decidir. Estado al integrar la Fase 0 (`06c198f3` + `117c058e`) sobre `main` en `cursor/multirol-fase1`. Las callables `resolveStaffProfile` y `sesionOperador` ya estaban en `main` (`e02b8737`).

**No se tocó** `apps/mobile-guardia/app.config.ts` ni `eas.json`: el agente de la app está armando el build de Play en paralelo. El nombre visible sigue siendo **COSP Guardia** (la Fase 0 quería renombrarlo a «COSP»; eso queda para ese build, no para esta rama). Tampoco hay OTA ni deploy.

## Cómo entra alguien y cómo elige modo

1. Login → callable `resolveStaffProfile` (en el emulador, si Functions no está, stub local).
2. Entra si es guardia (`empleados.uid`), staff (`system_users`), SuperAdmin, o claim `role`/`type: EVENTUAL` (aunque no tenga legajo: se trata como modo Guardia).
3. Modos visibles (`resolveVisibleModes`): **Guardia** si `isGuard` o SuperAdmin; cada modo staff si el módulo tiene `read` (SuperAdmin ve los cuatro).
4. Si hay más de uno, la barra (`ModeSelectorBar`) cambia de modo. Se recuerda en el teléfono. Por defecto, si es guardia, abre Guardia.
5. Guardia y eventual: gate de dispositivo (igual que hoy). Staff puro: no. Quien es las dos cosas y el teléfono no valida igual puede usar el modo staff.
6. Preview SuperAdmin: legajo (`?previewEmp=`) o bolsa (`?previewBolsa=` / `enterPreviewEventual`). Se ve la app como esa persona, sin modo staff.

## Por rol

Leyenda de tamaño: chico = 1–3 días, mediano = 4–8, grande = 9–15. Es tiempo de app, no del panel.

### Guardia — ya está

| | |
|---|---|
| Ve | Hoy, Agenda, Alertas, Más (novedad, credencial, permutas, eventos). |
| Hace | Fichar (ventanas P5/P5d/P5 convocado), avisar llegada, responder ¿Venís?, aceptar o rechazar cobertura, ver retención. |
| Push | Canal `alertas_turno`. Eventos: aviso T−5 (`AVISO_TURNO_PROXIMO`), ¿Venís? a la hora (`LLEGADA_TARDE`), «quedás retenido», convocatoria de cobertura, recordatorio del convocado, cierre por relevo. |
| Permiso | No usa `roles`. Entra por legajo `empleados.uid` + claim de empleado. |
| Falta | Nada de esta fase. Las alertas que se cierran solas (P5–P9) siguen en la tarjeta de Alertas. |

### Eventual — ya está, no es un modo aparte

| | |
|---|---|
| Ve | Las mismas pestañas que el guardia, más contratos/anexo y la ficha de la bolsa. Turnos de todas las empresas habilitadas. |
| Hace | Activar la cuenta (token `tipo: EVENTUAL`), fichar el evento, acusar recibo, confirmar el anexo. Sin alta ARCA la fichada responde `ALTA_ARCA_PENDIENTE`. |
| Push | El mismo canal del guardia cuando tiene turno. El código del anexo sale por push y mail. Los avisos ARCA (alta/baja/error, marco por vencer) **no** le llegan a él: van a los roles del panel (abajo). |
| Permiso | Claim `EVENTUAL` + `eventuales_bolsa.uid`. El módulo `EVENTUALES` del panel es de quien lo administra, no de la persona. |
| Falta | Un modo «Eventual» separado no suma: ya entra como Guardia. Chico (1–2 días) solo si más adelante se quiere una home propia (contratos primero). |

### Operador (Centro de Comando) — primero

| | |
|---|---|
| Ve hoy | Pantalla «Próximamente» + controles de sala: tomar mando, copiloto, pasar a Auto (`sesionOperador`, origin `MOBILE`). |
| Debería ver | El monitor (activos, ausentes, vacantes, retenidos) de la empresa elegida. |
| Debería hacer | Lo que el CC ya hace en la web: marcar llegada, revertir ausencia (hasta T+60, y al revertir se releva la serie), convocar, cerrar protocolo. |
| Push | Canal `cosp-staff` (el teléfono ya se registra con audience `staff`). **Ningún evento del servidor escribe ese canal todavía.** Los avisos de Configuración → Empresas → Avisos (`empresas.avisos`) pueden incluir push al rol OPERADOR para `ARCA_ALTA_PENDIENTE`, `ARCA_BAJA_PENDIENTE`, `ARCA_ERROR`, `MARCO_POR_VENCER` (módulo `OPERATIONS` con `read`). Hoy los dispara el robot ARCA, no el monitor. |
| Permiso | `OPERATIONS` → `read`. |
| Tamaño | Grande (10–14 días). Es el de más valor: la sala ya está y el dolor operativo (P5–P9) es de este rol. |

### Supervisión — segundo

| | |
|---|---|
| Ve hoy | Placeholder. |
| Debería ver | El mismo monitor, solo de sus objetivos, sin mando de sala. |
| Hace | Consultar. Escalar una vacante sin cobertura es del servidor, no un botón nuevo. |
| Push | Mismo canal staff, cuando exista. En Avisos, el rol SUPERVISIÓN se cruza con `SUPERVISION` `read`. |
| Permiso | `SUPERVISION` → `read`. |
| Tamaño | Mediano (4–6 días) si reutiliza la pantalla del operador en solo lectura. |

### RRHH — tercero

| | |
|---|---|
| Ve hoy | Placeholder. |
| Debería ver | Novedades y licencias del día (no el legajo completo). |
| Hace | Ver, y más adelante cargar una novedad corta. `adjust` no entra en la app. |
| Push | Avisos ARCA y marco por vencer si el rol RRHH está en Configuración → Avisos (`RRHH` `read`). |
| Permiso | `RRHH` → `read`. |
| Tamaño | Mediano (6–8 días). El panel web sigue siendo el lugar del legajo. |

### Planificación — cuarto

| | |
|---|---|
| Ve hoy | Placeholder. |
| Debería ver | Huecos del día y la grilla publicada, no el editor del mes. |
| Hace | Consultar. Publicar, corregir y FT se quedan en la web (`publish`, `correct`, `assign_ft`). |
| Push | Avisos ARCA si el rol PLANIFICACIÓN está configurado (`PLANNING` `read`). El hueco SLA a T−12 h hoy es una novedad de bandeja, no un push. |
| Permiso | `PLANNING` → `read`. |
| Tamaño | Grande (10–15 días) y rinde menos en el teléfono que el operador. |

## Orden recomendado

1. **Operador** — la sala móvil ya existe; el monitor es lo que la operación pide a la noche.
2. **Supervisión** — la misma pantalla, sin escribir.
3. **RRHH** — bandeja de novedades, no el legajo.
4. **Planificación** — consulta. El armado del mes sigue en la web.
5. **Eventual como modo propio** — no hacerlo ahora.

El guardia no se reabre. Los avisos por empresa y rol (Configuración → Empresas → Avisos) ya resuelven destinatarios; falta que el push staff del teléfono reciba esos cuatro tipos y, después, los del monitor.
