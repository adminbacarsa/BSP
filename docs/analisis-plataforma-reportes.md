# ControlData — Lectura senior y foco en reportes

## 1. Mapa de la plataforma

### 1.1 Arquitectura general (monorepo)
- **Frontend principal**: Next.js (`apps/web2`) con lógica de negocio importante en hooks y servicios Firestore.
- **Backend**: Firebase Functions (`apps/functions`) con mezcla de callables y HTTP (incluye módulo payroll API).
- **Base de datos**: Firestore multi-tenant por `empresaId`, con coexistencia de datos legacy (caso Bacarsa).
- **Módulos funcionales**: definidos en `apps/web2/src/config/modules.ts` (`SYSTEM_MODULES`, incluye `REPORTS`, `ANALYSIS`, `SERVICES`, `PLANNING`, etc.).

### 1.2 Control de acceso y navegación
- La navegación lateral del panel muestra Reportes según permisos (`canReadModule('REPORTS')`) en `apps/web2/src/components/layout/DashboardLayout.tsx` (bloque de links de `/admin/reportes` y `/admin/reportes/marcaciones`).
- Resolución de permisos en `apps/web2/src/context/AuthContext.tsx`:
  - `onAuthStateChanged` carga `system_users/{uid}`.
  - Obtiene permisos desde `roles/{roleId}`.
  - Soporta bypass por `isSuperAdmin` y contexto `allEmpresas`.
- Empresa activa y cambio de tenant en `apps/web2/src/context/EmpresaContext.tsx` (con persistencia local para superadmin).

### 1.3 Fortalezas arquitectónicas observadas
1. **Aislamiento multiempresa explícito** en utilidades (`shouldScopeQueriesToEmpresa`, `belongsToEmpresaView`, `empresaScopedQuery`) en `apps/web2/src/lib/multiempresa.ts`.
2. **Mitigación de bloqueos de Firestore** con `getDocsOnce` + timeout configurable (`apps/web2/src/lib/firebase.ts`).
3. **Particionado por mes calendario** para consultas grandes de turnos (`fetchTurnosForReport`) en `apps/web2/src/hooks/useReportes.ts`.
4. **Índices compuestos relevantes ya declarados** para colecciones críticas (`turnos`, `ausencias`, `planificacion_estados`, `audit_logs`, `ajustes_liquidacion`) en `firestore.indexes.json`.
5. **Separación de cálculo de liquidación server-side** para integraciones (`buildLiquidacionSnapshot` en Functions), consumido por callable en frontend (`useLiquidaciones`).

### 1.4 Riesgos transversales observados
1. Parte del sistema aún depende de **filtrado en memoria post-query** para tenancy (costo y latencia).
2. Hay caminos con **lecturas amplias sin paginación real de origen** y luego slice/filtro en cliente/servidor.
3. Se detectan **inconsistencias entre comentarios funcionales y enforcement real** (ver sección 8).

---

## 2. Modelo de datos y tenancy (resumen)

### 2.1 Colecciones críticas para reportes
- `turnos` (base de horas planificadas/reales, estados, códigos).
- `ausencias` (novedades RRHH y ausentismo).
- `planificacion_estados` (publicación mensual por objetivo).
- `servicios_sla` (horas vendidas/contrato).
- `ajustes_horas` y `ajustes_liquidacion` (correcciones manuales).
- `audit_logs` (auditoría, exportes, acciones).
- `ccosto_objective_mapping` (mapeo Centro de Costo ↔ Objetivo para marcaciones).

### 2.2 Reglas de tenancy/autorización
- En reglas Firestore (`firestore.rules`) se usa `tenantMatches()` y helpers `tenantAdminRead/Create/Update/Delete`.
- Accesos específicos relevantes:
  - `turnos`: lectura por admin tenant, cliente relacionado o empleado dueño.
  - `ausencias`, `planificacion_estados`, `servicios_sla`, `audit_logs`, `ajustes_*`, `ccosto_objective_mapping`: reglas diferenciadas por rol/tenant.
- `payroll_settings/{empresaId}` y `integraciones_api` tienen reglas específicas para API de liquidación.

