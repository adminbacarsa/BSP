# Cómo instalar y usar el Agente NVR en la PC de la red

Esta guía es para instalar el agente en una **PC que esté en la misma red que el NVR** (por ejemplo en la oficina del cliente). Esa PC se conecta al NVR por IP y envía las alarmas a la plataforma por internet.

---

## Qué necesitás

| Requisito | Descripción |
|-----------|-------------|
| **Windows 64 bits** | La PC donde corre el agente (puede ser Windows 10/11 o Server). |
| **Java (JDK 8 o 11)** | Necesario para ejecutar el agente. Si no está instalado, ver más abajo. |
| **Acceso a la red del NVR** | La PC debe poder hacer ping al NVR (misma red o VLAN permitida). |
| **Puerto 37777** | Es el puerto por defecto del NetSDK del NVR; debe estar abierto desde la PC hacia el NVR. |
| **Internet** | Para enviar eventos a la URL de la plataforma (Cloud Function). |

---

## Dos formas de instalación

### Opción A: Te dan una carpeta ya armada (recomendado para el cliente)

Si alguien del equipo ya compiló el agente y te pasó una carpeta tipo `nvr-agent-cliente`, en la PC del cliente solo tenés que:

1. **Instalar Java** (si no está):
   - Descargar [JDK 8 (Adoptium)](https://adoptium.net/temurin/releases/?version=8&os=windows&arch=x64) o JDK 11.
   - Instalar y marcar “Set JAVA_HOME” si la instalación lo ofrece.
   - Abrir una **nueva** CMD y escribir `java -version` para confirmar.

2. **Copiar la carpeta** del agente a la PC (ej. `C:\CronoApp\nvr-agent`). Esa carpeta debe tener:
   - `nvr-agent-1.0.0.jar`
   - Carpeta `lib\` (con los JARs del SDK)
   - Carpeta `run\win64\` (con las DLLs del NetSDK: `dhnetsdk.dll`, etc.)
   - `config.properties` (o copiar desde `config.example.properties` y editar)
   - `run.bat` (script para ejecutar)

3. **Editar la configuración** (ver sección “Configuración” más abajo).

4. **Ejecutar** con doble clic en `run.bat` o desde CMD (ver “Cómo ejecutarlo”).

---

### Opción B: Compilar vos mismo (desarrollo o primera vez)

Hace falta tener:

- El **Dahua NetSDK Java** (ej. `General_NetSDK_ChnEng_JAVA_Win64_IS_V3.060...`).
- **Maven** y **JDK 8** en la máquina donde compilás.

**Pasos:**

1. **Instalar el NetSDK en Maven** (una sola vez, en la carpeta del SDK):
   ```bat
   cd C:\ruta\al\SDK\General_NetSDK_ChnEng_JAVA_Win64_IS_...
   mvn clean install -DskipTests
   ```

2. **Compilar el agente** (desde el repo CronoApp):
   ```bat
   cd D:\APP\cronoapp\apps\nvr-agent
   mvn clean package
   ```

3. **Armar la carpeta para llevar a la PC del cliente:**
   - Crear una carpeta, ej. `nvr-agent-cliente`.
   - Copiar:
     - `target\nvr-agent-1.0.0.jar`
     - `target\lib\*` → dentro de `nvr-agent-cliente\lib\`
     - Toda la carpeta `libs\win64` del SDK → `nvr-agent-cliente\run\win64\`
   - Copiar `config.example.properties` como `config.properties` y editarlo.
   - Copiar el `run.bat` (está en el repo) para que ejecute desde esa estructura.

Así tenés una carpeta lista para copiar a la PC de la red.

---

## Configuración

En la PC donde corre el agente, editá `config.properties` (con Bloc de notas o similar). Los campos importantes:

| Campo | Qué poner |
|-------|-----------|
| **nvr.ip** | IP del NVR en la red local (ej. `192.168.1.100`). |
| **nvr.port** | Normalmente `37777` (puerto NetSDK). |
| **nvr.user** | Usuario del NVR (ej. `admin`). |
| **nvr.password** | Contraseña del NVR. |
| **nvr.id** | Mismo identificador que en la plataforma (Cámaras/NVR). Ej. número de serie o nombre `nvr-porteria`. |
| **platform.url** | URL de la Cloud Function, ej. `https://us-central1-TUPROYECTO.cloudfunctions.net/nvrAgentEvents`. |
| **platform.key** | Secreto (por defecto `Bacar2026`). Debe coincidir con el configurado en la plataforma. |

Ejemplo:

```properties
nvr.ip=192.168.1.100
nvr.port=37777
nvr.user=admin
nvr.password=tu_password

nvr.id=nvr-porteria

platform.url=https://us-central1-tuproyecto.cloudfunctions.net/nvrAgentEvents
platform.key=Bacar2026
```

Guardá el archivo. No hace falta reiniciar nada si todavía no ejecutaste el agente.

---

## Cómo ejecutarlo

La carpeta del agente debe ser la **carpeta actual** al ejecutar (donde está `config.properties` y `run\win64`).

### Con doble clic (recomendado)

1. Ejecutá **`run.bat`** con doble clic.
2. Se abre una ventana negra; deberías ver algo como:
   - `NVR Agent - Conectando a 192.168.1.100:37777 (nvrId=nvr-porteria)`
   - `Plataforma: https://...`
   - `Agente en marcha. Recibiendo alarmas...`
3. Dejá esa ventana abierta. Si la cerrás, el agente se detiene.
4. Para salir: Ctrl+C o cerrar la ventana.

### Desde CMD

Abrí CMD, entrá a la carpeta del agente y ejecutá el mismo comando que usa `run.bat`:

```bat
cd C:\CronoApp\nvr-agent
set JAVA_LIBRARY_PATH=run\win64
java -Djava.library.path=run\win64 -cp "nvr-agent-1.0.0.jar;lib\*" com.cronoapp.nvragent.Main
```

(Adaptá la ruta y el nombre del JAR si tu carpeta es distinta.)

---

## Dejarlo corriendo siempre (opcional)

Si querés que el agente arranque con Windows y no dependa de una ventana abierta:

- **Opción 1 – Inicio automático:** Poné un acceso directo a `run.bat` en la carpeta de inicio de Windows (Win+R → `shell:startup`). El agente se abrirá en una ventana cada vez que inicie sesión el usuario.
- **Opción 2 – Servicio Windows:** Usar un programa que convierta “java ...” en servicio, por ejemplo [NSSM](https://nssm.cc/): instalás el servicio con la misma línea de `java ...` y lo configurás para que inicie con el sistema.

---

## Verificar que funciona

1. **Al arrancar:** En la ventana del agente no debe aparecer “Login fallido” ni “No se pudo suscribir a alarmas”. Si aparece, revisá IP, puerto, usuario y contraseña del NVR, y que las DLL estén en `run\win64`.
2. **En la plataforma:** En Operaciones, cuando haya una alarma en el NVR (por ejemplo detección de movimiento), debería crearse una alerta y poder usar “Ver canal en vivo” para ese canal.
3. **En la consola:** Si hay eventos, verás líneas como `[PlatformSender] Evento enviado: MOTION_EX ch=0 start`.

---

## Varias NVR en la misma red

Si hay más de una NVR:

1. Creá una carpeta de configs, ej. `config`, y un archivo por NVR: `config\nvr-porteria.properties`, `config\nvr-deposito.properties`, cada uno con su `nvr.ip` y `nvr.id`.
2. Ejecutá **un agente por NVR**: dos ventanas (o dos servicios), cada una con:
   ```bat
   java ... com.cronoapp.nvragent.Main config\nvr-porteria.properties
   ```
   ```bat
   java ... com.cronoapp.nvragent.Main config\nvr-deposito.properties
   ```
3. En la plataforma, cada NVR debe estar dado de alta con el mismo `nvr.id` que en su archivo de config.

---

## Problemas frecuentes

| Problema | Qué revisar |
|----------|--------------|
| “No se encuentra java” | Instalar JDK y abrir una CMD nueva; probar `java -version`. |
| “Login fallido” | IP correcta, puerto 37777, usuario/contraseña del NVR, y que la PC pueda hacer ping al NVR. |
| “Could not find library” / error de DLL | Las DLL del SDK deben estar en `run\win64` y esa ruta debe ser la de `java.library.path` (como en `run.bat`). |
| No llegan alertas a la plataforma | Revisar `platform.url` y `platform.key`; que la PC tenga internet y que la Cloud Function esté desplegada. |
| Alertas pero “Ver en vivo” no funciona | En Cámaras/NVR, el NVR debe tener los datos de streaming (IP/puerto/usuario/contraseña del flujo) y el `nvr.id` debe coincidir con el del agente. |

Si algo no coincide con tu carpeta (por ejemplo el JAR está en `target\`), adaptá las rutas en `run.bat` o en el comando que uses.

---

## Agente instalable y parametrizable (resumen)

El agente está pensado para instalarse en la PC del cliente y ejecutarse como **servicio** (NSSM u otro), con **todo parametrizado** en `config.properties` (o en archivos por NVR):

| Parámetro | Dónde | Uso |
|-----------|--------|-----|
| **nvr.id** | config | Mismo ID que en CronoApp (Cámaras NVR). Obligatorio para que las alertas se asocien y se pueda "Ver en vivo". |
| **nvr.name** | config | Nombre para mostrar en alertas y N8N. |
| **channel.names** | config | Nombres de cámaras por canal (coma separada, orden 0, 1, 2…). Ver [ALTA-NVR-NUEVA.md](ALTA-NVR-NUEVA.md). |
| **platform.url** | config | Webhook N8N o Cloud Function. |
| **platform.key** | config | Secreto para la plataforma (Firestore `nvr_config/webhook` o N8N). |
| **event.types.include** | config | Qué eventos enviar (ej. `VIDEOLOST_EX,SHELTER_EX,ALARM_EX`). |
| **platform.heartbeat.interval.seconds** | config | Heartbeat cada N segundos (0 = desactivado). |

Así podés desplegar la misma carpeta en varias PCs y solo cambiar el archivo de config (IP del NVR, nvr.id, channel.names) para asociar cada agente a su NVR y nombres de canales.
