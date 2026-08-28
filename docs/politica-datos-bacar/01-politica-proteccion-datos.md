# Política de Protección de Datos Personales

**Bacar S.A.**  
**Versión:** 1.0 — borrador interno  
**Fecha:** 28/08/2026  
**Estado:** pendiente de revisión Legal / RRHH / Dirección  
**Clasificación:** uso interno

> Este documento es la política marco de la empresa. No sustituye el asesoramiento de un abogado laboral o de protección de datos. Debe revisarse antes de inscribir bases en la AAIP, publicarla a clientes o usarla como aviso de Google Play.

---

## 0. Datos a completar antes de firmar

| Campo | Valor |
|-------|--------|
| Razón social | Bacar S.A. |
| CUIT | `{{CUIT}}` |
| Domicilio legal | `{{domicilio}}` |
| Responsable de la/s base/s de datos | `{{responsable}}` (cargo y nombre) |
| Canal de ejercicio de derechos | `{{mail_datos}}` |
| Referente técnico (sistemas) | Mauro Martinez — IT Leader |
| Referente RRHH | `{{responsable_rrhh}}` |

**Checklist de cierre (Dirección / RRHH):**

- [ ] CUIT, domicilio y mail de contacto cargados
- [ ] Designado el responsable de la/s base/s (no puede quedar vacío)
- [ ] RRHH aceptó los plazos de conservación del inventario (`02`)
- [ ] Decisión: inscribir o no las bases ante la AAIP (ver §11)
- [ ] Revisión legal del texto y de las cláusulas modelo (`05`)
- [ ] Comunicación interna al personal que trata datos

---

## 1. Objeto

Esta política establece cómo **Bacar S.A.** (en adelante, “la Empresa”) recolecta, almacena, usa, cede y destruye **datos personales** en el marco de su actividad de **seguridad privada** y de la gestión de su personal, clientes y proveedores.

Aplica a todos los tratamientos, estén o no informatizados: COSP (CronoApp), correo, planillas, legajos papel, dispositivos, radios, mensajería y cualquier otro medio que la Empresa utilice.

## 2. Marco normativo

- Constitución Nacional, art. 43 (habeas data)
- Ley 25.326 de Protección de Datos Personales y Decreto 1558/01
- Disposiciones y criterios de la **AAIP** (Agencia de Acceso a la Información Pública)
- Ley de Contrato de Trabajo (LCT) y normativa de seguridad social / AFIP / ART
- CCT 422/05 (vigiladores) y demás convenios aplicables al plantel
- Ley 26.351 y normativa provincial de seguridad privada, en lo que corresponda a habilitación y control de personal

Cuando un tratamiento tenga base en una **obligación legal** o en el **contrato de trabajo**, no se sustituye esa base por un “acepto” genérico de consentimiento.

## 3. Definiciones operativas

| Término | Significado en esta política |
|---------|------------------------------|
| **Dato personal** | Información de cualquier tipo referida a personas físicas determinadas o determinables (DNI, CUIL, foto, domicilio, GPS, teléfono, legajo, etc.) |
| **Dato sensible** | Salud, discapacidad, vida sexual, origen racial/étnico, opiniones políticas, **afiliación gremial**, creencias religiosas, y todo dato que pueda originar discriminación. Incluye certificados médicos, ART y permiso gremial (PG) |
| **Titular** | La persona a quien se refieren los datos |
| **Responsable de la base** | Bacar S.A., a través de la persona designada en el recuadro de §0 |
| **Usuario / encargado interno** | Empleado o contratista de la Empresa que accede a datos por su función |
| **Encargado externo** | Tercero que trata datos por cuenta de la Empresa (p. ej. Google Cloud / Firebase, estudio de liquidación) |
| **Tratamiento** | Cualquier operación: recolectar, grabar, conservar, usar, ceder, bloquear o destruir |

## 4. Ámbito subjetivo

La política cubre datos de:

