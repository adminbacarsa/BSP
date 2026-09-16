# Modo capacitación — alcance y opciones

> **Decisión de producto (Mauro, 2026-09-16):** la capacitación debe ser una **empresa aparte** (sandbox tenant), con **datos efímeros** que se borran al terminar; el **rol del usuario** define qué módulos aprender; dentro de cada módulo hay un **seguimiento guiado paso a paso** (ej. Planificación: crear cronograma → generar turno → publicar). Los datos de práctica **no se conservan** como operación real.

---

## 1. Problema (por qué la guía actual no alcanza)

La guía actual (`/admin/guia`) es útil como onboarding conceptual, pero no reemplaza entrenamiento operativo real:

- Es un flujo de lectura/checklist, no un circuito de ejecución con datos reales de negocio.
- No obliga a completar la cadena punta a punta (CRM → SLA → Planificación → Operaciones → RRHH → Reportes).
- No permite medir desempeño por evidencia transaccional (qué creó, qué publicó, qué corrigió, qué cerró).
- No genera “muscle memory” de resolución de incidentes (ausencias, vacantes, retenciones, refuerzos).
- No borra automáticamente lo practicado: deja residuos o fuerza al instructor a limpiar a mano.

**Evidencia en código**

- `apps/web2/src/pages/admin/guia/index.tsx` implementa pasos guiados y checks locales, con sincronización de progreso, pero no impone validaciones por resultado de negocio ni cleanup de datos.
- El progreso de onboarding está orientado a completitud de guía, no a aprobación de acciones operativas reales ni a borrado post-sesión.

---

## 2. Recorrido de capacitación objetivo (pasos in situ)

### 2.1 Principio pedagógico acordado

1. **Empresa aparte** (`capacitacion_*`) — nunca Bacarsa ni tenants productivos.
2. **Datos solo para práctica** — se escriben en el tenant de capacitación y se **eliminan al cerrar/completar** la sesión (o al abortar).
3. **Recorrido por rol** — los módulos a aprender salen de `roles/{id}.permissions` (mismos módulos que usa el panel).
4. **Coach in-situ por módulo** — al entrar a un módulo, un overlay/wizard lleva al alumno por cada micro-paso (no slideshow separado).
5. **Seguimiento de aprendizaje** — cada micro-paso se marca por evidencia (acción real en UI + doc creado/actualizado), no por checkbox manual.

### 2.2 Cadena operativa completa (cuando el rol lo permita)

| Paso capacitación | Módulo UI | Lectura/escritura principal |
|---|---|---|
| 1. Crear cliente | `/admin/crm` | `clients` (alta/edición), opcional `client_users`, `audit_logs` |
| 2. Cargar objetivo/sede | `/admin/crm` | `clients.objetivos[]` embebido; consumo operativo posterior en `turnos`, `servicios_sla` |
| 3. Crear contrato | `/admin/crm` | `contracts` y/o `contratos_servicio` (según flujo usado) |
| 4. Crear servicio/SLA | `/admin/servicios` y CRM servicios | `servicios_sla`, impacto en `hours_balances` |
| 5. Planificar servicio | `/admin/planificacion` | `turnos` (draft/publicado), `planificacion_estados`, `planificaciones_historial`, `audit_logs`, `user_notifications` |
| 6. Operar servicio publicado | `/admin/operaciones` | `turnos` (estado/presencia/cobertura), `novedades`, `ausencias`, `convocatorias_cobertura`, `swap_requests`, `user_notifications` |
| 7. Cargar novedades/ausencias | `/admin/rrhh` y `/admin/operaciones` | `ausencias`, `novedades`, actualización de `turnos` |
| 8. Crear refuerzos/cobertura | `/admin/operaciones` + solicitudes | `solicitudes_refuerzo`, `turnos` (RFZ/TURA/ops), `novedades` |
| 9. Ver impacto final | `/admin/reportes` y `/admin/analisis` | `turnos`, `ausencias`, `servicios_sla`, `hours_balances`, agregados de liquidación |

### 2.3 Ejemplo de coach por módulo: Planificación

Cuando el alumno entra a Planificación (y su rol tiene `PLANNING.read` + create/update/publish según corresponda), el coach lo lleva por:

1. Seleccionar **Cliente** y **Objetivo** (seed o creados en pasos previos).
2. Elegir **período** (mes/año).
3. Asignar/generar turnos en la grilla (crear al menos un turno real).
4. Revisar vacantes / consistencia básica vs SLA.
5. **Publicar cronograma** (`planificacion_estados.publishedAt`).
6. Confirmar evidencia: existe turno + publicación → marcar hito del módulo.

Lo mismo aplica a CRM, Servicios, Operaciones, RRHH: **pasos concretos de la pantalla real**, no textos aparte.

