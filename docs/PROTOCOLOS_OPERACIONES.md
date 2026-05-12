# Protocolos de novedades en Operaciones

Documento de referencia: **qué hace el sistema** en cada acción del centro de control (Operaciones). Sirve para corregir flujos y unificar criterios.

---

## Reglas de negocio (a respetar en flujos)

- **Ausencia no es vacante.** Una ausencia tiene tratamiento propio: no se “resuelve” igual que una vacante. Se marca después de **60 min** de que el guardia no llegó, o por **declaración del operador**, y **inicia el protocolo de cobertura** (CUBRIR). “Devolver” en una ausencia es excepcional (reportar a planificación sin cobertura).
- **La salida debe ir acompañada de un ingreso.** Al registrar una salida, normalmente debe haber un ingreso (relevo) que cubra el puesto. Excepción: cuando el servicio no tiene más vacantes/posiciones que cubrir en ese objetivo.
- **Ausencia → protocolo.** Marcar ausente abre el modal de Cobertura para asignar reemplazo; el camino principal es CUBRIR, no devolver a planificación.

---

## 1. Dar presente / Ingreso (HandoverModal)

**Cuándo:** El guardia llega al objetivo y el operador registra el ingreso (botón "PRESENTE" / "LLEGÓ?" o atajo **P**). Ventana permitida: entre **15 min antes** y **60 min después** del horario de inicio del turno.

**Qué hace el sistema:**
- Actualiza el turno en `turnos`: `isPresent: true`, `status: 'PRESENT'`, `checkInTime` (serverTimestamp), `isLate` si llegó >5 min tarde.
- Si el operador elige **relevar** a un guardia que ya está en el puesto: además actualiza el turno del **relevado** con `checkOutTime`, `isCompleted: true`, `status: 'COMPLETED'`.
- Si no elige a nadie: "INGRESAR SIN RELEVAR" solo marca presente al entrante.
- Bitácora: registra "Ingreso / Presente" o "Ingreso tarde" con objetivo y cliente.

**Campos Firestore afectados (turno entrante):** `isPresent`, `status`, `checkInTime`, `isLate`, `checkInMethod: 'OPERATOR'`, `checkInOperator` (uid).  
**Turno relevado (si aplica):** `checkOutTime`, `isCompleted`, `status: 'COMPLETED'`.

---

## 2. Salida (CheckOutModal)

**Cuándo:** El operador hace "SALIDA" sobre un turno activo o retenido.

**Regla de negocio:** La salida debe ir acompañada de un ingreso (relevo) salvo que el servicio no tenga más vacantes que cubrir en ese objetivo. El operador debe asegurar el relevo antes de registrar salida cuando corresponda.

**Qué hace el sistema:**
- Llama a `logic.handleAction('CHECKOUT', shiftId, novedad)` → actualiza el turno: `status: 'COMPLETED'`, `isCompleted: true`, `isPresent: false`, `realEndTime` (serverTimestamp), `checkoutNote` (si el operador escribió novedad).
- Bitácora: "Salida registrada" con nombre del guardia, objetivo, puesto y texto de novedad si hay.

**Campos Firestore:** `status`, `isCompleted`, `isPresent`, `realEndTime`, `checkoutNote`.

---

## 3. Marcar ausente (AttendanceModal → handleMarkAbsent)

**Cuándo:** El guardia no se presentó. Se puede marcar **después de 60 min** de que no llegó, o por **declaración del operador**. Botón "AUSENTE" / "CONFIRMAR AUSENCIA" (o atajo **A** con tarjeta seleccionada).

**Regla de negocio:** La ausencia **no se resuelve como una vacante**. Inicia el **protocolo de cobertura**: el camino principal es CUBRIR (asignar reemplazo). "Devolver" es excepcional.

**Qué hace el sistema:**
- Actualiza el turno: `status: 'ABSENT'`, `isAbsent: true`.
- Bitácora: "Marcó ausente" con empleado, objetivo y puesto.
- **Cierra el modal de asistencia y abre automáticamente el modal de Cobertura** con ese turno para iniciar el protocolo (retención, intercambio, libre, volante, adelanto, franco).

**Campos Firestore:** `status: 'ABSENT'`, `isAbsent: true`.

---

## 4. Baja anticipada (InterruptModal)

**Cuándo:** El operador hace "BAJA" sobre un guardia que está en el puesto (activo).

**Dos caminos:**

### 4a. Hay otros guardias en el objetivo ("REGISTRAR NOVEDAD (CUBIERTO)")
- Crea documento en `novedades`: tipo `BAJA_CUBIERTA`, shiftId, detalles "Retiro anticipado. Puesto cubierto por dotación."
- Actualiza el turno: `checkOutTime`, `status: 'COMPLETED'`, `comments: 'Baja anticipada (Cubierto)'`.
- Bitácora: "Baja anticipada (cubierto)" con empleado, objetivo, puesto.
- No se crea vacante.

