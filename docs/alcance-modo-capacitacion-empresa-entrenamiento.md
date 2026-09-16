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

## 10. Preguntas para Mauro

1. **Sandbox 1:1**: ¿una sola empresa `capacitacion` compartida (con `trainingSessionId` por alumno) o una empresa/sesión por alumno?
2. **Permisos de escritura**: ¿el alumno usa su rol real (puede que solo tenga READ) o un rol “práctica” con create/update/publish solo en el sandbox?
3. **Alcance MVP de coaches**: ¿arranquemos por CRM + Planificación, o priorizás Operaciones?
4. **Momento del borrado**: ¿solo al “Finalizar”, también al cerrar sesión/navegador, y/o TTL automático (ej. 24 h)?
5. **Qué sí guardar**: ¿además del % de progreso, querés historial de intentos/tiempos por paso para el instructor?
6. **Notificaciones**: ¿sandbox total sin push/email, o push solo a cuentas de prueba?
7. **Cuándo subir a proyecto Firebase aparte**: ¿umbral de alumnos, o después de cerrar riesgos R1–R3?

---

## Síntesis ejecutiva

- **Diseño acordado**: empresa de capacitación aparte + datos de práctica **efímeros** (se borran al terminar) + recorrido **por rol** + **coach paso a paso** dentro de cada módulo.
- **Recomendación técnica**: Opción **A endurecida** (sandbox tenant en el mismo Firebase) con purge confiable; Opción **B** solo si el riesgo/volumen lo exige.
- **Riesgos principales**: callables legacy sin tenant assert, endpoints globales, crons/push compartidos, purge incompleto de colecciones.
- **MVP**: sesión training + plan por rol + coaches CRM/Planificación + evidencia de hitos + cleanup al finalizar.
- **Condición no negociable**: el alumno nunca escribe en Bacarsa/prod; al terminar no quedan datos de negocio de la práctica.
