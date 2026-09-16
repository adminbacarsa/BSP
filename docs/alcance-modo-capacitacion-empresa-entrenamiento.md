# Modo capacitación — alcance y opciones

## 1. Problema (por qué la guía actual no alcanza)

La guía actual (`/admin/guia`) es útil como onboarding conceptual, pero no reemplaza entrenamiento operativo real:

- Es un flujo de lectura/checklist, no un circuito de ejecución con datos reales de negocio.
- No obliga a completar la cadena punta a punta (CRM → SLA → Planificación → Operaciones → RRHH → Reportes).
- No permite medir desempeño por evidencia transaccional (qué creó, qué publicó, qué corrigió, qué cerró).
- No genera “muscle memory” de resolución de incidentes (ausencias, vacantes, retenciones, refuerzos).

**Evidencia en código**

- `apps/web2/src/pages/admin/guia/index.tsx` implementa pasos guiados y checks locales, con sincronización de progreso, pero no impone validaciones por resultado de negocio.
- El progreso de onboarding está orientado a completitud de guía, no a aprobación de acciones operativas reales.

---

## 2. Recorrido de capacitación objetivo (pasos in situ)

Recorrido objetivo solicitado por Mauro, mapeado a módulo + colecciones principales.

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

**Conclusión de recorrido**

Para entrenamiento real, hay que cubrir al menos estos 9 pasos sobre datos reales de Firestore, en un tenant aislado y reseteable.

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

3. **Helpers backend para callables modernas**
   - `apps/functions/src/auth/panel-tenant-auth.util.ts` aporta `assertPanelTenantCallable` y `tenantMatchesDoc` con soporte legacy Bacarsa + `allEmpresas`/superadmin.
   - Callables nuevas y sensibles (ej. `executeAgentAction`) sí aplican este control.

4. **Scope del asistente**
   - `apps/functions/src/assistant/assistantEmpresaScope.ts` y `resolveAssistantEmpresaScope` aplican la misma lógica de scope por tenant/migración.

### 3.2 Legacy Bacarsa (confirmado)

- Existe compatibilidad explícita para documentos sin `empresaId` como legacy de Bacarsa (`bacarsaLegacyOpen`, fallbacks en `belongsToEmpresaView` y reglas).
- Es funcional para transición, pero agrega complejidad y puntos de ambigüedad (especialmente cuando hay docs históricos no etiquetados).

### 3.3 Veredicto de aislamiento

**Sí, una empresa de entrenamiento puede aislar la mayor parte de escrituras operativas**, siempre que:

- el usuario no tenga bypass (`SuperAdmin` / `allEmpresas`),
- se usen rutas frontend y callables que respetan tenant,
- y se controlen superficies globales/legacy listadas en riesgos.

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

Impacto: ruido operativo, notificaciones y costos si no se diseña política específica para tenant de entrenamiento.

### R6 — Canales externos reales (MEDIO)

- Notificaciones push (FCM), correo de activación portal, AFIP, payroll, backups Drive.
- Aunque muchos flujos sellan `empresaId`, siguen operando sobre infraestructura productiva real.

### R7 — Modelo legacy Bacarsa (MEDIO)

- Documentos sin `empresaId` y fallbacks Bacarsa pueden inducir lecturas ambiguas en casos límite.

### R8 — IDs/documents cross-tenant en migraciones/imports (MEDIO)

- Hay utilidades de migración/restauración con soporte cross-tenant deliberado (`backup/restore`, `migrateEmpresaData`), útiles para admin, pero peligrosas si se exponen sin guardrails de proceso.

### Hipótesis a validar (etiquetadas)

- **H1**: algunos flujos viejos de UI todavía pueden invocar callables legacy de forma no evidente para el usuario.
- **H2**: la operación diaria actual ya no depende de varias rutas legacy, pero siguen desplegadas por compatibilidad.
- **H3**: los permisos por rol en producción real reducen riesgo práctico, aunque no eliminan riesgo técnico por callable.

---

## 5. Opciones A/B/C/D y recomendación

### A) Empresa de entrenamiento dentro del Firebase productivo

**Pros**
- Más rápida de habilitar.
- Reusa autenticación, módulos y datos reales del producto.
- Excelente para entrenamiento in situ.

