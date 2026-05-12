# Dahua H5 Player Web SDK – Análisis y uso en la plataforma

Carpeta del SDK: `C:\Users\Soporte\Downloads\H5PlayerWEBSDK-Development-GuideV1.1.R1509191.230912`

## 1. ¿Qué es?

SDK **sin plugins** (100% web) de Dahua para reproducir video de cámaras/NVR en el navegador. Usa **WebSocket** (`/rtspoverwebsocket`) y **Web Workers** + **WASM** para decodificar en el cliente. Compatible con dispositivos que soporten “no plug-ins” (ver guía oficial, sección 1.2).

### Contenido del paquete

| Carpeta/archivo | Uso |
|-----------------|-----|
| `doc/` | Guía en PDF/Word (entorno, dispositivos soportados, APIs). |
| `webs/` | Demo web: `index.html`, `index.js` y módulos del player. |
| `webs/module/` | **PlayerControl.js** (clase principal), **libDecodeSDK.js** + **libDecodeSDK.wasm**, workers de video/audio. |
| `nginx-1.10.2/` | Servidor para probar el demo y usar **proxy** para PTZ/APIs del equipo. |

---

## 2. ¿Para qué nos sirve?

En la plataforma hoy tenéis:

- Alertas NVR con **fotos** (snapshots) en el modal de operaciones/mapa.
- **Sin** video en vivo ni reproducción de grabaciones desde el navegador.

Con el H5 Player Web SDK podríamos:

| Funcionalidad | Descripción | Dónde encaja |
|---------------|-------------|--------------|
| **Video en vivo** | Ver stream en tiempo real de un canal del NVR/cámara Dahua. | Operaciones: vista en vivo de la cámara que disparó la alerta; futura “sala de monitoreo” por cliente/NVR. |
| **Captura (snap)** | Hacer una foto desde el stream actual. | Complementar o sustituir la imagen que ya envía la NVR en la alerta. |
| **Reproducción (playback)** | Reproducir grabaciones del equipo por rango de tiempo. | Operaciones: “ver qué pasó 5 min antes/después” de la alerta. |
| **Audio** | Activar/desactivar audio del canal, volumen. | Útil en monitoreo si el equipo tiene audio. |
| **Descarga de tramos** | Recortar y descargar un tramo de video. | Exportar evidencias (ej. clip del evento). |
| **PTZ** | Mover, zoom, enfoque, presets (si la cámara es PTZ). | Solo si usáis cámaras PTZ y queréis control desde la web. |
| **Intercom (talk)** | Hablar por la cámara (bidireccional). | Casos muy concretos (portero, megafonía). |

Lo más valioso para vuestro flujo actual: **vivo + playback + snap** en la misma pantalla donde ya mostráis las alertas.

---

## 3. Cómo funciona (resumen técnico)

- **Login:** Se hace contra el **dispositivo** (NVR o cámara) por su IP:puerto. En el demo usan un objeto global `RPC` (login, keepAlive, logout, etc.).
- **Stream:**  
  - **WebSocket:** `ws://IP:PUERTO/rtspoverwebsocket`  
  - **RTSP (interno):** `rtsp://IP:PUERTO/cam/realmonitor?channel=1&subtype=0&proto=Private3`  
  - Canal: normalmente `channel` 1, 2, 3…; `subtype`: 0 = main, 1+ = sub stream.
- **Player:** Se crea una instancia de `PlayerControl` con `wsURL`, `rtspURL`, usuario y contraseña. Se llama a `init(canvas, video)` y, en el evento `WorkerReady`, a `connect()`. El video se pinta en un `<canvas>` o en un `<video>` según el modo de decodificación.

### API principal (según el demo `index.js`)

```js
// Opciones típicas para vivo
const options = {
  wsURL: 'ws://' + ip + ':' + port + '/rtspoverwebsocket',
  rtspURL: 'rtsp://' + ip + ':' + port + '/cam/realmonitor?channel=' + channel + '&subtype=' + stream + '&proto=Private3',
  username: name,
  password: pswd,
  lessRateCanvas: true,
  wndIndex: 0
};

const player = new PlayerControl(options);

player.on('WorkerReady', () => player.connect());
player.on('PlayStart', (e) => { /* listo */ });
player.on('DecodeStart', (e) => { /* usar canvas o video según e.decodeMode */ });
player.on('Error', (e) => { /* fallos */ });

player.init(canvasElement, videoElement);
```

**Métodos útiles:**

- `player.connect()` – inicia la conexión (tras `WorkerReady`).
- `player.stop()`, `player.close()` – parar y cerrar.
- `player.setAudioVolume(0..1)` – volumen.
- `player.capture('nombre')` – captura (snap).
- `player.startRecord(true/false)` – grabar en el navegador (vivo).
- `player.pause()` / `player.play()` – pausa/continuar (playback).
- `player.playByTime(segundos)` – ir a un tiempo en playback.
- `player.startCut(true/false)` – inicio/fin de recorte para descarga (playback).

Para **PTZ**, búsqueda de grabaciones, etc., el demo usa **RPC** contra el equipo (MagicBox, DevVideoInput, MediaFileFind, PTZManager). Esas llamadas suelen requerir que la página se sirva desde un **proxy** (p. ej. nginx) que apunte al dispositivo, para evitar CORS y mezcla HTTP/HTTPS.

---

## 4. Cómo cargarlo en React/Next (apps/web2)