1. **Personal en relación de dependencia** (vigiladores y personal administrativo / supervisión)
2. **Postulantes** a empleo
3. **Ex empleados**, en la medida de las obligaciones de conservación
4. **Clientes** personas humanas y **contactos** de clientes personas jurídicas (referentes, jefes de seguridad, facturación)
5. **Usuarios de COSP** (cuentas de panel, portal empleado, SuperAdmin)
6. **Visitantes o terceros** registrados en un objetivo, **si** ese registro existe — hoy: `PENDIENTE` de confirmar
7. **Proveedores** personas humanas (CUIT/CUIL, contacto) — `PENDIENTE` de inventario

No cubre secretos comerciales del cliente que no identifiquen personas (p. ej. un plano sin nombres). Si un dato del cliente identifica a una persona, sí aplica.

## 5. Principios (Ley 25.326)

1. **Licitud.** Solo se tratan datos con base jurídica: ley, contrato de trabajo, contrato de servicio con el cliente, consentimiento cuando corresponda, o interés legítimo compatible con la función de seguridad (p. ej. control de presencia en el puesto).
2. **Finalidad.** Cada dato se usa para el fin declarado en el inventario (`02`). Está prohibido usar el plantel, GPS o fotos para fines ajenos (marketing no laboral, reventa, “por las dudas”).
3. **Calidad.** Datos exactos, actualizados y no excesivos. RRHH y operación corrigen errores apenas se detectan.
4. **Seguridad.** Medidas técnicas y organizativas proporcionales al riesgo (ver §9).
5. **Confidencialidad.** Quien accede por función no puede divulgar ni reutilizar. El deber sobrevive al cese de la relación.
6. **Consentimiento informado**, cuando la ley lo exige (p. ej. usos no laborales de la foto, o tratamientos no necesarios para el contrato). El consentimiento debe ser libre, expreso e informado; no se “esconde” en un reglamento ilegible.

## 6. Finalidades corporativas

La Empresa trata datos personales para:

| Finalidad | Ejemplos |
|-----------|----------|
| Gestión laboral | Legajo, CCT, categoría, francos, licencias, liquidación de haberes |
| Operación de seguridad | Asignación a objetivos, cobertura de vacantes, control de presencia, novedades |
| Cumplimiento legal | AFIP, ART, registro de seguridad privada, requerimientos de autoridad competente |
| Relación comercial | Contratos, SLA, facturación, CUIT de clientes |
| Seguridad de la información | Cuentas, logs de acceso, auditoría de cambios en COSP |
| Mejora operativa | Reportes de horas, análisis de cobertura, planificación |

Queda **prohibido**:

- Usar datos de salud, ART o afiliación gremial para **automatizar** planificación o para **Gemini / asistente IA**
- Geocodificar el domicilio del empleado para fines ajenos a la asignación de puestos / viabilidad de cobertura
- Extraer el plantel a Excel personal, WhatsApp o pendrive sin autorización de `{{responsable}}` o IT
- Publicar fotos de credencial o de certificados fuera de los canales oficiales

## 7. Datos sensibles

Se tratan **solo** cuando son indispensables para:

- Licencias por enfermedad y ART (código E / A y adjuntos)
- Permiso gremial (PG)
- Habilitación / aptitud cuando la norma de seguridad privada o el cliente lo exijan (`PENDIENTE` confirmar qué se archiva en papel)

**Reglas:**

1. Acceso restringido a RRHH y a perfiles COSP con módulo RRHH (no a operación de piso ni a clientes).
2. Los certificados médicos se almacenan en Storage de Firebase (`ausencias/{uid}/` u homólogo) o en carpeta RRHH papel; no se reenvían por WhatsApp.
3. El asistente virtual y el ajuste fino de planificación **no** deben recibir el contenido de certificados ni diagnósticos.
4. La foto de credencial se usa para **identificación en el puesto**, no como sistema biométrico de control de acceso, salvo decisión expresa posterior y nueva base jurídica.

## 8. Encargados y cesiones

### 8.1 Encargados conocidos (sistemas)

