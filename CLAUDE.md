# COSP V1.0 — Protocolo de trabajo para agentes IA

> **Lectura obligatoria al iniciar cualquier sesión de trabajo.**
> Este archivo es la fuente de verdad para todos los agentes (Claude Code, Cursor/Claude Agent, etc.).
> Si algo cambió en el proyecto y no está reflejado aquí, actualizá este archivo.

---

## 0. Cómo usar este archivo según la herramienta

### Claude Code (Notebook)

Lo lee **automáticamente** al iniciar sesión — no hace falta hacer nada.

### Cursor / Claude Agent (N8N u otro agente)

Pegá esto al **inicio del chat** (o equivalente en el prompt del sistema):

```text
Leé el archivo CLAUDE.md en la raíz del proyecto antes de empezar. Es el protocolo de trabajo del equipo y define arquitectura, convenciones, flujo git/deploy y qué no tocar.
```

Para **cualquier agente nuevo**: misma instrucción. Este archivo resume stack, colecciones Firestore, códigos de turno, módulos de permisos, flujo Notebook → N8N → producción y reglas de trabajo.

### Mantenimiento

Si cambia algo importante (nueva colección, regla de seguridad, módulo, flujo de deploy), **actualizá `CLAUDE.md`** en el mismo PR o commit; así Claude Code y quien pegue la instrucción en Cursor quedan alineados en la próxima sesión.

---

## 1. ¿Qué es este proyecto?

**COSP V1.0** — Sistema de gestión operativa para empresas de seguridad privada.

Funcionalidades principales:
- **Planificación de turnos**: asignar guardias a objetivos/puestos por período
- **Operaciones en tiempo real**: monitor de guardias activos, ausentes, vacantes
- **RRHH**: legajos, novedades, ausencias, licencias
- **CRM**: clientes, objetivos, servicios/SLA
- **Reportes**: detalle de turnos y planificación con horas y estados
- **Portal empleado**: el guardia ve sus turnos, marca presencia, pide licencias
- **Roles y permisos**: por módulo (ver/crear/editar/borrar)

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14 (static export), TypeScript, Tailwind CSS |
| Backend | Firebase (Firestore, Auth, Functions) |
| Functions | NestJS sobre Firebase Functions (Node.js) |
| Hosting | Firebase Hosting |
| Estado | React hooks + Firestore real-time (`onSnapshot`) |
| UI | Componentes propios + Lucide React icons + Sonner (toasts) |

Firebase **Functions** (`apps/functions`): runtime **Node.js 22** (`engines` en `package.json`). **`firebase-functions` v7+** usa por defecto la API v2; las callables/triggers **de 1ª gen** importan **`firebase-functions/v1`** (`https.onCall`, `runWith`, `region`, etc.). HTTPs que ya usan **`firebase-functions/v2/https`** o **`v2/scheduler`** se mantienen así.
---

## 3. Estructura del repo

```
cronoapp/
├── apps/
│   ├── web2/                  ← Frontend Next.js (TODO el código UI)
│   │   ├── src/
│   │   │   ├── pages/admin/   ← Páginas del panel de administración
│   │   │   │   ├── operaciones/index.tsx   ← Monitor en tiempo real
│   │   │   │   ├── planificacion/index.tsx ← Planificador de turnos
│   │   │   │   ├── rrhh/index.tsx          ← RRHH y novedades
│   │   │   │   ├── crm/index.tsx           ← Clientes y objetivos
│   │   │   │   ├── servicios/index.tsx     ← SLA, puestos; análisis de turnos/esquema (sin costeo)
│   │   │   │   ├── reportes/index.tsx      ← Reportes y liquidación
│   │   │   │   └── configuracion/index.tsx ← Roles, usuarios, empresa
│   │   │   ├── pages/empleado/dashboard.tsx ← Portal del guardia
│   │   │   ├── hooks/
│   │   │   │   ├── useOperacionesMonitor.ts ← Lógica central de operaciones
│   │   │   │   ├── usePlanificacion.ts      ← Lógica de planificación
│   │   │   │   └── useReportes.ts           ← Lógica de reportes
│   │   │   ├── services/      ← Acceso a Firestore (CRUD)
│   │   │   ├── context/       ← AuthContext, EmpresaContext
│   │   │   └── config/modules.ts ← Definición de módulos y permisos
│   │   └── .env.local         ← Config local (NO commitear)
│   ├── functions/             ← Firebase Functions (NestJS)
│   │   └── src/
│   │       ├── auth/          ← Gestión de usuarios Auth
│   │       ├── data-management/ ← CRUD empleados, clientes, etc.
│   │       └── scheduling/    ← Lógica de turnos y patrones
├── firebase.json              ← Config Firebase + emuladores
├── firestore.rules            ← Reglas de seguridad Firestore
├── CLAUDE.md                  ← Este archivo
└── scripts/                   ← Scripts utilitarios de admin
```

---

## 4. Colecciones Firestore clave

| Colección | Descripción |
|-----------|-------------|
| `turnos` | Turnos planificados y operativos. Campo clave: `objectiveId`, `employeeId`, `startTime`, `endTime`, `origin`, `isPresent`, `isAbsent` |
| `clients` | Clientes con array `objetivos[]` embebido |
| `empleados` | Legajos. Campo `uid` = Firebase Auth UID |
| `ausencias` | Ausencias/licencias. `shiftId` vincula con turno. `origin: 'AUTO_T30'` = generada automáticamente |
| `tipos_novedad` | Catálogo parametrizable de tipos RRHH por empresa (label, código grilla, `defaultDays`, flags). Soft delete `status: INACTIVE`. Seed incluye MAVIC (mutual SUVICO) |
| `novedades` | Alertas operativas. `shiftId` vincula con turno |
| `planificacion_estados` | Publicación de planificación. Key: `${objectiveId}_${year}_${month}` |
| `servicios_sla` | Contratos/SLA con estructura de puestos y turnos permitidos. Puesto `coverageType: eventos` = extras (Eventos): no cubre ni vende SLA; las TURA imputadas van a prefactura agrupadas por día. `billingMode` (`PLANIFICADO`/`EJECUTADO`/`FIJO`/`ORDEN_COMPRA`) manda en la prefactura; sin `billingMode`, contrato comercial `abierto` (`contracts`) → EJECUTADO. Prefactura **Auto** resuelve el modo por objetivo (`resolveSlaBillingMode`, `lib/crm/slaBilling.ts`). EJECUTADO/OC = horas por franja (`executedBillableHoursByFranja`: ESC/REF no facturan, la tardanza no descuenta, la salida anticipada sí salvo que cubra un retenido —tope 12:59 h— o el relevo que llegó antes; turnos cargados por rango de `startTime`). La grilla Ejecutado se pinta con los aportes por legajo de esas franjas (mismo total que el contador). Servicios: sin `billingMode` = opción «Auto: …» (guarda `null`). |
| `hours_balances` | Extracto mensual por objetivo (legacy). Las pantallas ya no lo escriben (H2b). Solo se lee como fallback rotulado «anterior» si el rebuild del libro falla. |
| `hours_ledger` / `hours_ledger_monthly` | Libro H2a (escritor único en Functions: `rebuildHoursLedger`). Día por puesto y rollup mensual. No pisa `hours_balances`. Lectura en `/admin/banco-horas`. Escritura solo servidor. SLA del mes = contratos en operación (activo + cronograma publicado + cliente activo) + cerrados del mes prorrateados; el cerrado se muestra aparte y ya está en el total. Inactivo y sin plan quedan fuera. Trabajadas del libro = solo ese universo; el resto va a trabajadas fuera de operación. FT, EXT y ADV del libro salen del mismo desglose que liquida el motor persona (hours-core, tope H1): separados, no sumados. Cubiertas no superan las trabajadas en operación más el retenido/relevo de franja. Liquidación sigue pagando todo lo trabajado. La prefactura (contador, grilla y PDF) factura solo objetivos en operación del período (`classifySlaBucket`, el mismo universo del libro); los turnos de objetivos sin servicio quedan como fuera de contrato y no se facturan. Reportes → Liquidación con `hoursCoreEnabled` usa ese motor (igual que payrollApi): Hs. normales, al 50% y FT por separado, y el total trabajado es normales + al 50% + FT. |
| `hours_ledger_jobs` | Recálculo H2c en segundo plano. La callable solo crea el doc y responde el `jobId`. Tandas de 10 objetivos. Lectura tenant admin, escritura solo servidor. |
| `hours_ledger_dirty` | H2f. Doc `{empresaId}_{objectiveId}_{yyyy-mm}`. Lo escriben los triggers (turnos/fichada, publicar o despublicar `planificacion_estados`, `servicios_sla`, `clients.objetivos`, ausencias). Escritura solo servidor; lectura tenant admin para mostrar «Actualizando…». Mauro publica las reglas. |
| `roles` | Permisos por módulo. Estructura: `{ permissions: { MODULE_KEY: ['read','create',...] } }` |
| `payroll_settings` | Modo de horas publicado al endpoint de liquidación (`hoursMode: planned \| real`). Doc id = `empresaId`. |
| `integrity_reports` | Informe nocturno (03:30 AR, `scheduledIntegrityScan`) por empresa. Doc id = `{empresaId}_{yyyy-mm-dd}`. Solo reporta. Si hay hallazgos, novedad `INTEGRIDAD_DATOS` (oculta en el monitor de Ops). |

