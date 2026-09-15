# Módulo Análisis — lectura y visión de control de negocio

## 1. Qué hace hoy (inventario con evidencia de código)

### 1.1. Entrada funcional y permisos

- El módulo está declarado como `ANALYSIS` en el catálogo de módulos (`apps/web2/src/config/modules.ts`).
- La navegación lateral lo muestra condicionado por `canReadModule('ANALYSIS')` (`apps/web2/src/components/layout/DashboardLayout.tsx`).
- En la página (`apps/web2/src/pages/admin/analisis/index.tsx`) se ejecuta `useAuth()` y se monta dentro de `DashboardLayout`, pero no hay un `router.replace(...)` específico por permisos como sí existe en `Liquidaciones`.

### 1.2. Pantalla y solapas reales

Ruta principal: `/admin/analisis` (`apps/web2/src/pages/admin/analisis/index.tsx`).

Grupos y solapas:

- **Operativa**:
  - `informe`
  - `demanda`
  - `cobertura`
  - `capacidad`
- **Humana**:
  - `guardias`
  - `art12`
- **Financiera**:
  - `financiera`
- **Herramientas**:
  - `viabilidad`
  - `analitica`
  - `proyeccion`

Evidencia: definición de `activeTab`, botones de grupo y tab-switch en `index.tsx` (bloque de solapas con ids `informe|demanda|cobertura|capacidad|guardias|art12|financiera|viabilidad|analitica|proyeccion`).

### 1.3. Filtros y horizonte temporal

- Selector de período: `day|week|month|quarter|semester|year` (`getPeriodRange` en `index.tsx`).
- Bloqueo de navegación mientras carga (`periodNavLocked`).
- En solapa Analítica hay rango manual `desde/hasta` y botón que amplía snapshot con `ensureRange(start,end)` (`loadAnalytics`).

### 1.4. Fuentes de datos y patrón de carga

El módulo usa un snapshot en memoria (`useAnalisisSnapshot`) y no depende de callables para calcular KPIs.

**Catálogo (1 vez por empresa):**

- `servicios_sla` (SLA/contratos)
- `empleados` (plantel activo)
- `clients` (objetivos embebidos para alias/nombre)
- `tipos_novedad` (catálogo RRHH para mapear códigos)
- `objetivos` (geo: lat/lng, sin scope directo por empresa)

Evidencia: `fetchAnalisisCatalog` en `apps/web2/src/lib/analisis/analisisSnapshot.ts`.

**Hechos:**

- `turnos` por mes calendario con query por `startTime` (y `empresaId` cuando aplica)
- `ausencias` (prefetch completo por empresa y filtro en memoria por período)

Evidencia: `ensureAnalisisFacts`, `fetchTurnosMonth`, `fetchAusenciasAll` en `analisisSnapshot.ts` + `buildPlanningMonthTurnosQuery` en `apps/web2/src/lib/planificacion/loadPlanningMonthShifts.ts`.

**Acelerador de pintado (extracto mensual):**

- `hours_balances` para pintar rápido Informe/Demanda/Financiera por objetivo cuando aún no terminó de cargar malla.
- Al completar malla, el front persiste/reconstruye extracto (`persistHoursBalancesFromTurnos`).

Evidencia: `extractReady`, `demandaFromHoursBalances`, `financieraFromHoursBalances` y `persistHoursBalancesFromTurnos(...)` en `index.tsx`; tipos/colección en `apps/web2/src/lib/hoursBalance/types.ts`.

### 1.5. Métricas y fórmulas clave actuales

- **Demanda/cobertura**: `resultante = plan + ext + adel + ops` (FT y novedades no suman cobertura).
  - Evidencia: `coverageResultanteHours` y `buildDemandaByObjective` (`analisisQueries.ts`, `analisisDemanda.ts`).
- **Ausentismo real**: motor por `ausencias` + detección en `turnos` (`isAbsent`, `AUTO_T30`, dedupe por `shiftId` / empleado+día).
  - Evidencia: `buildAusenciasStats` (`analisisQueries.ts`).
- **Bolsa/capacidad**:
  - Viabilidad usa jornada referencia **192 h** (`CCT_HS_MENSUAL`) para FTE.
  - Bolsa realista usa techo **200 h** y ajusta por índice de ausencias 3 meses cerrados previos.
  - Evidencia: `analisisUniverso.ts` y `analisisBolsa.ts`.
