# Modo capacitación — alcance y opciones

> **Decisión de producto (Mauro, 2026-09-16):** la capacitación debe ser una **empresa aparte** (sandbox tenant), con **datos efímeros** que se borran al terminar; el **rol del usuario** define qué módulos aprender; dentro de cada módulo hay un **seguimiento guiado paso a paso** (ej. Planificación: crear cronograma → generar turno → publicar). Los datos de práctica **no se conservan** como operación real.
>
> **Gate 0 cerrado (Mauro + recomendación Crono, 2026-09-16):**
> 1. Sandbox **compartido** `capacitacion` + aislamiento por `trainingSessionId` (no empresa 1:1 por alumno en MVP).
> 2. **Rol real** = qué módulos enseña el coach; **rol práctica** = permisos de escritura temporales solo dentro del sandbox.
> 3. Plan de módulos = **rol asignado** (si solo PLANNING → arranca en Planificación; si tiene SERVICES → carga servicios; etc.).
> 4. **Borrado al terminar cada módulo** (no solo al cierre total) + registro de “entendió / aprobado” del módulo.
> 5. **Guardar todo el progreso pedagógico y calificar** (score/rúbrica por módulo e historial para instructor).

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
2. **Datos solo para práctica** — se escriben en el tenant de capacitación y se **eliminan al completar cada módulo** (y al abortar/TTL de sesión).
3. **Recorrido por rol** — los módulos a aprender salen del **rol real asignado** (`roles/{id}.permissions`, mismos módulos que usa el panel). Ejemplo: planificador sin SERVICES → coach de Planificación (con seed previo); quien carga servicios → coach de SERVICES primero.
4. **Coach in-situ por módulo** — al entrar a un módulo, un overlay/wizard lleva al alumno por cada micro-paso (no slideshow separado).
5. **Seguimiento + calificación** — cada micro-paso se marca por evidencia (acción real en UI + doc creado/actualizado); al cerrar el módulo se guarda score/rúbrica y se registra que el alumno **entendió el funcionamiento** del módulo.

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

Regla: **si el rol real no tiene READ del módulo, ese coach no aparece**. Si el rol real tiene READ pero no CREATE/PUBLISH, en sandbox se activa el **rol práctica** (escritura temporal solo en `capacitacion`) para que pueda completar el circuito; fuera del sandbox vuelve a su rol real.

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
| Empresa aparte | Tenant compartido `capacitacion` (+ `trainingSessionId`), nunca Bacarsa |
| Borrar lo creado | Purge por `trainingSessionId` **al completar cada módulo**; TTL/abort de sesión |
| Usar el rol para ver qué módulos aprender | Coaches = permisos READ del **rol real** |
| Poder practicar aunque el rol sea solo lectura | **Rol práctica**: create/update/publish solo dentro del sandbox |
| Seguimiento paso a paso en cada módulo | Overlay/wizard in-situ + evidencia + **calificación** |
| Datos que no se deben guardar | Negocio de práctica no; progreso + score + historial sí |

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
6. **Cleanup por módulo**: al marcar un módulo como “entendido/aprobado”, borrar datos de negocio de ese módulo/sesión; conservar progreso + calificación. Al abortar o TTL, purge residual.
7. **Guardrails**: sin SuperAdmin en sesión alumno; sin API keys/AFIP/payroll; Centro de Control apagado o aislado para no disparar crons/push reales.
8. **Calificación**: score por módulo (evidencia + tiempos + reintentos) visible para instructor.

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
  role → ROL REAL (define qué módulos enseña el coach)
capacitacion_sesiones/{sessionId}
  empresaId: "capacitacion"          // sandbox compartido MVP
  alumnoUid, roleIdReal
  practiceWriteEnabled: true         // rol práctica solo en sandbox
  status: ACTIVE | COMPLETED | ABORTED
  modulesPlan: ["CLIENTS","PLANNING",...]  // derivado del rol real
  progress: {
    CLIENTS: {
      stepsDone: [...],
      understoodAt,                  // “dio por entendido”
      score: 0-100,
      attempts, durationMs,
      cleanedUpAt
    },
    ...
  }
  overallScore
  startedAt, endedAt