### 4b. Es el único guardia en el objetivo ("INICIAR PROTOCOLO DE COBERTURA")
- Actualiza el turno del guardia: `status: 'INTERRUPTED'`, `checkOutTime` (serverTimestamp).
- **Crea un nuevo documento en `turnos`** con los mismos datos del puesto pero `employeeId: 'VACANTE'`, `employeeName: 'VACANTE (BAJA)'`, `isUnassigned: true`, `isPresent: false` (sin enviar `id` ni campos `undefined`).
- Bitácora: "Baja anticipada (protocolo)" — puesto descubierto, protocolo activado.
- **Abre el modal de Cobertura** con esa nueva vacante para asignar reemplazo.

**Campos Firestore (turno original):** `status: 'INTERRUPTED'`, `checkOutTime`.  
**Nuevo turno:** copia del turno con empleado VACANTE, mismo objetivo/puesto/horario restante.

---

## 5. Cobertura (CoverageModal)

**Cuándo:** Hay una vacante (sin asignar) o una ausencia. Se abre desde "CUBRIR", o automáticamente después de "Marcar ausente" o "Baja anticipada (protocolo)".

**Objetivo del modal:** Asignar a alguien al puesto descubierto. Opciones (en orden sugerido):

### 5.1 Retención (Doble turno)
- Candidatos: guardias que **ya estaban en el mismo objetivo y mismo puesto** y tienen turno que termina dentro de 1 h del inicio de la vacante/ausencia.
- **Qué hace:** Actualiza el turno de la vacante/ausencia: `employeeId`, `employeeName`, `isUnassigned: false`, `status: 'PENDING'`, `assignmentType: 'RETENTION'`, `resolvedBy: 'OPERACIONES'`, `origin: 'OPERATIONS_COVERAGE'`.
- Bitácora: "Cobertura asignada" — Retención/Doble turno.

### 5.2 Intercambio (vecinos < 2 km)
- Candidatos: guardias **presentes en otros objetivos** a menos de 2 km, con al menos 2 guardias en ese objetivo (para no dejar descubierto).
- **Qué hace:** Misma actualización que retención con `assignmentType: 'SWAP'`.
- Bitácora: "Cobertura asignada" — Intercambio.

### 5.3 Sin turno asignado / Libres hoy
- Candidatos: empleados que **no tienen ningún turno ese día** (ni franco asignado).
- **Qué hace:** Asignación con `assignmentType: 'LIBRE'`.
- Bitácora: "Cobertura asignada" — Libre/Volante.

### 5.4 Volantes (por cercanía)
- Candidatos: mismos libres pero ordenados por distancia al objetivo (usa coords del empleado si existen).
- **Qué hace:** Asignación con `assignmentType: 'VOLANTE'`.
- Bitácora: "Cobertura asignada" — Volante.

### 5.5 Adelanto de turno
- Candidatos: **siguiente turno** en el mismo objetivo y mismo puesto que empieza después de ahora y antes del fin del turno descubierto.
- **Qué hace:**
  - Crea turno real en `turnos` si la vacante era virtual (V124_ / SLA_GAP).
  - Actualiza el turno del **siguiente guardia**: `startTime: now`, `originalStartTime`, `isEarlyStart: true`, `comments: 'Adelanto de Ingreso (Operaciones)'`.
  - Marca la vacante/ausencia como resuelta: `resolutionStatus: 'RESOLVED'`, `resolutionMethod: 'EARLY_START'`, `coveredByShiftId`, `resolvedBy: 'OPERACIONES'`.
- Bitácora: "Adelanto de turno".

### 5.6 Franco convocado (Franco trabajado)
- Candidatos: turnos de tipo **franco** del mismo día.
- **Qué hace:**
  - Crea turno real si era virtual.
  - Actualiza el turno del **franco**: `isFranco: false`, `isFrancoTrabajado: true`, `code: 'FT'`, tipo `EXTRA_FRANCO`, datos del objetivo/puesto/horario de la cobertura, `comments` indicando que cubre la vacante/ausencia, `resolvedBy`, `origin`, `coverageSourceId`.
  - Marca la vacante como resuelta: `resolutionStatus: 'RESOLVED'`, `resolutionMethod: 'FRANCO'`, `coveredByShiftId`, etc.
- Bitácora: "Franco convocado".

**Vacantes virtuales (V124_ / SLA_GAP):** Antes de asignar o adelantar, se llama a `ensureRealShiftId()`: si el shift es virtual, se crea un documento real en `turnos` con `employeeId: 'VACANTE'`, mismo objetivo/puesto/horario, `origin: 'OPERATIONS_MATERIALIZE'`, y se usa ese id para las actualizaciones.

---

## 6. Devolver a Planificación (handleReportPlanning)

**Cuándo:** Botón "DEVOLVER" en una vacante (no cubierta por operaciones). Atajo **D** con tarjeta seleccionada.