| Encargado | Rol | Ubicación típica |
|-----------|-----|------------------|
| Google LLC (Firebase / Google Cloud) | Hosting de COSP: Auth, Firestore, Storage, Functions | Estados Unidos (`us-central1` en Functions) |
| Google LLC (Gemini) | Asistente operativo y ajuste fino de planificación; invocación **en servidor** con secreto `GEMINI_API_KEY` | Tratamiento en infraestructura Google |
| AFIP | Constancia de inscripción / WSAA para autocompletar clientes por CUIT; obligaciones fiscales | Argentina |
| Estudio / sistema de liquidación | `PENDIENTE` — endpoint de horas planificadas o fichadas | `PENDIENTE` |
| Aseguradora de riesgos del trabajo | Siniestros, exámenes — `PENDIENTE` confirmar ART | Argentina |
| Mutual / SUVICO (MAVIC) | Capacitación gremial — dato de licencia, no necesariamente cesión de legajo completo | Argentina |

### 8.2 Cesiones

La Empresa puede ceder datos cuando:

- Lo exige una **autoridad competente** (AFIP, policía, justicia, autoridad de seguridad privada)
- Es **necesario para el contrato** con el cliente (p. ej. nombre y credencial del vigilador asignado al objetivo), en la medida estrictamente indispensable
- Hay **consentimiento** del titular
- Lo prevé una ley

El cliente **no** recibe DNI/CUIL/domicilio/salud del plantel salvo obligación legal o cláusula contractual revisada.

Detalle de sistemas: `03-anexo-sistemas.md`.

## 9. Transferencias internacionales

COSP se aloja en **Firebase / Google Cloud**. Las Functions de producción operan en **`us-central1`**. Ello implica **transferencia de datos personales a Estados Unidos**.

**Justificación:** no existe hoy un hosting equivalente en Argentina para el stack en producción; el servicio es necesario para la operación (turnos, fichadas, portal).

**Medidas:**

- Autenticación Firebase Auth; acceso por roles y `empresaId`
- Reglas de Firestore; secretos (Gemini, AFIP) en servidor, no en el bundle del front
- Gemini no se invoca desde el navegador con API key pública
- Prohibido sincronizar bases de COSP a nubes personales (Drive/Gmail no corporativos, Dropbox, etc.)

Los titulares (empleados y, cuando aplique, contactos de clientes) deben ser **informados** de esta transferencia (cláusulas en `05`). El consentimiento o la información se documenta en el ingreso de personal y, a futuro, en el aviso público.

## 10. Conservación

Los plazos detallados están en el inventario (`02`). Criterio general:

| Categoría | Criterio (propuesta a validar por RRHH) |
|-----------|------------------------------------------|
| Legajo laboral | Vigencia de la relación **+ 10 años** (seguridad social / AFIP / eventuales reclamos) |
| Recibos, liquidación, CBU | **10 años** |
| Fichadas y coordenadas GPS de marcación | **24 meses** operativos; luego se puede conservar el hecho de la fichada (hora) sin coordenada, o el plazo que fije RRHH |
| Certificados médicos / ART | Vigencia + plazo de prescripción de reclamos ART — propuesta **10 años** |
| Datos de postulantes no ingresados | **12 meses** desde la postulación |
| Clientes / contratos / CUIT | Vigencia del contrato **+ 10 años** (AFIP) |
| Logs de auditoría COSP | **24 meses**, salvo investigación abierta |
| Video vigilancia | `PENDIENTE` — si existe, plazo corto (p. ej. 30 días) salvo incidente |

La **baja lógica** en COSP (`status: INACTIVE` en empleados/clientes) **no** es destrucción. La destrucción o anonimización se programa cuando vence el plazo.

## 11. Inscripción de bases (AAIP)

La Ley 25.326 prevé el registro de bases de datos. El régimen de inscripción ha tenido cambios de implementación.

**Decisión pendiente de Dirección:**

- [ ] Consultar con letrado si corresponde inscribir las bases (plantel, clientes, postulantes, videovigilancia) ante la AAIP
- [ ] Si se inscribe: usar este inventario (`02`) como insumo
- [ ] Si no se inscribe aún: dejar constancia de la decisión y fecha de revisión

