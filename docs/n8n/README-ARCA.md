# ARCA eventuales — flujos n8n

Tres workflows para importar. No traen claves. La clave fiscal se carga en COSP (Eventuales → Parámetros → ARCA → «Acceso a ARCA del robot», SuperAdmin, botón **Guardar credenciales**) y queda en Secret Manager, un secreto por CUIT de ingreso que varias empresas pueden compartir. El JSON local es solo respaldo.

| Archivo | Dónde | Qué hace |
|---|---|---|
| `arca-local-lotes.json` | n8n local `https://192.168.0.8:5678` (alias `https://autbacar.dnsalias.com`) | 18:00 altas AT, 09:00 bajas BT (hora Argentina) y webhook `urgente` |
| `arca-local-robot.json` | el mismo n8n local | Playwright: carga masiva y, de a una, anulación (`--modo anular --envio ID`) |
| `arca-cloud-respaldo-urgente.json` | `https://bacarit.app.n8n.cloud/` | cada 10 min, AT/BT/ANULACION urgente sin cerrar: mail a RRHH con estado y link manual. ENVIADO no entra. |

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

En n8n Cloud no se usa `$env` (Cloud lo bloquea en los nodos). La URL y la clave se cargan como variable del proyecto y credencial Header Auth. El paso a paso está en «Respaldo urgente en n8n Cloud». Ahí no hay clave fiscal.

Para que los nodos del n8n **local** vean `$env`: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. El nodo Execute Command tiene que estar habilitado en el n8n local (en Cloud no se usa).

## 2. Playwright en la PC del n8n

En el repo de esa PC (Playwright ya es dependencia de desarrollo del monorepo):

```text
npx playwright install chromium
```

El script es `scripts/arca-robot/subir.mjs`. Con `ARCA_SIMULACION=1` no abre el navegador.

## 3. Importar

1. n8n local → Workflows → Import from file → `arca-local-robot.json`. Activar.
2. Importar `arca-local-lotes.json`. No activar todavía.
3. n8n Cloud → seguir «Respaldo urgente en n8n Cloud». No activar el horario hasta probar un envío a mano.

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
6. El respaldo de Cloud se prueba con un envío de pruebas, como dice la sección de abajo. Un envío se avisa una sola vez (`marcarRespaldo`).

Los horarios 18:00 (AT, canal LOTE) y 09:00 (BT, canal LOTE) ya estan en el JSON, zona `America/Argentina/Buenos_Aires`. El viernes a las 18:00 incluye lo del fin de semana porque eso ya lo clasifico COSP al armar el envio.

## 5. Pasar a real

1. `ARCA_SIMULACION=0` y reiniciar n8n.
2. Probar un solo lote chico de una empresa cuya clave fiscal ya esté en COSP (Secret Manager).
3. El robot entra a Clave Fiscal → portal → **Simplificación Registral - Empleadores** → elige el CUIT del empleador en el `<select>` (no el primero) → Continuar si aparece DatosBasicos → `CargaMasiva.aspx` (LISTADO DE NOVEDADES). Si no hay abierta: **Nuevo**. Si hay una Abierta del código guardado en el lote: lápiz. Si hay otra abierta ajena: error claro y captura (nunca borra). En el principal guarda `arcaCodigoNovedad`, abre **Cargar Archivo**, sube el TXT, valida Registros vs líneas, presenta (selectores por confirmar) y lee el Nro. Transacción del listado por Código. Confirma con `POST ?action=resultado`.
4. Si falla, reintenta (`ARCA_ROBOT_REINTENTOS`, default 3), guarda una captura en `ARCA_SHOTS_DIR` y marca el lote `ERROR` con el detalle. Esos envios vuelven a entrar en el próximo lote.
5. Un `SUBIENDO` de más de 20 minutos (el archivo murio) también vuelve al lote.