**Qué hace el sistema:**
- Si la vacante es **virtual** (id empieza con V124_ o SLA_GAP): crea un documento en `turnos` con los datos del turno (VACANTE, mismo objetivo/puesto/horario), `status: 'UNCOVERED_REPORTED'`, `isReported: true`, `origin` según tipo.
- Si la vacante ya es un **turno real**: actualiza ese turno con `status: 'UNCOVERED_REPORTED'`, `isReported: true`.
- Crea novedad en `novedades`: tipo `VACANTE_NO_CUBIERTA`, title "Vacante Reportada", cliente, objetivo, shiftId, descripción, `reportedBy: 'OPERACIONES'`, `status: 'pending'`, `priority: 'high'`.
- Bitácora (audit_logs): "Devolución a Planificación" con objetivo, puesto y detalle.

**Efecto:** La vacante deja de ser responsabilidad de operaciones y pasa a planificación para que asignen desde ahí.

---

## 7. Presente aprobado (solicitud desde empleado)

**Cuándo:** En "Novedades" aparece una solicitud de presente (CHECKIN_REQUEST). El operador aprueba.

**Qué hace el sistema:**
- Actualiza el turno en `turnos`: `status: 'PRESENT'`, `isPresent: true`, `isLate` (si llegó >5 min tarde), `checkInTime`, `checkInMethod: 'OPERATOR'`, `checkInOperator`, `checkInCoords` (si venían), `checkInRequestStatus: 'APPROVED'`.
- Actualiza la novedad: `status: 'RESUELTO'`, `resolution: 'APROBADO'`, `resolvedAt`, `resolvedBy`.
- Bitácora: "Presente aprobado" con shiftId.

---

## 8. Solicitud de presente rechazada

**Cuándo:** El operador rechaza la solicitud de presente.

**Qué hace el sistema:**
- Si hay `shiftId`: actualiza el turno con `checkInRequestStatus: 'REJECTED'`.
- Actualiza la novedad: `status: 'RECHAZADO'`, `resolution: 'RECHAZADO'`, `resolvedAt`, `resolvedBy`.
- Bitácora: "Solicitud rechazada" con shiftId.

---

## 9. Novedad vista (marcar como visto)

**Cuándo:** El operador marca una novedad como vista/recibida.

**Qué hace el sistema:**
- Actualiza la novedad en `novedades`: `status: 'RECEIVED'`, `receivedAt` (serverTimestamp).
- Bitácora: "Novedad vista" con tipo y descripción.

---

## 10. Franco trabajado (WorkedDayOffModal)

**Cuándo:** El operador abre el modal desde un turno de tipo franco (botón asociado a "Franco trabajado").

**Qué hace el sistema (resumen):** Permite vincular ese franco a una vacante/ausencia del día: selecciona la cobertura a cubrir, objetivo y puesto destino, y confirma. Se actualiza el turno franco (franco trabajado) y se resuelve la vacante/ausencia con método FRANCO / adelanto según la implementación del modal en `OperationalModals.tsx`. (Detalle fino depende de la versión actual del componente.)

---

## Resumen rápido (atajos y flujos)

| Acción           | Atajo / Origen        | Efecto principal                                                                 |
|------------------|------------------------|-----------------------------------------------------------------------------------|
| Dar presente     | P (ventana -15 a +60 min) | Turno → PRESENT, checkIn; opcional relevo de otro guardia                        |
| Salida           | Botón SALIDA           | Turno → COMPLETED, realEndTime, checkoutNote                                      |
| Marcar ausente   | A                      | Turno → ABSENT; abre Cobertura                                                    |
| Baja (cubierto)  | BAJA + hay compañeros  | Novedad BAJA_CUBIERTA; turno COMPLETED                                           |
| Baja (protocolo) | BAJA + solo en puesto  | Turno INTERRUPTED; nuevo turno VACANTE; abre Cobertura                            |
| Cobertura        | C (vacante) o tras ausencia/baja | Asignar por Retención / Intercambio / Libre / Volante / Adelanto / Franco        |
| Devolver         | D                      | Turno → UNCOVERED_REPORTED; novedad VACANTE_NO_CUBIERTA; bitácora                 |
| Presente aprobado / rechazado | Novedades           | Turno checkInRequestStatus; novedad RESUELTO/RECHAZADO                             |
| Novedad vista    | Novedades              | Novedad RECEIVED                                                                  |

---

## Mapas y objetivos

- Los **mapas** (vista Operaciones y mapa táctico) muestran solo objetivos que tengan **coordenadas** (`lat`/`lng`). Las coordenadas se normalizan desde la colección `clients`, campo `objetivos[]`, aceptando `lat`/`lng`, `latitude`/`longitude` o `coords`.
- Si no ves objetivos en el mapa: (1) Revisar que cada ítem en `clients.objetivos` tenga `lat` y `lng` (o variantes anteriores). (2) Revisar reglas Firestore para `clients` y `servicios_sla` (lectura para admins).