### Períodos de horas (no mezclar)

| Consumidor | Rango |
|------------|--------|
| Liquidación, libro PERSONA, Reportes, `payrollApi` | Ciclo CCT **26 del mes anterior → 25** del mes de cierre |
| Prefactura, libro PUESTO, SLA vendido, KPIs mensuales | Mes calendario **1 → 30/31** |

El detalle se guarda **por día**. Un doc id `yyyy-mm` es solo el mes calendario: la liquidación del cierre octubre lee `yyyy-09` (días 26..fin) **y** `yyyy-10` (días 1..25). Congelar un ciclo 26→25 no congela la prefactura de ese mes, ni al revés. Helper: `apps/web2/src/lib/hoursPeriod.ts`. `calculateLiquidationHoursStats` no recibe el ciclo: el llamador filtra los turnos al rango antes.

### Campos importantes en `turnos`

```typescript
origin: 'RETEN' | 'OPERATIONS_COVERAGE' | 'SLA_VIRTUAL' | undefined  // turno operativo vs planificado
isPresent: boolean       // guardia marcó presencia
isAbsent: boolean        // guardia ausente
isCompleted: boolean     // turno finalizado (checkout)
isReportedToPlanning: boolean  // vacante enviada a planificación
isFranco: boolean        // día franco
draft: boolean           // borrador (no mostrar en ops)
resolvedBy: 'OPERACIONES' | undefined
archiveTier?: 'hot' | 'warm' | 'cold'  // retención (cron scheduledTagTurnosArchiveTier)
```

### Retención de datos (hot / warm / cold)

Fuente: `apps/web2/src/lib/dataRetention.ts` (mirror `apps/functions/src/ops/dataRetention.ts`).

| Capa | Ventana | Uso |
|------|---------|-----|
| **Hot** | Mes en curso + **2** meses calendario cerrados | Ops, Planificación (default), Portal, VIGI, Análisis (`analisisWorkingWindow`) |
| **Warm** | Hasta **12** meses atrás (incluye hot) | Historial app: reportes, liquidación, corrección puntual |
| **Cold** | Anterior a esos 12 meses | No navegar online; export/backup |

- Planificación bloquea navegación a **cold**; **warm** muestra aviso.
- Cron diario `scheduledTagTurnosArchiveTier` (04:15 AR) etiqueta `archiveTier` **sin borrar**.
- Callable admin `tagTurnosArchiveTier` (`dryRun`, `empresaId`, `maxDocs`).
- Fase siguiente: mover cold fuera de la colección caliente (aún no implementado).

### Regla crítica: turno operativo vs planificado

```typescript
const isOperationalOrigin = (shift) =>
    shift.origin === 'RETEN' ||
    shift.origin === 'OPERATIONS_COVERAGE' ||
    shift.origin === 'SLA_VIRTUAL' ||
    !!shift.isReten ||
    shift.resolvedBy === 'OPERACIONES';
```

Los turnos **operativos** siempre se muestran en operaciones.
Los turnos **planificados** solo se muestran si la planificación está publicada (`planificacion_estados`).

---

## 5. Módulos y permisos

Definidos en `apps/web2/src/config/modules.ts`:

| Key | Módulo | Ruta |
|-----|--------|------|
| `DASHBOARD` | Dashboard Principal | `/admin` |
| `OPERATIONS` | Operaciones | `/admin/operaciones` |
| `PLANNING` | Planificación y Turnos | `/admin/planificacion` |
| `RRHH` | RRHH y Legajos | `/admin/rrhh` |
| `CLIENTS` | Clientes y Objetivos | `/admin/crm` |
| `SERVICES` | Servicios y SLA | `/admin/servicios` |
| `REPORTS` | Reportes y Liquidación | `/admin/reportes` |
| `ANALYSIS` | Análisis Operativo | `/admin/analisis` |
| `HOURS_BANK` | Banco de Horas (libro `hours_ledger`) | `/admin/banco-horas` |
| `CONFIG` | Configuración Global | `/admin/configuracion` |

Acciones por módulo: `read`, `create`, `update`, `delete`.
`PLANNING` además: `publish`, `correct`, `auto_lab`, `assign_ft` (Franco Trabajado).
`RRHH` además: `adjust`.
`HOURS_BANK` además: `rebuild` ya no muestra el botón. **Recalcular** queda solo para SuperAdmin (forzado manual). El libro se recalcula solo: cambios de datos marcan `hours_ledger_dirty` y un scheduler cada **5 min** encola esos objetivos-mes en el job H2c (debounce `dueAt` +2 min). Nadie recalcula al abrir una pantalla. Cada doc del libro guarda `engineVersion`. Constante `LEDGER_ENGINE_VERSION` en `apps/functions/src/hoursLedger/ledgerDirtyPlan.ts`: **al cambiar reglas de horas, subirla** (plan sin cobertura ya está en 1; el próximo cambio, por ejemplo EV, pasa a 2). El scheduler de 5 min recalcula la ventana hot (mes en curso + 2 cerrados) si la versión es vieja. El nocturno **03:40** sigue como red de seguridad. Con `hoursCoreEnabled` en false no se marca ni se recalcula. Los roles existentes con REPORTS/ANALYSIS **no** reciben HOURS_BANK solos: lo asigna Mauro en Configuración → Roles. Las reglas Firestore no leen permisos por módulo: `hours_ledger*` se lee con `tenantAdminRead()`.
`isSuperAdmin` bypasea todos los permisos.

**Centro de Control (kill switch):** campo `empresas/{id}.centroControlEnabled` (default ON). SuperAdmin lo apaga en Configuración → Empresas. Si está en `false`, los crons `detectarAusencias`, `gestionarVacantes` y `autoCompletarTurnos` no generan novedades/AUTO_T30/avisos para esa empresa; tampoco el aviso de llegada tarde ni el auto-monitor del front. **Excepción:** `autoCompletarTurnos` igual **cierra** turnos en modo silencioso (relevo programado/presente, sin continuidad en fin planificado, tope 12:59 y retroactivo con `requiereRevision`), sin retener, sin novedades, sin escalar vacante y sin push.

**Alertas IA retiradas (CC):** el cron `operationalAlertsCron` (**no desplegado**) generaba novedades `IA_ALERTA_*` vía `scanOperationalAlertsForEmpresa` (`apps/functions/src/automation/operationalAutomation.ts`, flag `IA_OPERATIONAL_ALERTS_ENABLED = false`). Duplicaban el monitor; el front oculta `IA_ALERTA_*`. Limpieza histórica: `node scripts/retire-ia-alerta-novedades.mjs` (dry-run; `--apply` solo con OK de Mauro).

**Sala multi-operador (Manual):** el modo Manual/Auto se resuelve a nivel **empresa** (`sesiones_operador` activas), no por “si yo abrí sesión”. Primer ingreso = **piloto**; siguientes = **copiloto** (pueden pedir mando; el piloto acepta/rechaza). Piloto “Pasar a Auto” cierra todas las sesiones → Auto para todos. Banner en Ops muestra quién es piloto/copiloto. Asistido solo lo ejecuta el piloto. Demo (SA) cierra la sala al activarse.

### Protocolo de cobertura (Ops — CC, Map view, Auto, Demo)

**Regla de producto:** Manual, Auto y Demo comparten el **mismo orden CCT** (retención en puesto → **RET → REF → ESC** → **Ext + Adel** → **FT**). Manual lo opera el CC; **Auto** dispara convocatorias con guardias reales; **Demo** inventa eventos y **`simularRespuestasConvocatorias`** simula aceptación/rechazo.

