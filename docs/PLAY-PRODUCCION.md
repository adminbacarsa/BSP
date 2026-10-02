# COSP Guardia — producción en Google Play

Package: `com.cosp.guardia` (no cambiar). Version name de este binario: **1.2.0**. El `versionCode` lo incrementa EAS (`autoIncrement`, fuente remota; el internal actual está en versionCode 2, el próximo build de production pasa a **3**).

No se subió nada a Play ni se lanzó OTA en esta tarea.

## Build (lo corre Mauro, no el agente)

Desde `apps/mobile-guardia`, con la cuenta EAS `cosp-guardia`:

```text
npx eas-cli build --platform android --profile production
```

Eso genera el **AAB** (`buildType: app-bundle`), con `EXPO_PUBLIC_USE_EMULATOR=false` y `autoIncrement`. No usa `eas submit`.

Functions se puede desplegar antes o después del AAB: el servidor elige el canal por dispositivo (`device_tokens.nativeVersion` >= 1.2.0 → `alertas_turno_v2`; si no, `alertas_turno`). Los celulares con el binario anterior siguen recibiendo en su canal MAX de siempre.

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
- Canal nuevo: `alertas_turno_v2`, importancia MAX, usage ALARM, sonido `alertas_turno`. El JS lo crea **solo** si `Constants.nativeAppVersion` >= 1.2.0 (binario con el wav). Un OTA sobre un binario viejo no lo crea: el canal quedaría fijado sin el sonido.
- Canal viejo `alertas_turno`: se sigue creando con sonido default. Android no cambia el sonido de un canal ya instalado.
- Al registrar el token, la app guarda `nativeVersion` en `device_tokens`. Sin ese campo (binarios anteriores) el servidor manda `alertas_turno`.
- iOS (sin build hoy): entitlement `time-sensitive` ya está en `app.config.ts`; el payload APNs manda `sound: alertas_turno.wav` e `interruption-level: time-sensitive`. Hay que tener el entitlement aprobado en la cuenta de Apple el día que haya build iOS.
- Teléfonos con el binario anterior: reciben en `alertas_turno` (importancia MAX, sonido default). El sonido propio aparece al instalar el AAB 1.2.0 y abrir la app (re-registra el token con `nativeVersion`).

## Permisos del manifest

Se usan: ubicación precisa y aproximada **solo en primer plano** (fichada y ETA al aceptar; `getCurrentPositionAsync`), cámara, notificaciones, vibrar.

No se usa ubicación en segundo plano. `ACCESS_BACKGROUND_LOCATION` está bloqueado, igual que `RECEIVE_BOOT_COMPLETED` (no hay alarmas locales al reiniciar; FCM no lo necesita), micrófono y superposición.

## Política de privacidad

Página: `apps/web2/src/pages/privacidad/index.tsx`. URL pública (después del deploy de hosting):

https://comtroldata.web.app/privacidad/

`firebase.json` reescribe `/privacidad` antes del catch-all del panel. En la app: Más → Privacidad. **Hay que desplegar hosting** para que Play pueda abrir la URL. No se desplegó en esta tarea.

La app nativa es solo para guardias y eventuales. No incluye el trabajo de `cursor/multirol-fase1`.

La app `COSP Guardia` (`com.cosp.guardia`) ya está en Borrador, con Prueba interna. La cuenta de Play es **personal**: hace falta una **prueba cerrada** con 12 testers opted-in durante 14 días seguidos. La prueba interna no cuenta para ese plazo.

## Orden en Play Console

### 1. Panel (cada tarea pendiente)

Respondé en este orden. Guardá cada una antes de pasar a la siguiente.

| Tarea del panel | Qué responder |
|-----------------|---------------|
| Política de privacidad | `https://comtroldata.web.app/privacidad/` (hay que tener el hosting desplegado) |
| Acceso a la app | El acceso está restringido. Instrucciones y usuario: sección de abajo. Pegá la clave que imprimió el script. |
| Anuncios | No, la app no tiene anuncios |
| Público objetivo | 18 años o más. No es para niños. No está hecha para niños |
| Clasificación de contenido | Cuestionario IARC: No a violencia, sexo, lenguaje vulgar, sustancias, apuestas y compras dentro de la app. Categoría: Productividad o Negocios |
| Apps de gobierno, finanzas o salud | No. Un certificado laboral no convierte a la app en una app médica |
| Seguridad de los datos | Copiar la tabla de más abajo. Ubicación precisa, solo con la app en uso, no en segundo plano |
| ID de publicidad | No se usa |
| Ficha de Play Store | Textos de abajo. Ícono `docs/play/icono-512.png`. Destacada `docs/play/destacada-1024x500.png`. Capturas `docs/play/01` a `06` |
| Categoría y datos de contacto | Productividad o Negocios. Mail `admin@bacarsa.com.ar`. Ficha en español (Argentina) |