### 2.4 Módulos según rol (fuente de verdad)

Reutilizar la matriz ya existente:

- Definición de módulos: `apps/web2/src/config/modules.ts` (`CLIENTS`, `SERVICES`, `PLANNING`, `OPERATIONS`, `RRHH`, etc.).
- Permisos del alumno: `roles/{roleId}.permissions` + `system_users/{uid}.role`.
- Onboarding tracks actuales (`OPERATIONS`, `PLANNING`, `CRM`, `SERVICES`, `RRHH` en `index.ts` / guía) se pueden mapear 1:1 a coaches por módulo, pero con evidencia real.

Regla: **si el rol no tiene READ del módulo, ese coach no aparece**. Si tiene READ pero no CREATE/PUBLISH, el coach enseña lectura + explica límites (o usa cuenta de práctica con permisos de escritura solo en el tenant capacitación).

---

## 3. Aislamiento multiempresa hoy (evidencia)

### 3.1 Confirmado por código (fuerte)

1. **Reglas Firestore con base tenant (`empresaId`)**
   - `firestore.rules` define `tenantMatches`, `userEmpresaId`, `systemUserHasAllEmpresas`, `bacarsaTenantDocMatches`.
   - CRUD de colecciones operativas críticas (`turnos`, `empleados`, `ausencias`, `clients`, `servicios_sla`, `hours_balances`, etc.) pasa por `tenantAdminRead/Create/Update/Delete`.

2. **Helpers frontend de aislamiento**
   - `apps/web2/src/lib/multiempresa.ts` centraliza:
     - `shouldScopeQueriesToEmpresa`
     - `belongsToEmpresaView`
     - `isTenantWriteOwner`
     - `stampEmpresaId`
     - `assertDocBelongsToEmpresa`
   - El patrón de escritura en módulos usa `stampEmpresaId` y/o validación previa de ownership tenant.
   - Ya existe `eliminarEmpresaYDatos` (purge por `empresaId`) — base técnica para cleanup post-capacitación (hoy no es soft-delete; borra docs del tenant).

3. **Helpers backend para callables modernas**
   - `apps/functions/src/auth/panel-tenant-auth.util.ts` aporta `assertPanelTenantCallable` y `tenantMatchesDoc` con soporte legacy Bacarsa + `allEmpresas`/superadmin.
   - Callables nuevas y sensibles (ej. `executeAgentAction`) sí aplican este control.

4. **Scope del asistente**
   - `apps/functions/src/assistant/assistantEmpresaScope.ts` y `resolveAssistantEmpresaScope` aplican la misma lógica de scope por tenant/migración.

### 3.2 Legacy Bacarsa (confirmado)

- Existe compatibilidad explícita para documentos sin `empresaId` como legacy de Bacarsa (`bacarsaLegacyOpen`, fallbacks en `belongsToEmpresaView` y reglas).
- Es funcional para transición, pero agrega complejidad y puntos de ambigüedad (especialmente cuando hay docs históricos no etiquetados).
- **Implicancia**: la empresa de capacitación **debe nacer con `migracionCompleta=true` y `empresaId` sellado en todo alta**, sin depender de fallbacks Bacarsa.

### 3.3 Veredicto de aislamiento

**Sí, una empresa de entrenamiento puede aislar la mayor parte de escrituras operativas**, siempre que:

- el usuario no tenga bypass (`SuperAdmin` / `allEmpresas`),
- se usen rutas frontend y callables que respetan tenant,
- y se controlen superficies globales/legacy listadas en riesgos.

Para el diseño acordado (“datos que no se deben guardar”), el aislamiento tenant + **purge al terminar** es el mecanismo correcto: se practica en pantallas reales, sin dejar huella operativa permanente.

---

## 4. Riesgos de contaminación de producción

Riesgos priorizados por severidad para la opción “empresa de entrenamiento en el mismo Firebase”.

### R1 — Callables legacy sin aserción tenant estricta (ALTO)

**Confirmado en `apps/functions/src/index.ts`:**

- `manageData`, `manageHierarchy`, `manageEmployees`, `manageSystemUsers`, `manageShifts`, etc. validan rol admin pero no `empresaId` contra perfil en backend.
- Estos handlers usan Admin SDK/Nest services (bypass de `firestore.rules`), por lo que una llamada mal formada podría afectar otros tenants.

### R2 — Payroll API key/snapshot con validación insuficiente (ALTO)

**Confirmado en `index.ts`:**

- `createPayrollApiKey`, `revokePayrollApiKey`, `getPayrollSnapshotInternal` exigen autenticación, pero no validan explícitamente tenant del caller para `empresaId` solicitada.

Impacto: posible lectura/creación de integraciones fuera del tenant esperado.