**Demo no toca licencias ni objetivos fuera de operación:** todo escritor de presencia ficticia filtra por **`isSimulableShift` / `simulableShiftSkipReason`** (`apps/functions/src/common/simulableShift.ts`). Quedan afuera códigos de licencia/ausencia (`V`, `L`, `E`, `A`, `ART`, `AA`, `PG`, `SGS`, `SUS`), francos (`F`, `FF`, `FP` / `isFranco`), `draft`, `isVirtual`, registros `ops_cov` de horas en origen y turnos cuyo objetivo **no está en operación ese día** (`FUERA_OPERACION`). Universo = el SLA del mes del Banco de Horas: contrato activo vigente ese día **o** contrato cerrado cuya vigencia incluye ese día (fechas AR; string `YYYY-MM-DD` o Timestamp 00:00 UTC), cliente activo y cronograma `planificacion_estados` publicado del mes (`ObjectiveOperationCache`). Cronograma en borrador no se simula. El Centro de Comando y el mapa ya ocultan el planificado sin `publishedAt`. Lo usan `runModoDemoForEmpresa`, `simularRespuestasConvocatorias`, `autoPresenciaYCierre`, la simulación del asistente y la cascada Demo (no genera ausencia ni cobertura fuera de operación). La simulación nunca inventa `realStartTime` sobre esos turnos. Complemento en el servidor: un turno con código de licencia **no se cierra por tope** — si quedó `PRESENT` el cron lo deja abierto (acción `WAIT` / `LICENCIA_PRESENTE`) para que lo corrija RRHH. Datos históricos de pruebas_sa: `node scripts/fix-p1d-demo-fuera-operacion.mjs` (dryRun; `--apply --allow-prod` solo con OK de Mauro).

**UI (misma pieza en las dos pantallas):**

| Ruta | Archivo |
|------|---------|
| Centro de Comando (lista) | `apps/web2/src/pages/admin/operaciones/index.tsx` |
| Map view | `apps/web2/src/pages/admin/operaciones/map-view.tsx` |

Ambas montan **`CoverageSessionManager`** + **`bootstrapCoverageSession`** al abrir protocolo (`openCoverageProtocol`). Datos: **`useOperacionesMonitor`**. Libs: `apps/web2/src/lib/operaciones/coverageRetention.ts`, `coverageInternalCandidates.ts`, `coverageGeo.ts` (distancia domicilio→objetivo, **15 km** default, ampliación **30 km**, ETA auto ~30 km/h), `opsConvocatoriaCobertura.ts`, `opsExtAdvCandidates.ts`, `syncAusenciaCobertura` (mirror front).

**Backend (Auto/Demo/vacantes):** `apps/functions/src/coverage/convocatoriasCobertura.ts` (`iniciarCascadaCobertura`, `crearConvocatoriaCobertura`, `resolverCobertura`, `simularRespuestasConvocatorias`), `coverageRetention.ts` (**`retainOutgoingForGap`** — único escritor de retención por hueco; libera con `releaseRetentionForAbsenceShift` al `applyCoverage` FULL), `ops/opsManualMode.ts` (`isEmpresaManualMode` = sesiones `sesiones_operador` ACTIVO), `positionHasContinuity.ts` + `scheduling/autoCompletarTurnosCore.ts` (cierre/retención según continuidad SLA ±30 min AR), `eligibilityFilter.ts`, `syncAusenciaCobertura.ts`. Triggers: **`onTurnoAbsenciaDetectada`** (Manual: solo retención; Auto/Demo: retención + cascada), cron **`gestionarVacantes`** (sin cascada en Manual), **`modoDemoCron`**, scheduler **`checkConvocatoriaTimeouts`**. Callable admin **`releaseInvalidRetentions`** (`dryRun` default) para liberar retenidos inválidos sin continuidad.

**UI vigente:** solo **`CoverageSessionManager`** (no reintroducir modales legacy de cobertura en estas páginas).

