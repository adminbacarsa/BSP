# EVENTUALES — Diseño Fase A (análisis, sin código)

> **Módulo:** RRHH-EVENTUALES · Vigiladores eventuales de seguridad (Córdoba, CCT 422/05 SUVICO, LCT arts. 99/100, Ley 24.013, Ley provincial 9236).
> **Rama:** `cursor/eventuales-fase-a` (desde `origin/main`). Solo diseño — sin código, sin escrituras en prod.
> **Coordina:** Claude Code · **Autor:** agente RRHH-EVENTUALES · **Fecha:** 29/09/2026.
> **Decisiones vigentes:** Eventuales es un módulo con bolsa propia, aparte de la nómina. La persona existe una vez por CUIL en `eventuales_bolsa`. El legajo de una empresa nace al darla de alta (contrato + ARCA). Una vez con legajo, se planifica, controla y liquida con el motor único. Dictamen del abogado en §0.5.

---

## 0. Alcance (Mauro + dictamen del abogado)

### 0.1 Bolsa única del grupo

Hay una **bolsa de eventuales**, módulo aparte de la nómina. Hoy el grupo es **Bacar S.A. y Grupo Bacar**; la lista es configurable (`grupos_eventuales`). La persona existe **una vez**, por CUIL, en `eventuales_bolsa/{cuil}`. Puede no trabajar para nadie, o para una o varias empresas del grupo.

### 0.1b Dónde se asigna un eventual y desde dónde se confirma el contrato

Hoy la plataforma tiene tres puertas por las que entra un eventual. En las tres el turno ya existe: lo que falta es el contrato.

| Flujo | Dónde | Qué turno crea |
|-------|-------|----------------|
| **Eventos** | `EventosPanel.tsx` → `assignGuardToEvent` (`services/eventoAssignService.ts:64`, `code: 'EV'`). La grilla lo muestra con `planningEventosExtras` (`planificacion/index.tsx:186`) | `EV` del evento |
| **Cobertura del CC (P8)** | `eventualesParaHueco` (`packages/ops-core/src/eventoCoverage.ts:31`, hoy devuelve `[]`; el CC la consulta antes de REF → ESC → EXT → ADV → FT) | `ops_cov` del hueco |
| **Planificación mensual** | Malla del puesto en `planificacion/index.tsx` (M/T/N como cualquier guardia) | turno del puesto |

**Decisión de Mauro.** Lo convoca el planificador, desde la malla del objetivo o desde el evento. Al asignar, `planAsignacion` (`lib/eventuales/flujo.mjs`) crea el contrato **ya confirmado** para la empresa convocante, con esas jornadas en un solo contrato (viernes + domingo = alta el viernes, baja el domingo o el lunes si cruza medianoche). RRHH ve y audita; no hay un paso de confirmación. El AT entra al lote de esa empresa.

En la ficha, `empresasHabilitadas` dice en qué empresas del grupo puede trabajar. Si la empresa no está, no aparece como candidato.

No se asigna si se superpone con otra empresa o si no quedan 12 h (art. 197). El selector muestra el mensaje de `bloqueoCruce`.

La liquidación ya es por empresa: `payroll-api/calc.ts` arma el snapshot con el `empresaId` pedido y descarta el turno de otra. `turnoLiquidaEnEmpresa` es el mismo corte.

**Lotes.** `empresas.arcaTandas`: altas 18:00 (lo que empieza al día siguiente o el fin de semana; el viernes cubre sábado y domingo) y bajas 09:00 de lo terminado el día anterior. Si la jornada empieza antes del próximo lote, el AT es urgente. Un lote = un TXT de la empresa (una línea por persona) y un `nroTransaccion` para todos sus envíos.

**Sustitución.** El planificador elige otro de la bolsa. Si el AT todavía no se subió, sale del lote. Si ya se subió y no trabajó, dentro de las 24 h el movimiento es **NA** (anulación de alta, hipótesis: confirmar con el contador). Después de 24 h ARCA no deja anular (rechazo BTU) y queda una BT marcada para el contador, no el motivo 30. El sustituto recibe su contrato y su AT. Queda en el historial del contrato.

### 0.1c Implementado en Planificación (rama `cursor/planif-eventuales`)

| Pieza | Archivo |
|-------|---------|
| Reglas puras: candidatos (`evaluarCandidato`, `ordenarCandidatos`), turno → jornada AR (`turnoAJornada`), contrato por turnos (`planContratoDesdeTurnos`) | `apps/web2/src/lib/eventuales/planificacion.mjs` (+ `.test.mjs`, `npm run test:eventuales`) |
| Callables `listarCandidatosEventuales`, `asignarEventualPlanificacion` (modo `LEGAJO` / `TURNOS`), `sustituirEventualPlanificacion`; trigger `onTurnoEventualWrite` → `sincronizarContratoEventual` | `apps/functions/src/eventuales/planificacionEventuales.ts` |
| Solapa **Eventuales** compartida | `apps/web2/src/components/eventuales/EventualesCandidatosPanel.tsx` |
| Grilla: cobertura de ausencias (`PlanningCoverageModal`), suplente de licencia (modal V/L/E/A → «Traer suplente» → **Eventuales (bolsa)**), **Sustituir eventual** en la celda, badge `EVENTUAL` en la fila | `apps/web2/src/pages/admin/planificacion/index.tsx` |
| Eventos: `EventoDetailModal` → Convocar → **Eventuales (bolsa)** primero (escribe el `EV` desde el servidor) | `apps/web2/src/components/servicios/EventoDetailModal.tsx` |

