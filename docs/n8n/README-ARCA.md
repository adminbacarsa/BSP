# ARCA eventuales — flujos n8n

Tres workflows para importar. No traen claves. La clave fiscal se carga en COSP (Eventuales → Parámetros → ARCA, SuperAdmin) y queda en Secret Manager. El JSON local es solo respaldo.

| Archivo | Dónde | Qué hace |
|---|---|---|
| `arca-local-lotes.json` | n8n local `https://192.168.0.8:5678` (alias `https://autbacar.dnsalias.com`) | 18:00 altas AT, 09:00 bajas BT (hora Argentina) y webhook `urgente` |
| `arca-local-robot.json` | el mismo n8n local | Playwright: carga masiva y, de a una, anulación (`--modo anular --envio ID`) |
| `arca-cloud-respaldo-urgente.json` | `https://bacarit.app.n8n.cloud/` | si un AT/BT urgente no se confirmó en N minutos, mail a RRHH con el link de carga manual |

Los JSON viejos `arca-local-playwright.json` y `arca-cloud-link-mágico.json` quedan de referencia. El que se importa para el aviso es el de respaldo: el link mágico lo emite COSP (`link-emitir`), igual que ese borrador.

COSP llama al webhook cuando un AT o BT pasa a canal URGENTE, y cuando una anulación entra en `PENDIENTE` (`onArcaEnvioUrgente`, tipo `ANULACION`). El flujo de lotes, en ese caso, no arma TXT: llama al robot con `--modo anular --envio ID`. Cloud Functions no llega a `192.168.0.8`: la URL tiene que ser el alias público.

## Instalar en la PC del n8n

En la PC del n8n (`D:\APP\cronoapp`, `https://autbacar.dnsalias.com`, puerto 5678) hay una sola acción: clic derecho en `INSTALAR-ROBOT-ARCA.cmd` (raíz del repo) y **Ejecutar como administrador**. Llama a `scripts/arca-robot/instalar.ps1`. Se puede correr dos veces.

En la PC del n8n, n8n corre con PM2 del usuario Soporte (`C:\Users\Soporte\.pm2`, `pm2.cmd`). El instalador corre como administrador: busca `pm2.cmd` (nunca el `pm2` sin extensión) y el `dump.pm2` en `C:\Users\*\.pm2`. Si hay PM2, ese es el arranque y no se mezcla con la tarea de inicio.

Deja las variables a nivel **máquina** (sobreviven un reinicio) y las aplica al proceso con `pm2 restart n8n --update-env` y `pm2 save`:

```text
ARCA_ENVIOS_URL=https://us-central1-comtroldata.cloudfunctions.net/arcaEnviosApi
ARCA_TXT_DIR=D:\arca-txt
ARCA_SHOTS_DIR=D:\arca-txt\shots
COSP_REPO=D:\APP\cronoapp
ARCA_SIMULACION=1
ARCA_ROBOT_REINTENTOS=3
NODES_EXCLUDE=[]
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
N8N_ROBOT_WEBHOOK=http://127.0.0.1:5678/webhook/cosp-arca-robot
```

`ARCA_ROBOT_KEY` se pide oculta si no está seteada. Si ya está, pregunta si se reemplaza. No se escribe en el repo. La clave fiscal ya no va en `D:\secretos\arca-claves.json` (sale de COSP / Secret Manager): el instalador no abre el Bloc de notas; si ese archivo tiene datos, avisa que se puede borrar.

Crea `D:\arca-txt` y `D:\arca-txt\shots`. En `scripts\arca-robot` instala Playwright y Chromium. Después del reinicio prueba `GET /healthz` y si el nodo Execute Command quedó disponible. Si Docker está instalado pero el motor no responde, lo ignora. Al final muestra el resumen en pantalla y lo deja en `D:\arca-txt\instalar.log`, y espera una tecla.

Si COSP no tiene la clave fiscal cargada, el robot puede usar como respaldo `D:\secretosrca-claves.json` (CUIT y clave), que queda solo en esa PC.

## 1. Variables (ninguna va al repo)

En el **proceso** del n8n local (no en el JSON):

```text
ARCA_ENVIOS_URL=https://us-central1-comtroldata.cloudfunctions.net/arcaEnviosApi
ARCA_ROBOT_KEY=LA_MISMA_QUE_EL_SECRETO_DE_FIREBASE
ARCA_TXT_DIR=D:\arca-txt
ARCA_SHOTS_DIR=D:\arca-txt\shots
COSP_REPO=D:\APP\cronoapp
N8N_ROBOT_WEBHOOK=http://127.0.0.1:5678/webhook/cosp-arca-robot
ARCA_SIMULACION=1
ARCA_ROBOT_REINTENTOS=3
```

`ARCA_N8N_URGENTE_URL` no va en n8n: va en el entorno de Functions (la setea el deploy cuando Mauro lo pida), por ejemplo `https://autbacar.dnsalias.com/webhook/urgente`. El certificado tiene que ser válido para Node. COSP manda el header `x-arca-key` con `ARCA_ROBOT_KEY`.

La clave fiscal ya no va en `D:\secretos\arca-claves.json`: se carga desde COSP y vive en Secret Manager. Si ese archivo quedó de una instalación anterior, se puede borrar.

En n8n Cloud, las mismas `ARCA_ENVIOS_URL` y `ARCA_ROBOT_KEY`, más `ARCA_URGENTE_MINUTOS=30`. Ahí no hay clave fiscal.

Para que los nodos vean `$env`: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. El nodo Execute Command tiene que estar habilitado en el n8n local (en Cloud no se usa).

## 2. Playwright en la PC del n8n

