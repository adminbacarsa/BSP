# Alta de una NVR nueva y parametrización de canales

Cuando instalás el agente en una PC que va a conectarse a una NVR **nueva**, conviene parametrizar **nombre del NVR** y **nombres de canales** para que las alertas sean claras (en N8N, CronoApp y reportes).

**Flujo recomendado (alta real desde el agente):** Si querés que la NVR quede dada de alta en la plataforma **desde el agente** al instalarlo (mismo ID, datos de conexión para "Ver en vivo" y clave por NVR), usá el flujo de **registro desde el agente**: [REGISTRO-DESDE-AGENTE.md](REGISTRO-DESDE-AGENTE.md). Así no hace falta crear el NVR a mano en Cámaras NVR; el agente lo registra y la plataforma le devuelve una clave para usar en adelante.

---

## 1. En CronoApp (Cámaras NVR) — flujo manual

Así la plataforma reconoce el NVR y sus canales; el agente debe usar el **mismo ID** que acá.

1. Entrá a **Admin → Cámaras NVR**.
2. **Agregar NVR:**
   - **Número de serie / ID:** elegí un identificador único (ej. `nvr-porteria`, `NVR-PORTERIA` o el serial del equipo). **Este valor es el que vas a poner en el agente como `nvr.id`.**
   - **Cantidad de canales:** la que tenga la NVR (ej. 16).
   - **Cliente** y **Objetivo:** asigná a qué cliente/objetivo pertenece.
3. Se crean automáticamente las rutas por canal (`nvrId__1`, `nvrId__2`, …).
4. **Opcional:** en cada canal podés editar el **nombre de cámara** (ej. "Entrada", "Hall"). Esos nombres se usan en alertas y en el dashboard.

Si preferís, podés crear solo los canales que usás (Crear canal) con el mismo `nvrId` y nombrarlos.

---

## 2. En el agente (config.properties)

En la PC donde corre el agente, editá `config.properties`:

```properties
# Conexión al NVR
nvr.ip=192.168.0.XXX
nvr.port=37777
nvr.user=admin
nvr.password=tu_password

# Mismo ID que en CronoApp (Cámaras NVR). Obligatorio para que las alertas se asocien bien.
nvr.id=nvr-porteria

# Opcional: nombre para mostrar (N8N, alertas, logs)
nvr.name=NVR Portería

# Opcional: nombres de canales (coma separada, en orden: canal 0, 1, 2...)
# Si no los definís, en la app se usa el nombre del canal en CronoApp o "Canal N".
channel.names=Entrada principal,Hall,Estacionamiento,Perimetral

# URL del webhook (N8N) o de la Cloud Function
platform.url=http://localhost:5678/webhook/nvr-alertas
platform.key=
```

- **nvr.id:** tiene que ser **exactamente** el mismo que el ID / número de serie del NVR en Cámaras NVR.
- **nvr.name:** solo informativo; hace que la data sea más legible (N8N, payload, etc.).
- **channel.names:** si lo definís, el agente envía `channelName` en cada evento (ej. "Entrada principal" para el canal 0). En CronoApp, si el canal ya tiene nombre en la ruta, se usa ese; si no, se usa el que mande el agente.

---

## 3. Orden de prioridad de los nombres

| Dónde se muestra el nombre | Origen (prioridad) |
|----------------------------|---------------------|
| **Cámara en la alerta**    | 1) Nombre del canal en CronoApp (ruta), 2) `channelName` del agente (`channel.names`), 3) "Canal N". |
| **NVR en la alerta**       | 1) `nvrName` del agente (`nvr.name`), 2) Nombre del dispositivo en CronoApp (nvr_devices). |

Así podés parametrizar todo en el agente y que se vea bien aunque aún no hayas afinado los nombres en CronoApp; cuando los definas en la app, la app tiene prioridad.

---

## 4. Resumen para instalar una NVR nueva

1. **CronoApp:** Alta del NVR (ID + canales + cliente/objetivo) y, si querés, nombres por canal.
2. **Agente:** Mismo `nvr.id`, IP/usuario/contraseña correctos, y opcionalmente `nvr.name` y `channel.names`.
3. Reiniciar el agente; las alertas empezarán a llegar con nombres significativos.

Si la NVR no está dada de alta en CronoApp, las alertas no se crearán (la Cloud Function solo crea alertas para rutas existentes). Para que todo funcione, el NVR debe existir en Cámaras NVR con al menos las rutas de los canales que disparan eventos.
