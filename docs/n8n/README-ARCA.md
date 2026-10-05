# ARCA eventuales — flujos n8n

Tres workflows para importar. No traen claves. La clave fiscal se carga en COSP (Eventuales → Parámetros → ARCA, SuperAdmin) y queda en Secret Manager. El JSON local es solo respaldo.

| Archivo | Dónde | Qué hace |
|---|---|---|
| `arca-local-lotes.json` | n8n local `https://192.168.0.8:5678` (alias `https://autbacar.dnsalias.com`) | 18:00 altas AT, 09:00 bajas BT (hora Argentina) y webhook `urgente` |
| `arca-local-robot.json` | el mismo n8n local | Playwright: login, Simplificación Registral, carga masiva, número de transacción, confirma en COSP |
| `arca-cloud-respaldo-urgente.json` | `https://bacarit.app.n8n.cloud/` | si un AT/BT urgente no se confirmó en N minutos, mail a RRHH con el link de carga manual |

Los JSON viejos `arca-local-playwright.json` y `arca-cloud-link-mágico.json` quedan de referencia. El que se importa para el aviso es el de respaldo: el link mágico lo emite COSP (`link-emitir`), igual que ese borrador.

COSP llama al webhook cuando un AT o BT pasa a canal URGENTE (`onArcaEnvioUrgente`). Cloud Functions no llega a `192.168.0.8`: la URL tiene que ser el alias público.

## Instalar en la PC del n8n

En la PC del n8n (`D:\APP\cronoapp`, `https://autbacar.dnsalias.com`, puerto 5678) hay una sola acción: clic derecho en `INSTALAR-ROBOT-ARCA.cmd` (raíz del repo) y **Ejecutar como administrador**. Llama a `scripts/arca-robot/instalar.ps1`. Se puede correr dos veces.

Detecta cómo arranca n8n (servicio Windows nssm o WinSW, PM2, tarea programada, `n8n start` o Docker Desktop) y lo dice. Si hay más de un modo, o no puede saberlo, no cambia el arranque ni otras variables.

Cuando el modo es uno solo, deja en ese arranque únicamente:

```text
ARCA_ENVIOS_URL=https://us-central1-comtroldata.cloudfunctions.net/arcaEnviosApi
ARCA_TXT_DIR=D:\arca-txt
ARCA_SHOTS_DIR=D:\arca-txt\shots
COSP_REPO=D:\APP\cronoapp
ARCA_CLAVES_PATH=D:\secretos\arca-claves.json
ARCA_SIMULACION=1
ARCA_ROBOT_REINTENTOS=3
NODES_EXCLUDE=[]
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

`ARCA_ROBOT_KEY` se pide por pantalla (oculta) y queda en el entorno de esa PC o servicio. No se escribe en el repo. Si ya estaba, no la vuelve a pedir.

Crea `D:\arca-txt`, `D:\arca-txt\shots` y `D:\secretos` (SYSTEM, Administradores y la cuenta de n8n). Si COSP no tiene la clave, el robot usa ese JSON como respaldo. Si falta el archivo, copia `arca-claves.example.json` a `arca-claves.json` y abre el Bloc de notas: ahí se completan el CUIT y la clave fiscal. No la pide por pantalla ni la escribe en el repo.

En `D:\APP\cronoapp\scripts\arca-robot` instala Playwright y Chromium. Reinicia n8n según el modo y prueba `GET /healthz`. El log es `D:\arca-txt\instalar.log`.

No setea `N8N_ROBOT_WEBHOOK`. Si falta, dejala en el mismo arranque: `https://127.0.0.1:5678/webhook/cosp-arca-robot`.

## 1. Variables (ninguna va al repo)

En el **proceso** del n8n local (no en el JSON):

```text
ARCA_ENVIOS_URL=https://us-central1-comtroldata.cloudfunctions.net/arcaEnviosApi
ARCA_ROBOT_KEY=LA_MISMA_QUE_EL_SECRETO_DE_FIREBASE
ARCA_TXT_DIR=D:\arca-txt
ARCA_SHOTS_DIR=D:\arca-txt\shots
COSP_REPO=D:\APP\cronoapp
N8N_ROBOT_WEBHOOK=https://127.0.0.1:5678/webhook/cosp-arca-robot
ARCA_CLAVES_PATH=D:\secretos\arca-claves.json
ARCA_SIMULACION=1
ARCA_ROBOT_REINTENTOS=3
```

