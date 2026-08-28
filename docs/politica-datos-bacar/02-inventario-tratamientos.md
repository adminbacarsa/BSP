# Inventario de tratamientos de datos personales

**Bacar S.A.**  
**Versión:** 1.0 — borrador interno  
**Fecha:** 28/08/2026  
**Complementa:** `01-politica-proteccion-datos.md`

Este registro describe **qué se trata, para qué, con qué base, quién accede y cuánto se conserva**.  
Donde el hecho no está confirmado fuera de COSP se marca **`PENDIENTE`**. No se inventa.

Leyenda de base jurídica:

- **Contrato de trabajo / LCT / CCT** — necesario para la relación laboral
- **Obligación legal** — AFIP, ART, seguridad privada, requerimiento de autoridad
- **Contrato de servicio** — prestación al cliente
- **Consentimiento** — usos no estrictamente necesarios (foto de credencial más allá de identificación mínima; avisos no laborales)
- **Información + transferencia internacional** — hosting COSP en Google Cloud (EE.UU.)

Los plazos de conservación son **propuesta**. RRHH / Dirección deben tildarlos en el recuadro de la política marco.

---

## 1. Plantel y legajo

| Ítem | Detalle |
|------|---------|
| **Titulares** | Vigiladores y personal interno |
| **Datos** | Nombre y apellido, DNI, CUIL, legajo (`fileNumber`), teléfono, email, domicilio, coordenadas de domicilio (`lat`/`lng`), género, talle (camisa/pantalón/calzado), categoría, convenio (p. ej. SUVICO / CCT 422/05), tipo de contrato, fecha de ingreso, ciclo de liquidación, tope de horas, cliente/objetivo preferido, volante, restricciones a cliente/objetivo (con motivo), conflictos entre empleados (con motivo), foto de credencial, `uid` de Firebase Auth, estado activo/inactivo |
| **Sistema principal** | COSP — colección `empleados` |
| **Otros soportes** | Legajo papel / carpetas RRHH: `PENDIENTE`. Recibos, CBU, ART, preocupacional: `PENDIENTE` (no están en el alta COSP actual) |
| **Finalidad** | Identificar al trabajador, asignarlo a puestos, liquidar, contactarlo, emitir credencial, planificar cobertura |
| **Base** | Contrato de trabajo + LCT + CCT + obligaciones de seguridad privada |
| **Destinatarios internos** | RRHH, planificación, operaciones (subset: no salud), SuperAdmin |
| **Destinatarios externos** | Cliente: nombre y foto/credencial en el puesto, en la medida necesaria. AFIP/ART: `PENDIENTE` canales. Google Cloud: hosting |
| **Sensibles** | Género (dato personal; tratar con reserva). Salud y gremio **no** van en este registro salvo que se copien mal — no deben |
| **Conservación** | Vigencia + **10 años** (propuesta). En COSP la baja es lógica (`status: inactivo`); no se usa `deleteDoc` de legajo |
| **Observaciones** | La geocodificación del domicilio se usa para distancia al objetivo (viabilidad / planificación). No es rastreo en tiempo real |

## 2. Cuentas de acceso (COSP / portal)

| Ítem | Detalle |
|------|---------|
| **Titulares** | Empleados con portal, usuarios de panel (`system_users`), SuperAdmin |
| **Datos** | Email, UID Auth, rol, permisos por módulo, `empresaId`, flags de portal, `deviceId` en app (cuando exista) |
| **Sistema** | Firebase Auth + `system_users` / `empleados.uid` / `client_users` |
| **Finalidad** | Autenticación, autorización, activación de dispositivo |
| **Base** | Contrato de trabajo / contrato de servicio (usuario cliente, si aplica) |
| **Conservación** | Mientras la cuenta esté activa + **24 meses** de metadatos de acceso (propuesta) |
| **Observaciones** | Prohibido compartir usuarios. La desvinculación laboral debe **desactivar** Auth, no solo el legajo |

## 3. Turnos, planificación y operaciones