- **Financiera hs-hombre**:
  - Consumo = plan/fichada + novedades + FT + extra/ops + horas no usadas (F/RET/REF/ESC).
  - Rollup empresa -> cliente -> objetivo -> guardia.
  - Evidencia: `buildAnalisisFinanciera`, `finConsumoHours`, `rollAnalisisFinanciera` (`analisisFinanciera.ts`).
- **ART.12**:
  - Distancia domicilio-objetivo por Haversine, umbral 25 km, validación de distancias implausibles >500 km y corrección tentativa lat/lng invertidos.
  - Evidencia: helpers ART12 en `index.tsx`.

### 1.6. Diferencia técnica frente a Reportes y Liquidaciones

**Análisis**

- Motor principalmente client-side (snapshot + agregaciones puras en `lib/analisis/*`).
- Exporta Excel (`exportInforme`, `exportFinanciera`) desde front.
- Tiene lógica de aceleración con `hours_balances`.

**Reportes (`/admin/reportes`)**

- Flujo on-demand con botón de generación y lecturas grandes puntuales:
  - `turnos`, `ausencias`, `planificacion_estados`, `ajustes_horas`, `servicios_sla`, `audit_logs`.
- No usa snapshot persistente de múltiples solapas como Análisis; construye datasets por corrida.
- Evidencia: `generateReports` en `apps/web2/src/hooks/useReportes.ts`, queries auxiliares en `apps/web2/src/lib/reportFirestoreQueries.ts`.

**Liquidaciones (`/admin/liquidaciones`)**

- Núcleo de cálculo se resuelve en backend por callable `getPayrollSnapshotInternal` (Functions), no en front.
- Front suscribe `payroll_settings/{empresaId}` y `ajustes_liquidacion`.
- Evidencia: `apps/web2/src/hooks/useLiquidaciones.ts`, `apps/web2/src/pages/admin/liquidaciones/index.tsx`, `apps/functions/src/index.ts`.

## 2. Opinión senior (qué está bien, qué falta, riesgos)

> Definición confirmada con Mauro (follow-up): el control de la unidad se gestiona **solo en horas** (sin capa contable en moneda). Además, la prioridad es unir **liquidación de horas** con **prefactura de horas**.

### 2.1. Qué está bien

1. **Arquitectura analítica modular**: buena separación de cálculo en librerías puras (`analisisDemanda`, `analisisFinanciera`, `analisisInforme`, `analisisBolsa`, `analisisUniverso`), lo que baja riesgo de regresión y facilita testing.
2. **Pintado progresivo inteligente**: fallback con `hours_balances` evita esperar toda la malla para mostrar señal de negocio.
3. **Modelo de lectura orientado a decisión operativa**: distingue cobertura (plan/resultante) de costo (FT, novedades, horas no usadas), algo clave para seguridad privada.
4. **Drill-down útil**: empresa -> cliente -> objetivo -> guardia en Financiera, y objetivo con detalle en Demanda/Cobertura.
5. **Rigor de códigos de dominio** (FT, RET, REF, ESC, V/E/L/A/AA/PG/SUS) y reglas explícitas en código.

### 2.2. Qué falta o puede inducir decisiones erróneas

1. **Alineación de alcance (fortaleza y límite)**: al trabajar solo en horas, el módulo está bien orientado al control operativo; el riesgo es de expectativa (usuarios esperando rentabilidad en $ dentro de Análisis).
2. **No existe “cierre” analítico mensual versionado**: el tablero puede cambiar por fichadas tardías o recálculos; útil para operación, débil para comité financiero/auditoría.
3. **Riesgo de confusión 192 vs 200**: el código explica la diferencia, pero en operación diaria puede mezclarse “capacidad” con “techo liquidable”.
4. **Carga de ausencias potencialmente cara**: `fetchAusenciasAll` trae colección completa por empresa y filtra luego.
5. **Dependencia de calidad de datos maestros**:
   - domicilio geolocalizado (ART.12),
   - objectiveId consistente,
   - turnos con `startTime` válido.

### 2.3. Riesgos técnicos y de gobierno de dato