### 2.3 Patrón de tenancy en código
- Frontend: `apps/web2/src/lib/multiempresa.ts` centraliza scoping.
- Functions: `apps/functions/src/assistant/assistantEmpresaScope.ts` replica criterio (incluyendo Bacarsa legacy).
- Riesgo clave: en múltiples puntos se consulta “amplio” y luego se filtra con `belongsToEmpresaView`.

---

## 3. Flujos críticos

### 3.1 Flujo Reportes (pantalla `/admin/reportes`)
1. UI con tabs: `Liquidación`, `Detalle Turnos`, `Por Objetivo`, `Planificado`, `Servicios`, `Auditoría` (`apps/web2/src/pages/admin/reportes/index.tsx`).
2. Hook `useReportes`:
   - Carga catálogos iniciales (`empleados`, `clients`, `feriados`).
   - Ejecuta pipeline al generar:
     - SLA (`servicios_sla`)
     - publicación (`planificacion_estados`)
     - ausencias (`ausencias`)
     - ajustes (`ajustes_horas`)
     - turnos (`turnos`)
   - Calcula agregados por empleado y por objetivo en cliente.
3. Exportaciones:
   - CSV y JSON en cliente.
   - PDF con import dinámico (`liquidacionReportPdf`, `serviciosReportPdf`).

### 3.2 Flujo Marcaciones CC (`/admin/reportes/marcaciones`)
1. Carga catálogo clientes/objetivos + mapping actual (`ccosto_objective_mapping`).
2. Parsea Excel de centros de costo y Excel de marcaciones.
3. Simula o aplica importación:
   - valida legajo por DNI,
   - valida publicación de cronograma,
   - encuentra turno candidato,
   - escribe fichadas en `turnos` con batches.

### 3.3 Flujo Liquidaciones (`/admin/liquidaciones`, módulo adyacente)
1. Front llama callable `getPayrollSnapshotInternal` (`useLiquidaciones`).
2. Functions arma snapshot con `buildLiquidacionSnapshot` (lee `empleados`, `turnos`, `ausencias`, `feriados`, `payroll_cycles_locks`).
3. Ajustes manuales persisten en `ajustes_liquidacion` + trazabilidad en `audit_logs`.
4. API externa HTTP (`/v1/payroll/*`) comparte el mismo motor de cálculo.

---

## 4. Inventario de reportes (pantallas, endpoints, colecciones, queries)

## 4.1 Pantalla `/admin/reportes` (tabs)

| Tab | Fuente técnica | Colecciones / endpoints | Patrón de query/agregación |
|---|---|---|---|
| Liquidación | `useReportes` + `calculateStatsExact` | `turnos`, `ausencias`, `ajustes_horas`, `planificacion_estados`, `servicios_sla`, `empleados`, `clients`, `feriados` | Descarga lote + agregación intensiva en cliente por legajo |
| Detalle Turnos | `objectiveReport.rawShifts` / filtros client-side | Mismo dataset de `useReportes` | No relanza query al refinar; filtra en memoria |
| Por Objetivo | `objectiveReport` | Mismo dataset de `useReportes` | Agrupa por objetivo + cruce SLA + deduplicaciones |
| Planificado | `useReportes(fetchScope)` | Mismo dataset con alcance por cliente/objetivo/legajo | Reconsulta Firestore al “Generar” con scope; refinado extra en memoria |
| Servicios | lógica local en `index.tsx` (no usa hook principal) | `servicios_sla`, `clients` | Carga al entrar al tab; filtra por vigencia/estado/búsqueda en memoria |
| Auditoría | `loadAudit()` en `useReportes` | `audit_logs` | `where(empresaId) + where(timestamp>=90d) + orderBy desc + limit(500)` |

Notas:
- Export PDF usa import dinámico (optimiza bundle inicial) en `reportes/index.tsx`.
- Export CSV se construye completamente en cliente.

### 4.2 Pantalla `/admin/reportes/marcaciones`

