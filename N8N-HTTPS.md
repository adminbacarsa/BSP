# N8N con HTTPS (sin Docker)

Usando **Caddy** instalado en Windows como proxy: obtiene el certificado Let's Encrypt y redirige a N8N.

**Dominio:** autbacar.dnsalias.com

---

## Requisitos

- **N8N** corriendo en el host: `n8n start` (puerto 5678).
- **Router:** reenviar puertos **80** y **443** a la IP de la PC donde corre N8N.
- **autbacar.dnsalias.com** debe apuntar a tu IP pública.

---

## 1. Instalar Caddy en Windows

1. Descargá Caddy para Windows (64 bits):  
   https://github.com/caddyserver/caddy/releases  
   (archivo `caddy_windows_amd64.exe`).

2. Creá una carpeta para Caddy, por ejemplo `C:\caddy\`, y copiá ahí el exe (renombralo a `caddy.exe` si querés):
   ```powershell
   mkdir C:\caddy
   copy "C:\Users\Soporte\Downloads\caddy_windows_amd64.exe" C:\caddy\caddy.exe
   ```

3. Creá en `C:\caddy\` un archivo **Caddyfile** (sin extensión) con este contenido:

```caddyfile
autbacar.dnsalias.com {
    reverse_proxy 127.0.0.1:5678
}
```

4. En el **router**, reenviá los puertos **80** y **443** a la IP de esta PC (la que tiene N8N).

5. En el **Firewall de Windows**, permití entrada en los puertos **80** y **443** (igual que con 5678).

---

## 2. Ejecutar Caddy

Abrí **PowerShell o CMD** (como administrador si da error de puertos), entrá a la carpeta de Caddy y ejecutá:

```powershell
cd C:\caddy
.\caddy.exe run
```

(Si renombraste el exe a `caddy.exe`, podés usar `.\caddy run`.)

La primera vez, Caddy pedirá el certificado a Let's Encrypt (necesita que el puerto 80 sea accesible desde internet). Cuando termine, dejá esa ventana abierta.

Entrá en el navegador a:

**https://autbacar.dnsalias.com**

(Sin `:5678`; el puerto 443 es el estándar de HTTPS.)

---

## 3. Configurar N8N para que use la URL pública (HTTPS)

Para que N8N genere webhooks y **callbacks OAuth2** con tu dominio HTTPS (y no con `http://0.0.0.0:5678`), arrancalo con estas variables:

**PowerShell:**

```powershell
$env:WEBHOOK_URL = "https://autbacar.dnsalias.com"
$env:N8N_HOST = "autbacar.dnsalias.com"
$env:N8N_PROTOCOL = "https"
n8n start
```

- **WEBHOOK_URL**: las Production URLs de los nodos Webhook serán `https://autbacar.dnsalias.com/webhook/...`.
- **N8N_HOST** y **N8N_PROTOCOL**: la URL de callback para OAuth2 (y otras redirecciones) será `https://autbacar.dnsalias.com/rest/oauth2-credential/callback` en lugar de `http://0.0.0.0:5678/...`.

---

## 4. N8N como servicio de Windows (NSSM)

Para que N8N arranque con Windows y no tengas que abrir una ventana:

1. **Descargar NSSM:** https://nssm.cc/download → descomprimí y copiá `nssm.exe` (de la carpeta win64) a `D:\APP\nssm\nssm.exe`.

2. **Abrir PowerShell o CMD como Administrador** (clic derecho → Ejecutar como administrador).

3. **Rutas a usar** (ajustá si tu Node está en otro lado):
   - Node: `C:\Program Files\nodejs\node.exe`
   - N8N (instalado global): `C:\Users\Soporte\AppData\Roaming\npm\node_modules\n8n\bin\n8n`
   - Si no encontrás la carpeta de n8n, ejecutá `where n8n` en una consola normal y usá la ruta que aparezca.

4. **Instalar el servicio** (en la consola de administrador):

```bat
cd /d D:\APP\nssm
nssm install n8n "C:\Program Files\nodejs\node.exe" "C:\Users\Soporte\AppData\Roaming\npm\node_modules\n8n\bin\n8n" start
```

   Si NSSM abre una ventana de configuración:
   - **Path:** `C:\Program Files\nodejs\node.exe`
   - **Startup directory:** `C:\Users\Soporte` (o la carpeta de tu usuario).
   - **Arguments:** `"C:\Users\Soporte\AppData\Roaming\npm\node_modules\n8n\bin\n8n" start`

5. **Variables de entorno** (para webhooks y OAuth con HTTPS):

```bat
nssm set n8n AppEnvironmentExtra "WEBHOOK_URL=https://autbacar.dnsalias.com" "N8N_HOST=autbacar.dnsalias.com" "N8N_PROTOCOL=https"
```

6. **Iniciar el servicio:**

```bat
nssm start n8n
```

7. **Comandos útiles** (desde `D:\APP\nssm` o con ruta completa):
   - Ver estado: `nssm status n8n`
   - Parar: `nssm stop n8n`
   - Reiniciar: `nssm restart n8n`
   - Quitar el servicio: `nssm remove n8n confirm`

Después de reiniciar Windows, N8N debería levantarse solo. Entrá a N8N y comprobá que los workflows con webhook estén **Active**.

---

## 5. Dejar Caddy como servicio (opcional)

Para que Caddy arranque con Windows y no tengas que abrir la ventana a mano:

- Podés usar **NSSM** (igual que para N8N) para instalar `caddy.exe` como servicio.
- Comando de ejecución: `C:\caddy\caddy run --config C:\caddy\Caddyfile` (o `D:\APP\caddy\caddy run` si usás esa ruta).

O creá un acceso directo en Inicio que ejecute `caddy run` en esa carpeta.

---

## Si algo falla

- **"Timeout during connect (likely firewall problem)"** al obtener el certificado: Let's Encrypt no puede llegar a tu PC. Tenés que **abrir en el router los puertos 80 y 443** y reenviarlos a la IP de esta PC (la misma donde corre Caddy). También en el **Firewall de Windows** permití entrada en **TCP 80** y **TCP 443**. Sin eso no se puede emitir el certificado.
- **"Certificate verification failed"**: igual que arriba: el puerto **80** (y 443) tienen que estar abiertos y reenviados.
- **"Connection refused"** al abrir https://: N8N tiene que estar corriendo en el puerto 5678 antes de abrir la URL.
- **"Site not found"**: revisá que el Caddyfile tenga exactamente `autbacar.dnsalias.com` y que el archivo esté guardado en la carpeta desde donde ejecutás `caddy run`.