- **Riesgo R1 (cost/read)**: consultas amplias de ausencias y objetivo geo global pueden escalar con volumen multiempresa.
- **Riesgo R2 (consistencia)**: escritura de `hours_balances` desde front (`persistHoursBalancesFromTurnos`) depende del estado de carga del cliente.
- **Riesgo R3 (seguridad funcional)**: acceso a página sin guard explícito en la propia ruta (el gating principal está en navegación/permisos de contexto).
- **Riesgo R4 (tenancy legacy)**: coexistencia de reglas `bacarsa` legacy con `migracionCompleta` exige disciplina para evitar mezclar documentos huérfanos.

## 3. Lente operativa — decisiones y control

### 3.1. Decisiones que el módulo ya permite

- Ver brecha SLA vs cobertura resultante por objetivo (`demanda.deltaSla`, `vacantHours`).
- Detectar dependencias de cobertura costosa (FT/ext/ops).
- Priorizar objetivos críticos (drill de Demanda/Cobertura y deep-link a Planificación).
- Evaluar viabilidad diaria por servicio (pax requerido vs dotación disponible por aus/franco/licencia/otro objetivo).

### 3.2. Qué falta para control operativo de unidad

1. KPI de **cumplimiento SLA por franja horaria** (no solo agregado período).
2. **Tiempo de reacción** ante ausencia (T0 ausencia -> T1 cobertura efectiva).
3. **Ranking de puestos crónicos** (vacancia y FT recurrente por banda M/T/N).
4. **Semáforo de calidad de dato operativo** (turnos sin start/end, objetivo ambiguo, estado incoherente).
5. Métrica de **cobertura comprometida vs publicada** (plan publicado vs ejecución con trazabilidad de cambios).

## 4. Lente RRHH — decisiones y control

### 4.1. Lo que ya cubre

- Ausentismo por categoría y horas afectadas (V/E/A/AA/Otros) con dedupe razonable.
- Carga por guardia (horas, % sobre 200h, disponibilidad residual).
- ART.12 de distancia domicilio-objetivo con detección de datos implausibles.
- Desglose de novedades CCT en horas en Financiera.

### 4.2. Qué falta para control RRHH real

1. **Trazabilidad de fatiga** (rachas de nocturnidad, secuencias >X días, descansos insuficientes).
2. **Rotación funcional por objetivo** (estabilidad vs alta rotación por cliente/puesto).
3. **KPIs de cumplimiento convencional** (descansos, francos mínimos, límites semanales por persona).
4. **Calidad de legajo** (porcentaje con domicilio geocodificado confiable, CUIL/campos críticos completos).
5. **Ausentismo prevenible**: separar estructural (vacaciones planificadas) vs contingente (AA/E) para acción de jefatura.

## 5. Lente financiera — decisiones y control

### 5.1. Lo que ya aporta

- Consumo hs-hombre piramidal (empresa/cliente/objetivo/guardia).
- Separación entre horas de cobertura, horas sumadas por novedades y horas “no usadas” (F/RET/REF/ESC).
- Delta de consumo vs SLA (en horas), eficiencia SLA/consumo y composición de drivers (FT, ext, ops).

### 5.2. Qué falta para control financiero de negocio

1. **Puente Liquidación hs vs Prefactura hs** por ciclo y objetivo (misma fuente, mismas reglas y trazabilidad de diferencias).
2. **Centro de costo en horas** integrado al objetivo (sin monto), para detectar dónde se consume sobre SLA.
3. **Forecast de cierre en horas** (proyección fin de período de FT/ext/ausencias/vacantes).
4. **Matriz de desvíos en horas** (SLA vs plan vs real vs prefactura) con causal principal.
5. **Alertas tempranas en horas** con umbrales pactados (ej. FT > X% SLA del objetivo).

## 6. Tablero mínimo viable de control de unidad de negocio (métricas + fuentes + frecuencia)

> Objetivo: que Mauro pueda decidir cobertura, dotación y rentabilidad sin salir de un tablero único.