| Flujo | Fuente técnica | Colecciones | Patrón |
|---|---|---|---|
| Mapeo CC | `ccostoMappingService` | `ccosto_objective_mapping` | `getDoc/setDoc` por `empresaId` |
| Simulación/importación | `runMarcacionesImport` | `empleados`, `turnos`, `planificacion_estados` | Carga datasets del período y mapea fila a turno; escritura batch en `turnos` |

Punto notable: `loadPublishStatusMap` hace loops `meses x objetivos` con `fetchPlanificacionEstadoDoc` (consultas secuenciales por documento).

### 4.3 Endpoints/callables de liquidación relacionados con reportes

| Endpoint/callable | Archivo | Uso |
|---|---|---|
| `getPayrollSnapshotInternal` (callable) | `apps/functions/src/index.ts` | Snapshot para `/admin/liquidaciones` |
| `payrollApi` HTTP (`/v1/payroll/cycles`, `/liquidacion`, `/close`) | `apps/functions/src/payroll-api/handler.ts` | Integración externa de liquidación |
| `createPayrollApiKey`, `revokePayrollApiKey` | `apps/functions/src/index.ts` | Gestión de credenciales API |

---

## 5. Hallazgos de performance y costo Firestore (priorizados P0/P1/P2)

## P0 (alto impacto inmediato)

### P0.1 Lecturas amplias y filtrado en memoria en snapshot de liquidación server-side
**Evidencia**
- `buildLiquidacionSnapshot` consulta:
  - `turnos` por `startTime` sin `where('empresaId','==',...)` y luego filtra con `turnoBelongs`.
  - fallback adicional por `scheduleDate` también sin filtro de tenant.
  - `ausencias` sólo con `where('startDate','<=', cycleEnd)` (sin cota inferior).
  (`apps/functions/src/payroll-api/calc.ts`).

**Impacto**
- Latencia y costo de lectura crecen con el total multi-tenant, no sólo con la empresa solicitante.
- Riesgo de timeout en picos de histórico.

**Propuesta**
- Forzar scoping de tenant en origen cuando corresponda.
- Añadir cota inferior en ausencias (`endDate >= cycleStart` o prefiltrado equivalente por diseño de índice/dato).
- Considerar particionado por período (materialized snapshots por ciclo+empresa).

### P0.2 Consultas de `useReportes` con scope incompleto en ramas por empleado/objetivo
**Evidencia**
- `fetchTurnosForReport`:
  - rama `employeeId`: query por `employeeId + startTime` sin `empresaId`.
  - rama `objectiveIds`: query por `objectiveId + startTime` sin `empresaId`.
  (`apps/web2/src/hooks/useReportes.ts`).
- `fetchReportAusencias`:
  - rama `employeeId`: query por `employeeId + startDate` sin `empresaId`.
  (`apps/web2/src/lib/reportFirestoreQueries.ts`).

**Impacto**
- Lecturas extra evitables.
- Dependencia de filtro posterior (`belongsToEmpresaView`) para corregir scope.

**Propuesta**
- Introducir query tenant-aware en todas las ramas donde `scopeEmpresa=true`.
- Mantener fallback legacy sólo para casos Bacarsa explícitos y medidos.

### P0.3 Riesgo de no-recarga y lectura cross-tenant en tab Servicios de Reportes
**Evidencia**
- `const migracionCompleta = false` hardcodeado en carga de Servicios.
- Si `scopeEmpresa=false`, consulta completa `servicios_sla` y filtra luego en memoria.
- `svcReportLoaded` no se resetea al cambiar `empresaId` (puede dejar datos cacheados de otra empresa).
  (`apps/web2/src/pages/admin/reportes/index.tsx`).

**Impacto**
- Riesgo de datos stale en cambio de empresa (superadmin/allEmpresas).
- Costo de lectura mayor al necesario.

**Propuesta**
- Atar `migracionCompleta` a estado real de empresa.
- Invalidar cache local de Servicios al cambiar `empresaId`.
- Escopar query por tenant en origen siempre que sea posible.