En el repo de esa PC (Playwright ya es dependencia de desarrollo del monorepo):

```text
npx playwright install chromium
```

El script es `scripts/arca-robot/subir.mjs`. Con `ARCA_SIMULACION=1` no abre el navegador.

## 3. Importar

1. n8n local → Workflows → Import from file → `arca-local-robot.json`. Activar.
2. Importar `arca-local-lotes.json`. No activar todavía.
3. n8n Cloud → importar `arca-cloud-respaldo-urgente.json`. En el nodo Gmail elegir la credencial de RRHH (el JSON trae el nombre `Gmail RRHH`, sin token). No activar todavía.

Los webhooks de producción quedan `POST /webhook/urgente` y `POST /webhook/cosp-arca-robot`. Hay que mandar `x-arca-key`. Si falta o no coincide, el flujo corta con `NO_AUTORIZADO`.

## 4. Probar en simulación

1. Dejar `ARCA_SIMULACION=1` y reiniciar el proceso de n8n para que tome las variables.
2. Activar los dos flujos locales y el de Cloud.
3. En COSP (cuando la function ya esté desplegada) generar un AT urgente, o pegarle al webhook a mano:

```text
POST https://127.0.0.1:5678/webhook/urgente
x-arca-key: LA_MISMA_QUE_ARCA_ROBOT_KEY
{"empresaId":"ID_DE_LA_EMPRESA","tipo":"AT","canal":"URGENTE"}
```

4. El flujo de lotes pide `GET ?action=lote`, guarda el TXT en `ARCA_TXT_DIR` y llama al robot. El robot **no entra a ARCA** y confirma en COSP con un número `SIM-...` y origen ROBOT. Una anulación en simulación confirma con `SIM-ANUL-...` y tampoco pide la clave.
5. Revisar en `arca_envios` que el lote quedó `CONFIRMADO` con ese número. No tiene que haber login a AFIP.
6. Para el respaldo: un urgente que siga `PENDIENTE` más de N minutos. Cloud pide `GET ?action=vencidos`. COSP emite el link (y el push a quien tenga el aviso `ARCA_ALTA_PENDIENTE` o `ARCA_BAJA_PENDIENTE`) y el nodo Gmail manda el estado y el link. Un envío se avisa una sola vez.

Los horarios 18:00 (AT, canal LOTE) y 09:00 (BT, canal LOTE) ya estan en el JSON, zona `America/Argentina/Buenos_Aires`. El viernes a las 18:00 incluye lo del fin de semana porque eso ya lo clasifico COSP al armar el envio.

## 5. Pasar a real

1. `ARCA_SIMULACION=0` y reiniciar n8n.
2. Probar un solo lote chico de una empresa cuya clave fiscal ya esté en COSP (Secret Manager).
3. El robot entra a Clave Fiscal, abre Simplificación Registral → Relaciones Laborales → Carga Masiva → Nuevo, sube el TXT, lee el o los números de transacción y la constancia, y llama `POST ?action=resultado` con `estado: CONFIRMADO`, `loteId` y `nroTransaccion`.
4. Si falla, reintenta (`ARCA_ROBOT_REINTENTOS`, default 3), guarda una captura en `ARCA_SHOTS_DIR` y marca el lote `ERROR` con el detalle. Esos envios vuelven a entrar en el próximo lote.
5. Un `SUBIENDO` de más de 20 minutos (el proceso murio) también vuelve al lote.

La primera corrida real puede pedir un ajuste de selector si AFIP cambio la pantalla. La captura del error muestra donde se corto. Los selectores de la anulación están en `scripts/arca-robot/selectores.json`. Con credenciales reales y `ARCA_SIMULACION=0`, `node scripts/arca-robot/subir.mjs --modo explorar --envio ID --empresa EMPRESA` recorre hasta la búsqueda y **no confirma**.

## Anulación automática

Al entrar en `PENDIENTE`, COSP avisa el webhook urgente. El robot busca el alta por CUIL y fecha (AAAAMMDD) o por el número de transacción, anula, lee el acuse y hace `POST ?action=resultado` con `estado: ANULADO` y origen ROBOT. Si falla 2 veces, o faltan menos de 2 horas para el plazo RG 2988, el envío queda `MANUAL` en ARCA pendientes y se avisa a RRHH. Si el plazo vence, sigue la baja código 30.

## Endpoints (header `x-arca-key`)

| Accion | Uso |
|---|---|
| `GET ?action=lote&tipo=AT\|BT&canal=LOTE\|URGENTE[&empresaId=]` | TXT unico por empresa. Pasa esos envios a `SUBIENDO` y les pone `loteId`. No incluye `enviable: false` ni los quitados del lote. |
| `GET ?action=anulacion&envioId=` | Datos de una anulación: CUIL, fecha AAAAMMDD, nro de transacción del alta y `cuitRepresentado`. Si faltan menos de 2 h o el robot ya falló 2 veces, responde `MANUAL` y no hay que entrar a ARCA. |
| `POST ?action=resultado` | `{ loteId o envioId, estado, nroTransaccion?, nrosTransaccion?, constanciaUrl?, error? }`. Confirmar exige número. Un lote confirmado comparte el mismo número. |
| `GET ?action=vencidos&minutos=N` | AT/BT urgentes sin confirmar hace más de N minutos. No devuelve el TXT. |
| `POST ?action=link-emitir` | `{ envioId, marcarRespaldo: true }` link de un solo uso. El push lo manda COSP. |
| `GET ?action=config-avisos&empresaId=&tipo=` | mails de RRHH ya resueltos. |

Sin el header, o con otra clave, responden `401`. Estos cambios de la function hay que desplegarlos aparte: este trabajo no despliega.