**Contras**
- Convivencia con superficies globales/callables legacy.
- Requiere disciplina fuerte de permisos/proceso para evitar bleed.

**Esfuerzo estimado**: **M**

---

### B) Proyecto Firebase separado (lab aislado)

**Pros**
- Aislamiento físico total (datos, secretos, jobs, integraciones).
- Riesgo de contaminación productiva casi nulo por diseño.

**Contras**
- Mayor costo operativo (deploys, seed, mantenimiento de entornos).
- Necesita sincronización funcional continua con producción.

**Esfuerzo estimado**: **L**

---

### C) Feature flag “modo capacitación” sobre tenant fijo + seed/reset

**Pros**
- UX homogénea y controlada.
- Permite bloquear funciones peligrosas cuando `trainingMode=true`.

**Contras**
- Si comparte proyecto productivo, sigue existiendo riesgo residual en capas no cubiertas por flag.
- Alto trabajo de cobertura para no dejar huecos.

**Esfuerzo estimado**: **M/L**

---

### D) Híbrido (arranque A endurecido + evolución a B)

**Pros**
- Valor rápido para capacitación.
- Camino de reducción de riesgo progresivo sin frenar adopción.
- Permite validar el producto pedagógico antes de invertir en separación total.

**Contras**
- Requiere gobernanza clara por fases.
- Durante fase 1 persiste riesgo residual controlado (no cero).

**Esfuerzo estimado**: **L (total)**, con fase 1 **M**.

---

### Recomendación

**Recomiendo Opción D (Híbrida)**:

1. **Fase MVP inmediata**: empresa de entrenamiento dentro del proyecto actual, con hardening de permisos, reset controlado y checklist verificable.
2. **Fase objetivo**: migrar capacitación a proyecto Firebase separado cuando el circuito esté estable y validado.

Racional:

- Mauro necesita entrenamiento real ya (time-to-value).
- El aislamiento lógico actual es suficientemente bueno para una primera fase controlada.
- Los riesgos críticos detectados (callables legacy/globales) justifican objetivo de aislamiento físico posterior.

---

## 6. Alcance MVP vs completo

## MVP (mínimo útil de capacitación real)

1. **Empresa entrenamiento dedicada** (ej. `capacitacion_bacarsa`) con usuarios/roles propios.
2. **Seed inicial reproducible** (cliente, objetivo, SLA base, plantilla mínima de empleados).
3. **Reset de tenant** en 1 click (solo esa empresa), con restauración a snapshot base.
4. **Checklist verificable por evidencia de datos** (no checklist manual):
   - cliente creado,
   - objetivo creado,
   - SLA creado,
   - grilla publicada,
   - ausencia registrada,
   - vacante gestionada,
   - refuerzo asignado,
   - reporte consultado.
5. **Rol “Capacitación Admin”** sin permisos globales (`allEmpresas=false`, no superadmin).
6. **Bloqueos explícitos en capacitación** para acciones de alto riesgo (API keys reales, AFIP prod, limpiezas globales).

## Completo (versión madura)

1. **Aislamiento físico** (proyecto Firebase lab dedicado).
2. **Instructor view** con trazabilidad por alumno, score y tiempos por paso.
3. **Escenarios de práctica parametrizados** (operaciones normales, ausencias masivas, cobertura urgente, etc.).
4. **Motor de evaluación automática** con rúbricas por rol (Operaciones, Planificación, RRHH, CRM).
5. **Integración de evidencia** (export de resultados, intentos, historial por cohorte).

---

## 7. Diseño propuesto (empresa entrenamiento + reset + checklist verificable)

### 7.1 Empresa de entrenamiento

- Crear empresa dedicada (no Bacarsa legacy).
- `migracionCompleta=true` desde inicio.
- Usuarios de capacitación sin bypass de tenant.
- Prohibir uso de cuentas SuperAdmin durante entrenamiento estándar.

### 7.2 Reset seguro

Flujo propuesto:

1. Congelar sesión activa de entrenamiento.
2. Ejecutar limpieza tenant-scoped de colecciones operativas.
3. Restaurar snapshot semilla de la empresa entrenamiento.
4. Rehidratar estado base de planificación/servicios.
5. Registrar auditoría del reset.

