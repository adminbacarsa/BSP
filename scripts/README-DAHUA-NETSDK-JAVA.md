# Dahua NetSDK Java – Análisis y uso posible en la plataforma

Carpeta del SDK: `C:\Users\Soporte\Downloads\General_NetSDK_Eng_JAVA_Win64_IS_V3.060.0000003.0.R.251127`  
(Dentro suele haber una subcarpeta `General_NetSDK_ChnEng_JAVA_Win64_IS_V3.060.0000003.0.R.251127` con el código.)

## 1. ¿Qué es?

**NetSDK Java** es el SDK “completo” de Dahua para aplicaciones **Java de escritorio o servidor**. Usa **JNA** para llamar a librerías nativas (DLL en Windows, .so en Linux). No corre en el navegador: corre en una JVM con acceso a las DLLs del SDK.

| Aspecto | H5 Player Web SDK | NetSDK Java |
|--------|--------------------|-------------|
| Entorno | Navegador (JavaScript) | Java (escritorio/servidor) |
| Video en vivo | ✅ (WebSocket + decodificación en el cliente) | ✅ (CLIENT_RealPlayEx, CLIENT_RealPlayByDataType) |
| Reproducción (playback) | ✅ limitado en demo (mismo flujo que vivo) | ✅ CLIENT_PlayBackByTime / PlayBackByTimeEx |
| Descarga de grabaciones | ❌ | ✅ Por tiempo, por archivo, por tipo de dato (.dav, .mp4, .flv, etc.) |
| Captura (snap) | ✅ | ✅ Local y remota |
| PTZ | ❌ (requiere proxy) | ✅ CLIENT_DHPTZControlEx |
| Intercom (talk) | ✅ | ✅ CLIENT_StartTalkEx, etc. |
| Alarmas | ❌ | ✅ CLIENT_StartListenEx, CLIENT_SetDVRMessCallBack |

Resumen: el **H5 solo sirve para ver video en vivo (y snap)** en el navegador; el **NetSDK Java** sirve para **vivo, playback, descarga de video, PTZ, alarmas, etc.**, pero solo en una aplicación Java con las DLLs cargadas.

---

## 2. Estructura del paquete NetSDK Java

```
General_NetSDK_ChnEng_JAVA_Win64_IS_V3.060.../
├── ReadMe_PleaseReadFirst.txt   ← Resumen de demos e interfaces (muy útil)
├── doc/                         ← Manuales PDF (Programming Manual, FAQ, etc.)
├── libs/
│   ├── jna.jar
│   ├── win64/                   ← DLLs (dhnetsdk.dll, play.dll, etc.)
│   ├── win32/, linux32/, linux64/, mac64/
├── res/
│   ├── dynamic-lib-load.xml     ← Qué DLL cargar por plataforma
│   └── res_*.properties         ← Idiomas
├── src/main/java/com/netsdk/
│   ├── lib/                     ← Enlace con el SDK nativo
│   │   ├── NetSDKLib.java       ← Definición JNA de todas las APIs
│   │   ├── ToolKits.java, Utils.java, LibraryLoad.java
│   │   └── enumeration/, structure/, callback/
│   ├── demo/
│   │   ├── frame/               ← UIs de ejemplo (Swing)
│   │   │   ├── RealPlay.java, RealplayEx.java
│   │   │   ├── DownLoadRecord.java, DownLoadByDataType.java
│   │   │   ├── PlayByDataType.java    ← Reproducción por tipo de dato
│   │   │   ├── CapturePicture.java, PTZControl.java, Talk.java
│   │   │   ├── AlarmListen.java, DeviceControl.java, ...
│   │   └── module/              ← Lógica reutilizable (sin UI)
│   │       ├── RealPlayModule.java
│   │       ├── DownLoadRecordModule.java
│   │       ├── LoginModule.java, ...
│   └── common/
├── pom.xml, run_win64.bat, package.bat
```

---

## 3. Funciones que nos interesan (según ReadMe y código)

### 3.1 Inicialización y login

- `CLIENT_Init` – Inicializar NetSDK (y callbacks de desconexión).
- `CLIENT_LoginWithHighLevelSecurity` – Login al NVR/cámara (IP, puerto, usuario, contraseña).
- `CLIENT_Logout` – Cerrar sesión.
- `CLIENT_Cleanup` – Liberar NetSDK.