**Backlog Ops cobertura (actualizar este listado al cerrar tareas; commit en `main`):**
- [x] **Escritor único `applyCoverage`** (`functions/src/coverage/syncAusenciaCobertura.ts` + espejo `web2/src/lib/operaciones/syncAusenciaCobertura.ts`) para Manual, app y Auto/Demo: turno origen del que cubre intacto + `coverageUsed`; cobertura siempre en doc `ops_cov_{titularShiftId}_{employeeId}` (`origin: OPERATIONS_COVERAGE`, banda/horario del titular); EXT/ADV = `coverageHoursOnSource: true` (horas en el turno propio, no se suman dos veces); claim atómico `coverageClaimConvocatoriaId` (expira 2 min). E2E: `node scripts/eval-coverage-e2e-emulator.mjs` (emulador :8080, `npm run build` en functions).
- [x] **Auto Ext+Adel:** titular `PARTIAL` con una pata; no cancela la pata hermana y convoca la faltante (`ensureMissingDualLegConvocatoria`); sin candidato → novedad `VACANTE_PARCIAL`.
- [x] **Callable Manual:** tipos **REF/ESC** nativos + `candidateShiftId` en `crearConvocatoriaCobertura`.
- [x] **Retención auto (Fase 1):** `retainOutgoingForGap` en backend; protocolo CC solo lectura (`bootstrapCoverageSession`); liberación al `applyCoverage` FULL; saliente ±30 min del hueco; CC badge RECARGO si `isRetention`. Pasado el fin sin cierre: **ESPERANDO RELEVO** (siguen en ACTIVOS) hasta que el server escribe la retención.
- [x] **Cascada Manual/Auto (Fase 1):** con sesión CC activa no corre `iniciarCascadaCobertura` (trigger + `gestionarVacantes`); Demo sin cambio.
- [x] **Cierre automático (Fase 1):** `positionHasContinuity`; sin continuidad → `SIN_CONTINUIDAD_SLA`; sin auto-cierre 2 h en puestos continuos.
- [x] **Cierre único + tope 12:59 (P1):** solo el server cierra automáticamente (`autoCompletarTurnosCore` + `registrarPresencia`, vía `scheduling/shiftClose.ts` `buildAutoClosePatch`: siempre `realEndTime`, `retentionMinutes` si retenido). Tope 12:59 desde inicio real aun con continuidad → `TOPE_JORNADA` + novedad + vacante escalada; > 2 h pasado el tope → `TOPE_JORNADA_RETROACTIVO` con `requiereRevision`. El navegador ya no cierra (solo aviso); salida/relevo manual del CC siguen. `dryRun` en `runAutoCompletarTurnosPass`.
- [ ] **Retención — pendiente:** liberar FIFO al fichar entrante (relevo); retención tras chequear cobertura en orden estricto spec; no sacar compañero de activos en edge cases UI.
- [ ] **Convocatorias CC:** cancelar al rechazar/cerrar; botón «Acepta» siempre visible.
- [ ] **Flujos recuperados:** sin turno, retener sola, sin cobertura con turno sintético, candidatos de otros objetivos, candidatos > 30 km.
- [ ] **Cascada Auto:** sin turno / volante primero; fechas en hora AR (hoy UTC).
- [x] **Fase 2 — ops_cov EXT/ADV registro:** excluidos de ausencias/retención/cascada/listas Ops; callable **`releaseTraceAbsences`** (`dryRun` default). E2E 21.
- [x] **Fase 2 — `markShiftAbsent`:** motor único AA + RRHH + `AUSENCIA_AUTO` (T+30, llegada tarde, convocado, manual CC).
- [x] **Fase 2 — llegada tarde:** **`notificarLlegadaTarde`** (T−60…T+5, `lateArrivalEtaMinutes` / `lateArrivalEtaAt`); ETA vencida en **`detectarAusencias`**; callables **`revertirAusencia`** / **`marcarAusenciaOperaciones`**.
- [x] **P5c — ventana de llegada:** deadline de AA = **max(T+30, min(ETA, T+60))**. Hasta ese deadline se puede fichar (TARDE AVISADA si avisó, TARDE SIN AVISO si no). **Sin aviso:** a T+30 hay AA **y** vacante + cascada en el mismo momento (`AUTO_T30`); se puede revertir hasta T+60 si ficha o LLEGÓ?. **Con aviso:** AA provisoria (`ETA_VENCIDA`) sin vacante ni cascada hasta T+60; el CC muestra «NO LLEGÓ / posible ausencia»; la vacante abre al T+60 o si el operador declara (`marcarAusenciaOperaciones`). Retención del saliente en ambos casos. Espejo en ops-core, `detectarAusencias` y portal-core.
- [x] **P9 — saliente presente no desaparece:** un PRESENT sin `realEndTime` sigue en ACTIVOS aunque haya pasado `endTime` (mapa y CC). Pasado el fin: **ESPERANDO RELEVO** con minutos; cuando el cron escribe `isRetention`, badge **RETENIDO**. `autoCompletarTurnos` toma el fin en el momento (`endTime <= now`, sin esperar 5 min) y retiene con `retentionStartedAt` = fin planificado y `retentionReason` `RELEVO_NO_PRESENTADO`, serie P5g y cupo de la franja siguiente. **P9b:** en ACTIVOS y en RET (lista CC, panel del mapa y popup del objetivo) el retenido muestra badge RETENIDO con contador en vivo (`formatRetentionDuration`: `12 min` / `1 h 05 min`), desde qué hora, a quién espera (relevo de la serie con nombre y hora, o vacante) y el tope 12:59 (`buildRetentionWaitInfo` / `formatRetentionLine` en `packages/ops-core/src/retentionDisplay.ts`; el hook lo deja en `shift.retentionWait`). El contador RET del encabezado cuenta también al saliente vencido sin `isRetention`; los totales del CC no suman RET (ya está en ACT). El relevo programado (`relievedBy` / `relieveScheduledAt`) se revalida al cerrar: entrante presente, de la serie y en la ventana del fin; si no, se limpia (`staleProgrammedReliefPatch`, guarda `staleReliefPrevious`) y sigue la lógica actual. El override del operador (`overrideRelieveShiftId`) que no es de la serie se ignora y vuelve al relevo de la serie; la fichada anticipada del operador también programa el cierre a la hora planificada. Tests: `node --experimental-strip-types scripts/eval-p9b-retention-display.mjs`, E2E `scripts/eval-p9-salientes-emulator.mjs` (Peaje, Río Primero, legacy). Datos: `scripts/fix-p9-salientes-peaje.mjs`, `scripts/fix-p9b-relevo-programado.mjs` (dryRun; `--apply --allow-prod` solo con OK de Mauro). **P9d:** en el modal de ingreso (lista CC, map-view y popup) el saliente de la serie queda elegido (`seriesReliefChoiceNotice` / `outgoingFor`). Si el operador marca otro, el aviso dice a quién le corresponde y si el elegido cierra a su hora o queda retenido; al confirmar igual, el servidor sigue la serie (P9c) y `audit_logs` anota a quién eligió el operador. Test: `node --experimental-strip-types scripts/eval-p9d-aviso-serie.mjs`. **P9e:** en el paso FT una persona sale una sola vez (`collapseByEmployee`): el franco del día del hueco gana sobre el de mañana. Si ese franco ya es FT por otra cobertura, no vuelve a ser candidata salvo que no solape, quepa en 12:59 y deje 10 h de descanso. La distancia usa el domicilio geocodificado del legajo y las coordenadas del objetivo (`logic.objectives`), no el turno. Paridad: `node --experimental-strip-types scripts/eval-coverage-candidates-parity.mjs`. El franco origen (día 00:00–23:59, o F pasado a FT con `coverageDocId`) no se simula ni se marca ausente (`FRANCO_ORIGEN`); `applyCoverage` lo deja en F con `coverageUsed` y el FT real queda en el ops_cov. La app muestra el turno PRESENT. Test: `node --experimental-strip-types scripts/eval-p9e-franco-origen.mjs`.
- [x] **P8 — eventos en el CC:** el EV ficha y cierra como un puesto (ventana T−15…T+30, pago hasta T+5 / fichada desde T+6, tope 12:59, aviso T−5 y ¿Venís?). La ausencia es `markShiftAbsent` (AA + `ausencias` + novedad) con `eventoId` y servicio; no abre vacante del SLA. El hueco del evento usa la cascada del CC sin retención (salvo `eventoFranjasEncadenadas`, que aplica la serie P5g). Candidatos: bolsa de eventuales (`eventualesParaHueco`, vacía hasta el módulo) y después REF → ESC → EXT → ADV → FT. La cobertura se escribe como EV (`applyCoverage`). Eventual ausente: diseño en `planEventualAusente` (AA en la empresa que lo dio de alta, descuento de liquidación, confiabilidad, baja ARCA pendiente si no fichó; sin implementar ARCA). E2E `scripts/eval-p8-eventos-cc-emulator.mjs`.
- [x] **P5+P6 — convocado:** RET/ESC/REF/FT/sin turno no tienen hora de llegada ni AA automática. Fichan al llegar (desde la aceptación hasta el fin del hueco) y el pago arranca en la fichada; al fichar liberan al retenido de la serie (P5g). EXT no ficha (`EXT_NO_CHECKIN`); ADV ficha y libera al extendido. ETA al aceptar: `originCoords` del celular o domicilio del legajo, colectivo ~20 km/h + 10 min (`convocadoEtaSpeedKmh` / `convocadoEtaWaitMinutes`); ESC/REF en el mismo objetivo = 5 min. Se guarda `originSource`, `etaMinutes`, `expectedArrivalAt`. Recordatorio push a los 2/3 (`CONVOCADO_RECORDATORIO`, canal `alertas_turno`); respuesta `responderRecordatorioConvocado` (`ON_WAY` 10/15/30 o `PROBLEM` → novedad `PROBLEMA_CONVOCADO`). Si pasa la llegada + 15 min sin fichar: `CONVOCADO_DEMORADO` (una vez por ETA; se repite si reprograman). El seguimiento consulta solo lo que vence (`reminderPending` / `delayAlertPending`, paginado; índices en `firestore.indexes.json`); la fichada y el hueco terminado lo cierran (`followUpClosedReason`). Campos que lee la app (no renombrar): `expectedArrivalAt`, `etaMinutes`, `reminderSentAt`, `convocadoReply/At/Note`, `originCoords/originSource`; en el ops_cov `convocadoReminderSentAt`, `convocadoDemorado`. El CC muestra EN CAMINO. Auditoría `convocatorias_cobertura/{id}/eventos` (escritura solo servidor; reglas en `firestore.rules`, las publica Mauro). E2E `scripts/eval-p5-p6-e2e-emulator.mjs`.
- [x] **P5g — relevo por serie:** además del horario (fin = inicio ±30, mismo puesto), el relevo sigue la serie del código. `relieverFor` / `outgoingFor` en `packages/ops-core/src/shiftSeries.ts` (espejo `apps/functions/src/common/shiftSeries.ts`): M→T→N→M, M2→T2→N2→M2 (el sufijo es la serie), D12→N12→D12. Si el código no es serie (vacío, custom, FT; ops_cov hereda el del titular) queda el horario. Con varios candidatos gana la serie. ESC/REF/RET siguen sin relevar. Lo usan la fichada, `retainOutgoingForGap`, `autoCompletarTurnosCore` y la continuidad del SLA. E2E 71–74.
- [x] **P5f — revertir siempre hasta T+60:** desde el instante de la AA hasta T+60 el operador tiene salida en Manual, Asistido, Auto y Demo. `canRevertAbsenceNow` (`lib/operaciones/revertAbsenceWindow.ts`) habilita **LLEGÓ? / REVERTIR** en cualquier pestaña del CC y en el popup del mapa, aunque la vacante ya esté abierta, la cascada corriendo o el titular marcado como cubierto (antes la tarjeta devolvía `null` con `operacionallyCovered` y el mapa no mostraba botón si la AA no era provisoria). Si hay cobertura activa el callable sigue pidiendo `cancelCoverage`: lo resuelve el modal del operador. E2E 69–70.
- [x] **P5e — push al guardia:** el texto que recibe el vigilador lleva su primer nombre (`common/pushGreeting.ts`: `firstName` o lo que sigue a la coma en `employeeName`, capitalizado). Sin nombre, no hay saludo. Tono de voseo, corto; la retención es firme («⛔ Quedás retenido»). Los avisos al CC no cambian. Canal `alertas_turno` y prioridad alta se mantienen donde ya estaban.
- [x] **P5d — reloj, relevo y demora:** lo que se **muestra** es `realStartTime` (pago: inicio planificado hasta T+5, fichada desde T+6). Si fichó antes, se ve el inicio planificado y `checkInAt` queda chico («marcaste HH:MM»). El relevo automático es solo quien **termina** cuando empieza el entrante (mismo puesto, fin ±30 min): `realEndTime` y la liberación = max(inicio planificado del entrante, el fin del saliente si es posterior, o ahora si ya pasó). Fichada anticipada **programa** el cierre (`relieveScheduledAt`); el cron lo cierra a esa hora. Quien comparte el fin no es relevo. Retención: mismo criterio (no quien arranca a esa hora ni quien está a mitad). Demora avisada: **10, 15 o 30** min (el servidor clampa a 30). Con aviso el plazo de llegada es T+30; T+60 solo revierte y, si avisó, abre la vacante. La app del guardia lleva OTA.
- [x] **Fase 2 — fichada servidor:** ventanas en **`checkInWindow.ts`** + **`registrarPresencia`** / **`requestCheckIn`** (Ops sin ventana). E2E 22–28.
- [ ] **Fichaje convocado (portal UI):** alinear **`portal-core` `getCheckInTiming`** con ventanas servidor; **`CONVOKED_FLEX`** legacy si aplica.
- [x] **P5 — ventana del convocado (ops_cov):** ancla `acceptedAt` (= `respondedAt`; se persiste en el ops_cov). Tope = min(acceptedAt+60 min, fin del hueco). 0–30 a tiempo (`realStartTime` = fichada, sin LT). 30–tope: LLEGADA_TARDE, minutos = fichada − (acceptedAt+30). Después: TOO_LATE y el mismo tope en `runConvocadoAbsentPass` + re-cascada. El titular sigue T+5/T+30. Espejo en `evaluateCheckInWindow` / `deadlineFromWindow`. Countdown en el CC.
- [x] **P6 — auditoría:** subcolección `convocatorias_cobertura/{id}/eventos` (CREADA, PUSH, RESPUESTA, RESULTADO). Padre conserva `status`/`respondedAt`. Lectura tenant admin; escritura solo servidor (**reglas sin publicar**). Línea de tiempo al expandir la fila en el CC.
- [x] **P2 — Candidatos únicos:** `buildCoverageCandidates` en `packages/ops-core` (copia idéntica en `functions/src/coverage/coverageCandidates.ts`). Manual, Auto y Demo usan la misma lista. Reglas: el ausente no se cubre; licencia en malla o en `ausencias` no es candidata; EXT/ADV contiguos ±30 min (mismo puesto primero); tope 12:59; zombis fuera; una sola cobertura/convocatoria por persona; PARTIAL no cancela el resto; al aceptar se revalida. El orden de cascada sigue en `COVERAGE_CASCADE_ORDER` (hoy RET→REF→ESC→EXTEND→ADVANCE→FT) hasta que Mauro lo cambie. Paridad: `node --experimental-strip-types scripts/eval-coverage-candidates-parity.mjs`. Escaneo de ventanas: `node scripts/scan-ops-cov-ventanas.mjs` (dry-run).
- [ ] **Prioridad EXT** sobre guardia **retenido** (`isRetention` / retención por ausencia) y segmentos por horario (HH:MM–HH:MM), no solo código M/T/N.
- [x] **P1d — Demo solo en operación:** `FUERA_OPERACION` si no hay SLA activo o cerrado vigente ese día, cliente activo y cronograma publicado (mismo universo que el SLA del mes del Banco de Horas). Borrador no se simula. E2E caso 57. Script `npm run fix:p1d-demo-fuera-operacion` (dryRun; `--apply --allow-prod` solo con OK de Mauro).
- [x] **P1b — Demo/licencias, tope y pestaña vieja:** filtro único `simulableShift.ts`; `LICENCIA_PRESENTE` en `autoCompletarTurnosCore`; clave `planificacion_estados` en calendario AR (`arPlanificacionEstadoKey`); regla `turnos` que rechaza desde cliente los motivos de cierre retirados por P1 (**reglas sin publicar — las publica Mauro**); aviso + recarga automática del panel cuando hay versión nueva. Tests: `node scripts/eval-coverage-e2e-emulator.mjs` (46), `node --experimental-strip-types scripts/eval-cc-casos-reales-emulator.mjs` (24), `npm run eval:plan-key-tz`, `npm run eval:turnos-close-reason-rules`. Script de datos `npm run fix:p1b-demo-licencias` (dryRun; `--apply` solo con OK de Mauro).
- [x] **P3 — Una representación por hueco:** ausencia = titular AA (`onGuardAbsenceDetected` ya no crea `VACANTE_POR_AUSENCIA`); falta de plan = `sla_huecos_sin_plan` id `gap_*` (sin copia a `turnos`); CC/map no escriben `SLA_VIRTUAL` aleatorio; retiro = titular recortado (cascada sobre el mismo id). Lectores (`isVacantShift` / `isProformaVacancyShift`) ignoran hermanos. Limpieza: `node scripts/dedupe-vacantes-hueco.mjs` (dryRun; `--apply --allow-prod` solo con OK de Mauro).

