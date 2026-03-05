# Instalar Maven y SDK para poder ejecutar el agente

Si no tenés Maven instalado ni el Dahua NetSDK, seguí estos pasos en orden.

---

## 0. Tener JDK (no solo JRE)

Maven necesita un **JDK** para compilar (el JRE no trae el compilador). Si ves *"No compiler is provided in this environment. Perhaps you are running on a JRE rather than a JDK?"*:

1. **Descargá un JDK** (no JRE), por ejemplo:
   - [Eclipse Temurin JDK 8](https://adoptium.net/temurin/releases/?version=8&os=windows&arch=x64) (LTS) → descargá el **.msi** o **.zip** de JDK.
   - O [Oracle JDK](https://www.oracle.com/java/technologies/downloads/) si preferís.

2. **Instalá el JDK** (o descomprimí el ZIP en una carpeta, ej. `C:\Program Files\Eclipse Adoptium\jdk-8.x`).

3. **Configurá JAVA_HOME** apuntando a la carpeta del **JDK** (donde hay `bin\javac.exe`):
   - Variables de entorno → Variables del sistema → Nuevo: nombre `JAVA_HOME`, valor `C:\Program Files\Eclipse Adoptium\jdk-8.0.xxx-hotspot` (o la ruta donde instalaste).
   - En **Path**, agregá `%JAVA_HOME%\bin` (o la ruta completa).

4. **Comprobá en una CMD nueva:**
   ```bat
   java -version
   javac -version
   ```
   Las dos tienen que mostrar versión. Si `javac` no existe, seguís con un JRE; tenés que instalar/usar un JDK.

---

## 1. Instalar Maven (para que funcione `mvn`)

### Opción A: Descargar e instalar a mano

1. **Descargá Maven** (ZIP para Windows):
   - https://maven.apache.org/download.cgi
   - Bajá **apache-maven-3.9.x-bin.zip** (Binary zip).

2. **Descomprimí** el ZIP en una carpeta, por ejemplo:
   - `C:\Program Files\Apache\maven`  
   (quedando `C:\Program Files\Apache\maven\bin\mvn.cmd`).

3. **Agregar Maven al PATH**:
   - Buscá en Windows **"Variables de entorno"** → "Editar las variables de entorno del sistema".
   - En "Variables del sistema" elegí **Path** → Editar → Nuevo.
   - Agregá la ruta al **bin** de Maven, ej.: `C:\Program Files\Apache\maven\bin`.
   - Aceptar todo.

4. **Comprobá**: abrí una **nueva** CMD y escribí:
   ```bat
   mvn -version
   ```
   Deberías ver la versión de Maven y de Java.

### Opción B: Con Chocolatey (si lo tenés)

```bat
choco install maven
```

Luego abrí una CMD nueva y `mvn -version`.

---

## 2. Conseguir el Dahua NetSDK Java

El agente usa el **NetSDK Java** de Dahua (no el H5 del navegador). Lo tenés que descargar desde el sitio de Dahua o del soporte del NVR.

- **Nombre típico del paquete:** algo como `General_NetSDK_ChnEng_JAVA_Win64_IS_V3.060...` o `General_NetSDK_Eng_JAVA_Win64_IS_...`.
- Dentro suele haber una carpeta con el mismo nombre que contiene:
  - `pom.xml` (para Maven)
  - `libs\win64\` (DLLs: `dhnetsdk.dll`, etc.)
  - `src\` (código del SDK)

**Recomendado: copiar el SDK dentro del proyecto** para tener todo junto y no depender de rutas externas:

1. Descomprimí el paquete del NetSDK que bajaste.
2. Entrá a la carpeta **que tiene** `pom.xml` y `libs` (a veces es una subcarpeta con el mismo nombre del ZIP).
3. **Copiá todo el contenido** de esa carpeta (pom.xml, libs/, src/, res/, etc.) dentro de:
   ```
   D:\APP\cronoapp\apps\nvr-agent\sdk\
   ```
   De forma que quede `apps\nvr-agent\sdk\pom.xml`, `apps\nvr-agent\sdk\libs\win64\`, etc.

Si hacés eso, **COMPILAR-CON-MAVEN.bat** usará automáticamente `sdk` sin que tengas que editar rutas. La carpeta `sdk` está en `.gitignore` (no se sube al repo).

Si preferís no copiarlo, dejá el SDK donde lo descomprimiste y en COMPILAR-CON-MAVEN.bat configurá la variable `SDK_PATH` con esa ruta.

---

## 3. Instalar el NetSDK en Maven (una sola vez)

Abrí CMD y entrá a la **carpeta del SDK** (la que tiene el `pom.xml` del NetSDK). Por ejemplo:

```bat
cd C:\Users\Soporte\Downloads\General_NetSDK_Eng_JAVA_Win64_IS_V3.060.0000003.0.R.251127
```

Si dentro hay otra carpeta con el mismo nombre, entrá a esa:

```bat
cd General_NetSDK_ChnEng_JAVA_Win64_IS_V3.060.0000003.0.R.251127
```

Ejecutá:

```bat
mvn clean install -DskipTests
```

Cuando termine sin errores, el SDK quedó instalado en tu Maven local.

---

## 4. Compilar el agente

```bat
cd D:\APP\cronoapp\apps\nvr-agent
mvn clean package
```

Se genera `target\nvr-agent-1.0.0.jar` y `target\lib\*`.

---

## 5. Copiar las DLL del SDK

Del paquete del NetSDK, la carpeta **libs\win64** tiene las DLL que necesita el agente.

- **Origen:** `C:\...\General_NetSDK_...\libs\win64\` (toda la carpeta)
- **Destino:** `D:\APP\cronoapp\apps\nvr-agent\run\win64\`

Creá la carpeta `run\win64` en `nvr-agent` si no existe, y copiá ahí **todo** el contenido de `libs\win64` (archivos como `dhnetsdk.dll`, etc.).

---

## 6. Ejecutar el agente

En CMD:

```bat
cd D:\APP\cronoapp\apps\nvr-agent
run.bat
```

O doble clic en `run.bat`. Deberías ver que se conecta al NVR y que la plataforma es tu URL de N8N.

---

## Resumen rápido

| Paso | Qué hacer |
|------|-----------|
| 1 | Instalar Maven (descarga + PATH) y verificar con `mvn -version` |
| 2 | Tener el NetSDK Java de Dahua (carpeta con pom.xml y libs\win64) |
| 3 | En la carpeta del SDK: `mvn clean install -DskipTests` |
| 4 | En `apps\nvr-agent`: `mvn clean package` |
| 5 | Copiar `libs\win64` del SDK → `apps\nvr-agent\run\win64` |
| 6 | Ejecutar `run.bat` desde `apps\nvr-agent` |

Si en el paso 2 no tenés el SDK, tenés que conseguirlo (Dahua, soporte del NVR o quien te dio el proyecto).