### 3.2 Video en vivo (real play)

- `CLIENT_RealPlayEx(loginHandle, channel, hWnd, stream)` – Iniciar vista previa en una ventana (Swing Panel o equivalente).
- `CLIENT_StopRealPlayEx(playHandle)` – Parar vista previa.
- `CLIENT_RealPlayByDataType` – Obtener flujo por tipo de dato (incl. guardar a archivo, p. ej. MP4).

### 3.3 Reproducción (playback) de grabaciones

- `CLIENT_PlayBackByTime` / `CLIENT_PlayBackByTimeEx` / `CLIENT_PlayBackByTimeEx2` – Reproducir por rango de tiempo (canal, inicio, fin, ventana, callback de progreso).
- `CLIENT_StopPlayBack` – Detener reproducción.
- `CLIENT_PausePlayBack` – Pausar/reanudar.
- `CLIENT_GetPlayBackOsdTime` – Obtener tiempo OSD (posición actual, inicio, fin).

### 3.4 Descarga de grabaciones

- **Por tiempo**  
  - `CLIENT_DownloadByTimeEx(loginHandle, channelId, recordFileType, startTime, endTime, savedFileName, progressCallback, ...)`  
  - `CLIENT_StopDownload(handle)`  
  - Formato típico: **DAV** (propietario Dahua).

- **Por archivo**  
  - `CLIENT_QueryRecordFile` – Consultar archivos de grabación.  
  - Luego usar `CLIENT_DownloadByTimeEx` (o variantes) para descargar el tramo correspondiente.

- **Por tipo de dato**  
  - `CLIENT_DownloadByDataType` – Descarga en el formato elegido:  
    - `.dav` (privado), `.ps`, `.ts`, `.mp4`, `.h264`, `.flv`.

- **Otras**  
  - `CLIENT_AdaptiveDownloadByTime`, `CLIENT_DownloadByFileSelfAdapt`, `CLIENT_DownloadByRecordFileEx`, etc., para casos más avanzados.

### 3.5 Captura (snap)

- `CLIENT_CapturePictureEx` – Captura local (requiere vista previa activa).
- `CLIENT_SnapPictureEx` – Captura remota o por tiempo.
- `CLIENT_SetSnapRevCallBack` – Callback para recibir la imagen.

### 3.6 PTZ

- `CLIENT_DHPTZControlEx` – Control PTZ (direcciones, zoom, iris, etc.); el comando concreto se elige por parámetro.

### 3.7 Intercom (talk)

- `CLIENT_SetDeviceMode` – Configurar modo/código de intercom.
- `CLIENT_StartTalkEx` / `CLIENT_StopTalkEx` – Iniciar/parar intercom.
- `CLIENT_TalkSendData` – Enviar audio al dispositivo.
- `CLIENT_AudioDecEx` – Decodificar y reproducir audio recibido del dispositivo.

### 3.8 Alarmas

- `CLIENT_SetDVRMessCallBack` – Callback de mensajes/alarmas.
- `CLIENT_StartListenEx` – Suscribirse a alarmas del equipo.
- `CLIENT_StopListen` – Dejar de escuchar.

---

## 4. Cómo podría usarse en la plataforma (CronoApp)

La app actual es **web (Next.js)** y ya usa el **H5 Player** para **vivo en el navegador**. El NetSDK Java **no se ejecuta en el navegador**; tiene sentido usarlo en un **proceso Java en servidor o en una PC de la red** que hable con el NVR y exponga servicios a la web.

### 4.1 Descarga de grabaciones (clips) para eventos

- **Flujo:**  
  1. En Operaciones, el usuario elige “Descargar clip” para una alerta (o un rango de tiempo y canal).  
  2. El backend (p. ej. Cloud Functions o un servidor vuestro) recibe la petición con: `nvrId`, `channel`, `startTime`, `endTime`.  
  3. Un **servicio Java** que use NetSDK (en una máquina con red al NVR):  
     - Lee de Firestore o de config la IP/puerto/user/pass del NVR (por `nvrId`).  
     - Hace login, `CLIENT_QueryRecordFile` si hace falta, luego `CLIENT_DownloadByTimeEx` o `CLIENT_DownloadByDataType` para generar un archivo (p. ej. MP4).  
     - Sube el archivo a Cloud Storage (o similar) y devuelve la URL al front.  
  4. La web muestra un enlace de descarga o un reproductor para ese clip.