```

Todo doc de negocio creado en la sesión lleva:

- `empresaId` = `capacitacion`
- `trainingSessionId` = sessionId (purge selectivo por alumno/módulo)
- `trainingModuleKey` (opcional, para purge fino al cerrar un módulo)

**Persistente al terminar módulo/sesión:** progreso, score, historial de intentos/tiempos, flag `understood`.  
**No persistente:** `clients`, `servicios_sla`, `turnos`, `ausencias`, `novedades`, etc. de la práctica (se borran al completar el módulo o al abortar).

### 7.2 Empresa de entrenamiento

- **Una sola** empresa compartida `capacitacion` en MVP (recomendación Crono; ver §10.1).
- `migracionCompleta=true` desde inicio.
- Flags: `isTrainingEmpresa: true`, `centroControlEnabled: false`.
- Alumnos con `empresaId` fijado al sandbox durante training; sin `allEmpresas`.
- Aislamiento concurrente por `trainingSessionId` (no por empresa 1:1).

### 7.3 Rol real vs rol práctica

| Concepto | Qué es | Para qué sirve |
|---|---|---|
| **Rol real** | El rol COSP del usuario (`system_users.role` → `roles/{id}.permissions`) | Decide **qué módulos** aparecen en el plan de capacitación |
| **Rol práctica** | Capacidad temporal de create/update/publish **solo** en `empresaId=capacitacion` y mientras `session.status=ACTIVE` | Permite completar el circuito aunque el rol real sea solo lectura |

Ejemplos:

- Usuario “Planificador” (PLANNING create/publish, sin SERVICES) → coaches de Planificación; el seed de CRM/SLA lo provee el sistema o un instructor.
- Usuario “Comercial/CRM” (CLIENTS + SERVICES) → coaches CRM → Servicios; luego puede o no tocar Planificación según permisos.
- Usuario “Operador” (OPERATIONS) → coach Operaciones sobre planificación ya publicada (seed).

El rol práctica **no** eleva permisos en Bacarsa/prod ni en CONFIG.

### 7.4 Cleanup al completar cada módulo (contrato Mauro)

Flujo:

1. Alumno completa evidencia del módulo → coach pide confirmar “Entendí el funcionamiento”.
2. Callable `completeTrainingModule({ sessionId, moduleKey })`:
   - valida evidencia + calcula `score`;
   - setea `progress[module].understoodAt` + `score`;
   - borra docs con `trainingSessionId == sessionId` **y** (si aplica) `trainingModuleKey == moduleKey` o grafo de dependencia del módulo;
   - deja audit log.
3. Al cerrar toda la sesión / abort / TTL: `finalizeTrainingSession` purga residuales de la sesión.
4. Si falla parte del purge → `CLEANUP_PARTIAL` + alerta a Sistemas.

**Control clave**: callables de purge rechazan cualquier `empresaId` que no sea `capacitacion` / `isTrainingEmpresa`.

### 7.5 Coach + checklist verificable + calificación

Ejemplo Planificación (evidencia):

| Micro-paso | Evidencia | Peso score (ej.) |
|---|---|---|
| Elegir cliente/objetivo | UI state + ids válidos del tenant training | 10 |
| Crear/asignar turno | existe `turnos` con `trainingSessionId` | 40 |
| Publicar | `planificacion_estados.publishedAt` set | 40 |
| Módulo completo / entendido | todos OK + confirmación → `understoodAt` | 10 |

Ejemplo CRM:

| Micro-paso | Evidencia | Peso score (ej.) |
|---|---|---|
| Crear cliente | `clients` con `empresaId` training | 40 |
| Cargar objetivo | `clients.objetivos[]` con id | 40 |
| (Opcional) contrato | `contracts` training | 20 |

Rúbrica mínima MVP: % de micro-pasos con evidencia + penalización por reintentos excesivos + tiempo (informativo, no bloqueante).  
No usar checkboxes locales como fuente de verdad (como hace hoy `/admin/guia` con `localStorage`).

### 7.6 Guardrails

- Bloquear/ocultar CONFIG global, API keys, AFIP, mobile builds, restore/migrate.
- Denegar callables legacy de alto impacto al rol en sesión training (o forzar wrapper con `assertPanelTenantCallable` + allowlist `capacitacion`).
- Silenciar FCM/email en docs training (o no registrar `device_tokens` de práctica).
- Banner visible: “Modo capacitación — los datos de práctica se borran al completar cada módulo”.

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

1. El alumno practica en pantallas reales de COSP dentro de la **empresa `capacitacion`**.
2. Solo ve coaches de módulos permitidos por **su rol real**.
3. Puede escribir en sandbox vía **rol práctica** aunque su rol real sea solo lectura en ese módulo.
4. En cada módulo MVP el coach lo lleva **paso a paso** hasta completar la acción real; al cerrar se registra **entendido + score**.
5. Al completar un módulo, **no quedan** datos de negocio de esa práctica; el score/historial sí.
6. Cero escrituras en tenants productivos (`bacarsa` u otros) durante la sesión.
7. El circuito es repetible: nueva sesión = datos limpios + mismos coaches + calificación acumulable.

---

## 10. Gate 0 — respuestas Mauro + recomendación Crono

### 10.1 Sandbox compartido vs 1:1 — **¿qué me parece?**

**Recomendación: empresa compartida `capacitacion` + `trainingSessionId` por alumno/sesión.**

Por qué:

- Más barato de operar (un solo seed, un banner, un flag `isTrainingEmpresa`).
- Evita proliferar empresas fantasmas en `empresas/` y en selectores SuperAdmin.
- El aislamiento concurrente ya se resuelve stampando `trainingSessionId` en cada doc y purgando por ese id (por módulo y al cerrar).
- Empresa 1:1 por alumno escala mal (N empresas, N seeds, riesgo de residuos huérfanos) y solo vale la pena si el volumen o el cumplimiento lo exigen → queda como **Opción D / Fase madura**.

**Decisión Gate 0:** compartido + `trainingSessionId` (MVP). Revisar 1:1 solo si hay colisiones reales en pruebas concurrentes.

### 10.2 Rol real vs rol práctica — **qué significa**

| | Rol real | Rol práctica |
|---|---|---|
| Origen | `system_users.role` / matriz de permisos productiva | Flag/sesión de training (`practiceWriteEnabled`) |
| Decide | **Qué módulos** entran al plan de capacitación | **Si puede crear/editar/publicar** dentro del sandbox |
| Ámbito | Toda la app (identidad del usuario) | Solo `empresaId=capacitacion` mientras la sesión esté ACTIVE |
| Ejemplo | “Soy planificador → me enseñan Planificación” | “Aunque en prod solo leo, en capacitación puedo publicar un cronograma de mentira” |

Sin rol práctica, un usuario READ-only no puede “aprender haciendo”. Sin rol real, no sabríamos qué circuito enseñarle.

**Decisión Gate 0:** rol real define el plan; rol práctica habilita escritura solo en sandbox.

### 10.3 Alcance de módulos — **depende del rol asignado**

Confirmado por Mauro: el recorrido **no es fijo para todos**.

- Si el rol tiene PLANNING y no SERVICES → arranca (o solo ve) Planificación; CRM/SLA vienen de **seed** del sandbox.
- Si el rol tiene CLIENTS/SERVICES → coaches de alta de cliente/objetivo/SLA.
- Si tiene OPERATIONS → opera sobre malla publicada (seed o de otro módulo previo de la misma sesión si el rol lo incluye).

MVP de implementación de coaches (ingeniería): CRM + Planificación primero; el **plan visible al alumno** sigue filtrado por rol. Operaciones/RRHH en fases siguientes.

**Decisión Gate 0:** módulos = rol asignado; coaches MVP técnicos = CRM + Planificación.

### 10.4 Momento del borrado — **al terminar cada módulo**

Confirmado por Mauro: al cerrar un módulo de capacitación (evidencia OK + “entendí el funcionamiento”) se:

1. Registra `understoodAt` + score del módulo.
2. Borra los datos de práctica asociados a ese módulo/sesión.
3. Deja el sandbox listo para el siguiente módulo o para reintento.

Además (operativo, recomendado Crono, no contradice a Mauro):

- Abort / “Finalizar capacitación” → purge residual de la sesión.
- TTL diario (ej. 24–48 h) para sesiones abandonadas → evita basura.

**Decisión Gate 0:** purge **por módulo** al entender/aprobar; purge residual al cerrar/TTL.

### 10.5 Qué guardar — **todo el progreso + calificar**

Confirmado por Mauro: guardar y calificar.

Persistir (pedagógico):

- Hitos/evidencia por micro-paso.
- `understoodAt` por módulo.
- Score 0–100 por módulo + `overallScore`.
- Intentos, duración, reintentos (para instructor).
- Estado cleanup OK/PARTIAL.

No persistir: clientes/SLA/turnos/novedades de práctica.

**Decisión Gate 0:** historial completo + rúbrica/score; negocio efímero.

### 10.6 Notificaciones y herramienta (defaults Crono, no bloqueantes)

- **Notificaciones:** sandbox **sin** push/email reales (mails `*@capacitacion.local` si hace falta).
- **Ejecución:** mix por fase (§12.2) — Cursor para UI/modelo; review humana en purge/hardening.

### 10.7 Checklist Gate 0 (firmado)

- [x] Empresa aparte + datos efímeros + coach por rol.
- [x] Sandbox compartido + `trainingSessionId` (no 1:1 en MVP).
- [x] Rol real = módulos; rol práctica = escritura sandbox.
- [x] Plan de módulos = rol asignado.
- [x] Borrado al completar cada módulo + registro de entendimiento.
- [x] Guardar progreso + calificar.
- [x] Coaches MVP técnicos: CRM + Planificación (resto por fases).
- [x] Sin push/email reales en sandbox (default).
- [x] Ejecución por fases §12; sin implementación hasta autorización explícita de Mauro para F1.

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
| Progreso solo pedagógico | No hay sandbox | Extender `onboardingGuide` + `capacitacion_sesiones` (score, understoodAt) |
| Sin calificación | — | Rúbrica por módulo en F5 / instructor F7 |
| “Abrir módulo” sin coach | El alumno queda solo | Al abrir módulo en modo training, montar coach paso a paso |
| Empresa del usuario = prod | Riesgo de datos reales | Forzar contexto a `capacitacion` durante la sesión |
| Cleanup solo al final | Residuos entre módulos | Purge al completar cada módulo (`completeTrainingModule`) |

### 11.3 Activos NUEVOS (hay que construir)

1. Empresa training compartida `capacitacion` + flags + seed.
2. Sesión `capacitacion_sesiones` + stamp `trainingSessionId` / `trainingModuleKey`.
3. Rol práctica (escritura sandbox) desacoplado del rol real.
4. Coach overlays in-situ (MVP: CRM + Planificación) + confirmación “entendí”.
5. Callables `completeTrainingModule` (score + purge módulo) y `finalizeTrainingSession`.
6. Detector de evidencia server-side + rúbrica.
7. Hardening de callables legacy / silenciar push-crons-AFIP en training.

### 11.4 Qué NO tocar en las primeras fases

- Lógica core de `useOperacionesMonitor` / publicación de planificación (solo envolver con coach + stamps).
- `firestore.rules` de Bacarsa legacy (salvo allowlist mínima si hace falta para training).
- Migraciones/restore globales, payroll API, mobile builds.
- Reescribir `/admin/guia` desde cero: **reusar shell + progreso**.

---

## 12. Plan de ejecución controlado (listo para Cursor / Claude)

### 12.1 Principios de control

1. **Gate 0 cerrado** (§10.7); implementación solo tras autorización explícita de Mauro para F1.
2. **Una fase = un PR** (o un worktree), con criterios de aceptación binarios.
3. **Reutilizar** onboarding existente; no duplicar tracks/progreso.
4. **Datos de negocio efímeros por módulo**; progreso + score persistentes.
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
| F5 Cleanup/purge por módulo + score | **Cursor** + review humana | Riesgo de borrado; needs allowlist estricta |
| F6 Hardening callables/guardrails | **Cursor** + review | Seguridad; no confiar en un solo agente |
| F7 Instructor + métricas | Cualquiera | Extiende `OnboardingTab` |

**Recomendación de mix:** Gate 0 cerrado → con OK de Mauro ejecutar F1–F2–F4–F5 en Cursor Cloud con este doc como protocol → F3 coach UI en Cursor (rama dedicada) → F6 con review obligatoria de Sistemas antes de merge a `main`/`eventos-deploy`.

### 12.3 Fases detalladas

#### Gate 0 — Decisiones (bloqueante) — **CERRADO 2026-09-16**

- [x] Responder §10 (sandbox compartido + `trainingSessionId`, rol real/práctica, coaches MVP, purge por módulo, score).
- [x] Congelar alcance MVP coaches: **CRM + Planificación** (plan visible sigue filtrado por rol).
- [x] Confirmar: la guía actual sigue como hub obligatorio hasta que el coach in-situ cubra los tracks.
- [ ] Autorización explícita de Mauro para arrancar **Fase 1** (implementación).

**Salida:** checklist Gate 0 firmado en §10.7 de este doc.

---

#### Fase 1 — Sandbox empresa (S/M)

**Objetivo:** existir `empresas/capacitacion` (compartida) usable sin tocar Bacarsa.

**Reusar:** `guardarEmpresa`, `EmpresaContext`, seed scripts (`seed-empresa-prueba.js` si aplica).

**Hacer:**
1. Crear empresa `capacitacion` con `migracionCompleta=true`, `isTrainingEmpresa=true`, `centroControlEnabled=false`.
2. Seed mínimo: 1 cliente, 1 objetivo, 1 SLA, 3–5 empleados ficticios (emails no productivos).
3. Usuario alumno de prueba con `empresaId=capacitacion`, sin `allEmpresas`.
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
   - colección `capacitacion_sesiones` (score, understoodAt, practiceWriteEnabled).
2. Al iniciar training: crear sesión + plan de tracks = `filterTracksByRolePermissions(...)` (**rol real**).
3. Activar **rol práctica** (`practiceWriteEnabled`) solo mientras `status=ACTIVE` y `empresaId=capacitacion`.
4. Mantener gate `needsMandatoryOnboarding` (training incompleto = bloqueo igual que guía).
5. Compatibilidad: usuarios solo-guía (sin sandbox) siguen funcionando.

**Aceptación:**
- Asignar onboarding desde Config sigue funcionando.
- Iniciar training crea `sessionId` y no borra `completedTracks` previos sin RESET explícito.
- Plan de módulos refleja el rol real; escritura sandbox no eleva permisos en prod.
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
4. Hub `/admin/guia` muestra estado del coach (“CRM 2/3 · score 80”, “Planificación pendiente”) en lugar de solo slideshow.
5. Al cerrar módulo: CTA “Entendí el funcionamiento” → dispara score + purge del módulo (F5).

**Aceptación:**
- Alumno sin leer el slideshow puede completar CRM+Planificación solo con el overlay.
- Publicar cronograma marca hito PLANNING.
- Confirmación “entendí” deja `understoodAt` (purge en F5).
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

#### Fase 5 — Cleanup efímero por módulo + score (M) — crítico

**Objetivo:** al completar/entender un módulo, calificar y borrar datos de negocio de esa práctica.

**Reusar:** idea de `eliminarEmpresaYDatos`, pero **no** usarla cruda (inventario incompleto).

**Hacer:**
1. Inventario cerrado de colecciones a purgar (doc interno en el PR de la fase).
2. Callable `completeTrainingModule({ sessionId, moduleKey })`:
   - valida evidencia,
   - calcula score/rúbrica,
   - setea `understoodAt`,
   - purge por `trainingSessionId` (+ `trainingModuleKey` si aplica),
   - conserva progreso pedagógico.
3. Callable `finalizeTrainingSession({ sessionId })` para residuales / abort.
4. Estados: `COMPLETED` | `CLEANUP_PARTIAL`.
5. TTL opcional (job diario) para sesiones abandonadas.

**Aceptación:**
- Tras completar un módulo: 0 docs de negocio de ese módulo/sesión; score + `understoodAt` quedan.
- Tras finalizar sesión: 0 docs residuales con ese `trainingSessionId`.
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
1. Columnas: sesión activa, último hito, score por módulo, cleanup OK/PARTIAL.
2. Botón “Forzar cleanup”.
3. Vista de calificación (overall + por módulo).
4. (Opcional) coaches Operaciones/RRHH/Servicios.

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
2. Alumno training completa CRM+Planificación in situ según su rol.
3. Al completar un módulo: score + `understoodAt` quedan; datos de negocio de esa práctica no.
4. Auditoría no muestra writes a tenants productivos.
5. Feature flag apaga todo el modo training sin romper el panel.

---

## Síntesis ejecutiva

- **Diseño acordado**: empresa `capacitacion` compartida + datos **efímeros por módulo** + plan por **rol real** + escritura **rol práctica** + **coach in-situ** + **calificación**.
- **Gate 0 cerrado** (§10.7): falta solo autorización de Mauro para F1.
- **No partir de cero**: tracks, progreso remoto, gate obligatorio, instructor y callables de onboarding — encajar sandbox/coach encima.
- **Plan controlado**: F1…F7; MVP = F1–F5 (+ hardening mínimo F6).
- **Ejecución**: fases en PRs separados; Cursor para implementación; review humana en purge/hardening.
- **Condición no negociable**: nunca escribir práctica en Bacarsa/prod; al completar un módulo no quedan datos de negocio de esa práctica; sí quedan score e historial.