### R3 — Endpoints operativos globales por secret (ALTO)

**Confirmado en `cleanupSlaDevueltas` (`index.ts`):**

- Si se invoca sin `empresaId`, opera globalmente sobre `turnos`/`novedades` de tipo SLA virtual.

### R4 — Superficies globales no tenant (MEDIO/ALTO)

Colecciones/config de alcance plataforma:

- `system_config`, `system_secrets`, `scheduled_job_logs`, parte de `planificaciones_historial`, `historial_operaciones`, `convenios_colectivos` (según reglas).
- Móvil (`apps/functions/src/mobileApp/*`) usa `system_config/mobile_app` y `system_secrets/mobile_app` globales.

Impacto: cambios en capacitación pueden alterar comportamiento global si se habilitan módulos equivocados.

### R5 — Cron jobs compartidos (MEDIO)

Crons (`autoCompletarTurnos`, `detectarAusencias`, `gestionarVacantes`, etc.) procesan datos de múltiples empresas en el mismo proyecto; aplican lógica por `empresaId`, pero el runtime es compartido.

Impacto: ruido operativo, notificaciones y costos si el tenant de capacitación genera turnos “reales” visibles a los crons. Mitigación: `centroControlEnabled=false` y/o `modoDemoEnabled` solo en ese tenant, o flag `isTrainingEmpresa`.

### R6 — Canales externos reales (MEDIO)

- Notificaciones push (FCM), correo de activación portal, AFIP, payroll, backups Drive.
- Aunque muchos flujos sellan `empresaId`, siguen operando sobre infraestructura productiva real.
- Mitigación MVP: deshabilitar push/email/AFIP/payroll en sesión de capacitación.

### R7 — Modelo legacy Bacarsa (MEDIO)

- Documentos sin `empresaId` y fallbacks Bacarsa pueden inducir lecturas ambiguas en casos límite.

### R8 — Cleanup incompleto deja residuos (MEDIO) — relevante al diseño “no guardar”

- `eliminarEmpresaYDatos` hoy no cubre todas las colecciones usadas en el circuito (faltan, según uso real: `hours_balances`, `contracts`, `quotes`, `solicitudes_refuerzo`, `convocatorias_cobertura`, `tipos_novedad`, locks de payroll, etc.).
- Auth users / `device_tokens` / emails no se revierten con el purge de Firestore.
- **Hipótesis H4**: el purge de capacitación debe ser un callable dedicado con inventario exhaustivo + borrado de docs marcados `sessionId`/`createdByTrainingSession`, no solo `eliminarEmpresaYDatos` tal cual.

### Hipótesis a validar (etiquetadas)

- **H1**: algunos flujos viejos de UI todavía pueden invocar callables legacy de forma no evidente para el usuario.
- **H2**: la operación diaria actual ya no depende de varias rutas legacy, pero siguen desplegadas por compatibilidad.
- **H3**: los permisos por rol en producción real reducen riesgo práctico, aunque no eliminan riesgo técnico por callable.
- **H4**: hace falta un inventario cerrado de colecciones a purgar por sesión de capacitación (más amplio que `COLECCIONES_A_ELIMINAR` actual).

---

## 5. Opciones A/B/C/D y recomendación

### A) Empresa de entrenamiento dentro del Firebase productivo (sandbox tenant)

**Pros**
- Más rápida de habilitar.
- Reusa autenticación, módulos y UX real (coach in-situ).
- Encaja con “empresa aparte + borrar datos al terminar”.

**Contras**
- Convivencia con superficies globales/callables legacy.
- Requiere hardening y purge confiable.

**Esfuerzo estimado**: **M**

---

### B) Proyecto Firebase separado (lab aislado)

**Pros**
- Aislamiento físico total (datos, secretos, jobs, integraciones).
- Riesgo de contaminación productiva casi nulo por diseño.

**Contras**
- Mayor costo operativo (deploys, seed, mantenimiento).
- El coach in-situ sigue haciendo falta; el aislamiento solo no enseña.

**Esfuerzo estimado**: **L**

---

### C) Feature flag “modo capacitación” sobre tenant fijo + seed/reset

**Pros**
- UX homogénea y controlada.
- Permite bloquear funciones peligrosas cuando `trainingMode=true`.

**Contras**
- Si comparte proyecto productivo, sigue existiendo riesgo residual.
- Sin “empresa aparte” clara, el alumno puede confundir prod vs práctica.

**Esfuerzo estimado**: **M/L**

---

### D) Híbrido (A endurecido ahora → B si hace falta)

**Pros**
- Valor rápido + camino a aislamiento físico.
- Valida pedagogía (coach por rol) antes de invertir en segundo proyecto.

**Contras**
- Gobernanza por fases; riesgo residual controlado en fase 1.