**Control clave**: reset debe exigir `empresaId` fijo de entrenamiento y rechazar cualquier otro.

### 7.3 Checklist verificable (evidencia técnica)

Cada hito se marca por consulta de estado real en Firestore:

- H1 Cliente: existe `clients/{id}` con `empresaId=capacitacion_*`.
- H2 Objetivo: `clients.objetivos[]` contiene objetivo válido.
- H3 SLA: existe `servicios_sla` activo para objetivo.
- H4 Planificación: `turnos` + `planificacion_estados.publishedAt`.
- H5 Operación: cambios de estado en `turnos` (present/absent/completed).
- H6 RRHH: alta de `ausencias`/`novedades` asociadas.
- H7 Cobertura: evidencia de refuerzo/convocatoria/cobertura.
- H8 Reporte: lectura de extracto (`hours_balances`) o cálculo de período.

### 7.4 Guardrails de seguridad para entrenamiento

- Bloquear/ocultar módulos globales no necesarios.
- Denegar callables legacy o de alto impacto para rol capacitación.
- Aislar notificaciones y correos a usuarios de prueba.
- Etiquetar todo evento de entrenamiento con `empresaId` + bandera de sesión para trazabilidad.

---

## 8. Workstreams y esfuerzo (S/M/L)

| Workstream | Descripción | Esfuerzo |
|---|---|---|
| WS1 Gobernanza de permisos | Rol capacitación, exclusión de superadmin/allEmpresas, matriz por módulo | **M** |
| WS2 Hardening backend callables | Cerrar rutas legacy sin tenant assert / validar `empresaId` en endpoints sensibles | **L** |
| WS3 Seed + snapshot base | Dataset inicial reproducible y versionado | **M** |
| WS4 Reset automático | Limpieza + restore seguro de empresa entrenamiento | **M** |
| WS5 Checklist verificable | Motor de hitos por evidencia Firestore | **M** |
| WS6 UX capacitación | Vista alumno + progreso operativo real | **M** |
| WS7 Instructor view | Seguimiento multi-alumno, estado por etapa, reproceso | **M/L** |
| WS8 Aislamiento integraciones | AFIP, payroll API keys, notificaciones y correo en modo capacitación | **M** |
| WS9 Opción B futura | Proyecto Firebase separado + pipeline CI/CD paralelo | **L** |

---

## 9. Criterios de éxito

1. Un alumno completa circuito completo (pasos 1–9) sin tocar datos de empresas productivas.
2. Reset deja entorno idéntico a baseline en tiempo acotado y trazable.
3. No se detectan escrituras cross-tenant en auditoría.
4. Instructor puede verificar progreso por evidencia, no por declaración.
5. El circuito es repetible por múltiples cohortes sin intervención manual de ingeniería.

---

## 10. Preguntas para Mauro

1. **Nivel de riesgo aceptable**: ¿aceptamos fase inicial en mismo Firebase (con hardening) o exigimos aislamiento físico desde día 1?
2. **Perfil de alumno**: ¿quién se capacita como “admin entrenamiento” y quién solo como “operador”?
3. **Profundidad del circuito MVP**: ¿incluimos desde inicio payroll/API keys/AFIP o quedan explícitamente fuera?
4. **Política de reset**: ¿reset por demanda (botón instructor) o automático por cohorte/fecha?
5. **Estrategia de notificaciones**: ¿usar canales reales filtrados o sandbox total sin push/email reales?
6. **Métrica de aprobación**: ¿qué puntaje/hitos mínimos definen “apto” por rol?
7. **Cadencia de evolución a aislamiento físico**: ¿qué condición funcional/disponibilidad dispara paso a opción B?

---

## Síntesis ejecutiva

- **Recomendación**: **Opción D (híbrida)**: activar rápido empresa entrenamiento endurecida + roadmap a proyecto aislado.
- **Riesgos principales**: callables legacy sin tenant assert, endpoints globales por secret, superficies de configuración global.
- **MVP útil**: empresa dedicada + seed + reset + checklist verificable + rol capacitación restringido.
- **Condición no negociable**: bloquear accesos y operaciones de alcance global durante entrenamiento.