**Análisis — snapshot en memoria:** `useAnalisisSnapshot` + `lib/analisis/*`. Catálogo (SLA, empleados, geo, `tipos_novedad`) una vez por empresa; hechos (`turnos` + `ausencias`) = **hot** = mes en curso + **2** meses cerrados (`analisisWorkingWindow` / `dataRetention`). Cambiar día/semana/mes dentro de esa ventana = 0 queries (slice en memoria). Fuera de la ventana (abril, año, etc.) se amplía con merge. Analítica reutiliza el mismo store. Header = **universo real** (clientes, objetivos, puestos/`quantity`, slots SLA por banda, pico simultáneo, plantel) — sin selectores 24/25 ni 8/12. **192 = jornada de referencia** (universo/viabilidad); **200 = techo de liquidación** (`analisisBolsa.ts`). Bolsa realista = plantilla ACTIVE × 200 × (1 − índice ausencia 3 meses cerrados previos); si no hay historial 3m → **sin índice** (se muestra el techo, no se finge capacidad). Solapas: **Operativa** (Informe / Demanda / Cobertura / Capacidad y bandas), **Humana** (Guardias + ART.12; sliders ausentismo = what-if), **Financiera** (hs-hombre: SLA vs consumo plan/real + novedades + FT; **gasto** también suma francos F/FF, RET no activado 8 hs y REF/ESC — horas asignadas no usadas en cobertura; si el RET se usó el mismo día no se duplica; pirámide objetivo → cliente → empresa; **solo horas, sin precios**; novedades V/E/L/A/AA/PG/SUS = jornada del turno (8 o 12 hs), nunca 24 hs de calendario; Financiera desglosa SUS (no va a Otr); licencias sin `objectiveId` se atribuyen al último puesto de malla o quedan en `SIN_OBJETIVO`), **Herramientas** (Viabilidad / Analítica / Proyección). Informe: vendido / plan / **hs liquidadas** (motor Liquidación) / bolsa + KPIs de V (pendiente, dosis/mes, soporte sin extras); novedades, conclusiones; períodos día/semana/mes/trimestre/semestre/año; export Excel. Demanda: SLA vs plan vs resultante (plan + ext/adel + ops). **Cobertura** usa la misma fuente que Demanda (`buildDemandaByObjective` / plan+vacante); el drill código/guardia viene de la malla. **Capacidad y bandas** también pinta plan/vacante desde Demanda. Deep-link a Planificación: `/admin/planificacion/?objectiveId=&clientId=&year=&month=` (mes 1–12). Selector de período se bloquea hasta terminar la carga. Quien cubre suma el turno (M=8); FT/novedades no inflan cobertura — el recargo FT es costo/liquidación. Ausentismo real COSP (`shiftId` / `isAbsent` / `AUTO_T30`). **Carga:** primero el extracto mensual CRM (`hours_balances`, 1 doc por objetivo/mes — mismo que el dashboard: cambio de mes instantáneo). Si hay extracto, Informe/Demanda/Financiera pintan a nivel objetivo **sin esperar la malla**; banner «actualizando malla» hasta que llegan guardias, F/RET/REF y desglose fino. Ausencias RRHH van con el catálogo. Malla por mes calendario (misma query que Planificación); overlay = ventana hot. Al tener malla se reescribe el extracto. Recargar en el header. **KPIs cruzados (Dashboard / CRM / Análisis):** SLA = contrato vigente (`pickVigenteSlasForPeriod` + `slaHoursForServiceInRange`); plan = malla (`isPlanificadorPlannedHoursShift` + `calcPlanificadorShiftHours`); **hs liquidadas / reales** = mismo motor que Reportes → Liquidación (`sumPlantelLiquidationHours` / `calculateLiquidationHoursStats`: reloj clampeado, FT, RET/REF/ESC, ext/adel, TURA/RFZ) — el período puede ser calendario o ciclo CCT; si nadie liquidó queda 0, no se infiere del plan. Financiera: V/L/E/ART/PG = **hs muertas pagadas** (no son liquidadas del puesto). Informe también muestra **dosis óptima de vacaciones** del plantel (`analisisVacacionesCapacidad`: derecho CCT por antigüedad, pendiente YTD, holgura bajo techo 200, gap de extras forzadas). CRM pisa el SLA del extracto `hours_balances` con el contrato vivo. Smoke: `npm run eval:analisis-queries` (desde `apps/web2`).