Esta política **no** constituye por sí sola la inscripción.

## 12. Derechos de los titulares

Toda persona puede solicitar, respecto de sus datos:

- **Acceso** (conocer qué datos tiene la Empresa)
- **Rectificación** (corregir inexactitudes)
- **Actualización**
- **Supresión o bloqueo**, cuando los datos no sean necesarios o se hayan tratado en infracción a la ley — **salvo** que exista obligación legal de conservarlos (legajo, AFIP, causa judicial, investigación interna abierta)

Canal: `{{mail_datos}}`.  
Procedimiento y plazos: `04-procedimiento-derechos-e-incidentes.md`.

El habeas data judicial (art. 43 CN y Ley 25.326) permanece disponible. No se exige patrocinio letrado para el trámite interno.

## 13. Incidentes de seguridad

Se considera incidente, entre otros:

- Pérdida o robo de celular / notebook con acceso a COSP o Excel de plantel
- Envío de planilla de DNI/CUIL a destinatario equivocado
- Cuenta Google o Firebase comprometida
- Publicación de fotos de credencial o certificados
- Acceso de un usuario a una empresa / objetivo que no le corresponde

**Plazo interno:** quien detecta el hecho avisa a IT y a `{{responsable}}` **en el día**; clasificación en **72 horas corridas**.  
Si hay riesgo relevante para los titulares, se les informa y se evalúa denuncia a AAIP / autoridad competente.

Procedimiento: documento `04`.

## 14. Deberes del personal

Todo usuario de datos (panel COSP, RRHH, supervisión, administración) debe:

1. Usar solo la cuenta asignada; no compartir contraseñas
2. Acceder únicamente a lo necesario para su función
3. No exportar planteles ni reportes a canales no oficiales
4. Bloquear la sesión al ausentarse
5. Reportar incidentes de inmediato
6. Devolver o borrar copias locales al cesar la función

El incumplimiento es falta grave y puede dar lugar a sanciones laborales, sin perjuicio de responsabilidades civiles o penales.

## 15. Roles internos

| Rol | Responsabilidad |
|-----|-----------------|
| **Dirección** | Aprueba esta política; destina recursos |
| **Responsable de la base** (`{{responsable}}`) | Cumplimiento Ley 25.326; punto de contacto AAIP y titulares |
| **RRHH** | Calidad del legajo; plazos; datos sensibles; respuesta de derechos del personal |
| **IT Leader** | Medidas técnicas COSP/Firebase; altas/bajas de usuarios; incidentes técnicos |
| **Jefatura de operaciones** | Uso correcto de COSP en piso; no difundir datos de guardias a terceros no autorizados |
| **Comercial / administración** | Datos de clientes y facturación |

## 16. Relación con COSP

COSP es **un medio** de tratamiento, no el responsable. El responsable es siempre **Bacar S.A.**

El detalle de colecciones, GPS, fotos, AFIP y Gemini está en `03-anexo-sistemas.md`. Cualquier módulo nuevo que trate datos personales (app de guardia, portal público, integraciones) debe actualizar el inventario **antes** de usarse en producción.

## 17. Vigencia y revisión

- Entra en vigencia el día de la firma de Dirección.
- Revisión **al menos anual**, o antes si cambia el sistema, un encargado relevante (p. ej. otro cloud) o la ley.
- Versiones anteriores se archivan; no se reescriben en silencio.

## 18. Documentos asociados

| Código | Documento |
|--------|-----------|
| 02 | Inventario de tratamientos |
| 03 | Anexo de sistemas |
| 04 | Procedimiento de derechos e incidentes |
| 05 | Cláusulas modelo |

---

**Firma (cuando se apruebe)**

| | Nombre | Firma | Fecha |
|---|--------|-------|-------|
| Dirección | | | |
| Responsable de la base | | | |
| RRHH | | | |
| IT Leader | Mauro Martinez | | |