El **readme del SDK** dice que **no** se debe usar `import`; hay que exponer la clase en `window` con un `<script>`:

- Opción A: copiar los archivos de `webs/module/` (PlayerControl.js, libDecodeSDK.js, libDecodeSDK.wasm, workers) a `apps/web2/public/dahua-sdk/` y en la página que use el player:

  ```html
  <script src="/dahua-sdk/PlayerControl.js"></script>
  ```

- Opción B: cargar el script solo en la ruta que tenga el reproductor (por ejemplo una página de “vivo” o un modal de operaciones), por ejemplo con `next/script` o un `<script src="...">` en un layout específico.

Después, en tu componente:

```ts
declare global {
  interface Window {
    PlayerControl?: typeof import('...').PlayerControl; // o any
  }
}
// ...
const player = new window.PlayerControl(options);
```

Los workers y el WASM deben poder cargarse desde la misma base (ej. `/dahua-sdk/`); el SDK suele referenciarlos por path relativo.

---

## 5. Requisitos y limitaciones

- **Dispositivo:** NVR o cámara Dahua que soporte “no plug-ins” (ver doc, sección 1.2). Puerto típico **80** (HTTP/WS), no 37777 para este flujo.
- **Red:** El navegador debe poder abrir **WebSocket y RTSP-over-WebSocket** a la IP del NVR. Si la app está en HTTPS (Firebase Hosting), ver más abajo.
- **Credenciales:** Usuario y contraseña del **dispositivo** (no de Firebase). Habría que guardarlas de forma segura (backend/env) y no en el cliente si es posible, o al menos no en texto plano en el front.
- **PTZ y APIs RPC:** Requieren servir la página (o un proxy) que hable con el equipo; el demo usa nginx para eso. Sin proxy, solo “vivo + snap” (y playback si la URL de playback se construye igual que en el demo) suele ser posible si el CORS del equipo lo permite (muchos no).

### HTTPS (Firebase Hosting) y NVR en HTTP

- La app en producción es **HTTPS**. Los NVR suelen ser **HTTP/WS** (sin SSL).
- **Mixed content:** El navegador puede bloquear `ws://` desde una página `https://`.  
- **Opciones:**  
  1. **Proxy en vuestro backend:** Una ruta (por ejemplo en Cloud Functions o en un servidor vuestro) que haga de túnel WebSocket al NVR (similar al proxy HTTP→HTTPS que tenéis para alertas). El front se conecta a `wss://vuestro-dominio/...` y el servidor abre `ws://NVR:80/rtspoverwebsocket`.  
  2. **Acceso solo en red interna:** Si operaciones se usa desde una red donde el NVR es accesible por IP (ej. misma LAN), se podría documentar “solo en intranet” y usar `ws://IP:80` si la política de seguridad lo permite.

---

## 6. Integración sugerida con vuestra arquitectura

- **NVR/cámaras:** Ya tenéis `nvr_devices` y `camera_routes` (por `route_key` = `nvrId__channel`). Para el player necesitáis por ruta: **IP, puerto, usuario, contraseña** (y opcionalmente si es PTZ). Pueden vivir en configuración por NVR (o por canal) y resolverse en backend; el front solo recibe una URL de WebSocket (vuestra proxy) o, en intranet, IP:puerto.
- **Operaciones / mapa:**  
  - En el modal de una alerta: botón “Ver en vivo” que abra un panel o modal con un `<canvas>` + `<video>` y una instancia de `PlayerControl` para el `route_key` de esa alerta (obteniendo IP/puerto/user/pass del backend o de config).  
  - Opcional: “Reproducir desde X minutos antes” usando la misma API de playback del SDK (rangos de tiempo y lista de archivos como en el demo).
- **Seguridad:** No dejar usuario/contraseña del NVR en el cliente. Ideal: endpoint en Cloud Functions que devuelva una URL temporal de stream (o un token) o que abra el túnel WebSocket; el front solo conectaría a vuestro dominio.

---

## 7. Próximos pasos recomendados

1. **Leer** la guía en `doc/` (PDF/Word), sobre todo sección 1.2 (dispositivos soportados) y entorno (puertos, proxy).
2. **Probar el demo** localmente:  
   - Editar IP/puerto/user/pass en `webs/index.html` (línea ~15 y lista de dispositivos).  
   - Arrancar nginx (`nginx-1.10.2/start.bat`) y abrir `http://127.0.0.1/index.html`.  
   - Confirmar que con vuestro NVR/cámara Dahua tenéis vivo, snap y, si aplica, playback.
3. **Copiar** `webs/module/*` a `apps/web2/public/dahua-sdk/` (o similar) y crear una página mínima en Next que cargue `PlayerControl` por `<script>` y muestre un solo canal en vivo (sin PTZ). Validar que workers y WASM cargan bien.
4. **Definir** cómo exponer IP/puerto/credenciales al front (proxy WebSocket, endpoint que devuelva URL, etc.) sin romper seguridad.
5. **Añadir** “Ver en vivo” en el modal de alertas de operaciones usando ese player y la ruta/cámara de la alerta.

Si queréis, el siguiente paso puede ser un **ejemplo mínimo** en `apps/web2` (una página `/admin/operaciones/vivo` o un componente `DahuaLivePlayer`) que reciba `route_key` o `nvrId`+canal y muestre el stream usando este SDK.