### P0.4 Importación Marcaciones: patrón N×M secuencial para estado de publicación
**Evidencia**
- `loadPublishStatusMap` recorre `meses x objetivos` y por cada combinación llama `fetchPlanificacionEstadoDoc`.
- `fetchPlanificacionEstadoDoc` puede hacer hasta 2 `getDoc` (tenant + legacy).
  (`apps/web2/src/lib/marcaciones/importMarcacionesRunner.ts`, `apps/web2/src/lib/multiempresa.ts`).

**Impacto**
- Latencia acumulada alta en simulaciones/importaciones grandes.
- Mayor cantidad de lecturas puntuales.

**Propuesta**
- Reemplazar por query batch mensual (similar a `fetchReportPlanificacionEstados`) y armar mapa en memoria.

## P1 (impacto medio-alto)

### P1.1 CPU intensa en cliente por cálculo minuto-a-minuto y doble agregación
**Evidencia**
- `getNightDuration` itera minuto a minuto.
- `calculateStatsExact` lo ejecuta por shift y se usa en más de un agregado (empleado y objetivo).
  (`apps/web2/src/hooks/useReportes.ts`).

**Impacto**
- UI bloqueada en períodos largos/plantillas grandes.
- Mayor tiempo de “Generando reporte”.

**Propuesta**
- Reemplazar cálculo minuto-a-minuto por intersección de intervalos.
- Reusar métricas preagregadas por turno para evitar recalcular en cada vista.

### P1.2 Cargas completas de catálogos en reportes
**Evidencia**
- `loadCatalogs` en `useReportes` hace `getDocs` de `empleados` y `clients` sin limit/paginación.
  (`apps/web2/src/hooks/useReportes.ts`).

**Impacto**
- Tiempo de warm-up alto en tenants grandes.

**Propuesta**
- Catálogo incremental (on-demand por filtro) o cache compartida de sesión por empresa.

### P1.3 Snapshot “paginado” sólo al final del cálculo
**Evidencia**
- En `buildLiquidacionSnapshot` se procesa todo (`allItems`) y recién después aplica `slice` por `page/pageSize`.
  (`apps/functions/src/payroll-api/calc.ts`).

**Impacto**
- El costo de cálculo casi no baja al pedir páginas chicas.

**Propuesta**
- Estrategia de agregados persistidos por ciclo o pipeline incremental para evitar recomputar universo completo.

### P1.4 Exportaciones grandes 100% cliente
**Evidencia**
- CSV/JSON/PDF se generan en browser con arrays completos.
  (`apps/web2/src/pages/admin/reportes/index.tsx`, `apps/web2/src/lib/reportes/*.ts`).

**Impacto**
- Riesgo de freeze en equipos modestos con datasets masivos.

**Propuesta**
- Backend export jobs asíncronos (Cloud Functions + storage + link de descarga).

## P2 (impacto bajo/medio)

### P2.1 Inconsistencia de estrategia de lectura (`getDocs` vs `getDocsOnce`)
Hay áreas críticas con `getDocs` directo y otras con `getDocsOnce` + timeout. Conviene converger para observabilidad consistente.

### P2.2 Potencial desalineación Bacarsa legacy en publicación
`fetchReportPlanificacionEstados` recibe `scopeEmpresa` pero no lo usa en branching; si persisten docs legacy sin `empresaId`, puede haber sesgo de datos (a validar con estado real de migración).

---

## 6. Hallazgos de UX en vistas de reportes (priorizados)

## P0 UX

### UX-P0.1 Export CSV con riesgo de fallo por auditoría previa
**Evidencia**
- `downloadCSV` primero hace `addDoc('audit_logs', ...)` sin `empresaId`.
- Si esa escritura falla por reglas tenant, la exportación se corta (no hay `try/catch` aislado para logging).
  (`apps/web2/src/pages/admin/reportes/index.tsx` + `firestore.rules` en `match /audit_logs`).

**Impacto**
- Usuario percibe “no descarga” aunque el problema sea el log.

**Recomendación**
- Logging no bloqueante del export + incluir `empresaId` consistente.

### UX-P0.2 Acceso directo a `/admin/reportes` sin guard explícito de permiso
**Evidencia**
- En `reportes/index.tsx` no hay chequeo `canReadModule('REPORTS')`.
- En `reportes/marcaciones.tsx` sí existe guard y estado “Sin permiso”.

