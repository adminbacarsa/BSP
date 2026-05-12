# NVR Agent – CronoApp

Programa que corre **en la red del NVR**, se conecta al NVR con el Dahua NetSDK Java, recibe alarmas (eventos de canal, movimiento, pérdida de video, disco, etc.) y las envía a la plataforma por HTTPS.

Así podés recibir eventos aunque la NVR **no tenga o no use webhook**: el agente captura el canal real y sube los datos a la nube.

**→ Guía de instalación en la PC del cliente:** [INSTALACION.md](INSTALACION.md) (requisitos, pasos, config, ejecución, varias NVR).  
**→ Alta de una NVR nueva y nombres de canales:** [ALTA-NVR-NUEVA.md](ALTA-NVR-NUEVA.md) (parametrizar en CronoApp y en el agente para que las alertas tengan nombres significativos).  
**→ Qué alertas enviar a la plataforma:** [ALERTAS-A-PLATAFORMA.md](ALERTAS-A-PLATAFORMA.md) (filtrar MOTION_EX, enviar VIDEOLOST, ALARM_EX, heartbeat/keepalive).

## Requisitos

- **JDK 8** (o 11).
- **Dahua NetSDK Java** (el paquete que descargaste: General_NetSDK_Eng_JAVA_Win64_IS_...). Hay que compilarlo e instalarlo en el repositorio Maven local.
- **Windows 64** (o Linux 64 si tenés las .so del SDK). Las DLLs del SDK deben estar en `java.library.path` al ejecutar el agente.

## Pasos para compilar y ejecutar

### 1. Instalar el NetSDK en Maven

En la carpeta del SDK (la que tiene `pom.xml` del NetSDK, ej. `General_NetSDK_ChnEng_JAVA_Win64_IS_V3.060...`):

```bash
mvn clean install -DskipTests
```

Eso instala `com.netsdk:netsdk:1.0-demo` en tu repositorio local.

### 2. Compilar el agente

Desde la raíz del repo CronoApp:

```bash
cd apps/nvr-agent
mvn clean package
```

Se genera `target/nvr-agent-1.0.0.jar` y las dependencias en `target/lib/`.

### 3. Copiar las DLLs del SDK

El NetSDK necesita las librerías nativas en el path. Copiá la carpeta de libs del SDK al directorio desde donde vas a ejecutar, por ejemplo:

- **Windows:** copiar `libs/win64` del SDK a `apps/nvr-agent/run/win64` (o donde vayas a ejecutar).
- **Linux:** copiar `libs/linux64` a `apps/nvr-agent/run/linux64`.

### 4. Configuración

Copiá `config.properties.example` a `config.properties` y completá:

- **nvr.ip**, **nvr.port** (37777 es el puerto típico del NetSDK; si tu NVR usa otro, cambialo), **nvr.user**, **nvr.password**.
- **nvr.id**: identificador del NVR en la plataforma (número de serie o el mismo que usás en Cámaras).
- **platform.url**: URL que recibe los eventos. Puede ser la Cloud Function (Firebase) o un **webhook de N8N** (ej. `http://192.168.0.8:5678/webhook/nvr-alertas`). Ver [N8N-WEBHOOK.md](N8N-WEBHOOK.md) para configurar N8N.
- **platform.key**: secreto para autorizar el request (Cloud Function). Para N8N local podés dejarlo vacío. Se envía en header `X-API-Key` y `Authorization: Bearer`.

También podés usar **variables de entorno**: `NVR_IP`, `NVR_PORT`, `NVR_USER`, `NVR_PASSWORD`, `NVR_ID`, `PLATFORM_URL`, `PLATFORM_KEY`.

### 5. Ejecutar

Desde `apps/nvr-agent` (donde está `config.properties`), con las DLLs en `run/win64`:

**Windows:**

```bat
set JAVA_LIBRARY_PATH=run\win64
java -Djava.library.path=run\win64 -cp "target\nvr-agent-1.0.0.jar;target\lib\*" com.cronoapp.nvragent.Main
```