Así se cubre lo que el H5 no ofrece: **descarga de grabaciones por tiempo/canal**.

### 4.2 Playback “en la nube” (opcional)

- El mismo servicio Java podría:  
  - Reproducir por tiempo con `CLIENT_PlayBackByTimeEx` y, con `CLIENT_RealPlayByDataType` o callbacks de datos, **guardar el tramo a MP4** y subirlo a Storage.  
  - La web solo reproduciría ese MP4 (HLS o descarga directa).  
No es playback en tiempo real desde el NVR hacia el navegador, pero permite “ver el tramo de la alerta” sin instalar nada en el cliente.

### 4.3 Snapshot desde el servidor

- Para una alerta o para “foto actual del canal”, el backend podría llamar a un servicio Java que haga login, `CLIENT_SnapPictureEx`, reciba la imagen por callback y la suba a Storage; la web solo muestra la URL. Útil si no queréis depender del H5 para la captura.

### 4.4 Arquitectura posible

- **Opción A – Servidor Java en la red del NVR**  
  - Una PC o VM en la misma red que el NVR ejecuta un **servicio Java** (Spring Boot, Quarkus, o un “runner” mínimo).  
  - Ese servicio: carga las DLLs del NetSDK, hace login al NVR, descarga por tiempo/canal, convierte a MP4 si hace falta, sube a Cloud Storage.  
  - La plataforma web (Next.js / Firebase) llama a este servicio por **HTTP/HTTPS** (API REST) con `nvrId`, `channel`, `start`, `end`; el servicio devuelve la URL del clip o un error.

- **Opción B – Sin Java en producción**  
  - Si no queréis mantener un proceso Java, el H5 sigue siendo la opción para **solo vivo + snap** en el navegador; la descarga de grabaciones quedaría para un “cliente pesado” (p. ej. el demo del NetSDK) o para una herramienta interna.

---

## 5. Requisitos del NetSDK Java

- **JDK:** El ReadMe menciona JDK 1.8 para `run_win64.bat`; en general conviene usar una versión compatible con la que compile el proyecto (p. ej. 8 u 11).
- **Plataforma:**  
  - **Windows:** `libs/win64` (o win32); las DLL deben estar en el path o en la carpeta del proceso.  
  - **Linux:** `libs/linux64` (o linux32); en Linux el demo solo soporta flujo (sin GUI).  
- **Red:** La JVM debe poder alcanzar al NVR (IP:puerto); si el servicio Java está en la nube, el NVR tendría que ser accesible (VPN o IP pública), lo que no es lo habitual. Por eso suele colocarse el servicio Java **en la misma red que el NVR**.
- **Recursos:** Inicializar NetSDK y mantener sesiones consume recursos; un solo proceso puede atender varias peticiones secuenciales o un pool de conexiones, según cómo lo implementéis.

---

## 6. Resumen

| Necesidad | SDK a usar | Dónde corre |
|-----------|------------|-------------|
| Ver canal en vivo en el navegador | H5 Player Web SDK | Navegador (ya integrado) |
| Descargar grabación por tiempo/canal (ej. clip de una alerta) | NetSDK Java | Servicio Java en red del NVR |
| Reproducir grabación “como archivo” en la web | NetSDK Java (descarga/conversión) + Storage | Servicio Java + Cloud Storage; web solo reproduce la URL |
| PTZ / alarmas / intercom desde la web | NetSDK Java (o H5 + proxy para PTZ) | Servicio Java o proxy en la red del NVR |

El **H5 sirve solo para vivo (y snap)** en el cliente. El **NetSDK Java** sirve para **vivo, playback, descarga en varios formatos, PTZ, alarmas, intercom**, pero en un **servicio Java** que podéis usar para dar a la plataforma web la capacidad de “descargar clip” o “ver tramo grabado” sin instalar nada en el usuario final.