`ARCA_N8N_URGENTE_URL` no va en n8n: va en el entorno de Functions (la setea el deploy cuando Mauro lo pida), por ejemplo `https://autbacar.dnsalias.com/webhook/urgente`. El certificado tiene que ser válido para Node. COSP manda el header `x-arca-key` con `ARCA_ROBOT_KEY`.

Crear `D:\arca-txt` antes de activar. El archivo de claves, **fuera del repo**:

```json
{
  "30000000000": "PEGAR_LA_CLAVE_FISCAL_SOLO_ACA"
}
```

La clave del JSON es el CUIT de la empresa, solo dígitos. Un CUIT por empresa. Permisos de lectura solo para el usuario que corre n8n. No copiar ese archivo a COSP ni a git.

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

4. El flujo de lotes pide `GET ?action=lote`, guarda el TXT en `ARCA_TXT_DIR` y llama al robot. El robot **no entra a ARCA** y confirma en COSP con un número `SIM-...` y origen ROBOT.
5. Revisar en `arca_envios` que el lote quedó `CONFIRMADO` con ese número. No tiene que haber login a AFIP.
6. Para el respaldo: un urgente que siga `PENDIENTE` más de N minutos. Cloud pide `GET ?action=vencidos`. COSP emite el link (y el push a quien tenga el aviso `ARCA_ALTA_PENDIENTE` o `ARCA_BAJA_PENDIENTE`) y el nodo Gmail manda el estado y el link. Un envío se avisa una sola vez.

Los horarios 18:00 (AT, canal LOTE) y 09:00 (BT, canal LOTE) ya estan en el JSON, zona `America/Argentina/Buenos_Aires`. El viernes a las 18:00 incluye lo del fin de semana porque eso ya lo clasifico COSP al armar el envio.

## 5. Pasar a real

1. `ARCA_SIMULACION=0` y reiniciar n8n.
2. Probar un solo lote chico de una empresa cuyo CUIT este en `arca-claves.json`.
3. El robot entra a Clave Fiscal, abre Simplificación Registral → Relaciones Laborales → Carga Masiva → Nuevo, sube el TXT, lee el o los números de transacción y la constancia, y llama `POST ?action=resultado` con `estado: CONFIRMADO`, `loteId` y `nroTransaccion`.
4. Si falla, reintenta (`ARCA_ROBOT_REINTENTOS`, default 3), guarda una captura en `ARCA_SHOTS_DIR` y marca el lote `ERROR` con el detalle. Esos envios vuelven a entrar en el próximo lote.
5. Un `SUBIENDO` de más de 20 minutos (el proceso murio) también vuelve al lote.

La primera corrida real puede pedir un ajuste de selector si AFIP cambio la pantalla. La captura del error muestra donde se corto. No hace falta tocar COSP para eso: es `scripts/arca-robot/subir.mjs`.

## Endpoints (header `x-arca-key`)

| Accion | Uso |
|---|---|
| `GET ?action=lote&tipo=AT\|BT&canal=LOTE\|URGENTE[&empresaId=]` | TXT unico por empresa. Pasa esos envios a `SUBIENDO` y les pone `loteId`. No incluye `enviable: false` ni los quitados del lote. |
| `POST ?action=resultado` | `{ loteId o envioId, estado, nroTransaccion?, nrosTransaccion?, constanciaUrl?, error? }`. Confirmar exige número. Un lote confirmado comparte el mismo número. |
| `GET ?action=vencidos&minutos=N` | AT/BT urgentes sin confirmar hace más de N minutos. No devuelve el TXT. |
| `POST ?action=link-emitir` | `{ envioId, marcarRespaldo: true }` link de un solo uso. El push lo manda COSP. |
| `GET ?action=config-avisos&empresaId=&tipo=` | mails de RRHH ya resueltos. |

Sin el header, o con otra clave, responden `401`. Estos cambios de la function hay que desplegarlos aparte: este trabajo no despliega.