| Ítem | Detalle |
|------|---------|
| **Titulares** | Empleados asignados a objetivos |
| **Datos** | `employeeId`, nombre, objetivo, cliente, códigos de turno (M/T/N/D12/N12/RET/ESC/REF/F/FF/FP/FT), horarios planificados, origen (`RETEN`, `OPERATIONS_COVERAGE`, `SLA_VIRTUAL`, etc.), flags de presente/ausente/completado/franco/borrador, retención operativa, publicación de planificación (`planificacion_estados`) |
| **Sistema** | COSP — `turnos`, `planificacion_estados` |
| **Finalidad** | Cubrir el SLA, controlar la guardia, reportar horas |
| **Base** | Contrato de trabajo + contrato de servicio con el cliente |
| **Destinatarios** | Operaciones, planificación, reportes; el **portal del guardia** ve **sus** turnos |
| **Conservación** | Mínimo el plazo de reclamos de haberes / AFIP — alineado a liquidación (**10 años** propuesta) o el que fije RRHH para la malla |
| **Observaciones** | Los turnos operativos se muestran en operaciones aunque la malla no esté publicada. Los borradores (`draft`) no deben usarse como dato de presencia real |

## 4. Fichadas y geolocalización de marcación

| Ítem | Detalle |
|------|---------|
| **Titulares** | Vigiladores que marcan ingreso/egreso |
| **Datos** | Timestamp de check-in / check-out (`checkInTime`, `checkOutTime`, `realStartTime`, `realEndTime`), coordenadas de la marcación (`lat`/`lng`), distancia al objetivo, marcación remota si el objetivo lo permite, cola offline en el dispositivo |
| **Sistema** | COSP — callable `requestCheckIn`; portal web y futura app; Storage no aplica a la coordenada (va en el turno) |
| **Finalidad** | Verificar presencia **en el puesto** (radio ~80 m salvo check-in remoto autorizado). No es tracking continuo 24/7 |
| **Base** | Contrato de trabajo / poder de dirección. Debe **informarse** al ingreso (cláusula GPS en `05`). Consentimiento específico si se usara para otro fin (p. ej. recorrido permanente) |
| **Conservación** | **24 meses** con coordenada (propuesta); el hecho horario puede conservarse más, ligado a liquidación |
| **Observaciones** | El domicilio del empleado (`empleados.lat/lng`) es **otro** tratamiento: no confundir con la fichada. La app de guardia (Play Store) exigirá aviso público (F0-11); no está en esta etapa |

## 5. Ausencias, licencias y datos de salud / gremio

| Ítem | Detalle |
|------|---------|
| **Titulares** | Empleados |
| **Datos** | Tipo (V, L, E, A, PG, AA, SUS, SGS, MAVIC, etc.), fechas, `shiftId`, origen (`AUTO_T30`), adjuntos (certificado médico / constancia) en Storage `absences/{uid}/`, notas |
| **Sistema** | COSP — `ausencias`, `tipos_novedad`, `novedades` (alertas operativas) |
| **Finalidad** | Administrar inasistencias, cubrir el puesto, cumplir CCT y ART |
| **Base** | LCT / CCT / ART. El **diagnóstico** no es necesario para operación: basta el tipo y el período |
| **Sensibles** | **Sí** — E, A, certificados; **PG** (afiliación/actividad gremial) |
| **Destinatarios** | RRHH (completo). Operaciones: puede ver que hay ausencia/vacante, **no** el PDF médico. Gemini: **prohibido** el contenido clínico |
| **Conservación** | **10 años** (propuesta ART / reclamos) |
| **Observaciones** | AUTO_T30 es ausencia generada por el sistema (no presentación). Kill switch `centroControlEnabled` corta esa generación por empresa; no borra histórico |

## 6. Credencial digital y foto

| Ítem | Detalle |
|------|---------|
| **Titulares** | Empleados con credencial |
| **Datos** | Foto, DNI, CUIL, legajo, nombre, QR / código temporal |
| **Sistema** | COSP — Storage `credenciales/{empDocId}/foto.png` (y `foto_sb.png`), campos en `empleados` |
| **Finalidad** | Identificación ante el cliente / supervisión en el objetivo |
| **Base** | Contrato de trabajo + obligación de identificarse en el servicio. Consentimiento informado para captura y archivo de imagen (cláusula en `05`) |
| **Conservación** | Mientras el empleado esté activo; al cese, retirar credencial visible. Archivo: alineado al legajo |
| **Observaciones** | No usar la foto para reconocimiento facial automatizado sin nueva decisión y base jurídica |

## 7. Clientes, objetivos y contratos (CRM)

