# EVENTUALES — Diseño Fase A (análisis, sin código)

> **Módulo:** RRHH-EVENTUALES · Gestión de empleados eventuales de seguridad (Córdoba, CCT 422/05 SUVICO, LCT arts. 99/100, Ley 24.013, Ley provincial 9236).
> **Rama:** `cursor/eventuales-fase-a` (desde `origin/main`). Solo diseño — sin código, sin escrituras en prod.
> **Coordina:** Claude Code · **Autor:** agente RRHH-EVENTUALES · **Fecha:** 29/09/2026.
> **Ajuste Mauro (29/09):** el eventual es un vigilador más. Misma malla, mismo Centro de Control, mismo Banco de Horas, mismo Análisis, mismo motor de liquidación (`hours-core` / Reportes / `payrollApi`), y sirve tanto en servicios normales como en eventos (`coverageType: eventos` / TURA). **Única diferencia operativa:** solo puede tener turnos dentro de un contrato eventual vigente, más el alta/baja ARCA de ese contrato. No hay motor, bolsa ni rama de liquidación paralela.

---

## 1. ARCA — PRIORIDAD 1: ¿existe web service de Simplificación Registral?

### 1.1 Conclusión (verificada contra fuentes oficiales)

**NO existe hoy un web service público de ARCA para altas/bajas de Simplificación Registral** (registración de relaciones laborales). El certificado WSAA por empresa que ya tenemos **no sirve** para este trámite porque no hay ningún ID de servicio de negocio (WSN) que autorizar.

Evidencia:

- **Catálogo oficial de Web Services SOAP de ARCA** ([afip.gob.ar/ws/documentacion/catalogo.asp](https://www.afip.gob.ar/ws/documentacion/catalogo.asp), consultado 29/09/2026): lista todos los WSN disponibles (padrón `ws_sr_constancia_inscripcion`, `ws_sr_padron_a4/a10/a13/a100`, WSBFE, WSCPE, WSCDC, `TRABAJO_F931`, agro, aduana, etc.). **No figura ningún servicio de Simplificación Registral / registración laboral.** El único WS del área Seguridad Social es `TRABAJO_F931`, que es **solo consulta** de DDJJ F.931 presentadas (remuneraciones declaradas), no alta/baja de relaciones.
- **Página oficial del servicio** ([afip.gob.ar/simplificacionregistral/](https://www.afip.gob.ar/simplificacionregistral/) y [arca.gob.ar/simplificacionregistral/caracterisiticas-y-utilizacion/procedimiento.asp](https://www.arca.gob.ar/simplificacionregistral/caracterisiticas-y-utilizacion/procedimiento.asp)): las únicas vías son (a) el servicio interactivo **«Simplificación Registral - Empleadores»** con Clave Fiscal nivel 2+, (b) la app móvil **«Alta Ya»** (RG 5448/2023, solo altas), (c) F.885/A en dependencia. No se menciona ningún WS ni API.
- **Guías paso a paso oficiales**: [carga masiva id=143](https://serviciosweb.afip.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=143), [alta masiva id=361](https://serviciosweb.afip.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=361), [modificación masiva id=498](https://serviciosweb.afip.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=498). Todas describen **carga de archivo dentro del servicio interactivo**, nunca un endpoint.

Por lo tanto: no hay URL de homologación/producción, ni métodos, ni trámite de adhesión que investigar — **el servicio no existe** como WS. (Si ARCA lo publica a futuro, aparecerá en el catálogo de WSN; conviene re-chequear cada tanto.)

### 1.2 Mejor alternativa automatizable: archivo de **Carga Masiva**

La vía oficial semi-automatizable es generar desde COSP el **archivo de importación** y subirlo en «Simplificación Registral - Empleadores» → menú **Relaciones Laborales → Carga masiva** (Clave Fiscal del empleador, no certificado). Dos modos (guía id=361): *alta masiva hasta 10 registros* (formulario) y *alta masiva sin límite* (archivo).

- **Formato:** archivo de texto plano. El **diseño de registro exacto (posiciones del TXT) sigue pendiente**: no está publicado; Mauro lo baja del servicio con Clave Fiscal y se versiona en `docs/arca/` (Fase B). Hasta entonces el generador no se escribe.
- **Alta inicial RG 5508 — solo 7 campos.** El resto (puesto, CCT 422/05, categoría, remuneración, ART, jornada) se completa en Simplificación Registral **antes de la primera liquidación**, con datos que COSP ya tendrá en el legajo y el contrato. Mapeo del alta:

| Campo RG 5508 | Origen COSP | Hoy | Quién lo completa |
|---------------|-------------|-----|-------------------|
| CUIL | `empleados.cuil` | Existe | Ya está en el legajo |
| Domicilio de explotación de la actividad | `empresas.arcaDomicilioExplotacion` (el domicilio **declarado en ARCA**, no el del objetivo) | **Falta** | Una vez por empresa, Configuración → Empresas |
| Fecha de inicio de la relación | `contratos_eventuales.fechaInicio` | Colección nueva | RRHH al crear el contrato |
| Modalidad de contratación | código de la tabla ARCA, constante eventual (`empresas.arcaModalidadEventual`) | **Falta el código** (sale con el diseño de registro) | Una vez, cuando Mauro baje la tabla |
| Marca trabajador agropecuario | constante `false` | No aplica a vigilancia | Nadie: el generador la manda en no |
| Obra social / agente del seguro de salud | código RNOS en el legajo (`empleados.obraSocialRnos`); default de empresa si todos van a SUVICO | **Falta** (no hay campo RNOS) | RRHH en el legajo, o default de empresa |
| Fecha de finalización | `contratos_eventuales.fechaFin` | Solo si `modalidad === PLAZO_FIJO` | RRHH en el contrato. En EVENTUAL el alta inicial **no** la envía |

- **Flujo propuesto:** botón «Generar archivo ARCA» agrupa contratos `FIRMADO` (altas, 7 campos) o `FINALIZADO` (bajas: CUIL + fecha + motivo). El TXT se marca `ALTA_ARCA` / `BAJA_ARCA` **recién cuando el operador confirma que ARCA aceptó el archivo** (nro. de transacción manual). Antes de la primera liquidación del ciclo, RRHH completa en el legajo/contrato los datos que la RG deja para después y los informa en el servicio (no van en este TXT inicial).
- **Certificado AFIP — alcance (dato Mauro):** hoy existe **solo el certificado de BACAR S.A.** Sirve para la empresa `bacarsa` y para `pruebas_sa` (pruebas). **No** se usa en ninguna otra empresa del panel: cada una necesita su propio certificado en `empresa_afip_credentials/{empresaId}`, o delegar el web service a otro CUIT en ARCA. El fallback global de `loadAfipConfigForEmpresa` (`empresaAfipStore.ts:127`, secrets si no hay doc por empresa) **no** habilita `TRABAJO_F931` para el resto.
- **Control `TRABAJO_F931`:** solo en empresas con certificado propio (hoy: `bacarsa` y `pruebas_sa` con el cert de Bacar, y el servicio autorizado en WSASS). Consulta, no alta. Sin certificado, el alta/baja se confirma a mano (el nro. de transacción del flujo de arriba) y no hay verificación automática.

---

## 2. Qué existe hoy reutilizable (archivo:línea)

### 2.1 Legajos (`empleados`)

- Interface front `Employee`: `apps/web2/src/services/employeeService.ts:4-23` (uid, dni, cuil, fileNumber, status, startDate, cycleStartDay, laborAgreement, portalInvite). CRUD + soft delete `INACTIVE`: `employeeService.ts:25-89`.
- Defaults/payload legajo: `apps/web2/src/lib/employees/employeeLegajoDefaults.ts:1-28` (`initialLegajoForm` con `contractType`, `maxHours: 200`), `:37-63` (`mapFirestoreToLegajoForm`), `:65-97` (`buildEmployeeSavePayload`).
- Backend Nest `IEmployee`: `apps/functions/src/common/interfaces/employee.interface.ts:11-47` — **ya existe `ContractType = 'FullTime' | 'PartTime' | 'Eventual'`**, pero el formulario vigente no lo expone (solo en `rrhh/index.tsx.bak:569`). Estados UI: `activo`/`inactivo` (`employeeLegajoDefaults.ts:30-34`); baja con `motivoBaja`/`fechaBaja`: `apps/web2/src/pages/admin/rrhh/index.tsx:1217-1222`.
- Formularios: RRHH inline `rrhh/index.tsx:403`, guardado `:1064-1121`, pestaña LABORAL `:2848-2893`; componente reutilizable `EmployeeLegajoForm`: `apps/web2/src/components/admin/employees/EmployeeLegajoForm.tsx:34-45` y `:208-264`, montado en `apps/web2/src/pages/admin/empleados/index.tsx:589-601`.

### 2.2 Credencial QR + verificación pública

- QR = URL `{origin}/credencial/?id={empDocId}`: `apps/mobile-guardia/src/lib/credencialVerification.ts:3-8`; render `apps/mobile-guardia/app/credencial.tsx:228-229`. Código rotativo anti-fraude 60 s (no viaja en el QR): `credencialVerification.ts:11-29`.
- Doc público `credenciales_publicas/{empDocId}` (create/merge): `apps/web2/src/components/empleado/CredencialDigital.tsx:172-189`.
- Página pública de verificación: `apps/web2/src/pages/credencial/index.tsx` (lee el doc en `:26-27`, UI «IDENTIDAD VERIFICADA» `:86-91`). Reglas: `firestore.rules:594-597` (`read: true`).

### 2.3 Eventos / coverageType `eventos` / TURA

- Puesto Eventos (extras, fuera de SLA): `apps/web2/src/lib/servicios/eventosPosition.ts:3-39`; `includeInSlaTotals: false` en `apps/web2/src/services/slaService.ts:56-57`; UI alta `apps/web2/src/pages/admin/servicios/index.tsx:4905-4914`.
- Colección `eventos` + estados: `apps/web2/src/services/eventoService.ts:19-74`, CRUD `:192-213`. Solicitudes/convocatorias: `apps/web2/src/services/solicitudEventoService.ts:15-101`; notif `apps/functions/src/notifications/onSolicitudEventoCreated.ts:15-74`.
- Turno EV (`code: 'EV'`, `origin: 'EVENTO'`): asignación `apps/web2/src/services/eventoAssignService.ts:128-212`; espejo portal `packages/portal-core/src/eventos/eventoPortal.ts:189-259`; aceptación del guardia `respondEventoConvocatoria`: `apps/functions/src/eventos/eventoPortalCallables.ts:87-165` (export `index.ts:1634`).
- Facturación TURA/EV: `apps/web2/src/lib/crm/executedBillableHoursByFranja.ts:22-33`; prefactura eventos `apps/web2/src/pages/admin/crm/index.tsx:2569-2631`; imputación a puesto Eventos `apps/web2/src/lib/refuerzo/refuerzoProforma.ts:9-14`.

### 2.4 Liquidación — mismo motor (el código `EV` no es la modalidad)

- Motor único `calculateLiquidationHoursStats`: `packages/hours-core/src/motors/liquidation/reportesLiquidation.ts:831-837` (impl. desde `:840`); bolsa 200 `:1067-1071`. Espejo API: `apps/functions/src/payroll-api/calc.ts:1-18`, persona `calcPersona.ts:1-32`. Banco de Horas y Análisis leen ese mismo resultado (`sumPlantelLiquidationHours` / libro persona).
- Un eventual con turnos de servicio (M/T/N/D12/N12, y también TURA/RFZ, que ya suman en `desgloseTura` `:1027`) **ya liquida hoy** como cualquier legajo. La modalidad no tiene rama propia.
- **El único hueco** es el código de turno `EV` (evento), excluido del cómputo **persona** para todos los guardias, no solo eventuales: early-return `reportesLiquidation.ts:891` y el espejo legacy `packages/hours-core/src/motors/legacy/reportesLiquidationF0.ts:792`. Esas horas hoy se facturan al cliente (prefactura eventos, §2.3) y no se le pagan al vigilador por este motor.
- **Cambio para que el evento liquide en el motor único** (sin segundo motor): sacar `'EV'` de esos dos early-return y acumular la duración real del turno (el evento tiene horario concreto, p.ej. 6 h) en el desglose que ya existe (`desgloseTura`, `:1027`), de modo que entre a bolsa 200, Banco de Horas, Análisis y `payrollApi` igual que un TURA. **No** sacar `EV` de `OBJECTIVE_NON_BILLABLE_CODES` (`:29`), ni de `publishedPlanHours.ts:12`, `positionCoverageUnits.ts:6` ni `deploymentRoles.ts:172,199`: ahí `EV` significa «no cubre ni vende SLA», y eso se mantiene. La prefactura de eventos al cliente no se toca.
- **Remuneración bruta fija del contrato:** es un dato del contrato (§3.2), no una fórmula. El pago sale del motor. Si el fijo pactado difiere de las horas liquidadas, la diferencia se carga como ajuste del snapshot que ya existe (`ajustes_liquidacion`), sobre el mismo `cycleId` 26→25. No hay bolsa ni tope distintos.

### 2.5 AFIP/WSAA por empresa

- Login WSAA **genérico y parametrizable por service id**: `loginWsaaDirect(cert, key, service, production, empresaId?)` en `apps/functions/src/afip/wsaaDirect.ts:95-100` (TRA `<service>` `:27-40`). Uso actual con `ws_sr_constancia_inscripcion`: `lookupTaxpayer.ts:8-32`.
- Credenciales por empresa `empresa_afip_credentials/{empresaId}`: `apps/functions/src/afip/empresaAfipStore.ts:6-18`; save `:41-87`; lectura runtime + fallback secrets `loadAfipConfigForEmpresa` `:108-128`; cache TA `:130-163`. Callables: `lookupClientByCuitHandler.ts:5-37`, `empresaAfipCredentialsHandler.ts:27-72` (exports `index.ts:3726-3731`). Reglas cerradas: `firestore.rules:424-427`.
- → `TRABAJO_F931` reutiliza `loginWsaaDirect`, pero **solo** si la empresa tiene certificado propio. El de Bacar cubre `bacarsa` y `pruebas_sa`; el resto confirma el alta a mano (§1.2). No hay servicio de altas/bajas.

### 2.6 Reglas e índices modelo

- Helpers tenant: `tenantAdminRead()` `firestore.rules:160-162`; `tenantAdminCreate/Update/Delete` `:164-176`; `empleadoDocOwnedByAuth` `:220-226`. Colecciones modelo: `empleados` `:289-296`, `ausencias` `:298-303`, `solicitudes_evento` `:865-874` (patrón lectura propia del guardia).
- Índices (`firestore.indexes.json`): turnos empresa+origin+startTime `:20-27`; ausencias employeeId+status+startDate `:71-78`; solicitudes_evento empresaId+empleadoId+servicioFecha `:490-496`.

### 2.7 Firma en app

- **No existe firma electrónica ni aceptación de términos persistida** (el bloque «FIRMAS» de RRHH es placeholder impreso: `rrhh/index.tsx:3435-3444`). Lo más cercano es el patrón callable de aceptación `respondEventoConvocatoria` (§2.3), que registra decisión + uid + timestamp server. La firma del contrato eventual se modela sobre ese patrón (§3.3).

---

## 3. Diseño de datos y pantallas

### 3.1 Legajo: campo `modalidad` + historial (misma nómina)

En `empleados` (sin colección paralela de personas):

```ts
modalidad: 'INDETERMINADO' | 'EVENTUAL' | 'PLAZO_FIJO';          // default INDETERMINADO
modalidadHistory: Array<{                                          // efectivización = nuevo item
  modalidad: Modalidad; desde: string; hasta?: string;             // ISO date
  motivo?: 'ALTA' | 'EFECTIVIZACION' | 'REINGRESO_EVENTUAL' | 'IMPORT_PLANILLA';
  contratoId?: string; setByUid: string; setAt: Timestamp;
}>;
eventualPrimerIngreso?: string;     // planilla «1º INGRESO»
eventualUltimaBaja?: string;        // planilla «BAJA EVENTUAL - última fecha»
fechaEfectivizacion?: string;       // planilla «FECHA EFECTIVIZACIÓN»
```

El estado de la planilla se **deriva**, no se guarda: ACTIVO = modalidad EVENTUAL + contrato vigente; EFECTIVIZADO = modalidad INDETERMINADO con history eventual previo; BAJA = EVENTUAL + `status: inactivo`; GOLONDRINA = EVENTUAL + ≥2 contratos no contiguos. UI: exponer `modalidad` en `EmployeeLegajoForm` (LABORAL) y sincronizar `contractType: 'Eventual'` que ya existe en `IEmployee` (§2.1).

### 3.2 Colección nueva `contratos_eventuales`

Un doc por evento/período. Id sugerido `ce_{employeeId}_{yyyyMMdd}_{n}`.

```ts
{
  empresaId, employeeId, cuil,                       // cuil desnormalizado p/ cruce entre empresas
  clientId?, objectiveId?, eventoId?,                // vínculo al evento/objetivo
  causa: string,                                     // texto art. 99 (exigencia extraordinaria)
  fechaInicio: string, fechaFin: string,             // ISO; fin obligatorio (eventual)
  horario: { inicio: 'HH:mm', fin: 'HH:mm' }, jornadaHoras: number,
  remuneracion: { tipo: 'BRUTA_FIJA' | 'POR_HORA', monto: number, pagoMesVencido: true },
  estado: 'BORRADOR' | 'FIRMADO' | 'ALTA_ARCA' | 'VIGENTE' | 'FINALIZADO' | 'BAJA_ARCA' | 'ANULADO',
  estadoHistory: Array<{ estado, at, byUid }>,
  documento: { storagePath, templateVersion, sha256 },          // PDF generado desde plantilla Bacar
  firma?: { signedAt, uid, deviceId, appVersion, verificationCode },  // ver 3.3
  arca?: { altaArchivoAt?, altaConfirmadaAt?, nroTransaccion?, bajaArchivoAt?, bajaConfirmadaAt? },
  status: 'ACTIVE' | 'INACTIVE', createdAt, createdBy, updatedAt
}
```

Plantilla: colección `contratos_templates/{empresaId}_{version}` con el texto Bacar (cláusulas: tareas seguridad y vigilancia, causa, jornada/horario, remuneración a mes vencido, puntualidad, fidelidad/reserva, obediencia, normas internas, domicilios, jurisdicción Córdoba) + placeholders `{{nombre}}, {{cuil}}, {{fechas}}, {{horario}}, {{remuneracion}}, {{causa}}, {{objetivo}}`.

**Reglas Firestore** (patrón §2.6): `read` = `tenantAdminRead() || empleadoDocOwnedByAuth(resource.data.employeeId)`; `create/update/delete` = `tenantAdmin*`. La **firma y los cambios de estado van solo por callable** (Admin SDK), como `respondEventoConvocatoria`; regla que bloquea escribir `firma`/`estado` desde cliente. `contratos_templates`: solo tenant admin.

**Índices:** `contratos_eventuales` (empresaId, employeeId, fechaInicio DESC) · (empresaId, estado, fechaInicio DESC) · (cuil, fechaInicio DESC) — este último **sin empresaId** para el cruce entre empresas (consulta collection-wide vía callable Admin SDK, no desde cliente).

**Única regla operativa — turno solo dentro de contrato vigente:** helper compartido `hasVigentContratoEventual(employeeId, date, hhmm)` (lib en `packages/` + espejo functions, patrón `simulableShift.ts`). Misma validación en los cuatro escritores: alta/edición de turno en Planificación, asignación desde el Centro de Control (cobertura y convocatorias), `eventoAssignService.ts:128-212` (eventos/TURA) y `applyCoverage`. Si `empleados.modalidad === 'EVENTUAL'` y no hay contrato FIRMADO/ALTA_ARCA/VIGENTE que contenga fecha y horario del turno → bloqueo con CTA «Crear contrato». Fuera de esa puerta, fichada, ausencias, cobertura, Banco de Horas, Análisis y liquidación no distinguen al eventual.

**Cruce entre empresas por CUIL:** callable `checkCuilConflicts({ cuil, fecha })` (Admin SDK): turnos de la misma persona en 2+ empresas del panel con superposición horaria o descanso < 12 h → warning en Planificación/CC y novedad `PLURIEMPLEO_DETECTADO`.

### 3.3 Firma en la app y credencial QR

- **Firma:** pantalla `apps/mobile-guardia/app/contrato.tsx` (patrón `eventos.tsx`): muestra el PDF/texto → «Firmar y aceptar» → callable `signContratoEventual({ contratoId })` que valida uid↔employeeId + device registrado, escribe `firma` (timestamp server, deviceId, hash del documento) y pasa `BORRADOR→FIRMADO`. Banner en tab Hoy si hay contrato pendiente de firma (patrón `CoberturaConvocatoriasBanner`).
- **Credencial QR:** extender `credenciales_publicas/{empDocId}` con bloque no sensible: `{ modalidad, contratoVigente?: { desde, hasta, estado }, habilitacion?: { ley9236Nro?, vencimiento? } }` (escrito por el server al cambiar estado del contrato). La página `/credencial/` (§2.2) muestra: empresa, vigilador (nombre/foto/legajo), **vigencia del contrato eventual**, habilitación provincial y estado — sin CUIL completo, ni remuneración, ni causa. Misma URL de QR existente: cero cambios en la app.

### 3.4 Pantallas RRHH

1. **RRHH → tab «Eventuales»** (en `rrhh/index.tsx`, permiso RRHH): tabla con los 4 estados derivados (Activo 25 / Efectivizados 27 / Baja 22 / Golondrina 2), filtros, contratos por persona, botones «Nuevo contrato», «Efectivizar» (escribe `modalidadHistory` + modalidad INDETERMINADO), «Generar archivo ARCA» (altas/bajas pendientes).
2. **Wizard alta de contrato:** empleado (o alta rápida de legajo) → evento/objetivo → fechas/horario/jornada → remuneración → causa art. 99 (texto editable con default) → previsualización PDF → guardar BORRADOR → enviar a firma (push al guardia).
3. **Ficha contrato:** timeline de estados, PDF, datos de firma, sección ARCA (archivo generado, confirmación manual con nro. de transacción).

---

## 4. Migración de la planilla SP Eventuales (76 personas)

Script `scripts/import-eventuales-planilla.mjs` — **dryRun por default**, `--apply` solo con OK de Mauro (patrón `fix-p1d-demo-fuera-operacion.mjs`):

1. Input: XLSX/CSV con NOMBRE, LEGAJO, CUIL, 1º INGRESO, ESTADO ACTUAL, FECHA EFECTIVIZACIÓN, BAJA EVENTUAL.
2. **Match por CUIL normalizado** (reutilizar `apps/functions/src/afip/normalizeCuit.ts`); fallback por `fileNumber`; sin match → crear legajo mínimo `status: inactivo` marcado `importSource: 'PLANILLA_SP'`. **Nunca duplicar**: si el CUIL existe, solo se agregan campos de modalidad.
3. Mapeo: ACTIVO → `modalidad: EVENTUAL` + item history; EFECTIVIZADOS → `modalidad: INDETERMINADO` + history `EFECTIVIZACION` con fecha; BAJA → `EVENTUAL` + `status: inactivo` + `eventualUltimaBaja`; GOLONDRINA → `EVENTUAL` + flag en history.
4. Contratos históricos: **un contrato sintético `FINALIZADO`** por período conocido (1º ingreso → efectivización/baja) con `documento: null` y `importSource` (la planilla no tiene el detalle por evento; no inventar). El reporte dryRun lista: matcheados, nuevos, ambiguos (CUIL inválido/duplicado) para revisión manual.

---

## 5. Dudas legales para el abogado laboral / Dirección de Control (Ley 9236)

1. **Pluriempleo:** ¿puede un vigilador habilitado prestar servicios simultáneos para dos prestadoras (empresas del panel) bajo Ley 9236 y CCT 422/05? ¿La habilitación provincial es por persona o por persona-empresa? ¿Qué descanso mínimo entre jornadas exige el CCT ante empleadores distintos?
2. **Límites del CCT 422/05 al eventual:** ¿admite el CCT la modalidad eventual sin restricción? ¿Tope de renovaciones/duración antes de presumirse contrato indeterminado (arts. 90/99 LCT)? ¿El patrón «golondrina» (contratos repetidos con la misma persona) es defendible o exige plazo fijo/temporada?
3. **Firma electrónica:** ¿es válida la firma «click-to-sign» en la app (registro de uid, dispositivo, timestamp, hash del PDF) como firma electrónica (art. 5 Ley 25.506) para un contrato laboral, o se exige firma ológrafa/digital certificada? ¿Conviene doble ejemplar impreso complementario (art. 100 LCT / requisitos Ley 24.013 art. 18)?
4. **QR ante la autoridad:** ¿qué debe poder constatar la Dirección de Control / policía adicional al escanear la credencial (habilitación 9236, alta ARCA, cobertura ART, vigencia del contrato)? ¿Hay datos que **no** deban exponerse públicamente (CUIL completo, domicilio)?
5. **Alta ARCA previa:** confirmación de que el eventual requiere alta en Simplificación Registral **antes** de iniciar cada período de prestación (alta temprana) aun para servicios de pocas horas, y qué código de modalidad de contratación corresponde (eventual vs. plazo fijo) según la tabla vigente.
6. **Remuneración bruta fija por evento:** compatibilidad con los mínimos del CCT 422/05 por hora/categoría (que el fijo nunca quede debajo del mínimo proporcional).

---

## 6. Plan por fases B–E

| Fase | Alcance | Tamaño | Riesgos |
|------|---------|--------|---------|
| **B — Datos + migración** | `modalidad`+history en legajo, `contratos_eventuales` + plantilla, reglas e índices, script import planilla (dryRun). Campos que faltan para el alta RG 5508: `empresas.arcaDomicilioExplotacion`, `empresas.arcaModalidadEventual`, `empleados.obraSocialRnos` (o default de empresa). El TXT espera a que Mauro baje el diseño de registro. | **M** (~1 semana) | Match CUIL con datos sucios; el código de modalidad ARCA no se inventa. |
| **C — UI RRHH + contrato PDF** | Tab Eventuales, wizard de contrato desde plantilla Bacar, PDF (reutilizar pipeline `liquidacionReportPdf`), efectivización, estados. | **M/L** (~1–2 semanas) | Plantilla legal debe cerrarla el abogado antes (dudas §5.3/5.6). |
| **D — Firma en app + QR + la única puerta** | Pantalla contrato en `mobile-guardia`, callable `signContratoEventual`, bloque eventual en `credenciales_publicas` + página `/credencial/`, `hasVigentContratoEventual` en Planificación, Centro de Control, eventos/TURA y `applyCoverage`, cruce CUIL entre empresas. | **L** (~2 semanas) | Tocar Planificación/CC exige tests E2E emulador; validez legal de la firma condiciona el diseño; OTA app. |
| **E — ARCA + EV dentro del motor único** | Generador del TXT de alta (7 campos RG 5508) y de bajas, con confirmación manual. `TRABAJO_F931` solo en empresas con certificado propio (`bacarsa`, `pruebas_sa`, o la que cargue el suyo); el resto, confirmación a mano. Incluir `EV` en el cómputo persona (§2.4: quitar el early-return en `reportesLiquidation.ts:891` y el espejo F0 `:792`, sumar al `desgloseTura`). Remuneración fija = campo del contrato; la diferencia, si la hay, va a `ajustes_liquidacion` del mismo ciclo. | **S/M** (~3–5 días) | Sin el diseño de registro no se escribe el generador. Incluir `EV` paga esas horas a **todos** los guardias con turno EV. El cert de Bacar no se reutiliza fuera de `bacarsa` / `pruebas_sa`. |

**Qué se simplifica** respecto del diseño anterior: no hay anexo de liquidación, ni colección de horas, ni rama en `payrollApi`/Banco/Análisis. Esos módulos no se modifican salvo el early-return de `EV`.

**Qué se agrega:** la puerta de contrato vigente en los cuatro escritores (Fase D) y el alta/baja ARCA por contrato (Fase E).

**Riesgo transversal:** no existe API de ARCA → el paso alta/baja siempre tendrá un click humano con Clave Fiscal; el diseño lo asume (estados `ALTA_ARCA`/`BAJA_ARCA` se confirman manualmente). Re-chequear el catálogo WSN de ARCA por si publican un servicio de registración.

---

*Fase A cerrada: solo diseño. Fuentes ARCA consultadas el 29/09/2026 (catálogo WSN, guías 143/361/498, páginas simplificacionregistral). La búsqueda web asistida estuvo bloqueada en esta sesión; la verificación se hizo por fetch directo de páginas oficiales ARCA/AFIP + índice DuckDuckGo.*