Selectores reales (capturas 05/10) en `scripts/arca-robot/selectores.json`. Tras Cargar válido: **Volver → Enviar**; Nro. desde listado (Estado Enviado); constancia SETI (`codigoControl`, `nroVerificador`). Anulación: **por confirmar** (`--modo explorar` / `--modo explorar-carga`). Con archivo: `node scripts/arca-robot/subir.mjs --modo explorar --archivo TXT --lote …` llega hasta después de Cargar y no presenta. Anulación: `node scripts/arca-robot/subir.mjs --modo explorar --envio ID --empresa EMPRESA`.



## Altas masivas por texto (AT urgente)

`empresas.arcaEventuales.canalUrgente`: `ALTAS_TEXTO` o `CARGA_MASIVA` (default). Solo cambia el AT con canal URGENTE. El lote de las 18:00 sigue por Carga Masiva.

Con `ALTAS_TEXTO` el robot usa `--modo altas-texto`: Relaciones Laborales → Registrar Nuevas Altas → Altas Masivas, pega hasta 10 líneas de 85 y Aceptar. Los errores salen como `Registro N: …`. `--modo explorar-altas` frena antes de Aceptar y captura. El número de alta o CAT de un Aceptar válido queda **por confirmar**: si aparece se guarda y el envío pasa a `ENVIADO` (la verificación CUIL sigue igual); si no aparece, no se marca enviado.


## Respaldo urgente en n8n Cloud

Instancia: `https://bacarit.app.n8n.cloud/`. Archivo: `docs/n8n/arca-cloud-respaldo-urgente.json`.

Cada 10 minutos hace `GET arcaEnviosApi?action=vencidos&minutos=30` con el header `x-arca-key`. Por cada AT, BT o ANULACION urgente sin cerrar: `POST ?action=link-emitir` (`marcarRespaldo: true`, un aviso por envío) y un mail a los destinatarios de `GET ?action=config-avisos`. El mail lleva el estado y el link de carga manual.

| Estado | Mail |
|---|---|
| `ENVIADO` | No. Ya tiene número y la fichada está habilitada. |
| `VERIFICAR` | Sí. Texto propio: «enviado pero no aparece en ARCA». |
| `MANUAL` de anulación | Sí. Hay que anular en la web de ARCA. |
| `PENDIENTE`, `SUBIENDO`, `ERROR` | Sí, pasados 30 minutos, si todavía no se avisó. |

Cloud bloquea `$env` en los nodos. Este JSON no lo usa.

1. En Cloud: **Settings → Variables** (variables del proyecto). Crear `ARCA_ENVIOS_URL` con el valor `https://us-central1-comtroldata.cloudfunctions.net/arcaEnviosApi`. Sin barra al final. El flujo la lee como `$vars.ARCA_ENVIOS_URL`.
2. **Credentials → Header Auth**. Nombre de la credencial: `ARCA x-arca-key` (el JSON la referencia por ese nombre). Name del header: `x-arca-key`. Value: el mismo secreto `ARCA_ROBOT_KEY` de Firebase. No pegar la clave en el workflow.
3. **Workflows → Import from file** → `arca-cloud-respaldo-urgente.json`. En los tres nodos HTTP (GET vencidos, Pedir link, GET config-avisos) elegir esa credencial Header Auth si Cloud no la tomó sola.
4. Nodo **Mail a RRHH**: credencial **Gmail OAuth2** de la cuenta que envía (Credentials → Gmail OAuth2 → Sign in with Google, o una que ya exista). El JSON solo trae el nombre `Gmail RRHH`, sin token ni refresh token. Asignarla al nodo.
5. No activar el horario todavía.

Probar con un envío de pruebas (no entra a ARCA):