**Impacto**
- Comportamiento inconsistente entre pantallas del mismo dominio.

**Recomendación**
- Unificar política de guard visual + mensaje de autorización.

## P1 UX

### UX-P1.1 Estados de carga bloqueantes largos sin cancelación/reintento granular
Overlay global de progreso (“No cierres esta pestaña”) útil, pero sin opción de abortar ni fallback por bloques.

### UX-P1.2 Tablas densas sin virtualización/paginación visual
Con períodos amplios, grillas pueden degradar scroll y legibilidad (desktop y mobile).

### UX-P1.3 Estado vacío genérico en escenarios distintos
Varios “Sin resultados/No hay filas” no distinguen si fue por filtros, permisos, cronograma no publicado o ausencia real de datos.

### UX-P1.4 Doble CTA hacia Marcaciones en la misma pantalla
Hay botón en header + card link adicional; puede generar ruido visual.

## P2 UX

### UX-P2.1 Persistencia parcial de contexto
Se persisten rango/publishFilter/usePlannedHours, pero no presets de filtros tab-específicos ni vistas guardadas.

---

## 7. Roadmap propuesto (quick wins vs cambios estructurales)

### 7.1 Quick wins (bajo riesgo, alto retorno)
1. **Scope tenant en origen** para ramas `employee/objective` en reportes y snapshot payroll.
2. **Corregir export CSV no bloqueante** (auditoría desacoplada + `empresaId` consistente).
3. **Reset/invalidate cache de Servicios al cambiar empresa**.
4. **Batch query de `planificacion_estados`** para marcaciones (eliminar N×M secuencial).
5. **Mensajería UX más diagnóstica** en estados vacíos/carga.

### 7.2 Cambios estructurales (requieren diseño)
1. **Motor de agregación server-side para Reportes** (paridad con enfoque de `/admin/liquidaciones`).
2. **Materialización por ciclo/período** (snapshots empresa+mes/ciclo) para evitar recomputar histórico completo.
3. **Pipeline de export asíncrono** (job + storage + notificación).
4. **Optimización algorítmica de nocturnas** y memoización de métricas por turno.
5. **Observabilidad técnica**: tiempos por fase (`SLA`, `turnos`, `ausencias`, agregación, export), volumen leído y costo estimado por ejecución.

---

## 8. Preguntas abiertas para el equipo

1. **¿Estado real de migración Bacarsa?**  
   Hay rutas con fallback legacy y otras con suposiciones tenant-scoped. Necesitamos confirmar porcentaje de docs sin `empresaId`.

2. **¿Unicidad global de `objectiveId`?**  
   Si no es global, las queries por objetivo sin `empresaId` amplifican costo y riesgo de mezcla.

3. **¿SLA de tiempo objetivo por tipo de reporte?**  
   Sin SLO formal (p95/p99), no se puede priorizar finamente entre quick wins.

4. **¿Volumen esperado por empresa (turnos/mes, legajos activos)?**  
   Define si basta tuning de queries o se justifica materialización obligatoria.

5. **¿Debe `/admin/reportes` heredar el mismo guard explícito de permisos que Marcaciones?**

6. **`payrollLockedAt` en reglas**  
   El handler de cierre menciona bloqueo posterior por reglas, pero no se observó condición explícita en `firestore.rules` que rechace updates por ese campo. ¿Está planificado en otra capa o pendiente de implementación?

7. **Deploy/routing de payroll API**  
   `firebase.json` actual no evidencia rewrite específico a `payrollApi`. ¿se consume sólo por URL directa de Function o existe otra capa de enrutamiento externa?

---

### Cierre ejecutivo
El módulo de reportes ya tiene buenas bases (scoping utilitario, timeouts, chunking mensual, índices clave), pero hoy combina **consultas parcialmente no acotadas + agregación pesada en cliente + export local**.  
La mejor relación impacto/esfuerzo está en: **scoping en origen, reducción de N×M queries, robustez de export y caché tenant-safe**; luego, evolucionar a **agregación server-side materializada** para escalar sin degradar latencia ni costo.