### 2. Build del AAB (lo corre Mauro)

Desde `apps/mobile-guardia`:

```text
npx eas-cli build --platform android --profile production
```

Cuando termina, en el sitio de EAS: descargar el `.aab`. No uses `eas submit`.

### 3. Prueba cerrada

1. Play Console → **Probar y publicar** → **Pruebas** → **Prueba cerrada** → **Crear pista**. Nombre: `cerrada-produccion`.
2. Países: Argentina (o los que correspondan).
3. **Testers** → crear una lista de correos (Gmail) con **al menos 12** personas. Guardar.
4. **Crear versión** → subir el AAB a mano (arrastrar el archivo, o **Subir**). Notas de la versión: “Primera prueba cerrada de COSP Guardia”.
5. Revisar y **Enviar a revisión**.
6. Cuando Google apruebe la pista, en Testers copiá el **link de inscripción** y pasáselo a los 12. Cada uno tiene que abrirlo, aceptar ser tester e instalar desde Play. El contador de 14 días empieza cuando hay 12 opted-in al mismo tiempo. Si uno se baja, el plazo se reinicia.

### 4. A los 14 días: producción

1. Panel → la tarea **Solicitar acceso a producción** (o Probar y publicar → Producción). Google la habilita solo si los 14 días se cumplieron.
2. Producción → **Crear versión** → subir el mismo AAB (o uno nuevo generado con el mismo comando) → **Enviar a revisión**.
3. Al aprobar, **Publicar**.

Subir el AAB a mano, en la pista que corresponda: **Crear versión** → **App bundles** → **Subir** → elegir el `.aab` descargado de EAS. No hace falta `eas submit`.

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

## Acceso a la app — usuario de revisión

El script no escribe nada si no le pasás los dos flags. La clave sale por consola solo con `--apply` y no se guarda en el repo.

```text
node scripts/crear-usuario-review-play.mjs
node scripts/crear-usuario-review-play.mjs --apply --allow-prod
```

Crea, en `pruebas_sa` (no en Bacar): Auth `cosp@bacarsa.com.ar` (Mauro crea la casilla; el script la usa como usuario de Auth) con claim `employee` (sin SuperAdmin), legajo `empleados/play_review_01` (`PLAY-01`) con `bypassDeviceCheck` y `fichadaRemota` (el gate de dispositivo y la geocerca los respetan solo en ese legajo), objetivo `obj_play_review` con `excluirDeOperacion` (sin SLA: no entra al Centro de Control ni a los crons) y **sin** `allowRemoteCheckIn`, y turnos `M` 07:00–15:00 publicados los próximos 30 días. La app cierra el turno con «Cerrar turno». Volver a correr `--apply` rota la clave.

El revisor puede fichar ese día desde cualquier lugar, a cualquier hora, porque el legajo tiene `fichadaRemota`. Otro legajo sigue con el radio de 80 m y la ventana normal.

Instrucciones para Play:

```text
Abrí COSP Guardia. Ingresá con cosp@bacarsa.com.ar y la contraseña indicada.
Aceptá notificaciones y, si la pide, la ubicación (solo se usa al fichar).
En Hoy ves el turno del día y podés fichar. En Agenda, el mes. En Más → Credencial y Política de privacidad.
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

## Material de la ficha (`docs/play/`)

Datos ficticios (Review Play, DNI 00.000.000, Cliente Revisión Play). No hay datos personales reales.

| Archivo | Uso |
|---------|-----|
| `icono-512.png` | Ícono 512×512, recorte del ícono de la app |
| `destacada-1024x500.png` | Imagen destacada |
| `01-hoy.png` … `06-contratos.png` | Capturas viejas 1080×1920 (maqueta simplificada) |
| `capturas-1.2.0/01` … `06` | **Capturas vigentes 1080×2400** con los componentes reales de la app: inicio con el turno del día, agenda, fichada con ubicación, bandeja de alertas, convocatoria Aceptar/Rechazar, aviso ¿Venís? 10/15/30. Más copia de `icono-512.png` y `destacada-1024x500.png` |

Las pantallas salen de `apps/mobile-guardia/app/play-capturas/[frame].tsx` (datos ficticios PLAY-01, sin Firestore; no está en el menú). Para regenerar, contra el export web local:

```text
cd apps/mobile-guardia && npm run build:web
cd ../..
node scripts/capturar-play-ficha.mjs
```

Escribe en `docs/play/capturas-{version}/` (versión de `apps/mobile-guardia/package.json`). `PLAY_CAPTURAS_COPY="C:\...\COSP Play Store\1.2.0"` deja una copia extra. Si Playwright no encuentra Chromium: `PLAYWRIGHT_BROWSERS_PATH=%LOCALAPPDATA%\ms-playwright`.
