# COSP Guardia — producción en Google Play

Package: `com.cosp.guardia` (no cambiar). Version name de este binario: **1.2.0**. El `versionCode` lo incrementa EAS (`autoIncrement`, fuente remota; el internal actual está en versionCode 2, el próximo build de production pasa a **3**).

No se subió nada a Play ni se lanzó OTA en esta tarea.

## Build (lo corre Mauro, no el agente)

Desde `apps/mobile-guardia`, con la cuenta EAS `cosp-guardia`:

```text
npx eas-cli build --platform android --profile production
```

Eso genera el **AAB** (`buildType: app-bundle`), con `EXPO_PUBLIC_USE_EMULATOR=false` y `autoIncrement`. No usa `eas submit`.

Cuando el AAB esté en Play y quieras que el servidor pida el sonido nuevo (canal `alertas_turno_v2`), desplegá Functions. Hasta ese deploy el server sigue mandando `alertas_turno` (sonido default). El binario crea los dos canales.

```text
firebase deploy --only functions:onEmployeeNotificationCreated,functions:scheduledArrivalNotices
```

El seguimiento del convocado usa el mismo helper: si vive en otra función exportada, incluila en ese deploy o desplegá `functions` completo.

Submit, solo cuando Mauro lo pida, con el AAB ya buildeado:

```text
npx eas-cli submit --platform android --profile production --latest
```

## Sonido de alertas (va en el binario, no en un OTA)

- Archivo: `apps/mobile-guardia/assets/sounds/alertas_turno.wav` (lo copia el plugin `expo-notifications`).
- Canal nuevo: `alertas_turno_v2`, importancia MAX, usage ALARM, sonido `alertas_turno`.
- Canal viejo `alertas_turno`: se sigue creando con sonido default. Android no cambia el sonido de un canal ya instalado.
- iOS (sin build hoy): entitlement `time-sensitive` ya está en `app.config.ts`; el payload APNs manda `sound: alertas_turno.wav` e `interruption-level: time-sensitive`. Hay que tener el entitlement aprobado en la cuenta de Apple el día que haya build iOS.
- Teléfonos con el binario anterior: FCM, si no encuentra `alertas_turno_v2`, muestra el aviso en el canal `default`. No se pierden. El sonido propio aparece al instalar este AAB y desplegar Functions.

## Permisos del manifest

Se usan: ubicación precisa y aproximada **solo en primer plano** (fichada y ETA al aceptar; `getCurrentPositionAsync`), cámara, notificaciones, vibrar.

No se usa ubicación en segundo plano. `ACCESS_BACKGROUND_LOCATION` está bloqueado, igual que `RECEIVE_BOOT_COMPLETED` (no hay alarmas locales al reiniciar; FCM no lo necesita), micrófono y superposición.

## Política de privacidad

Página: `apps/web2/src/pages/privacidad/index.tsx`. URL pública (después del deploy de hosting):

https://comtroldata.web.app/privacidad/

`firebase.json` reescribe `/privacidad` antes del catch-all del panel. En la app: Más → Privacidad. **Hay que desplegar hosting** para que Play pueda abrir la URL. No se desplegó en esta tarea.

## Checklist Play Console

1. Crear la app con package `com.cosp.guardia` si todavía no está, o abrir la existente.
2. Subir el AAB al track que corresponda (closed testing primero si la cuenta es personal).
3. **Política de privacidad:** `https://comtroldata.web.app/privacidad/`
4. **Acceso a la app:** restringida. Instrucciones y usuario de abajo.
5. **Anuncios:** No.
6. **Público objetivo:** 18 años o más. No es para niños. No es “hecha para niños”.
7. **Clasificación de contenido (IARC):** responder No a violencia, sexo, lenguaje vulgar, sustancias, apuestas, compras. Categoría de tienda: Productividad o Negocios.
8. **Gobierno / finanzas / salud:** No. Los certificados médicos son adjuntos laborales, no una app médica.
9. **Seguridad de los datos:** copiar el bloque de abajo.
10. **Ubicación:** declarar ubicación precisa, solo en primer plano, no en background. El formulario de permisos debe coincidir: no marcar background location.
11. **Ficha:** textos y capturas de abajo. Ícono 512×512. Gráfico de funciones 1024×500.
12. **Firma:** copiar el SHA-256 de Play App Signing a `assetlinks.json` cuando se quiera el App Link de activación (no bloquea la revisión).
13. Países, ficha en español (Argentina), mail de contacto `admin@bacarsa.com.ar`.

### Cuenta personal: 12 testers × 14 días

Si la cuenta de Play Console es **personal** (creada después de noviembre 2023), Google exige un closed test con **al menos 12 testers que hayan aceptado y permanezcan opted-in 14 días seguidos** antes de habilitar producción. Una cuenta de organización puede no tener ese requisito. El internal testing que ya existe no reemplaza ese closed test.