| Ítem | Detalle |
|------|---------|
| **Titulares** | Contactos de clientes (personas humanas); representantes |
| **Datos de persona jurídica** | Razón social, CUIT, domicilio fiscal, condición AFIP, objetivos (dirección, GPS del puesto), SLA, puestos, cantidades |
| **Datos de personas** | Nombres de referentes, teléfonos, mails — `PENDIENTE` confirmar campos reales en fichas |
| **Sistema** | COSP — `clients` (objetivos embebidos), `servicios_sla`, `contratos_servicio`, `hours_balances` |
| **Origen AFIP** | Callable `lookupClientByCuit` (WSAA + padrón Constancia de Inscripción). Credenciales por empresa en `empresa_afip_credentials/{empresaId}` (solo Admin SDK) |
| **Finalidad** | Contratar, facturar, dimensionar el servicio, autocompletar CUIT |
| **Base** | Contrato de servicio + obligación legal (AFIP). El padrón AFIP se usa para **calidad** del dato fiscal, no para perfilar personas ajenas al cliente |
| **Conservación** | Contrato + **10 años** |
| **Observaciones** | Soft delete de clientes en política COSP: `status: INACTIVE`. Hoy el código CRM puede usar `deleteDoc` en algunos flujos: **no implica** borrar turnos/SLA en cascada; cualquier limpieza debe ser explícita. Ajustar práctica a esta política |

## 8. Liquidación de horas y reportes

| Ítem | Detalle |
|------|---------|
| **Titulares** | Empleados |
| **Datos** | Horas planificadas vs fichadas, diurnas/nocturnas, FT, feriados, importación de marcaciones, modo publicado `payroll_settings.hoursMode` |
| **Sistema** | COSP — módulo Reportes; endpoint de liquidación; `hours_balances` |
| **Destinatarios externos** | Estudio / sistema de nómina: `PENDIENTE` identificar el encargado y el contrato de tratamiento |
| **Finalidad** | Pagar haberes y cumplir CCT |
| **Base** | Contrato de trabajo + obligación legal |
| **Conservación** | **10 años** |
| **Observaciones** | El endpoint entrega horas, no necesariamente CBU. CBU/banco: `PENDIENTE` dónde viven |

## 9. Asistente IA y ajuste fino de planificación (Gemini)

| Ítem | Detalle |
|------|---------|
| **Titulares** | Empleados cuyos nombres/legajos/turnos se consultan; usuarios que chatean |
| **Datos enviados al modelo** | Preguntas del usuario; resultados de herramientas de **solo lectura**: listados de empleados (nombre/id), turnos, resúmenes de horas y presencias, conteos de SLA/plantilla. En ajuste fino: contexto de planificación (empleados, asignaciones, estadísticas) |
| **Qué no debe enviarse** | Certificados médicos, DNI/CUIL salvo que una herramienta ya los exponga (evitar), CBU, conversaciones WhatsApp, fotos |
| **Sistema** | Callables `chatPlatformAssistant`, `optimizePlanningGemini`; secreto `GEMINI_API_KEY` en servidor |
| **Encargado** | Google (Gemini) |
| **Finalidad** | Asistencia operativa al usuario autorizado; corrección puntual de malla (no regenerar el mes) |
| **Base** | Interés en la operación + información al personal de que hay IA. No sustituye decisiones de RRHH sobre salud/gremio |
| **Portal empleado** | Solo turnos **propios** |
| **Conservación** | El hilo del globo es **solo en memoria** de sesión (no se persiste el chat). Logs de Functions: `PENDIENTE` plazo de Cloud Logging |
| **Transferencia** | Estados Unidos / infraestructura Google — ver política §9 |

## 10. Análisis operativo (snapshot en memoria)

| Ítem | Detalle |
|------|---------|
| **Datos** | SLA, empleados, geo, tipos de novedad, turnos y ausencias (ventana: mes en curso + 3 meses atrás, ampliable) |
| **Finalidad** | Informe de cobertura/capacidad/horas-hombre **sin precios** |
| **Base** | Misma que turnos + clientes |
| **Observaciones** | No crea una base nueva: es un recorte en memoria del front. Sigue siendo tratamiento |

## 11. Auditoría y notificaciones

| Ítem | Detalle |
|------|---------|
| **Datos** | `audit_logs` (quién cambió qué), `user_notifications`, tokens FCM (app) |
| **Finalidad** | Trazabilidad, avisos operativos (llegada tarde, vacantes, eventos EV) |
| **Base** | Seguridad de la información + contrato de trabajo |
| **Conservación** | Logs **24 meses** (propuesta) |

## 12. Postulantes