Si en el siguiente paso queréis, se puede bajar al detalle de una **API REST** (ej. “POST /api/nvr/download-clip” con `nvrId`, `channel`, `start`, `end`) y un **esqueleto de servicio Java** que use solo login + `CLIENT_DownloadByTimeEx` o `CLIENT_DownloadByDataType` y suba el archivo a Firebase Storage o a otro bucket.

---

## 7. Agente en la red del NVR (“tipo driver”)

Sí, se puede tener un **programa pequeño** instalado en la misma red que la NVR (una PC, un mini PC o una VM) que hable con la NVR vía SDK y **envíe información a la plataforma**. No es un driver del sistema: es un proceso (servicio o app) que corre en segundo plano.

### Qué haría el agente

| Función | Cómo | Hacia la plataforma |
|--------|------|----------------------|
| **Alertas / alarmas** | Suscripción con `CLIENT_StartListenEx` + `CLIENT_SetDVRMessCallBack`; cuando el NVR dispara alarma (movimiento, IVS, sistema), el callback recibe el evento | Enviar por **HTTPS** a una Cloud Function o API vuestra (ej. `POST /api/nvr-events`) con tipo, canal, hora, etc. La plataforma puede crear/actualizar documentos en Firestore (colección `alerts` o similar). |
| **Estado del equipo** | Periódicamente: `CLIENT_QueryDeviceTime`, `CLIENT_QueryDevState` u otras consultas de estado (disco, conexión) | Enviar resumen (heartbeat) a la plataforma: hora del NVR, estado, último evento. Útil para “¿el NVR está vivo?” y monitoreo. |
| **Complementar el webhook** | Hoy las alertas con foto llegan por **webhook** (NVR → proxy → nvrAlertV2). El agente podría enviar **eventos adicionales** que el NVR no mande por HTTP (ej. alarmas de sistema, pérdida de video) o unificar todo por un solo canal (agente recibe todo por SDK y lo sube). | Mismo endpoint o uno dedicado; la plataforma trata todo igual (alertas en Operaciones). |

No sustituye obligatoriamente al webhook: podéis seguir recibiendo fotos por el webhook y usar el agente para **más información** (alarmas de sistema, estado del NVR) o para sitios donde no quieran/configuren el webhook en el NVR.

### Cómo envía los datos a la plataforma

- **Opción recomendada:** El agente hace **POST HTTPS** a una **Cloud Function** (Firebase) o a vuestra API. Ejemplo: `POST https://us-central1-comtroldata.cloudfunctions.net/nvrAgentEvents` con un JSON `{ "nvrId", "channel", "eventType", "timestamp", "extra" }`. La función escribe en Firestore y, si queréis, envía notificaciones.
- **Alternativa:** El agente usa **Firebase Admin SDK** (Java) y escribe directo en Firestore (necesita una cuenta de servicio y mantenerla segura en el equipo donde corre el agente).

En ambos casos el agente **sale a internet por HTTPS**; no hace falta abrir puertos entrantes en la red del NVR.

### Tecnología del agente

- **Java + NetSDK:** Si usáis el NetSDK Java, el agente es un proceso Java (con las DLLs en `libs/win64` o .so en Linux) que: inicializa el SDK, hace login al NVR, abre la suscripción de alarmas y, en cada callback, envía el evento a la plataforma. Puede ser un JAR ejecutable con `java -jar nvr-agent.jar` o un servicio Windows/Linux.
- **Configuración:** En un archivo de config (o variables de entorno) se pone la IP del NVR, usuario, contraseña, y la URL de la plataforma (o las credenciales de Firebase). Opcionalmente el número de serie/nvrId para que la plataforma asocie los eventos al NVR correcto.

### Resumen

| Pregunta | Respuesta |
|----------|-----------|
| ¿Se puede hacer un programa que se instale en la red del NVR y envíe información a la plataforma? | **Sí.** Un agente (Java + NetSDK u otro SDK que hable con la NVR) en una PC/VM de esa red, enviando por HTTPS a vuestra API o Cloud Functions. |
| ¿Sustituye al webhook? | No es obligatorio. Podéis seguir con webhook para fotos y usar el agente para alarmas de sistema, estado del NVR o unificar todo. |
| ¿Qué necesita la red del NVR? | Salida a internet (HTTPS) desde la PC donde corre el agente; la NVR solo tiene que ser alcanzable por esa PC (LAN). |