**Esfuerzo estimado**: **L (total)**, fase 1 **M**.

---

### Recomendación (actualizada a la decisión de Mauro)

**Recomendación operativa: Opción A endurecida**, con el contrato de producto:

| Requisito Mauro | Diseño |
|---|---|
| Empresa aparte | Tenant `capacitacion_*` (o uno por cohorte/sesión), nunca Bacarsa |
| Al terminar, borrar lo creado | Purge tenant/sesión al completar, abortar o timeout |
| Usar el rol para ver qué módulos aprender | Coaches derivados de `roles.permissions` |
| Seguimiento paso a paso en cada módulo | Overlay/wizard in-situ (ej. Planificación: cronograma → turno → publicar) |
| Datos que no se deben guardar | Solo sandbox; progreso pedagógico sí se guarda (hitos/score), datos de negocio no |

**Opción D** queda como roadmap de riesgo: si el purge/hardening no alcanza o el volumen de alumnos crece, mover el sandbox a proyecto Firebase separado (B).

Racional:

- Mauro pide práctica in situ en pantallas reales + datos descartables: eso es un **sandbox tenant con coach**, no un segundo slideshow ni un lab sin UX.
- El aislamiento lógico actual alcanza para MVP si el alumno **no** es SuperAdmin/`allEmpresas` y las escrituras van siempre con `empresaId` de capacitación.
- Lo que NO debe persistir: clientes/SLA/turnos/novedades de práctica. Lo que SÍ puede persistir: progreso de aprendizaje del usuario (`capacitacion_progreso` / campos en `system_users`).

---

## 6. Alcance MVP vs completo

### MVP (mínimo útil — alineado a la decisión)

1. **Empresa entrenamiento dedicada** (`capacitacion_*`, `migracionCompleta=true`).
2. **Entrada a modo capacitación** que fija el contexto del alumno a ese tenant (sin selector de empresas productivas).
3. **Plan de aprendizaje por rol**: lista de módulos = permisos READ del rol (map a coaches CRM/Servicios/Planificación/Operaciones/RRHH).
4. **Coach in-situ en al menos 2 módulos MVP** (propuesta: **CRM + Planificación**), con micro-pasos verificables.
5. **Seguimiento de aprendizaje** por usuario: hitos completados, módulo actual, % progreso (persistente).
6. **Cleanup al terminar**: al marcar “Finalizar capacitación” (o al salir forzado), borrar datos de negocio creados en la sesión/tenant de práctica; conservar solo el progreso pedagógico.
7. **Guardrails**: sin SuperAdmin en sesión alumno; sin API keys/AFIP/payroll; Centro de Control apagado o aislado para no disparar crons/push reales.

### Completo (versión madura)

1. Coaches para todos los módulos del circuito (CRM → … → Reportes).
2. Escenarios de incidente (ausencia, vacante, refuerzo) con rúbrica automática.
3. Instructor view (estado por alumno, reintentos, tiempos por paso).
4. Sesiones concurrentes (sandbox por alumno o por cohorte) sin pisarse.
5. Proyecto Firebase separado si el riesgo/volumen lo exige.
6. Soft-fail de cleanup + reporte de residuos no purgados.

---

## 7. Diseño propuesto (empresa aparte + datos efímeros + coach por rol)

### 7.1 Modelo de sesión

```
system_users/{uid}
  role → define módulos a aprender
capacitacion_sesiones/{sessionId}
  empresaId: "capacitacion_..."
  alumnoUid, roleId
  status: ACTIVE | COMPLETED | ABORTED
  modulesPlan: ["CLIENTS","PLANNING",...]
  progress: { CLIENTS: { stepsDone: [...], completedAt }, ... }
  startedAt, endedAt
```

Todo doc de negocio creado en la sesión lleva:

- `empresaId` = empresa capacitación
- `trainingSessionId` = sessionId (para purge selectivo)

**Persistente al terminar:** progreso/score en sesión o en `system_users.onboardingGuide` extendido.  
**No persistente:** `clients`, `servicios_sla`, `turnos`, `ausencias`, `novedades`, etc. de la práctica.

### 7.2 Empresa de entrenamiento

- Crear empresa dedicada (no Bacarsa legacy).
- `migracionCompleta=true` desde inicio.
- Flags sugeridos: `isTrainingEmpresa: true`, `centroControlEnabled: false` (evitar crons/push reales).
- Usuarios de práctica con `empresaId` fijo al sandbox; sin `allEmpresas`.

### 7.3 Cleanup al terminar (contrato “no se deben guardar”)

Flujo:

1. Alumno / instructor cierra sesión de capacitación (o timeout).
2. Callable `finalizeTrainingSession({ sessionId })`:
   - valida que `empresaId` sea training y pertenezca a la sesión;
   - borra docs con `trainingSessionId == sessionId` (preferible) o purge tenant completo si la empresa es 1:1 con la sesión;
   - marca sesión `COMPLETED` y congela progreso pedagógico;
   - escribe `audit_logs` del cleanup.
3. Si falla parte del purge → estado `CLEANUP_PARTIAL` + alerta a Sistemas (no silenciar).

**Control clave**: el callable debe rechazar cualquier `empresaId` que no sea de capacitación.

### 7.4 Coach + checklist verificable

Ejemplo Planificación (evidencia):

| Micro-paso | Evidencia |
|---|---|
| Elegir cliente/objetivo | UI state + ids válidos del tenant training |
| Crear/asignar turno | existe `turnos` con `trainingSessionId` |
| Publicar | `planificacion_estados.publishedAt` set |
| Módulo completo | todos los micro-pasos OK → `progress.PLANNING.completedAt` |

Ejemplo CRM:

| Micro-paso | Evidencia |
|---|---|
| Crear cliente | `clients` con `empresaId` training |
| Cargar objetivo | `clients.objetivos[]` con id |
| (Opcional) contrato | `contracts` training |

No usar checkboxes locales como fuente de verdad (como hace hoy `/admin/guia` con `localStorage`).

### 7.5 Guardrails

- Bloquear/ocultar CONFIG global, API keys, AFIP, mobile builds, restore/migrate.
- Denegar callables legacy de alto impacto al rol en sesión training (o forzar que pasen por wrapper con `assertPanelTenantCallable` + allowlist de empresa training).
- Silenciar FCM/email en docs training (o no registrar `device_tokens` de práctica).
- Banner visible: “Modo capacitación — los datos de práctica se borran al finalizar”.

---

## 8. Workstreams y esfuerzo (S/M/L)

| Workstream | Descripción | Esfuerzo |
|---|---|---|
| WS1 Sesión + empresa training | Crear/activar sandbox, flags, fijar contexto alumno | **M** |
| WS2 Plan por rol | Derivar módulos a aprender desde `roles.permissions` | **S** |
| WS3 Coach in-situ | Overlay/wizard por módulo (MVP: CRM + Planificación) | **M/L** |
| WS4 Evidencia de hitos | Detectores de progreso por queries/acciones reales | **M** |
| WS5 Cleanup al finalizar | Callable purge por `trainingSessionId` / tenant training | **M** |
| WS6 Hardening callables | Tenant assert + bloqueo de rutas peligrosas en training | **L** |
| WS7 UX progreso alumno | Panel “qué me falta” + reanudar módulo | **M** |
| WS8 Instructor view | Estado multi-alumno, forzar cleanup, reintentos | **M/L** |
| WS9 Aislamiento físico (opcional) | Proyecto Firebase lab si se escala | **L** |

---

## 9. Criterios de éxito

1. El alumno practica en pantallas reales de COSP dentro de una **empresa aparte**.
2. Solo ve coaches de módulos permitidos por **su rol**.
3. En Planificación (y demás módulos MVP) el coach lo lleva **paso a paso** hasta completar la acción real (ej. publicar).
4. Al finalizar, **no quedan** clientes/SLA/turnos/novedades de práctica en Firestore (progreso pedagógico sí).
5. Cero escrituras en tenants productivos (`bacarsa` u otros) durante la sesión.
6. El circuito es repetible: nueva sesión = sandbox limpio + mismos coaches.

---

## 10. Preguntas para Mauro (bloqueantes antes de implementar)

Resueltas por decisión previa:
- Empresa aparte + datos efímeros + coach por rol → **sí**.

Pendientes (gates de arranque):

1. **Sandbox 1:1**: ¿una sola empresa `capacitacion` compartida (con `trainingSessionId` por alumno) o una empresa/sesión por alumno?
2. **Permisos de escritura**: ¿el alumno usa su rol real (puede que solo tenga READ) o un rol “práctica” con create/update/publish solo en el sandbox?
3. **Alcance MVP de coaches**: ¿arranquemos por CRM + Planificación, o priorizás Operaciones?
4. **Momento del borrado**: ¿solo al “Finalizar”, también al cerrar sesión/navegador, y/o TTL automático (ej. 24 h)?
5. **Qué sí guardar**: ¿además del % de progreso, historial de intentos/tiempos por paso para el instructor?
6. **Notificaciones**: ¿sandbox total sin push/email?
7. **Herramienta de ejecución**: ¿Cursor Cloud, Claude Code, o mix por fase? (recomendación abajo)

---

## 11. Inventario: qué ya existe de la guía interactiva (reutilizar)

> Nota: `docs/analisis-guia-interactiva.md` quedó **parcialmente desactualizado**. Ayer/reciente ya se avanzó a onboarding obligatorio con tracks, progreso remoto e instructor. Esta sección es la fuente de verdad actual para el plan.