### Asistente virtual (globo en la app)

- UI: `AssistantFloatingBubble` en `_app` (sesión **sólo en memoria**; botón papelera limpia el hilo). El **FAB es arrastrable**; la posición se guarda en `sessionStorage` hasta cerrar pestaña/navegador.
- Backend: callable Firebase **`chatPlatformAssistant`** (`apps/functions/src/index.ts` + `assistant/*`) invoca **Gemini** con API key en **servidor**. Con permiso READ y `empresaId` en sesión, herramientas **sólo lectura** Firestore (**`listado_empleados_empresa`** nombres/id de legajos; búsqueda por fragmento con **`buscar_empleados_por_nombre`**; **`consultar_turnos_empleado`** por rango AR; **`resumen_horas_empleado_periodo`** agregados de horas planificadas de cobertura y reales fichadas por legajo y rango; **`resumen_presencias_objetivos_dia`** agregados de presencia/ausencia por día; **`listado_turnos_operativos_dia`** lista de turnos visibles; **`contar_servicios_sla_vigentes_empresa`** cuántos SLA están activos y vigentes en la fecha para clientes de la empresa; **`contar_empleados_plantilla_empresa`** legajos activos/inactivos por `empresaId`). En producción: **`timeoutSeconds: 180`**, **`memory: 512MB`**, secreto **`GEMINI_API_KEY`**. El cliente envía **`clientToday`** (YYYY-MM-DD) y **timeout ~210 s** en el `httpsCallable`. Portal **empleado**: sólo turnos propios.
- **IA ajuste fino de planificación:** el front llama la callable **`optimizePlanningGemini`** (`planningGeminiServer.ts` + export en `index.ts`); usa el mismo secreto **`GEMINI_API_KEY`**. No hay `NEXT_PUBLIC_GEMINI_*` en el bundle. Deploy selectivo: `firebase deploy --only functions:optimizePlanningGemini` si el deploy completo de functions timeouta.
- **Agente planificación automática (pipeline):** motor determinístico **`autoScheduleEngineV2`** (viabilidad → generación) en `apps/web2/src/lib/planificacion/`; verificación **`coverageVerification`**; ajuste fino **`optimizePlanningGemini`** (no regenera el mes desde cero). Contrato/orquestación: `apps/functions/src/assistant/planningAgent/planningAgentTypes.ts`. UI: wizard **Automatizar** en `planificacion/index.tsx` **pausado** (`PLANNING_AUTOMATE_ENABLED = false`: sin botón ni indicadores; el código queda aislado, no borrado). Motores en Auto Lab (`/admin/planificacion/auto-lab`, permiso `auto_lab`). Skill Cursor para desarrollo: **`.cursor/skills/cosp-planificacion-agent/`** (invocar `@cosp-planificacion-agent`). Smoke: `npm run eval:planning-agent`.
- **VPLAN (cerebro experimental, paralelo):** documentación completa en **`docs/VPLAN.md`**. Código aislado en `apps/functions/src/vplan/` (callable **`vplanRun`**, pipeline fases 0–10). **No modifica** wizard Automatizar ni motores V2/V4. **Solo emulador** en fase prueba (handler rechaza prod hasta sign-off). **Sin deploy** hasta checklist §10 de `docs/VPLAN.md`. Smoke: `npm run eval:vplan`; E2E: `npm run test:vplan-emulator`.
- **App nativa portal guardia:** seguimiento en **`docs/MOBILE-GUARDIA-IMPLEMENTACION.md`**. Código: `apps/mobile-guardia/` + `packages/portal-core`. **Portal web del vigilador:** SPA Expo en **`https://comtroldata.web.app/app`** (`build:web` → `dist-web`). Hosting `/app` + redirects `/empleado` = **Plataforma** (`sync-guard-web-hosting` / `EmpleadoAppRedirect`). Sin OTA/EAS en web. iPhone = PWA/Safari en `/app`.
- **Producción (hosting + app real):**
  1. Crear el secreto (una vez): en la raíz del repo ejecutá `firebase functions:secrets:set GEMINI_API_KEY` y pegá la API key cuando pida valor (queda en Google Secret Manager).
  2. Desplegar: `firebase deploy --only functions`. La función `chatPlatformAssistant` ya declara `secrets: ['GEMINI_API_KEY']` y Firebase inyecta `process.env.GEMINI_API_KEY` en runtime.
  3. Si rotás la key: volvé a `secrets:set` con versión nueva y redeploy de functions.
  4. Si `firebase deploy --only functions` falla por timeout al analizar el código, en PowerShell ejecutá antes: `$env:FUNCTIONS_DISCOVERY_TIMEOUT='120'` (o `60`; el default **10 s** suele bastar hasta que el `index.ts` cargue demasiadas dependencias). Usá también deploy por nombre: `firebase deploy --only functions:chatPlatformAssistant`, etc.
  5. Alternativa manual: Cloud Console → Secret Manager / variables de la función — menos alineado con el manifest de Firebase.
- Front: `getFunctions(app, 'us-central1')` en `firebase.ts` debe coincidir con la región de la callable desplegada.
- **Laboratorio local (emulador):** el asistente usa la callable **sin** `runWith(secrets)` (en emulador las secrets de prod no vienen cargadas).
  - Poner **`GEMINI_API_KEY=...`** en **`apps/functions/.env`** (o `.env.local` en esa carpeta) y **reiniciar** solo el proceso del emulador de Functions (`npm run emulators`, etc.). `bootstrap-env.ts` fusiona `.env` + `.env.local` cuando `FUNCTIONS_EMULATOR=true`.
  - También válido: PowerShell `$env:GEMINI_API_KEY='...'` antes de arrancar el emulador.
  - `GEMINI_API_KEY` — obligatoria para que responda.
  - `GEMINI_MODEL` — opcional (default `gemini-2.5-flash`; `gemini-1.5-flash` suele dar 404 en proyectos/API keys nuevas).
  - **Usuario no reconocido por el asistente** (`Tu cuenta no está asociada…`): el backend resuelve el perfil con `system_users/{uidAuth}`, `client_users` o `empleados.uid`. En emulador, si falta `system_users` pero el login tiene **custom claim `role: SUPERADMIN`** (como deja `seed-admin.js`), hay **respaldo por Auth** sólo con `FUNCTIONS_EMULATOR=true`. Si aun así falla: levantá **Firestore + Auth + Functions** juntos (`npm run emulators`), ejecutá **`npm run seed`** (o `node scripts/seed-admin.js`) y **cerrá sesión y volvé a entrar** si recreaste el usuario de Auth (cambia el UID).
