# Contrato marco y anexo por convocatoria

Mauro lo pidió para pasárselo al abogado. Describe cómo funciona hoy y la pregunta que hay que contestar.

## Cómo funciona

1. **Contrato marco, una vez por empresa.** Cada empresa del grupo (hoy bacarsa y grupos_bacar_sa; el cotejo incluye también pruebas_sa) tiene su propio marco con esa persona. No es un contrato por jornada.
2. **Se firma en papel**, como el modelo de Bacar del 14/08/2026. COSP genera el PDF con lo que no cambia: modalidad eventual (arts. 99 y 100 LCT), tareas de seguridad y vigilancia, remuneración según la escala vigente del CCT 422/05 (no un monto fijo), puntualidad, reserva, normas internas, domicilios y jurisdicción de Córdoba. RRHH lo imprime, lo hace firmar y sube el escaneo. Queda `MARCO_VIGENTE` hasta el vencimiento (un año desde la firma, configurable). Sin escaneo es `SIN_MARCO`. Pasada la fecha es `VENCIDO`.
3. **Cláusula nueva del marco.** Cada convocatoria que el trabajador acepte en la aplicación COSP es un anexo de ese marco. El anexo dice la causa, las jornadas, los horarios, el lugar y la remuneración de esa convocatoria. La aceptación con código de verificación vale como conformidad expresa de ese anexo.
4. **Sin marco vigente no se lo convoca.** En Planificación, Eventos y el Centro de Comando se lo ve deshabilitado, con el motivo «Sin contrato marco». Treinta días antes del vencimiento RRHH recibe el aviso `MARCO_POR_VENCER` (Configuración → Avisos).
5. **El anexo nace al aceptar en la app.** El servidor arma el PDF del anexo y una constancia: usuario, código verificado, fecha y hora del servidor, hash SHA-256 del anexo, dispositivo, IP y ubicación si el teléfono la manda. El código es de un solo uso y vence a los 15 minutos. No sale por WhatsApp (no está integrado). Canales: push FCM al dispositivo, con el código en el aviso y en la bandeja de Alertas (`user_notifications` tipo `CODIGO_ANEXO`), y mail por el SMTP de Gmail que ya usa el portal (`nodemailer`, `smtp.gmail.com:465`, variables `GMAIL_USER` y `GMAIL_PASS`, las mismas de `createPortalAccess` y `createClientPortalAccess`). Si no hay token ni mail, responde `SIN_CANAL` y la pantalla pide contactar a RRHH.
6. **Dónde se guarda.** La raíz es `config/eventuales.driveRootFolderId` (default la carpeta que dio Mauro). Si esa carpeta ya se llama `Eventuales` se usa directa; si no, se crea `Eventuales` adentro. Después, una carpeta por persona: `Legajo {nro} - {APELLIDO, Nombre} - {CUIL}`, o `{CUIL} - {Nombre}` hasta que tenga legajo. Los archivos llevan la empresa adelante: `{Empresa}-Marco-{fecha}.pdf`, `{Empresa}-Anexo-{fecha}-{lugar}.pdf`, `{Empresa}-ARCA-{fecha}.pdf`. Se suben desde RRHH → Eventuales. La cuenta `comtroldata@appspot.gserviceaccount.com` tiene que ser Editora de esa carpeta. Sin permiso, el archivo queda en Storage con `drivePendiente`.

## Contrato para la app

- `pedirCodigoAnexoEventual({ contratoId | convocatoriaId })`. Lo pide el eventual logueado. Respuesta: `{ canales: ['PUSH'|'MAIL'], venceMs, mensaje }`. El mensaje es «Te enviamos un código de 6 dígitos a tu app y a tu mail terminado en …» (solo los canales que salieron). El código no vuelve en la respuesta: va en el push, en Alertas y en el mail. Sin token y sin mail: error `SIN_CANAL`, mensaje «No pudimos enviarte el código. Contactá a RRHH.»
- `confirmarAnexoEventual({ contratoId | convocatoriaId, codigo, dispositivo?, ubicacion? })`. Si el código cierra, responde `{ ok, hashAnexo, link }`. Si no: `CODIGO_INVALIDO`, `CODIGO_USADO` o `CODIGO_VENCIDO`.

## Pregunta para el abogado

¿Tiene valor de conformidad expresa, para cada convocatoria, el anexo aceptado en la aplicación con un código de un solo uso (push a la app y mail), hash del PDF y constancia de fecha, usuario, dispositivo e IP, cuando el contrato marco se firmó una sola vez en papel y la cláusula séptima dice que esa aceptación integra el marco?

Queda pendiente, a propósito, reemplazar la firma en papel del marco por Firma CiDi. Este esquema no lo hace.