| Métrica | Definición operativa | Fuente técnica actual | Frecuencia sugerida |
|---|---|---|---|
| 1. Cumplimiento SLA (%) | `resultante / slaHours` por objetivo y total | `buildDemandaByObjective` + `servicios_sla` + `turnos` | Diario + cierre mensual |
| 2. Vacancia crítica (hs) | `vacantHours` por objetivo/banda | `turnos` + `analisisDemanda` | Diario |
| 3. Dependencia FT (%) | `ftHours / slaHours` por objetivo | `turnos` + `analisisDemanda` | Diario/semanal |
| 4. Ausentismo operativo (%) | `hsAusencias / capacidad período` (con categorías) | `ausencias` + `turnos` + `buildAusenciasStats` | Diario/semanal |
| 5. Cobertura de ausencias (%) | `hsAusenciasCubiertas / hsAusencias` | `buildAusenciasStats` + `demanda` | Semanal |
| 6. Carga extrema por guardia | guardias >200h y guardias 160-200h | `actual.byGuard` en `index.tsx` | Semanal |
| 7. Eficiencia hs-hombre (%) | `slaHours / hsConsumo` | `buildAnalisisFinanciera` + `rollAnalisisFinanciera` | Semanal/mensual |
| 8. Horas no productivas (hs) | `hsFranco + hsRet + hsDespliegue` | `analisisFinanciera` | Semanal |
| 9. Gap liquidación vs prefactura (hs) | `hsLiquidación - hsPrefactura` por ciclo/objetivo | `getPayrollSnapshotInternal` + reportes prefactura (`useReportes`) | Semanal/cierre de ciclo |
| 10. Riesgo ART.12 (casos) | guardias >25km con data confiable + casos con coord. dudosa | cálculo ART12 en `index.tsx` + geo RRHH/objetivos | Semanal |
| 11. Viabilidad diaria (días en déficit) | días con `gap > 0` por servicio | `buildViabilityRangeReport` | Diario |
| 12. Calidad de dato crítico (%) | `% turnos con hora válida`, `% legajos con geo válida`, `% objetivo mapeado` | `turnos`, `empleados`, `objetivos/clients` | Semanal |

## 7. Gaps vs lo que hay hoy (priorizado P0/P1/P2)

### P0 (impacto directo en decisiones de negocio en horas)

1. **No hay conciliación automática Liquidación hs vs Prefactura hs** por ciclo/objetivo/cliente.
2. **No hay matriz única de desvío de horas** (SLA vendido, planificado, fichado, liquidado, prefacturado).
3. **No hay snapshot de cierre versionado** del tablero analítico: el número “se mueve” y complica auditoría.

### P1 (impacto alto en operación y control RRHH)

4. **Ausencias sin ventana de consulta optimizada** (`fetchAusenciasAll`): costo/read puede crecer fuerte.
5. **KPIs de fatiga/compliance laboral incompletos** (nocturnidad secuencial, descansos, límites semanales).
6. **Dependencia de calidad de maestros (geo/IDs)** sin tablero de calidad de dato visible para gestión.

### P2 (mejoras de robustez y escalabilidad)

7. **Escritura de `hours_balances` desde front**: funcional, pero menos robusto que pipeline backend/event-driven.
8. **Ambigüedad semántica 192 vs 200**: está explicada, pero requiere reforzar UX de interpretación.
9. **Guard de permiso en ruta no explícito** en Análisis/Reportes (la visibilidad actual depende del contexto de navegación/permisos).

## 8. Preguntas para Mauro

1. Confirmado: ¿sostenemos como alcance formal del módulo que el control será **solo en horas** (sin importes) durante esta etapa?
2. ¿Cuál es el umbral de alerta FT aceptable por objetivo (% de SLA) para disparar acción operativa?
3. ¿Qué versión debe ser “oficial” para comité: corte diario dinámico o snapshot de cierre mensual congelado?
4. ¿Qué reglas de compliance laboral quieren ver primero en tablero (descanso, nocturnidad, topes)?
5. ¿Qué periodicidad necesitan para revisión ejecutiva (diario de operaciones, semanal de jefaturas, mensual de directorio)?
6. ¿Las horas RET/REF/ESC se imputan 100% al objetivo o parte va a un centro de costo de estructura (siempre en horas)?
7. ¿La conciliación objetivo es **Liquidación hs vs Prefactura hs** (sin facturación en $) como KPI principal de cierre?
8. ¿Qué tan prioritario es incorporar un indicador de “calidad de dato” como KPI de gestión (geo, IDs, fichadas)?

---

### Hipótesis explícitas (no confirmadas en este relevamiento)

- **H1 (pendiente de validación funcional con usuarios):** parte de los responsables podría seguir interpretando “192” y “200” como equivalentes pese a las aclaraciones de UI.
- **H2 (pendiente de validación con datos productivos):** el costo de `fetchAusenciasAll` se vuelve material en empresas con histórico largo de ausencias.