- **Dataset entrenamiento/evaluación (pares Q + guía respuesta):** `apps/functions/src/assistant/assistantTrainingPairs.ts` (`ASSISTANT_TRAINING_PAIRS`, ~135 ítems). No se inyecta solo en el prompt; sirve para tests, few-shot manual o export externo.
- **Guías por módulo (UX):** si el cliente manda `moduleKey` (ej. `PLANNING`), el servidor inyecta texto operativo en `cospKnowledge` + `operationalGuideForModuleKey`, y el prompt (`ASSISTANT_RESPONSE_STYLE` en `runPlatformAssistant`) favorece respuestas con pasos numerados, **negritas** para controles UI y honestidad sobre límites del chat; el globo renderiza `**texto**` en negrita.
- **CSR / certificado AFIP (primera vez):** `npm run afip:csr` o `scripts/generate-afip-csr.ps1` — genera `privada.key` (2048 bits) y CSR PKCS#10 con `serialNumber = CUIT {11 dígitos}` (manual [AFIP WSASS](https://www.afip.gob.ar/ws/WSASS/html/generarcsr.html)). El **Alias** en AFIP debe coincidir con el **CN** del CSR. Salida en `scripts/afip-csr-{cuit}/` (gitignored).
- **CRM — autocompletar cliente por CUIT (AFIP):** callable **`lookupClientByCuit`** (`apps/functions/src/afip/*`, WSAA directo + padrón Constancia de Inscripción). UI: **AFIP** en nuevo cliente; ficha INFO **Actualizar desde AFIP** / **AFIP y guardar**. El cliente envía **`empresaId`** (empresa activa del panel). Credenciales **por empresa**: colección `empresa_afip_credentials/{empresaId}` (solo Admin SDK; reglas `allow read, write: if false`); metadatos en `empresas` (`afipConfigured`, `afipCertCuit`, `afipProduction`, `afipCertNotAfter`). Carga: **Configuración → Empresas** → sección **Certificado AFIP** (SuperAdmin/admin); callables **`saveEmpresaAfipCredentials`**, **`getEmpresaAfipConfig`**. Mismo cert puede repetirse en varias empresas del panel. **Fallback** si no hay doc por empresa: secrets globales **`AFIP_CUIT`**, **`AFIP_CERT`**, **`AFIP_PRIVATE_KEY`**, **`AFIP_PRODUCTION`**. CSR: `npm run afip:csr`; secrets globales: **`npm run afip:secrets`** (prod) o **`npm run afip:secrets:homo`**. WSASS: **`ws_sr_constancia_inscripcion`**.
---

## 6. Códigos de turno (CCT 422/05)

### Turnos de trabajo

| Código | Nombre | Horas | Computa horas | Notas |
|--------|--------|-------|---------------|-------|
| `M` | Mañana | 8h | ✅ | Banda fija diurna |
| `T` | Tarde | 8h | ✅ | Banda fija vespertina |
| `N` | Noche | 8h | ✅ | Banda fija nocturna |
| `D12` | Diurno 12h | 12h | ✅ | Extensión/rotativo diurno |
| `N12` | Nocturno 12h | 12h | ✅ | Extensión/rotativo nocturno |
| `RET` | Retención pasiva | 0h billables | — | Empleado en stand-by; disponible para cubrir. No genera horas facturables. Referencia interna: 8h stand-by. |
| `ESC` | Escuela | 8h | ✅ | Sobreturno de capacitación: el vigilador va al puesto a aprender. Se usa como fuente de cobertura (prioridad 3). |
| `REF` | Refuerzo | 8h | ✅ | Turno de refuerzo puntual, cobertura extra programada. |

### Francos / Descansos

| Código | Nombre | Horas | Costo extra | Notas |
|--------|--------|-------|-------------|-------|
| `F` | Franco | 0h | ❌ | Descanso planificado CCT 6+2 |
| `FF` | Franco feriado | 0h | ❌ | Descanso en día feriado |
| `FP` | Franco permuta | 0h | ❌ | Descanso por permuta de turno |
| `FT` | Franco trabajado | 8h | ✅ extra | Empleado de franco que cubre ausencia. Genera costo adicional. Requiere validación del empleado. Última opción de cobertura. |

### Ausencias / Licencias

| Código | Nombre | Horas | Computa horas | Notas |
|--------|--------|-------|---------------|-------|
| `V` | Vacaciones | — | ✅ (paga) | Período vacacional planificado |
| `L` | Licencia | — | ✅ (paga) | Licencia general (art. CCT) |
| `E` | Enfermedad | — | ✅ (paga) | Baja médica con certificado |
| `A` | Autorizada | — | ✅ (paga) | Ausencia autorizada / ART |
| `PG` | Permiso gremial | — | ✅ (paga) | Actividad sindical |
| `AA` | Ausencia injustificada | 0h | ❌ | Sin justificación ni certificado |

### Prioridad de cobertura ante ausencia

Cuando un empleado falta, el sistema busca reemplazante en este orden (menor a mayor costo):

```
1. Sin turno    — empleado disponible ese día (no tiene turno asignado)
2. RET          — vigilador en retención pasiva (stand-by)
3. ESC          — empleado en turno escuela (puede redirigirse al puesto)
4. Ext. 12hs    — extender turno de 8hs → 12hs (D12/N12) de alguien ya en servicio
                  ⚠ Requiere validación — no siempre acepta
5. FT           — llamar a empleado de franco a trabajar
                  ⚠ Requiere validación + genera costo extra (horas extras CCT)
```

Todos los candidatos deben ser del mismo objetivo. La banda a cubrir es la del empleado ausente (M cubre M, N cubre N, etc.).

### Relevo de franja

`isReliefEligibleShift` (`packages/ops-core/src/reliefEligibility.ts`, espejo `apps/functions/src/common/reliefEligibility.ts`): un turno **ESC**, **REF** o **RET** planificado no releva al saliente de la banda vendida. Sí relevan los turnos de puesto (M/T/N/D12/N12) y la cobertura `origin: OPERATIONS_COVERAGE` que no es registro EXT/ADV (`coverageHoursOnSource`). Francos, licencias y borradores tampoco relevan. El Centro de Comando muestra el código junto al nombre (`ShiftCodeBadge`).

La serie la resuelve `relieverFor` / `outgoingFor` (`packages/ops-core/src/shiftSeries.ts`, misma copia en `apps/functions/src/common/shiftSeries.ts`). Además del puesto y del horario (fin del saliente = inicio del entrante ±30 min), el entrante tiene que ser el código siguiente: **M→T→N→M**, y con sufijo **M2→T2→N2→M2** (M1, M3, … igual). **D12→N12→D12** (N12 es el nocturno de 12 h, no la serie 12). Si hay varios en la ventana, gana el de la serie. Sin código, código custom o FT se usa solo el horario; un `ops_cov` de cobertura del titular hereda el código del titular cuando el propio no es serie. Quien arranca a la misma hora no es el saliente. Así, en el Puesto 1, Baez **M** (10:45–12:00) lo releva Guerrero **T** y no Farias **M3**; si el T no llegó, Baez queda retenido. Fantini **M2** lo releva Fontana **T2**.

**Cantidad distinta por franja** (SLA `allowedShiftTypes[].quantity`, si falta vale la del puesto): al cambiar de franja se retienen como máximo tantos salientes como lugares tiene la franja siguiente (`nextBandSlotsFromSlaDoc` en `positionHasContinuity.ts` + `keepsNextBandSlot` en `shiftSeries.ts`). Se queda el que lleva **menos tiempo** en el puesto (fichada más reciente); los demás cierran a su fin planificado con `SIN_LUGAR_FRANJA`, sin retención. Ej. M×2 → T×1: el T releva al M más nuevo; si el T falta, ese M queda retenido y el otro se va a las 15:00. Franja que crece (N×1 → M×2): el primer M que ficha releva al N (a su hora planificada), el segundo no releva a nadie; si faltan los dos, el N queda retenido una vez y el otro lugar es vacante; si falta uno, el N se va con el que llegó y el lugar faltante es vacante sin retención. Todo junto con la serie y el tope 12:59. E2E 75–78.

La fichada tarde no escribe `lateArrivalAt`. Ese campo lo deja `notificarLlegadaTarde` o la convocatoria `LLEGADA_TARDE`. Sin aviso, el monitor marca TARDE SIN AVISO.

**Aviso de llegada (P5b):** `scheduledArrivalNotices` cada **1 min** (no el cron de 5). A **T−5**: «Tu turno empieza a las HH:MM en {cliente · objetivo · puesto}, ¿estás llegando?» (`AVISO_TURNO_PROXIMO`, flag `preStartArrivalNoticeAt`). A **T** (gracia 70 s): ¿Venís? (`LLEGADA_TARDE`, flag `earlyRetentionAlertAt`). Idempotente. Solo CC ON, no Demo, y objetivo en operación publicado (mismo universo P1d). Push de turno: FCM `priority: high`, Android `channelId: alertas_turno` (lo crea la app), APNs `interruption-level: time-sensitive`.

**Fichada:** `checkInAt` = hora real (auditoría). `realStartTime` para pago: hasta **T+5** inicio planificado; desde **T+6** la fichada y `lateMinutes`. CC y tarjeta del guardia: «Ingresó HH:MM (N min tarde)» con `checkInAt`.

---

## 7. Entorno y configuración