### 11.1 Activos listos para REUTILIZAR (no rehacer)

| Activo | Ubicación | Qué aporta al modo capacitación |
|---|---|---|
| Modelo de progreso | `apps/web2/src/lib/onboardingGuide.ts` | Tracks `OPERATIONS\|PLANNING\|CRM\|SERVICES\|RRHH`, status, `progressPct`, `completedTracks`, normalizers, filtro por permisos de rol |
| Gate obligatorio | `DashboardLayout` → `needsMandatoryOnboarding` | Fuerza `/admin/guia` hasta completar |
| UI alumno guía | `apps/web2/src/pages/admin/guia/index.tsx` | Wizard por pasos, deep-link “Abrir módulo”, checklist por track, sync de progreso |
| Checklist por track | `TRACK_CHECKLIST` en `guia/index.tsx` | Texto de hitos (hoy manual; base para convertir a evidencia) |
| Callable progreso | `updateOnboardingGuideProgress` | Actions `PROGRESS\|COMPLETE\|RESET` sobre `system_users.onboardingGuide` |
| Callable asignación | `assignOnboardingGuide` | Instructor asigna/libera tracks; respeta tenant/rol |
| Instructor UI | `OnboardingTab.tsx` + asignación en `UsersTab.tsx` | Seguimiento de quién tiene guía, estado, liberar |
| Auth carga guía | `AuthContext` | Expone `onboardingGuide` / `setOnboardingGuide` |
| Tracks ↔ módulos | `ONBOARDING_TRACK_MODULES` (front + functions) | Exactamente “usar el rol para ver qué módulos aprender” |
| Conocimiento asistente | `cospKnowledge` + router onboarding | FAQ de guía ya documentada para el globo |

### 11.2 Activos a EVOLUCIONAR (no tirar, transformar)

| Hoy | Limitación | Evolución hacia capacitación real |
|---|---|---|
| Guía = slideshow en `/admin/guia` | No practica in situ | Mantener como **hub de progreso**; el aprendizaje ocurre en el módulo con coach overlay |
| Checklist = checkboxes + `localStorage` | Declarativo, no evidencia | Reemplazar por detectores Firestore (`trainingSessionId`) |
| Progreso solo pedagógico | No hay sandbox | Extender `onboardingGuide` o agregar `capacitacion_sesiones` sin romper campos actuales |
| “Abrir módulo” sin coach | El alumno queda solo | Al abrir módulo en modo training, montar coach paso a paso |
| Empresa del usuario = prod | Riesgo de datos reales | Forzar contexto a empresa `capacitacion_*` durante la sesión |

### 11.3 Activos NUEVOS (hay que construir)

1. Empresa/flag `isTrainingEmpresa` + seed baseline.
2. Sesión `capacitacion_sesiones` (o extensión tipada de `onboardingGuide`).
3. Stamp `trainingSessionId` en escrituras de práctica.
4. Coach overlays in-situ (MVP: CRM + Planificación).
5. Callable `finalizeTrainingSession` (purge efímero).
6. Guardrails: silenciar push/crons/API/AFIP en training.
7. Evidencia automática de micro-pasos (queries de hitos).

### 11.4 Qué NO tocar en las primeras fases

- Lógica core de `useOperacionesMonitor` / publicación de planificación (solo envolver con coach + stamps).
- `firestore.rules` de Bacarsa legacy (salvo allowlist mínima si hace falta para training).
- Migraciones/restore globales, payroll API, mobile builds.
- Reescribir `/admin/guia` desde cero: **reusar shell + progreso**.

---

## 12. Plan de ejecución controlado (listo para Cursor / Claude)

### 12.1 Principios de control

1. **Analysis-only hasta Gate 0** (preguntas §10 respondidas).
2. **Una fase = un PR** (o un worktree), con criterios de aceptación binarios.
3. **Reutilizar** onboarding existente; no duplicar tracks/progreso.
4. **Datos de negocio efímeros**; progreso pedagógico persistente.
5. **Smoke obligatorio** antes de pasar de fase (lista en cada fase).
6. **Rollback**: cada fase debe poder apagarse con flag (`trainingModeEnabled` / feature flag) sin romper la guía actual.

### 12.2 Mapa fase → herramienta sugerida