## Seguridad de los datos (copiar)

| Pregunta | Respuesta |
|----------|-----------|
| ¿Se recopilan datos? | Sí |
| ¿Se comparten con terceros? | No se venden ni se comparten para publicidad. El procesador es Google Firebase (Auth, Firestore, Storage, FCM). |
| ¿Se cifran en tránsito? | Sí (HTTPS/TLS) |
| ¿El usuario puede pedir que se eliminen? | Sí. Pedido a admin@bacarsa.com.ar o RRHH. Los registros laborales se conservan el plazo legal de prescripción; el token push se borra al cerrar sesión. |
| Ubicación precisa | Sí. Recolectada. No compartida. Finalidad: funcionalidad de la app (fichada en el puesto y ETA al aceptar). No es seguimiento en segundo plano. Efímera en el teléfono; en el servidor queda el punto de la fichada. |
| Fotos | Sí, si el vigilador adjunta un certificado o actualiza la foto de la credencial. Finalidad: funcionalidad. |
| Nombre, DNI/CUIL, legajo, correo | Sí. Información personal. Finalidad: funcionalidad de la app y gestión de la cuenta laboral. |
| ID del dispositivo y token de notificaciones | Sí. Identificadores. Finalidad: funcionalidad (un dispositivo por legajo y avisos de turno). |
| Datos financieros, contactos, micrófono, salud como app médica | No |

Declaración de ubicación para el formulario de permisos: la app accede a la ubicación **solo con la app en uso**, para validar la fichada dentro del radio del objetivo y, si el vigilador lo permite, estimar la llegada al aceptar una convocatoria. No se accede en segundo plano.

## Acceso a la app — usuario de prueba (diseño, no creado)

No se escribió nada en producción. Crear esto en el proyecto `comtroldata`, empresa **`pruebas_sa`** (no en Bacar productiva):

1. Usuario de Auth `play.review@bacarsa.com.ar`. Contraseña larga, solo en Play Console → Acceso a la app. No guardarla en el repo. Sin claim de SuperAdmin.
2. Legajo `empleados/{id}`: `empresaId: pruebas_sa`, `email` igual al de Auth, `uid` del usuario, `status: ACTIVE`, `firstName: Review`, `lastName: Play`, `fileNumber: PLAY-01`, `deviceId` vacío. No crear `device_tokens` antes: el primer teléfono del revisor se ata solo. Si Google entra desde otro aparato, hay que limpiar ese token.
3. Un objetivo de `pruebas_sa` con `allowRemoteCheckIn: true` (el revisor no está en el puesto; si no, la geocerca de ~80 m rechaza la fichada).
4. Dos turnos `turnos` de ese legajo, código `M`, uno para el día de la revisión y otro para el día siguiente, `draft: false`, `isFranco: false`, con `objectiveId` de ese objetivo. Publicar `planificacion_estados` con id `{objectiveId}_{año}_{mes}` y `publishedAt`; si no, el planificado no aparece en Hoy.
5. Cliente de ese objetivo activo.

Instrucciones para Play:

```text
Abrí COSP Guardia. Ingresá con play.review@bacarsa.com.ar y la contraseña indicada.
Aceptá notificaciones y, si la pide, la ubicación (solo se usa al fichar).
En Hoy ves el turno del día. En Agenda, el mes. En Más → Credencial y Política de privacidad.
```

## Ficha de Play Store

**Título:** COSP Guardia

**Descripción corta (65 caracteres):**

```text
Turnos, fichada en el puesto, alertas y credencial del vigilador.
```

**Descripción larga:**

```text
COSP Guardia es la app del vigilador de Grupo Bacar. Muestra tus turnos, te avisa cuando tenés que salir y te deja fichar en el puesto.

• Turno de hoy y agenda del mes
• Fichada con validación de ubicación, solo mientras usás la app
• Alertas de turno, convocatorias, retención y código de anexo
• Credencial digital con QR
• Novedades de RRHH (ausencias y licencias) si tu empresa las habilita

No tiene anuncios. Hace falta una cuenta activada por RRHH. Cada vigilador ve solo su legajo.
```

## Capturas a sacar (teléfono, 1080×1920 o relación similar)

1. Hoy, con el turno de prueba y el botón de fichar.
2. El aviso de fichada (presente, o el mensaje si está fuera del puesto).
3. Agenda del mes con el turno marcado.
4. Alertas (una convocatoria o la lista vacía con el título de la pantalla).
5. Credencial digital con el QR.
6. Más, con la tarjeta de Privacidad visible.
7. Opcional: pantalla de ingreso.

Gráfico de funciones 1024×500: wordmark COSP Guardia sobre fondo `#8B1A1A`, una línea “Turnos, fichada y alertas”.