Permiso: `EVENTUALES.convocar` (el servidor lo exige; sin permiso la solapa muestra el aviso). Candidatos = bolsa `DISPONIBLE` con la empresa del objetivo en `empresasHabilitadas`; el cruce (`bloqueoCruce`) se calcula contra los turnos del CUIL en todo el grupo (`turnos.bolsaCuil`, índice `bolsaCuil + scheduleDate`) y se muestra como motivo. Distancia = `domicilioGeo` → coordenadas del objetivo. Vencimiento pasado de credencial/apto/habilitación bloquea; a 30 días avisa.

**Legajo.** El primer turno en una empresa crea `empleados` con `modalidad: 'EVENTUAL'`, `bolsaCuil`, `preferredObjectiveId: null` (aparece en la grilla como invitado del objetivo con sus turnos y el mismo cálculo de horas) y lo registra en `eventuales_bolsa.legajos`. Al guardar la grilla, todo turno de un legajo eventual sale con `esEventual: true` y `bolsaCuil`.

**Contrato = turnos.** Doc `contratos_eventuales/{empresaId}_{cuil}_{yyyy-mm}`, `origen: 'PLANIFICADOR'`, jornadas = turnos del eventual en esa empresa y mes. Turnos `draft` → contrato **BORRADOR** sin envío. Al publicar (la grilla pone `draft: false`) → **CONFIRMADO** y nace el `arca_envios` **AT** (canal `LOTE`/`URGENTE` por `clasificarAlta`). Mes ya publicado: cada guardado recalcula; si el AT está `PENDIENTE` se corrigen sus fechas, si ya se subió y cambian `fechaAlta`/`fechaBaja` nace un **MR**. Sin turnos: AT sin subir → contrato ANULADO y el envío `quitadoDelLote` (fuera de `armarLote`); AT subido → **NA** dentro de las 24 h del alta, **BT** después. Los turnos llevan `eventualContratoId` y `eventualAltaArcaConfirmada` (gate de fichada). Sustituir mueve los turnos guardados desde ese día al sustituto y recalcula ambos contratos. El TXT del AT/BT se arma con `lineasCargaMasiva` (`RETRIBUCION_PENDIENTE` hasta que haya bruto).

### 0.2 Contrato, ARCA y vuelta a la bolsa

La bolsa **no tiene un alta ARCA vigente**. El eventual está disponible sin alta. Cada vez que una empresa lo necesita: contrato → alta en ARCA antes de la primera jornada → trabaja esas jornadas → baja al terminar → vuelve a la bolsa. La próxima vez es un alta nueva, en la misma empresa o en otra. El legajo (`empleados`) se crea en ese alta, no al importar. Si se efectiviza, sale de la bolsa y queda en la planta de esa empresa.

El contrato es un período con sus jornadas `{ fecha, horaInicio, horaFin, horas }`. `fechaAlta` es el día en que empieza la primera. `fechaBaja` es el día en que termina la última, en hora de Argentina: si cruza medianoche, es el día siguiente. El sábado puede quedar adentro del período sin jornada. El TXT de ARCA de ese contrato informa desde y hasta. Los turnos de Planificación salen de esas jornadas. Un turno que no coincide con una jornada del contrato vigente se bloquea.

### 0.3 Turnos y liquidación en paralelo

Lleva turnos **en paralelo** en cada empresa. Cada empresa lo planifica, lo controla en el Centro de Control (fichada, ausencias, cobertura) y lo **liquida por separado** con el motor único: lo trabajado en una empresa se liquida en esa empresa (ciclo 26→25, bolsa 200, Banco de Horas y Análisis de esa empresa). Sirve en servicios normales y en eventos (`coverageType: eventos` / TURA).

### 0.4 Cruce obligatorio dentro del grupo

Al asignar un turno, el sistema mira los turnos de la misma persona en **todas** las empresas del grupo:

- no superponer horarios → **bloqueo**;
- descanso mínimo **12 h** entre el fin de una jornada y el inicio de la siguiente (art. 197 LCT), aunque cambie la empresa → **bloqueo**;
- tope diario de jornada (el de COSP, 12:59 desde el inicio real) sumando las horas del día en el grupo → **bloqueo**.

Además, alerta. El deber de fidelidad (art. 88 LCT) queda como obligación de la persona: el sistema solo ve empresas del grupo.

### 0.5 Dictamen aplicado

1. **Pluriempleo** entre prestadoras del grupo es legal (Ley 9236 no lo prohíbe). El cruce del §0.4 es obligatorio, no optativo.
2. **Eventual solo con causa** de pico extraordinario o reemplazo (arts. 99-100 LCT, Ley 24.013). Encadenar contratos con la misma persona para cubrir lo recurrente (**golondrina**) no es defendible: pasa a indeterminado o a prestación discontinua con antigüedad acumulada (art. 90). El sistema exige causa por contrato, alerta encadenamiento y sugiere efectivizar. Golondrina es un **riesgo**, no un estado sano.
3. **Firma.** El clic en la app es firma electrónica débil y **no** perfecciona el contrato. El contrato inicial es papel escaneado y adjunto, o firma digital certificada. La app muestra el contrato y registra **acuse de recibo**, con autenticación reforzada si se usa (OTP o biometría).
4. **QR ante la autoridad.** Sí: nombre, CUIL/DNI, empresa prestadora, habilitación provincial (Ley 9236) con estado y vencimientos, apto psicofísico solo como Apto/No apto, categoría, vencimiento de credencial, contrato vigente. No: domicilio, contacto, remuneración, datos médicos, familiares (Ley 25.326).
5. **Alta temprana siempre**, aunque el período sea de 2 h. Un turno de eventual solo puede **fichar** si el contrato de **esa** empresa está en `ALTA_ARCA` confirmada. Sin alta: bloqueo y alerta. Código de modalidad que indica el abogado: **14** (eventual, contratación directa) o **102** (empresas de servicios eventuales). **A confirmar** contra la tabla oficial ARCA/SICOSS vigente; no se hardcodea.
6. **No hay sueldo fijo por evento.** Se liquida por escala CCT 422/05 en el motor único: valor hora de categoría, presentismo proporcional, nocturnidad 21–06, extras 50/100 %, sábado después de las 13, domingo, feriado, adicionales. Al **finalizar** el contrato, la liquidación de esa empresa suma SAC y vacaciones proporcionales. El modelo de contrato de Bacar que pacta remuneración bruta fija **hay que cambiarlo** (queda anotado para el abogado).