| Fase | Mejor con | Por qué |
|---|---|---|
| F0 Decisiones + inventario cerrado | Chat / Mauro | Producto, no código |
| F1 Sandbox empresa + seed + flags | **Cursor** | CRUD empresas, scripts seed, flags en `empresas` |
| F2 Extender progreso + sesión training | **Cursor** | Tipado TS + callables alineados a `onboardingGuide` |
| F3 Coach in-situ CRM + Planificación | **Cursor** (UI) o **Claude** (si hay skill UI larga) | Mucho JSX en pantallas grandes; Cursor con contexto de repo |
| F4 Evidencia automática de hitos | **Cursor** | Queries Firestore + tests/smoke |
| F5 Cleanup/purge al finalizar | **Cursor** + review humana | Riesgo de borrado; necesita allowlist estricta |
| F6 Hardening callables/guardrails | **Cursor** + review | Seguridad; no confiar en un solo agente |
| F7 Instructor + métricas | Cualquiera | Extiende `OnboardingTab` |

**Recomendación de mix:** Mauro responde F0 → ejecutar F1–F2–F4–F5 en Cursor Cloud con este doc como protocol → F3 coach UI en Cursor (rama dedicada) → F6 con review obligatoria de Sistemas antes de merge a `main`/`eventos-deploy`.

### 12.3 Fases detalladas

#### Gate 0 — Decisiones (bloqueante)

- [ ] Responder §10 (sandbox 1:1 vs compartido, permisos escritura, coaches MVP, TTL cleanup).
- [ ] Congelar alcance MVP: **CRM + Planificación** (salvo que Mauro priorice Operaciones).
- [ ] Confirmar: la guía actual sigue como hub obligatorio hasta que el coach in-situ cubra los tracks.

**Salida:** checklist Gate 0 firmado en este doc o comentario de PR.

---

#### Fase 1 — Sandbox empresa (S/M)

**Objetivo:** existir `empresas/capacitacion_*` usable sin tocar Bacarsa.

**Reusar:** `guardarEmpresa`, `EmpresaContext`, seed scripts (`seed-empresa-prueba.js` si aplica).

**Hacer:**
1. Crear empresa training con `migracionCompleta=true`, `isTrainingEmpresa=true`, `centroControlEnabled=false`.
2. Seed mínimo: 1 cliente, 1 objetivo, 1 SLA, 3–5 empleados ficticios (emails no productivos).
3. Usuario alumno de prueba con `empresaId=capacitacion_*`, sin `allEmpresas`.
4. Banner/contexto UI cuando `empresa.isTrainingEmpresa`.

**Aceptación:**
- Login alumno solo ve datos del sandbox.
- Ningún doc nuevo lleva `empresaId=bacarsa`.
- Flag feature permite desactivar UI training.

**Smoke:** crear cliente en sandbox → aparece solo ahí; Bacarsa intacto.

---

#### Fase 2 — Sesión + progreso unificado (M)

**Objetivo:** no romper `onboardingGuide`; agregar capa de sesión efímera.

**Reusar:** `OnboardingGuideState`, `updateOnboardingGuideProgress`, tracks por rol, `assignOnboardingGuide`, `OnboardingTab`.

**Hacer:**
1. Extender modelo (opción preferida):
   - `onboardingGuide.mode: 'GUIDE' | 'TRAINING'`
   - `onboardingGuide.activeSessionId`
   - o colección `capacitacion_sesiones` referenciada desde la guía.
2. Al iniciar training: crear sesión + plan de tracks = `filterTracksByRolePermissions(...)`.
3. Mantener gate `needsMandatoryOnboarding` (training incompleto = bloqueo igual que guía).
4. Compatibilidad: usuarios solo-guía (sin sandbox) siguen funcionando.

**Aceptación:**
- Asignar onboarding desde Config sigue funcionando.
- Iniciar training crea `sessionId` y no borra `completedTracks` previos sin RESET explícito.
- Rollback: `mode=GUIDE` restaura comportamiento actual.

**Smoke:** assign tracks → progreso PROGRESS/COMPLETE sin sesión; luego con sesión.

---

#### Fase 3 — Coach in-situ MVP (M/L) — CRM + Planificación

**Objetivo:** al entrar al módulo en modo training, guiar micro-pasos reales.

**Reusar:** textos/checklist de `TRACK_CHECKLIST` + deep-links de `/admin/guia`; no reescribir el hub.

**Hacer:**
1. Componente `TrainingCoachOverlay` (pasos, CTA, “hecho / falta”).
2. Integración mínima en:
   - `crm/index.tsx` (crear cliente → objetivo),
   - `planificacion/index.tsx` (seleccionar → turno → publicar).
3. Cada acción exitosa emite evento `training_step_done` → actualiza progreso remoto.
4. Hub `/admin/guia` muestra estado del coach (“CRM 2/3”, “Planificación pendiente”) en lugar de solo slideshow.

**Aceptación:**
- Alumno sin leer el slideshow puede completar CRM+Planificación solo con el overlay.
- Publicar cronograma marca hito PLANNING.
- Fuera de modo training, overlay no aparece.