| Ítem | Detalle |
|------|---------|
| **Estado** | **`PENDIENTE`** — no hay módulo ATS en COSP |
| **Preguntas** | ¿Se reciben CV por mail/WhatsApp? ¿Quién los guarda? ¿Plazo? |
| **Propuesta si existen** | Datos mínimos; **12 meses** si no ingresa; no ceder a clientes |

## 13. Legajo papel, ART, bancos, preocupacional

| Ítem | Detalle |
|------|---------|
| **Estado** | **`PENDIENTE`** |
| **Preguntas** | Ubicación de carpetas; quién tiene llave; CBU; exámenes preocupacionales; altas ART; copias de DNI |
| **Hasta confirmar** | Se asume que **existen** en RRHH aunque no estén en COSP. Mismos principios: mínimo necesario, acceso restringido, no WhatsApp |

## 14. Comunicaciones operativas (WhatsApp, radio, mail)

| Ítem | Detalle |
|------|---------|
| **Estado** | **`PENDIENTE`** inventario de grupos y administradores |
| **Riesgo** | Reenviar fotos de certificados, listas de DNI, domicilios |
| **Regla inmediata** | WhatsApp **no** es legajo. Solo mensajes operativos (cobertura, llegada). Sin planillas de plantel |

## 15. Videovigilancia en objetivos

| Ítem | Detalle |
|------|---------|
| **Estado** | **`PENDIENTE`** — ¿cámaras propias de Bacar o del cliente? |
| **Si son del cliente** | Bacar es, en principio, **usuario** del sistema del cliente; el cliente es responsable de esa base. El personal de Bacar no extrae ni se lleva grabaciones |
| **Si son de Bacar** | Hay que cartelería, plazo corto (p. ej. 30 días), responsable e inventario propio |
| **Finalidad típica** | Seguridad del objetivo, no control disciplinario encubierto del plantel (si se usa para eso, hay que informarlo) |

## 16. Contabilidad, AFIP empresa, bancos

| Ítem | Detalle |
|------|---------|
| **Estado** | **`PENDIENTE`** sistema contable y tesorería |
| **Datos** | CUIT de la Empresa, proveedores, pagos a empleados |
| **Base** | Obligación legal |
| **Conservación** | Plazos AFIP (habitualmente **10 años**) |

## 17. Dispositivos, backups y copias locales

| Ítem | Detalle |
|------|---------|
| **Notebooks / lab** | PCs de desarrollo y N8N (`192.168.0.8`) con emuladores — **no** son producción, pero pueden tener seeds y a veces datos reales si alguien apunta mal el `.env` |
| **Regla** | Producción = Firebase proyecto `comtroldata`. Emulador local **no** debe cargarse con plantel real de clientes |
| **Backups Firestore** | `PENDIENTE` confirmar si hay exportación programada y quién accede |
| **Pendrives / Excel** | Prohibidos para plantel completo salvo autorización puntual y destrucción posterior |

## 18. Mapa resumen (responsable siempre: Bacar S.A.)

| # | Tratamiento | Sistema | Sensible | Transferencia exterior |
|---|-------------|---------|----------|------------------------|
| 1 | Legajo | COSP + papel `PENDIENTE` | Género; resto no | Google |
| 2 | Cuentas | Firebase Auth | No | Google |
| 3 | Turnos | COSP | No (salvo código E/PG en celda) | Google |
| 4 | Fichada GPS | COSP / dispositivo | Ubicación puntual | Google |
| 5 | Ausencias / salud / gremio | COSP Storage | **Sí** | Google |
| 6 | Credencial / foto | COSP Storage | Imagen | Google |
| 7 | Clientes / AFIP | COSP + AFIP | No (contactos: sí personales) | Google + AFIP AR |
| 8 | Liquidación | COSP + `PENDIENTE` | No | Según encargado |
| 9 | Gemini | Functions | Evitar sensibles | Google |
| 10–17 | Papel, WhatsApp, cámaras, banco, CV | `PENDIENTE` | Según caso | Según caso |

## 19. Huecos a cerrar con RRHH / Dirección

1. CUIT, domicilio, mail `{{mail_datos}}`, nombre del responsable de la base
2. Dónde están CBU, recibos, ART, preocupacionales
3. Existencia y dueño de cámaras
4. Grupos WhatsApp: inventario y regla de oro comunicada
5. Encargado de liquidación (estudio / software) y contrato
6. Postulantes: flujo de CV
7. Copias de seguridad de Firestore y de file servers
8. Decisión AAIP (inscripción)
9. Confirmación de plazos de GPS (24 meses) y de malla histórica