### Variables de entorno (`.env.local`)

```env
NEXT_PUBLIC_USE_EMULATOR=true      # true = emuladores locales, false = producción
NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.0.8  # solo si front y emuladores están en PCs distintas
NEXT_PUBLIC_FIREBASE_API_KEY=...   # credenciales reales del proyecto comtroldata
NEXT_PUBLIC_FIREBASE_PROJECT_ID=comtroldata
```

> **NUNCA commitear `.env.local`** — está en `.gitignore`.

### Emuladores Firebase (puertos)

| Servicio | Puerto |
|----------|--------|
| Firestore | 8080 |
| Auth | 9099 |
| Functions | 5001 |
| UI | 4000 |
| Emulator Hub | 4400 |

**UI `http://localhost:4000` (o `:4000` desde otra PC):** abrí también el puerto **4400** en el firewall. **`npm run emulators:light`** = solo Auth + Firestore + UI (sin **:5001** → el **asistente COSP no funciona**). Lab y asistente: **`npm run emulators`** (compila Functions, requiere **`GEMINI_API_KEY`** en `apps/functions/.env`). Si Functions falla en Windows (`""node"" no se reconoce`), el fix de PATH está en `run-emulators.js`; como último recurso podés usar `emulators:light` sin asistente.

**Windows — lab tras reinicio** (emuladores + seed + Next): no suben solos hasta registrar la tarea **COSP Lab** (PowerShell **como administrador** desde la raíz del repo):

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts\register-cosp-lab-scheduled-task.ps1
```

Modo **sin iniciar sesión** (PC encendida, usuario no logueado): `...\register-cosp-lab-scheduled-task.ps1 -AtStartupAsSystem` (SYSTEM, demora 3 min; Node en `Program Files\nodejs`, JDK 21).

Diagnóstico: `npm run diagnose:lab`. Trazas siempre en **`%ProgramData%\COSP\trace.log`** (útil si falla antes de escribir en `logs\`). Quitar tarea: `npm run unregister:lab-task` (admin). Instalación guiada: **`INSTALAR-TAREA-COSP-LAB.cmd`** (clic derecho → ejecutar como administrador; por defecto **SYSTEM**; con argumento **`logon`** registra al iniciar sesión del usuario).

### Primer arranque / emulador vacío

Con emuladores activos, admin + guardia de prueba:

```bash
npm run seed
```

(Mismo comando que `npm run seed:lab`.) Equivale a `node scripts/seed-admin.js` + `node scripts/seed-empleado.js` (`admin@bacarsa.com.ar` / `admin1234`, `guardia@bacarsa.com.ar` / `guardia1234`). `seed-lab.js` espera a que **8080 y 9099** acepten conexión (evita sembrar antes de que Auth esté listo). Solo admin: `node scripts/seed-admin.js`.

**Front en :3001:** el dev server es `next dev -p 3001` (`npm run dev` desde la raíz → `apps/web2`). Pará el proceso, borrá `apps/web2/.next`, volvé a `npm run dev` y recarga forzada (Ctrl+F5). Puerto configurable en `apps/web2/package.json` (`next dev -p`) o `COSP_DEV_PORT`.

---

## 8. PCs de trabajo

| PC | Ruta local | IP | Rol |
|----|------------|----|-----|
| **Notebook** | `C:\APP\cronoapp` | — | Desarrollo principal + deploys a producción |
| **N8N** | `D:\APP\cronoapp` | `192.168.0.8` | Servidor de testing compartido para el equipo |

Desde Notebook, N8N es accesible como `B:\cronoapp` (unidad de red).

---

## 9. Flujo de trabajo

```
DESARROLLO (Notebook)
  1. Editás código en C:\APP\cronoapp
  2. Probás en http://localhost:3001 (emuladores locales)
  3. git push origin main

TESTING (N8N — sincronizar desde Notebook)
  4. git -C /b/cronoapp fetch origin && git -C /b/cronoapp reset --hard origin/main
  5. En N8N: `npm install` y `npm run emulators`
  6. En N8N: `npm run dev` (Next en 0.0.0.0:3001)
  7. Testers acceden a http://192.168.0.8:3001

PRODUCCIÓN (Notebook)
  8. Cambiar .env.local → NEXT_PUBLIC_USE_EMULATOR=false
  9. cd apps/web2 && npm run build
  10. firebase deploy --only hosting
  11. Restaurar .env.local → NEXT_PUBLIC_USE_EMULATOR=true
```

### Reglas de trabajo

- **Commitear inmediatamente** después de cada cambio funcional. No acumular.
- **No hacer deploy automático** — solo cuando el usuario lo pida explícitamente.
- **No modificar N8N directamente** — todo cambio va por Notebook → git → N8N.
- **Responder siempre en español.**
- **No agregar comentarios obvios** al código — solo cuando el WHY es no obvio.
- **No crear archivos `.md` de documentación** salvo que se pida explícitamente.

---

## 10. Repo remoto

```
GitHub: https://github.com/adminbacarsa/BSP.git
Branch principal: main
```

Para sincronizar N8N desde Notebook:
```bash
git -C /b/cronoapp fetch origin && git -C /b/cronoapp reset --hard origin/main
```

---

## 11. Deploy a producción

Firebase Hosting → `https://comtroldata.web.app`
Firebase project: `comtroldata`

**Deploy no debe tumbar el lab.** Si emuladores (`:8080`/`:9099`) o `npm run dev` (`:3001`) están activos, `npm run deploy` usa automáticamente un **git worktree** en `../cronoapp-deploy`: build y `firebase deploy` corren ahí; esta carpeta (`cronoapp`) no ejecuta `next build`.

Artefactos de producción van a **`build/hosting`** y **`build/.next-prod`** (no `apps/web2/out` ni `.next` del dev server). `.env.local` del lab se copia al worktree solo para credenciales de build (`USE_EMULATOR=false` en el proceso de build).

```bash
# Recomendado con lab corriendo (worktree automático)
npm run deploy              # solo hosting
npm run deploy:functions    # hosting + functions
npm run deploy:all          # hosting + functions + firestore:rules

# Forzar build en esta carpeta (lab apagado o explícito)
npm run deploy:here

# Siempre worktree aunque el lab esté apagado
npm run deploy:worktree
```

- **PowerShell se come el `--`**: `npm run deploy:functions -- --rules` pierde el flag y NO publica reglas. Usar los scripts con nombre (`deploy:all`, etc.).
- Las reglas (`firestore.rules`) e índices (`firestore.indexes.json`) solo se publican con `deploy:all` o `firebase deploy --only firestore:rules` / `firestore:indexes`. **Pendiente de publicar:** la regla P1b que bloquea desde cliente los motivos de cierre retirados en `turnos`.
- **Panel desactualizado:** el build escribe `apps/web2/public/version.json` (gitignored) con el hash de `NEXT_PUBLIC_BUILD_HASH`. Tras un deploy de hosting, las pestañas abiertas detectan la versión nueva, **pausan sus escrituras automáticas** y recargan a los 5 s (o al cerrar el protocolo/modal/formulario que esté abierto). La recarga no cierra `sesiones_operador`: el piloto sigue siendo piloto.
- El deploy publica functions y hosting en comandos separados y al final verifica que `/app` quedó publicado (bundle y assets). Si una function falla, el deploy termina con error.
- Antes de deployar, revisar qué commits trae `main` (`git log origin/main..` y los de otros agentes): el deploy publica HEAD completo.
- App Android: después del deploy de hosting, OTA a `production` (`npm run update:production` en `apps/mobile-guardia`) para que app y web `/app` queden iguales.

Variable opcional: `COSP_DEPLOY_DIR` (default `../cronoapp-deploy`).

---

## 12. Qué NO tocar sin entender bien

- `useOperacionesMonitor.ts` — lógica central de operaciones en tiempo real. Muy compleja.
- `firestore.rules` — reglas de seguridad. Cambios incorrectos pueden bloquear usuarios.
- `planificacion_estados` — controla qué planificación está publicada. No borrar documentos.
- **Baja de clientes CRM** (`crm/index.tsx` + `deleteClientForEmpresa`) — desactivar es `status: INACTIVE` + `inactivatedAt` / `inactivatedBy`. El borrado físico es solo SuperAdmin (`firestore.rules`) y solo si el cliente no tiene turnos, `servicios_sla` ni `ordenes_compra`; si tiene, se bloquea. No hay cascade sobre turnos ni contratos.