**Smoke:** grabación/manual: flujo completo CRM→publicar en sandbox.

---

#### Fase 4 — Evidencia automática (M)

**Objetivo:** checklist deja de ser checkbox manual.

**Reusar:** IDs de `TRACK_CHECKLIST` como keys de evidencia.

**Hacer:**
1. Detectores por hito (ej. `crm-cliente`: existe client con `trainingSessionId`).
2. Callable o client helper `verifyTrainingEvidence(sessionId, track)`.
3. `COMPLETE` solo si evidencia OK (servidor valida; no confiar en el cliente).

**Aceptación:**
- Marcar checkbox a mano no alcanza para completar.
- Borrar el cliente de práctica invalidaría el hito hasta recrearlo (o hasta cleanup).

---

#### Fase 5 — Cleanup efímero (M) — crítico

**Objetivo:** al finalizar, borrar datos de negocio de la práctica.

**Reusar:** idea de `eliminarEmpresaYDatos`, pero **no** usarla cruda (inventario incompleto).

**Hacer:**
1. Inventario cerrado de colecciones a purgar (doc interno en el PR de la fase).
2. Callable `finalizeTrainingSession`:
   - allowlist `empresaId` training,
   - preferir delete por `trainingSessionId`,
   - conservar `onboardingGuide` progreso,
   - audit log del purge.
3. Estados: `COMPLETED` | `CLEANUP_PARTIAL`.
4. TTL opcional (job diario) para sesiones abandonadas.

**Aceptación:**
- Tras finalizar: 0 docs de negocio con ese `trainingSessionId`.
- Progreso pedagógico permanece (`COMPLETED` / `completedTracks`).
- Intentar purge de `bacarsa` → `permission-denied`.

**Smoke + control:** dry-run primero; luego run real en sandbox vacío de prod.

---

#### Fase 6 — Hardening (L) — control de riesgo

**Objetivo:** cerrar bleed paths mientras el sandbox vive en el mismo Firebase.

**Hacer (prioridad):**
1. Wrapper tenant en callables usadas por CRM/Planificación training.
2. Bloquear en training: payroll keys, AFIP prod, cleanup global, migrate/restore.
3. No FCM / no email real (o allowlist de mails `*@capacitacion.local`).
4. Crons: `centroControlEnabled=false` en empresa training (ya en F1) + skip `isTrainingEmpresa` en crons sensibles si hace falta.

**Aceptación:** suite corta de “no puede escribir fuera del sandbox”.

---

#### Fase 7 — Instructor + cierre de producto (M)

**Reusar:** `OnboardingTab` stats + assign.

**Hacer:**
1. Columnas: sesión activa, último hito, cleanup OK/PARTIAL.
2. Botón “Forzar cleanup”.
3. (Opcional) coaches Operaciones/RRHH/Servicios.

---

### 12.4 Orden de merge recomendado

```
Gate0 → F1 → F2 → F3 → F4 → F5 → F6 → F7
              \__________________/
                 MVP usable interno
```

**MVP interno “capacitacion v1”** = F1+F2+F3+F4+F5 (con F6 mínimo: bloqueo de callables peligrosas + CC off).

### 12.5 Prompt plantilla para ejecutar una fase (Cursor/Claude)

```text
Leé CLAUDE.md y docs/alcance-modo-capacitacion-empresa-entrenamiento.md §11–§12.
Implementá SOLO la Fase N (nombre). No implementes otras fases.
Reutilizá onboardingGuide / callables existentes; no dupliques el modelo de progreso.
Restricciones: soft-delete de usuarios/clientes según reglas del repo; stamp empresaId;
no tocar Bacarsa; tests/smoke listados en la fase; un PR por fase.
Al terminar: checklist de aceptación de la fase marcado con evidencia.
```

### 12.6 Criterios globales de “listo para producción pedagógica”

1. Guía actual sigue funcionando para usuarios no-training.
2. Alumno training completa CRM+Planificación in situ.
3. Cleanup deja sandbox limpio; progreso queda.
4. Auditoría no muestra writes a tenants productivos.
5. Feature flag apaga todo el modo training sin romper el panel.

---

## Síntesis ejecutiva

- **Diseño acordado**: empresa aparte + datos **efímeros** + plan por **rol** + **coach in-situ**.
- **No partir de cero**: ya existen tracks, progreso remoto, gate obligatorio, instructor y callables de onboarding — hay que **encajar** el sandbox/coach encima.
- **Plan controlado**: Gate 0 → F1…F7; MVP = F1–F5 (+ hardening mínimo F6).
- **Ejecución**: fases en PRs separados; Cursor para implementación; review humana en purge/hardening.
- **Condición no negociable**: nunca escribir práctica en Bacarsa/prod; al terminar no quedan datos de negocio de la sesión.