---

## 1. ARCA — no hay web service de altas/bajas

### 1.1 Conclusión (fuentes oficiales, 29/09/2026)

**No existe un web service público de ARCA para altas y bajas de Simplificación Registral.** El certificado WSAA por empresa no tiene un servicio de registración que autorizar.

- Catálogo de WSN: [afip.gob.ar/ws/documentacion/catalogo.asp](https://www.afip.gob.ar/ws/documentacion/catalogo.asp). No figura Simplificación Registral. El único WS de Seguridad Social es `TRABAJO_F931`, y es **consulta** de DDJJ F.931 ya presentadas.
- Vías oficiales: servicio interactivo «Simplificación Registral - Empleadores» ([afip.gob.ar/simplificacionregistral/](https://www.afip.gob.ar/simplificacionregistral/)), app «Alta Ya» (RG 5448/2023, solo altas), F.885/A. Guías de carga por archivo: [id=143](https://serviciosweb.afip.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=143), [id=361](https://serviciosweb.afip.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=361), [id=498](https://serviciosweb.afip.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=498).

No hay URL de homologación ni de producción. Si ARCA publica un WSN, aparecerá en ese catálogo.

### 1.2 Archivo de carga masiva (RG 5508)

COSP genera el TXT; una persona lo sube con Clave Fiscal del **CUIT de la empresa que da el alta**. El registro de posiciones fijas está en `docs/arca/CARGA-MASIVA-FORMATO.md`. Lo arma `lineasCargaMasiva` (`apps/web2/src/lib/eventuales/arcaTxt.mjs`) con los parámetros de `empresas/{id}.arcaEventuales`.

Alta inicial, 7 campos. El resto (puesto, CCT, categoría, remuneración de escala, ART, jornada) se informa en el servicio **antes de la primera liquidación** de esa empresa.

| Campo RG 5508 | Origen COSP | Hoy | Quién lo completa |
|---------------|-------------|-----|-------------------|
| CUIL | Ficha de bolsa / `empleados.cuil` | Existe | Ya está |
| Domicilio de explotación de la actividad | `empresas.arcaDomicilioExplotacion` (el declarado en ARCA, no el del objetivo) | Falta | Una vez por empresa |
| Fecha de inicio | `contratos_eventuales.fechaAlta` de **esa** empresa | Colección nueva | RRHH al crear el contrato |
| Modalidad de contratación | `empresas.arcaEventuales.modalidadContrato` | **012** Trabajo eventual (tabla oficial). El 14 es período de prueba: no se usa. | Default del generador |
| Trabajador agropecuario | constante `false` | No aplica | El generador lo manda en no |
| Obra social (RNOS) | `empleados.obraSocialRnos` o default de empresa (SUVICO) | Falta | RRHH en el legajo de esa empresa |
| Fecha de finalización | `contratos_eventuales.fechaBaja` | El mismo TXT informa desde y hasta | Alta AT y baja BT |

El alta del TXT sale de contratos `DOCUMENTADO` (papel o firma certificada adjunta). Pasa a `ALTA_ARCA` solo cuando el operador confirma que ARCA aceptó el archivo (nro. de transacción). La baja (CUIL + fecha + motivo) sale al `FINALIZADO`.

**Certificado.** Mauro tiene solo el de BACAR S.A. Sirve para `bacarsa` y para `pruebas_sa`. No se usa en otra empresa: cada una carga el suyo en `empresa_afip_credentials/{empresaId}` o delega el WS a otro CUIT. El fallback global de `loadAfipConfigForEmpresa` (`apps/functions/src/afip/empresaAfipStore.ts:127`) no habilita `TRABAJO_F931` para el resto. Ese control (consulta, no alta) corre solo donde hay certificado propio; si no hay, la confirmación es manual.

---

## 2. Qué existe hoy reutilizable (archivo:línea)

### 2.1 Legajos

- `Employee`: `apps/web2/src/services/employeeService.ts:4-23`. Soft delete `INACTIVE`: `:25-89`. El legajo ya es por `empresaId`: la bolsa no reemplaza esta colección; la enlaza por CUIL.
- Payload: `apps/web2/src/lib/employees/employeeLegajoDefaults.ts:1-28`, `:37-63`, `:65-97`.
- `ContractType` incluye `'Eventual'` en `apps/functions/src/common/interfaces/employee.interface.ts:11-47`, pero el formulario vigente no lo expone. Estados UI `activo`/`inactivo`: `employeeLegajoDefaults.ts:30-34`. Baja: `apps/web2/src/pages/admin/rrhh/index.tsx:1217-1222`.
- UI: RRHH `rrhh/index.tsx:1064-1121` y LABORAL `:2848-2893`; `EmployeeLegajoForm.tsx:34-45` y `:208-264`.

### 2.2 Credencial QR

- URL `{origin}/credencial/?id={empDocId}`: `apps/mobile-guardia/src/lib/credencialVerification.ts:3-8`; render `credencial.tsx:228-229`. El id es el legajo: con dos empresas hay dos credenciales, cada una con su prestadora.
- Doc público `credenciales_publicas/{empDocId}`: `apps/web2/src/components/empleado/CredencialDigital.tsx:172-189`.
- Página pública: `apps/web2/src/pages/credencial/index.tsx:26-27` y `:86-91`. Reglas `read: true`: `firestore.rules:594-597`. Hoy no muestra CUIL ni habilitación 9236: hay que ampliar el doc público con el recorte del §0.5.4.

### 2.3 Eventos / TURA

- Puesto eventos: `apps/web2/src/lib/servicios/eventosPosition.ts:3-39`; `slaService.ts:56-57`.
- Turno `EV`: `apps/web2/src/services/eventoAssignService.ts:128-212`. Aceptación del guardia: `apps/functions/src/eventos/eventoPortalCallables.ts:87-165`.
- Prefactura de eventos al cliente: `apps/web2/src/pages/admin/crm/index.tsx:2569-2631`. No se toca.

### 2.4 Liquidación — mismo motor, por empresa

- `calculateLiquidationHoursStats`: `packages/hours-core/src/motors/liquidation/reportesLiquidation.ts:831-837`; bolsa 200 `:1067-1071`. API: `apps/functions/src/payroll-api/calc.ts:1-18`.
- Los turnos M/T/N/D12/N12 y TURA/RFZ (`desgloseTura` `:1027`) ya liquidan en la empresa del turno. El hueco es el código `EV`, excluido en `:891` y en `reportesLiquidationF0.ts:792`. Para pagarlo en el mismo motor: sacar `'EV'` de esos dos returns y sumar la duración real a `desgloseTura`. `EV` sigue en `OBJECTIVE_NON_BILLABLE_CODES` (`:29`) para no vender SLA.
- **No hay remuneración fija.** El bruto lo calcula `calcularRemuneracionContrato` (§2.8) con la escala vigente a cada jornada. La clasificación diurna / nocturna / feriado es `getNightDuration` y `dateKeyAR` de hours-core, no una segunda regla. Esas líneas se reimprimen en la liquidación de esa empresa al `FINALIZADO`.

### 2.5 AFIP por empresa

- `loginWsaaDirect`: `apps/functions/src/afip/wsaaDirect.ts:95-100`. Credenciales: `empresaAfipStore.ts:6-18` y `:108-128`. Reglas cerradas: `firestore.rules:424-427`.
- Alta/baja de relaciones: no hay WS (§1.1). `TRABAJO_F931` solo con certificado de esa empresa (§1.2).

### 2.6 Reglas e índices modelo

- `tenantAdminRead()` `firestore.rules:160-162`; create/update/delete `:164-176`. `empleados` `:289-296`.
- La bolsa y el cruce por CUIL se leen por callable (Admin SDK), no desde el cliente de una sola empresa.

### 2.7 Firma

- No hay firma electrónica. El bloque «FIRMAS» de RRHH es un placeholder impreso: `rrhh/index.tsx:3435-3444`. El acuse de la app se apoya en el patrón de callable con uid y timestamp de servidor (`respondEventoConvocatoria`), y **no** cambia el estado legal del contrato.

### 0.4b Bloqueo de fichada sin alta ARCA

`isAltaArcaConfirmada` (`apps/functions/src/arca/altaArcaGate.ts`, espejo en `lib/eventuales/arcaEnvios.mjs`) es lo primero que mira `evaluateServerCheckInWindow`: un turno con `esEventual: true` y `eventualAltaArcaConfirmada !== true` devuelve `ALTA_ARCA_PENDIENTE` y `registrarPresencia` lo rechaza. Va **antes** de las ventanas y del bypass del CC: es un bloqueo legal, no una tolerancia horaria. El turno lleva el estado denormalizado para que la fichada no tenga que leer contratos.

Desde **T−2 h** el CC ve la alerta (`altaArcaPendienteAlerta`, novedad `ALTA_ARCA_PENDIENTE`, prioridad alta). Antes de esa ventana no molesta. Ese mismo disparador es el que usa n8n Cloud para mandar el link manual (§2.10).

### 2.8 Remuneración

No hay sueldo fijo. `calcularRemuneracionContrato` (`apps/web2/src/lib/eventuales/remuneracion.mjs`) arma el bruto para la cláusula del contrato y las mismas líneas se reusan al cerrar la liquidación.

Valor hora = básico mensual de la categoría / divisor. El divisor default es **200**, el techo que ya usa la liquidación (`reportesLiquidation.ts`, `SUVICO_POLICY.REST.MAX_MONTHLY_HARD`). Cada jornada usa la escala con `vigenciaDesde` ≤ esa fecha.

Horas: `getNightDuration` y `dateKeyAR` de `@cosp/hours-core` (21:00–06:00 AR). El feriado es el calendario `feriados` de COSP, minuto a minuto por el día AR (una jornada que cruza medianoche puede entrar a un feriado). Sábado desde las 13, domingo y feriado suman el recargo de `SUVICO_POLICY.COST` (100 %). Si la jornada pasa las 8 h, el excedente es extra al 50 %, o al 100 % si cae en sábado >13, domingo o feriado: ese 100 % reemplaza al recargo del día, no se apila. El nocturno sí se suma aparte. El % nocturno **no está en el repo**; si la escala lo trae vacío, las horas se cuentan y el importe queda en 0 con aviso.

Presentismo y adicionales (no remunerativos / viáticos) son conceptos de la escala. No entran a SAC ni a vacaciones si son viático o no remunerativos.

Al cierre: SAC = remunerativo del período / 12. Vacaciones no gozadas = (días con jornada / 20) × (básico / 30), la regla de 1 día cada 20 de `SUVICO_POLICY.VACATION` para quien no llega a medio año. 20, 12 y 30 quedan en la escala por si la paritaria dice otra cosa.

Colección `escalas_salariales/{convenio}_{categoria}_{vigenciaDesde}`: convenio, categoría, vigencia, básico, divisor, jornada ordinaria, recargos, presentismo, adicionales[], SAC, vacaciones, `status` (`ACTIVE` | `PENDIENTE_APROBACION` | `INACTIVE`). Solo `ACTIVE` entra al cálculo. Historial = un doc por vigencia. La lee un admin; la escribe SuperAdmin. Reglas e índice en el repo, sin publicar.

El job de escala (`planJobEscalaSuvico`) no está exportado en Functions: no se publica. Recorre fuentes (suvico.org.ar, Boletín Oficial de Córdoba, InfoLEG, prensa). Si el texto no trae una tabla `ESCALA_SUVICO_TABLA` con básico por categoría, no inventa importes: deja un aviso para carga asistida. Si parsea, crea una propuesta `PENDIENTE_APROBACION` con URL de fuente. `aprobarEscala` la pasa a `ACTIVE` (un clic de SuperAdmin). Nunca se aplica sola. El 29/09/2026 la home de SUVICO nombra «Escala Salarial Vigente» pero `/escala` y `/escala-salarial` responden 404. La prensa cita un conformado inicial de $1.644.650 del 1er semestre 2026: no es el básico de Vigilador General y no se cargó.

Cláusula que se imprime: bruto, categoría, valor hora, desglose por concepto y la frase de que no es un monto fijo. Al cierre se agregan SAC y vacaciones.

### 2.9 Envíos ARCA (`arca_envios`)

Un envío = un TXT que alguien tiene que subir a Simplificación Registral. Al **confirmar** el contrato se crea el AT (`planEnvioAlta`); al **cerrarlo**, el BT (`planEnvioBaja`, que exige el AT ya `CONFIRMADO`). Núcleo puro en `lib/eventuales/arcaEnvios.mjs`, espejo servidor en `functions/src/arca/arcaEnviosCore.ts`.

```ts
arca_envios/{envioId}: {
  empresaId, contratoIds[], bolsaCuil, tipo: 'AT' | 'BT',
  txt, enviable, advertencias[],
  estado: 'PENDIENTE' | 'SUBIENDO' | 'CONFIRMADO' | 'ERROR' | 'MANUAL',
  origen: 'ROBOT' | 'MANUAL' | 'LINK' | null,
  nroTransaccion, constanciaUrl, driveFileId, driveLink, driveSkipReason,
  intentos: Array<{ estado, origen, at, actor, error }>,
  token, tokenExpiraAt, tokenUsadoAt,
  cargaManual?: { ip, userAgent, at },
  fechaAlta, fechaBaja
}
```

`CONFIRMADO` es terminal y exige `nroTransaccion`. Un envío con `enviable: false` (falta el código de CCT, la categoría o el RNOS) no se le entrega al robot. Reglas: lectura solo SuperAdmin, escritura solo servidor — el TXT y el token nunca salen por el cliente de Firestore.

**Drive.** El proyecto ya tiene `googleapis` y la carpeta de backups, así que la función copia el TXT al confirmar (`arcaEnvioDrive.ts`, `DRIVE_ARCA_FOLDER_ID` o subcarpeta `arca-envios` del backup root). Si no hay carpeta configurada no falla el envío: deja `driveSkipReason` y lo sube el nodo Drive de n8n Cloud.

### 2.10 Endpoint para n8n y link manual

`arcaEnviosApi` (HTTPS v2, `us-central1`, secreto **`ARCA_ROBOT_KEY`**, rate limit por IP, un `audit_logs` por movimiento). No es callable: n8n no tiene SDK de Firebase.

| Acción | Auth | Para qué |
|--------|------|----------|
| `GET ?action=pendientes` | header `x-arca-key` | envíos `PENDIENTE`/`ERROR` con su TXT |
| `POST ?action=resultado` | header `x-arca-key` | `{ envioId, estado, nroTransaccion?, constanciaUrl?, error? }` |
| `POST ?action=link-emitir` | header `x-arca-key` | devuelve el link de un solo uso para WhatsApp/mail |
| `GET ?action=link&token=` | token | resumen público + TXT |
| `POST ?action=link-resultado&token=` | token | nro. de transacción + constancia |

**Link mágico.** Token aleatorio de 32 caracteres (`randomBytes`), vence a las **48 h** o al confirmar, y es de un solo uso (`tokenUsadoAt`). Página pública `/arca-envio/?token=…` (`pages/arca-envio/index.tsx`; export estático, por eso query y no ruta dinámica). Sin login. Muestra empresa, movimiento, cantidad de registros y fechas: **no** muestra CUIL, nombre ni importes (`vistaPublicaEnvio`). Deja `ip` y `userAgent` de quien cargó.

**Flujos n8n** (`docs/n8n/`, sin credenciales): `arca-local-playwright.json` (cada 5 min: pendientes → `SUBIENDO` → Playwright con la Clave Fiscal delegada, placeholder → resultado) y `arca-cloud-link-magico.json` (pendiente >15 min, `ERROR` o jornada en <2 h sin alta → link por WhatsApp/mail; respaldo Drive; resumen 09:00 AR).

Sin desplegar: falta que Mauro cree `ARCA_ROBOT_KEY` (`firebase functions:secrets:set ARCA_ROBOT_KEY`) y publique reglas e índices.

### 2.11 Avisos por empresa

`empresas/{id}.avisos` lista destinatarios por tipo: `ARCA_ALTA_PENDIENTE`, `ARCA_BAJA_PENDIENTE`, `ARCA_ERROR`. Cada uno es una persona (mail, WhatsApp, push) o un `rolDestino` (`OPERADOR` → módulo OPERATIONS, `PLANIFICACION` → PLANNING, `RRHH`, `SUPERVISION`). El rol se cruza con `roles` que tengan lectura de ese módulo y con `system_users` de la empresa. Si el rol no existe o no tiene nadie, la lista queda vacía.

El push usa `device_tokens` (uid + token, el mismo doc del panel y de la app). Si no hay token, esa persona cae a mail y WhatsApp. `GET ?action=config-avisos&empresaId=&tipo=` (misma clave) devuelve mails y WhatsApp ya resueltos; el FCM lo manda la función al emitir el link, con la URL del envío. Lo edita el admin de la empresa (solo el campo `avisos`) o SuperAdmin, y queda en `audit_logs` (`AVISOS_EMPRESA`). Pantalla: Configuración → Empresas → Avisos.

---

## 3. Datos, reglas y pantallas

### 3.1 Grupo y bolsa

```ts
grupos_eventuales/{grupoId}: {
  nombre: string;                    // «Grupo Bacar»
  empresaIds: string[];              // hoy las dos empresas Bacar; configurable
  descansoMinHoras: 12;              // art. 197, no editable a la baja
  alertaEncadenamiento: { maxContratos: number; ventanaMeses: number; patronSemanal: boolean };
  status: 'ACTIVE' | 'INACTIVE';
}

eventuales_bolsa/{cuil}: {
  grupoId, cuil, dni, nombre,
  nombre, legajoPlanilla,                 // el número de la planilla es referencia, no un empleados.id
  primerIngreso?: string;
  disponibilidad: 'DISPONIBLE' | 'NO_DISPONIBLE';   // convocable o no; no es el alta ARCA
  arcaHistorial: Array<{ estado: 'ALTA' | 'BAJA', fecha, origen, contratoId? }>;
  riesgoEncadenamiento?: boolean;
  legajos: Array<{ empresaId, employeeId }>;  // vacío hasta el alta de una empresa
  createdBy?: string;
}
```

`alertaEncadenamiento` es parametrizable. Los umbrales iniciales los fija Mauro con el abogado antes de la Fase C (no se inventan acá).

### 3.2 Legajo de cada empresa

Sigue siendo `empleados` de esa empresa, más:

```ts
modalidad: 'INDETERMINADO' | 'EVENTUAL' | 'PLAZO_FIJO';
bolsaCuil: string;                         // enlace a la bolsa
obraSocialRnos?: string;
modalidadHistory: Array<{ modalidad, desde, hasta?, motivo, contratoId?, setByUid, setAt }>;
fechaEfectivizacion?: string;
eventualUltimaBaja?: string;
habilitacion9236?: { numero, estado, vencimiento };
credencialVencimiento?: string;
aptoPsicofisico?: 'APTO' | 'NO_APTO';      // solo eso sale al QR
```

El domicilio de explotación ARCA vive en la empresa (`empresas.arcaDomicilioExplotacion`), no en el legajo. El código RNOS va en `empleados.obraSocialRnos`. El grupo default es `bacarsa` + `grupos_bacar_sa` (`grupos_eventuales/bacar`).

### 3.3 Contrato (uno por período y por empresa)

```ts
contratos_eventuales: {
  empresaId, employeeId, bolsaCuil,
  clientId?, objectiveId?, eventoId?,
  causa: string,                         // obligatoria, art. 99; no se guarda vacía
  fechaAlta: string,                     // día de inicio de la primera jornada
  fechaBaja: string,                     // día AR en que termina la última (día siguiente si cruza medianoche)
  jornadas: Array<{ fecha, horaInicio, horaFin, horas }>,
  estado: 'BORRADOR' | 'DOCUMENTADO' | 'ACUSE_RECIBIDO' | 'ALTA_ARCA' | 'VIGENTE' | 'FINALIZADO' | 'BAJA_ARCA' | 'ANULADO',
  documento: { storagePath, sha256, tipo: 'PAPEL_ESCANEADO' | 'FIRMA_DIGITAL_CERTIFICADA' },
  acuse?: { at, uid, deviceId, metodo: 'SESION' | 'OTP' | 'BIOMETRIA', docSha256 },
  arca?: { altaArchivoAt?, altaConfirmadaAt?, nroTransaccion?, bajaArchivoAt?, bajaConfirmadaAt?, modalidadCodigo? },
  liquidacionFinal?: { cycleId, sac, vacacionesProporcionales, snapshotRef },
  riesgoEncadenamiento?: boolean,
  status: 'ACTIVE' | 'INACTIVE'
}
```

No hay campo de monto fijo. Al armar el PDF se imprime `clausula` de §2.8: bruto calculado, desglose y la escala vigente. El abogado revisa ese texto; no vuelve el bruto pactado a mano.

**Firma y acuse.** `BORRADOR` → `DOCUMENTADO` solo con el archivo de papel o la constancia de firma certificada. La app muestra ese PDF y el callable `acusarReciboContrato` escribe el acuse (`ACUSE_RECIBIDO`). No existe transición por clic a «firmado».

### 3.4 Reglas de turno

1. **Asignar** (Planificación, Centro de Control, eventos y `applyCoverage`): el turno tiene que coincidir con una jornada del contrato de esa empresa. El día intermedio, sin jornada, no alcanza. Además, horas de la jornada y del día ≤ 12:59, y 12 h de descanso contra las otras jornadas del grupo (§0.4).
2. **Fichar**: la alta ARCA de ese contrato tiene que estar confirmada antes del inicio de la primera jornada. Si no: bloqueo y alerta.
3. **Encadenamiento:** al guardar un contrato, si en la ventana configurada se supera la cantidad de contratos, de días, o hay patrón semanal fijo con el mismo CUIL en el grupo, el contrato queda marcado `riesgoEncadenamiento` y la UI sugiere efectivizar. No impide guardar (la decisión es de RRHH), pero entra al reporte de riesgo.
4. **Cierre:** `FINALIZADO` dispara la liquidación final de esa empresa (SAC y vacaciones proporcionales, §2.4) y habilita el TXT de baja ARCA.

### 3.7 Efectivización (art. 90)

Pasar a planta permanente es en la **misma empresa** y el **mismo legajo**. Función pura `planEfectivizacion` (`apps/web2/src/lib/eventuales/efectivizacion.mjs`):

- `modalidad: INDETERMINADO` y `fechaEfectivizacion`.
- `startDate` queda en el **1º ingreso** (la antigüedad no se reinicia).
- Los contratos eventuales abiertos de esa empresa pasan a `FINALIZADO`. Si estaban en `ALTA_ARCA` o `VIGENTE`, queda pendiente la baja ARCA de ese contrato.
- Sale de la bolsa de esa empresa. Si no le queda un legajo eventual en otra empresa del grupo, `disponibilidad` pasa a `NO_DISPONIBLE`. Si sigue eventual en la otra, solo se quita este vínculo.
- ARCA: modificación de modalidad **pendiente** (no hay web service, §1.1). No se inventa el código 14/102.

Quien ya es `INDETERMINADO` no se efectiviza de nuevo.

Reglas Firestore: lectura del contrato = admin de esa empresa o el guardia dueño del legajo. Escritura de `estado`, `documento`, `acuse` y `arca` solo por callable. La bolsa: lectura admin de cualquier empresa del grupo; escritura solo callable.

Índices: `contratos_eventuales` (empresaId, employeeId, fechaInicio) · (empresaId, estado, fechaInicio) · (bolsaCuil, fechaInicio). El cruce de turnos del grupo lo hace el callable, no una query cruzada desde el cliente.

### 3.5 QR

Se extiende `credenciales_publicas/{empDocId}` (un doc por legajo / empresa prestadora) con: nombre, CUIL, DNI, empresa, habilitación 9236 (número, estado, vencimiento), `aptoPsicofisico`, categoría, vencimiento de credencial, vigencia y estado del contrato. Nada más. La página `/credencial/` muestra ese recorte.

### 3.6 Pantallas

1. **RRHH → Eventuales**, con el grupo seleccionado: la bolsa (una fila por CUIL), columnas de alta por empresa, contratos, y el reporte de riesgo de encadenamiento. Acciones: dar de alta en una empresa del grupo, nuevo contrato (causa obligatoria), efectivizar, generar TXT ARCA de esa empresa.
2. **Wizard de contrato:** causa → objetivo o evento → fechas y horario → previsualización sin monto fijo → adjuntar papel o constancia certificada.
3. **App:** pantalla de contrato en solo lectura + «Acusé recibo» (OTP o biometría si está disponible). Banner en Hoy si hay acuse pendiente. La fichada responde el bloqueo del §3.4.2 con un texto claro.
4. **Ficha:** timeline de estados, archivo adjunto, acuse, ARCA (transacción manual), liquidación final al cerrar.

---

## 4. Migración de la planilla

Script `scripts/import-eventuales-planilla.mjs`. Escribe **solo** `eventuales_bolsa` (id = CUIL, re-correr no duplica, no borra). No crea ni modifica `empleados`. `--apply` exige también `--allow-prod`. `createdBy` = `import-planilla-2026-09-29` y deja un `audit_logs`. El cotejo de planta permanente es por CUIL y por legajo contra `bacarsa`, `grupos_bacar_sa` y `pruebas_sa`. El detalle con datos personales va a `scripts/out/` (gitignored).

La bolsa no guarda un `estadoArca` vigente. El 1º ingreso y la última baja de la planilla entran al `arcaHistorial` como movimientos, sin contrato.

**Pregunta abierta (no resuelta):** qué significa ACTIVO / BAJA en ESTADO ACTUAL. Hipótesis parametrizada en `PLANILLA_ENTRA_BOLSA` / `PLANILLA_DISPONIBILIDAD`: ACTIVO sigue convocable; BAJA queda fuera, como histórico. Golondrina entra con marca de riesgo. Efectivizados no entran. Mauro tiene que confirmar el mapa antes de un `--apply`.

No entra a la bolsa si el CUIL o el legajo ya es planta permanente en esas empresas (`modalidad` `INDETERMINADO`, o sin modalidad y activo), ni si el legajo o el CUIL está repetido en la planilla (se informa; queda la primera fila).

---

## 5. Pendiente de verificar (el dictamen ya cerró el resto)

1. **Qué significa ACTIVO / BAJA en la planilla** (hipótesis en §4: convocable vs. fuera de la bolsa). No es el alta ARCA.
2. Código de CCT 422/05 (10 caracteres de la tabla de convenios) sigue pendiente. Categoría profesional Vigilador = **033104** (`arcaEventuales.categoria`, editable). Confirmar puesto 5414. Modalidad ya cerrada: **012**. Baja: movimiento BT, situación de revista **30** (vencimiento de plazo, art. 250 LCT). El RNOS es de cada vigilador: si falta, el envío queda `RNOS_PENDIENTE`.
3. Umbrales del alerta de encadenamiento (cantidad, meses, patrón semanal).
4. El abogado revisa la cláusula de §2.8. El monto ya sale de la escala; falta la tabla paritaria (básicos, % nocturno, presentismo, adicionales, 25 o 30 días para vacaciones).
5. Si el apto psicofísico y la habilitación 9236 viven en el legajo de cada empresa o se copian desde la bolsa cuando la habilitación es de la persona. El QR igual los muestra por empresa prestadora.

---

## 6. Fases B–E

| Fase | Alcance | Tamaño | Riesgo |
|------|---------|--------|--------|
| **B — Bolsa, legajo, contrato, migración** | Hecho en datos, sin UI: `eventuales_bolsa`, `grupos_eventuales`, `modalidad` + historial + RNOS en el legajo, `arcaDomicilioExplotacion` en la empresa, `contratos_eventuales` (causa obligatoria; estado/firma/ARCA solo servidor), reglas e índices **sin publicar**, import dry-run, `planEfectivizacion`. | **M** | CUIL sucio. Código 14/102 sin verificar. `--apply` sigue apagado. |
| **C — UI RRHH** | Tab de la bolsa del grupo, wizard con causa, alerta de encadenamiento y sugerencia de efectivizar, reporte de riesgo, PDF de contrato remitiendo al CCT (plantilla provisoria hasta el texto del abogado). | **M** (~1 semana) | El texto provisorio no se usa como contrato real hasta el ok del abogado. |
| **D — Acuse, QR, puertas** | Adjunto papel o firma certificada. Acuse en la app (no firma). QR del §0.5.4. Bloqueo al asignar (§0.4 + contrato de esa empresa) en Planificación, CC, eventos y `applyCoverage`. Bloqueo de fichada sin `ALTA_ARCA` de esa empresa. | **L** (~2 semanas) | Tocar Planificación, CC y fichada exige E2E de emulador. OTP/biometría depende de lo que el dispositivo ya sepa hacer. |
| **E — ARCA y cierre en el motor único** | TXT de alta (7 campos) y de baja, por CUIT de empresa, confirmación manual. `TRABAJO_F931` solo con certificado propio. Sacar `EV` del early-return del motor único (§2.4). Al `FINALIZADO`, líneas de SAC y vacaciones proporcionales en la liquidación de esa empresa. | **M** (~1 semana) | Sin el diseño de registro no hay generador. Incluir `EV` paga ese código a cualquier guardia, no solo a eventuales. El cert de Bacar no sale de `bacarsa` / `pruebas_sa`. |

Se simplifica respecto del diseño anterior: no hay remuneración fija, no hay firma por clic y no hay liquidación paralela. Se agrega la bolsa del grupo, el cruce de 12 h / tope diario entre empresas, la causa con alerta de golondrina, el acuse separado del papel, y la fichada condicionada al alta ARCA de esa empresa.

**Riesgo transversal:** el alta y la baja ARCA siguen teniendo un paso humano con Clave Fiscal. Re-chequear el catálogo de WSN por si aparece un servicio de registración.

---

*Fase A, solo diseño. Fuentes ARCA consultadas el 29/09/2026. Dictamen del abogado y alcance de bolsa aplicados en §0 el mismo día.*

---

## 7. Contrato para la app de guardias

El eventual entra a la misma app (`mobile-guardia` / `/app`). No hay un login aparte.

1. RRHH, con permiso `EVENTUALES` `update`, llama **`crearAccesoEventual`** `{ cuil }`. El servidor crea (o reutiliza) el usuario Auth del mail de la ficha, pone el claim `{ role: 'EVENTUAL', type: 'eventual', bolsaCuil }` y guarda `eventuales_bolsa.uid`. Devuelve un link de activación de 48 h, el mismo `device_activations` del portal del legajo (`tipo: 'EVENTUAL'`).
2. Al iniciar sesión, la app mira el claim. Si `role` es `EVENTUAL`, no busca un legajo: llama **`listarTurnosEventual`** (sin argumentos; el uid de Auth alcanza). La respuesta es `{ bolsaCuil, empresas, turnos }`. Los turnos salen de `turnos.bolsaCuil` y de `eventuales_bolsa.legajos[].employeeId`, de **todas** las empresas, no de la empresa de la sesión.
3. Si el claim es `employee`, el flujo de legajo no cambia.
4. Un eventual `NO_DISPONIBLE` no recibe acceso. La baja de la bolsa no borra la cuenta: deja de poder fichar cuando el contrato y el alta ARCA ya no están vigentes.