**O con script (crear `run.bat`):**

```bat
@echo off
set JAVA_LIBRARY_PATH=run\win64
java -Djava.library.path=run\win64 -cp "target\nvr-agent-1.0.0.jar;target\lib\*" com.cronoapp.nvragent.Main
pause
```

**Linux:**

```bash
export LD_LIBRARY_PATH=run/linux64
java -Djava.library.path=run/linux64 -cp "target/nvr-agent-1.0.0.jar:target/lib/*" com.cronoapp.nvragent.Main
```

El agente se queda corriendo, imprime en consola cuando recibe alarmas y las envía a **platform.url**. Ctrl+C para salir.

**Archivo de config distinto:** podés indicar la ruta del config como primer argumento:

```bat
java -Djava.library.path=run\win64 -cp "target\nvr-agent-1.0.0.jar;target\lib\*" com.cronoapp.nvragent.Main config\nvr-sede1.properties
```

---

## Varias NVR en la red

Si en el cliente hay **más de una NVR**, ejecutá **un agente por NVR**. Cada proceso usa su propia configuración (IP de esa NVR y `nvr.id` que coincida con el dispositivo en la plataforma). La misma **platform.url** y **platform.key** sirven para todos.

1. Creá una carpeta de configs, por ejemplo `config/`, y un archivo por NVR:
   - `config/nvr-porteria.properties` → `nvr.ip=192.168.0.101`, `nvr.id=porteria`
   - `config/nvr-deposito.properties` → `nvr.ip=192.168.0.102`, `nvr.id=deposito`
   En ambos podés dejar el mismo `platform.url` y `platform.key`.

2. Ejecutá un proceso por NVR (en ventanas distintas o como servicios):

   **Windows (dos NVR):**
   ```bat
   java -Djava.library.path=run\win64 -cp "target\nvr-agent-1.0.0.jar;target\lib\*" com.cronoapp.nvragent.Main config\nvr-porteria.properties
   ```
   ```bat
   java -Djava.library.path=run\win64 -cp "target\nvr-agent-1.0.0.jar;target\lib\*" com.cronoapp.nvragent.Main config\nvr-deposito.properties
   ```

   **Linux:** idem con `config/nvr-porteria.properties`, etc.

En la plataforma, cada NVR debe estar dado de alta en **Cámaras/NVR** con el mismo **nvr.id** (o número de serie) que usás en el config del agente. Así las alertas se asocian al NVR correcto y el "Ver canal en vivo" usa el `route_key` adecuado (`nvrId__canal`).

---

## Formato del evento que envía a la plataforma

Cada alarma se envía como **POST JSON** al `platform.url` con un cuerpo similar a:

```json
{
  "nvrId": "default",
  "channel": 0,
  "eventType": 8449,
  "eventTypeName": "MOTION_EX",
  "status": "start",
  "timestamp": "2025-02-23T12:00:00.000Z",
  "source": "nvr-agent"
}
```

- **channel**: canal del NVR (0-based). En la plataforma suele usarse canal 1-based; la Cloud Function puede convertir.
- **eventType**: código del SDK (0x2101 = ALARM_EX, 0x2102 = MOTION_EX, 0x2103 = VIDEOLOST_EX, etc.).
- **status**: `"start"` o `"stop"` según el tipo de evento.

**Destinos posibles para platform.url:**

- **Cloud Function** (`apps/functions`): `https://us-central1-TU_PROYECTO.cloudfunctions.net/nvrAgentEvents`. La función recibe el POST, valida NVR y ruta, y crea un documento en la colección `alerts`. Operaciones puede ver la alerta y "Ver canal en vivo".
- **N8N**: webhook en tu instancia (ej. `http://192.168.0.8:5678/webhook/nvr-alertas`). Ver [N8N-WEBHOOK.md](N8N-WEBHOOK.md) para crear el workflow y el path del webhook.