1. En COSP, un envío de `pruebas_sa` (o la empresa de prueba) con `canal: URGENTE`, tipo AT, BT o ANULACION, estado `PENDIENTE`, `MANUAL` o `VERIFICAR`, `createdAt` de más de 30 minutos y sin `respaldoAvisadoAt`. La empresa tiene que tener en Configuración → Avisos un mail de RRHH para `ARCA_ALTA_PENDIENTE` (BT usa `ARCA_BAJA_PENDIENTE`; ERROR usa `ARCA_ERROR`).
2. En el workflow, **Execute workflow** una vez (no hace falta esperar los 10 minutos).
3. El mail de un `VERIFICAR` dice «enviado pero no aparece en ARCA». El de una anulación `MANUAL` dice que hay que hacerla en la web. El de un `PENDIENTE` dice que no se confirmó, con el estado y el link.
4. Un `ENVIADO` no tiene que aparecer en el GET ni generar mail.
5. Volver a ejecutar: ese envío no se repite (`respaldoAvisadoAt`). Para probar de nuevo, borrar ese campo en el doc de prueba.
6. Si el mail y el link están bien, activar el workflow.

El filtro de estados está en `esUrgenteVencido` y en la consulta de `arcaEnviosApi`. Hasta el próximo deploy de functions, producción sigue con el filtro anterior.

## Verificación post-envío (ENVIADO ≠ CONFIRMADO)

Tras **Enviar**, el robot confirma el lote como `ENVIADO` (con `nroTransaccion`). La fichada queda habilitada. Un paso `--modo verificar` (n8n: día siguiente o cada pocas horas hasta 48 h) consulta por CUIL: si hay tarjeta con Fecha de Inicio = fecha del alta y Mod. Contrato **012** → `CONFIRMADO`; si no aparece en 48 h → `VERIFICAR` + novedad `ARCA_ALTA_VERIFICAR` (revisar Domicilio Fiscal Electrónico).

| Extra | Uso |
|---|---|
| `GET ?action=verificacion&envioId=` | Datos para el robot de verificación |
| `GET ?action=verificacion-pendientes` | Listado de AT en `ENVIADO` |

## Anulación automática

Al entrar en `PENDIENTE`, COSP avisa el webhook urgente. El robot busca el alta por CUIL y fecha (AAAAMMDD) o por el número de transacción, anula, lee el acuse y hace `POST ?action=resultado` con `estado: ANULADO` y origen ROBOT. Si falla 2 veces, o faltan menos de 2 horas para el plazo RG 2988, el envío queda `MANUAL` en ARCA pendientes y se avisa a RRHH. Si el plazo vence, sigue la baja código 30.

## Endpoints (header `x-arca-key`)

| Accion | Uso |
|---|---|
| `GET ?action=lote&tipo=AT\|BT&canal=LOTE\|URGENTE[&empresaId=]` | TXT unico por empresa. Pasa esos envios a `SUBIENDO` y les pone `loteId`. No incluye `enviable: false` ni los quitados del lote. |
| `GET ?action=anulacion&envioId=` | Datos de una anulación: CUIL, fecha AAAAMMDD, nro de transacción del alta y `cuitRepresentado`. Si faltan menos de 2 h o el robot ya falló 2 veces, responde `MANUAL` y no hay que entrar a ARCA. |
| `POST ?action=resultado` | `{ loteId o envioId, estado, nroTransaccion?, nrosTransaccion?, constanciaUrl?, error?, arcaCodigoNovedad? }`. Confirmar exige número. Un lote confirmado comparte el mismo número. |
| `POST ?action=arca-codigo` | `{ loteId o envioId, arcaCodigoNovedad }` guarda el Código de Carga Masiva sin cambiar el estado. |
| `GET ?action=vencidos&minutos=N` | AT/BT/ANULACION urgentes en PENDIENTE, SUBIENDO, ERROR, MANUAL o VERIFICAR, pasados N minutos. ENVIADO, CONFIRMADO y ANULADO no entran. No devuelve el TXT. |
| `POST ?action=link-emitir` | `{ envioId, marcarRespaldo: true }` link de un solo uso. El push lo manda COSP. |
| `GET ?action=config-avisos&empresaId=&tipo=` | mails de RRHH ya resueltos. |

Sin el header, o con otra clave, responden `401`. Estos cambios de la function hay que desplegarlos aparte: este trabajo no despliega.
