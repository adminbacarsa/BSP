# Escalas CCT automaticas

Investigacion del 01/10/2026. No se escribio produccion ni se desplego nada.
La plataforma hoy liquida eventuales con `escalas_salariales` del CCT 422/05.
El ultimo acuerdo salarial que se pudo bajar y leer no es ese convenio.

## Fuentes

Oficial de verdad, en este relevamiento:

- El acto que homologa es una Disposicion de la Direccion Nacional de Relaciones y Regulaciones del Trabajo (Secretaria de Trabajo, Empleo y Seguridad Social, Ministerio de Capital Humano), Ley 14.250. El PDF que UPSRA titula "HOMOLOGACION UPSRA C. CAESI" es copia de ese acto: expediente `EX-2026-66453648-APN-CGDTEYS#MCH`, documento del acuerdo `RE-2026-66453610-APN-CGDTEYS#MCH`. Homologa el acuerdo UPSRA?CAESI del **CCT 507/07** (1/7/2026 al 31/12/2026). El campo "Numero" de la disposicion no salio en la capa de texto. URL del PDF: https://upsra.org.ar/sitio/wp-content/uploads/2026/07/HOMOLOGACION-UPSRA-C.-CAESI.pdf
- El canal de publicacion oficial es el Boletin Oficial de la Nacion (Direccion Nacional del Registro Oficial). La propia disposicion dice "publiquese" y, si la Secretaria no publica gratis, rige el art. 5 de la Ley 14.250. Buscador: https://www.boletinoficial.gob.ar/busquedaAvanzada/primera (POST `/busquedaAvanzada/realizarBusqueda`). En esta sesion el POST respondio `{"error":2,"mensajes":["Hubo un error al realizar la busqueda"]}`. No hay URL de aviso confirmada para este expediente, ni RSS ni API estable verificada. Formato de cada aviso, cuando se abre: HTML y PDF. Frecuencia: diaria, pero la paritaria no sale todos los dias.

No alcanza como fuente unica:

- Indice del sindicato nacional, HTML, sin API. https://upsra.org.ar/sitio/escalas-salariales/ Lista PDFs y el feed del sitio es https://upsra.org.ar/sitio/feed/ (el de la home de WordPress; editar la pagina de escalas no garantiza un item RSS). El acta con los numeros es PDF con capa de texto: https://upsra.org.ar/sitio/wp-content/uploads/2026/07/ACTA-SALARIAL-JUL-DIC-2026-CAESI-UPSRA-RE-2026-66453610.pdf Sirve para detectar un archivo nuevo. No reemplaza la homologacion: el acta sola es el acuerdo de partes.
- SUVICO (Cordoba), HTML en https://www.suvico.org.ar/ El boton "Escala Salarial Actualizada" abre un PDF de Google Drive escaneado, sin capa de texto (4 paginas, 1,2 MB, extraccion 0): https://drive.google.com/file/d/10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc/view El convenio lo rotulan 422/05 en otro Drive: https://drive.google.com/file/d/1Sc6Xhky8MCPBy9j2c14iqrAvK94UKLqd/view `/escala` y `/escala-salarial` responden pagina Error404. No hay RSS. El id de Drive puede cambiar. No es fuente oficial ni unica.
- Boletin Oficial de Cordoba, https://boletinoficial.cba.gov.ar/ (HTML, home 200). La busqueda `?s=` devolvio HTTP 500. No se confirmo una homologacion provincial de SUVICO ni de una camara cordobesa.
- CAESI, https://www.caesi.org.ar/ respondio 403. Es la camara firmante del 507/07, no se confirmo que publique la escala.
- CAESCOR: `caescor.org.ar` y `www.caescor.org` no resolvieron DNS. No se confirmo la camara empresaria de Cordoba.
- Infoleg, https://www.infoleg.gob.ar/ y el formulario https://servicios.infoleg.gob.ar/infolegInternet/buscarNormas.do El formulario cargo. Esta sesion no obtuvo el texto de la paritaria semestral. No usar Infoleg como fuente de la escala del semestre.
- Salario minimo, https://www.argentina.gob.ar/trabajo/consejodelsalario Resolucion 4/2026, SMVM $ 383.800 desde septiembre 2026. Es otro instrumento. No es la escala del CCT.

Datos que trae el acta 507/07 (leida el 01/10/2026): categorias (Vigilador General, Bombero, Principal, Administrativo, Verificacion de Eventos, Operador de Monitoreo, Guia Tecnico, Instalador, Controlador de Admision), basico por mes jul?dic 2026, presentismo en pesos fijos por categoria (no un porcentaje), viatico por dia no remunerativo, suma no remunerativa mensual (la de diciembre se incorpora al basico el 1/1/2027), adicionales aeroportuario y Neuquen. No trae valor hora ni horas extra: el CCT los calcula sobre el basico. No trae el codigo ARCA `033104` (eso es categoria profesional de AFIP, no una fila de la escala).

Vigilador General, julio 2026, segun el acta: basico $ 1.001.300, presentismo $ 180.000, viatico $ 20.220 por dia, no remunerativo $ 20.000. Diciembre: basico $ 1.085.000, no remunerativo $ 120.000.

## Como lo usa la plataforma hoy

- `apps/web2/src/lib/eventuales/remuneracion.mjs`: el bruto del eventual sale de `escalaVigente`. Doc id `{convenio}_{categoria}_{vigenciaDesde}`. Solo entra `status: ACTIVE`. Valor hora = `basicoMensual / divisorHoras` (default 200). Recargos en porcentaje. Presentismo, si existe, es **porcentaje** del basico prorrateado por dias. Adicionales con modo `POR_HORA | POR_JORNADA | POR_DIA | FIJO_PERIODO`.
- `apps/web2/src/lib/eventuales/types.ts`: `convenio: 'CCT_422_05'`, estados `ACTIVE | PENDIENTE_APROBACION | INACTIVE`.
- `escalaPropuesta.mjs`: el job solo propone si el texto trae la marca `ESCALA_SUVICO_TABLA`. Si no, avisa `SIN_FUENTE_PARSEABLE`. No hay scheduler. Aprobar pasa la propuesta a `ACTIVE`. No se aplica sola.
- Coleccion que lee el server al armar el TXT: `escalas_salariales` con `status == ACTIVE` (`planificacionEventuales.ts`).
- `packages/hours-core` no lee escalas ni pesos. La liquidacion de horas (`payroll-api`) deja `cctVersion: '422/05'` y no usa el basico. Aprobar una escala no cambia los pesos de la liquidacion de planta hasta que alguien la conecte.

El presentismo del acta 2026 es un importe fijo, y el modelo actual espera un porcentaje. Hay que guardarlo como adicional `FIJO_PERIODO` (o un campo de importe), no como `presentismo.pct`.

## Modelo propuesto

Coleccion nueva `escalas_cct/{cct}_{vigenciaDesde}`. Un documento por acuerdo, no una fila por categoria.

- `cct`: `CCT_507_07` o `CCT_422_05`. No mezclar.
- `vigenciaDesde` / `vigenciaHasta`.
- `estado`: `PROPUESTA | APROBADA | RECHAZADA`. Nunca nace `APROBADA`.
- `fuente`: url, titulo, expediente, documento RE, quien lo bajo.
- `documentoHash`: sha256 del PDF o del texto extraido. Si el hash ya existe, no se crea otra propuesta.
- `tramos[]`: un mes, basicos por categoria, `noRemunerativoMensual`, `viaticoPorDia`.
- `presentismo[]`: importe mensual fijo por categoria.
- `noRemunerativoSeIncorporaAlBasicoDesde`: en este acuerdo, `2027-01-01`. No inventar el basico de enero.
- `aprobadoPor`, `aprobadoEn`.

Al aprobar, una funcion (no el cliente) parte los tramos en los docs que ya lee `remuneracion.mjs` (`escalas_salariales`, `ACTIVE`), uno por categoria y mes, con `vigenciaHasta` el fin de ese mes. La propuesta queda en `escalas_cct`. Lo que ya esta `ACTIVE` de un convenio distinto no se pisa.

`033104` sigue en `empresas.arcaEventuales.categoria`. RRHH mapea categoria CCT a ese codigo. El extractor no lo deduce.

## Flujo

1. n8n Cloud, una vez por dia: baja el HTML de https://upsra.org.ar/sitio/escalas-salariales/ y compara los `href` de PDF. Si hay uno nuevo, lo descarga y calcula el hash. En paralelo reintenta el buscador del Boletin Oficial por el numero de expediente; si aparece el aviso, esa URL queda como fuente oficial. SUVICO se mira aparte (hash del binario de Drive): si no hay texto, no se parsea solo.
2. Si el PDF tiene capa de texto, corre el parser de `scripts/escalas-cct/extraerActa.mjs`. Si no tiene texto (el Drive de SUVICO), una callable con el secreto `GEMINI_API_KEY` devuelve el mismo JSON y queda marcada `extraccion: GEMINI` para que RRHH no la trate igual que el parser. Hash repetido: no hace nada.
3. Escribe `escalas_cct` en `PROPUESTA` y avisa a RRHH (push del canal de avisos y mail). El aviso dice el convenio detectado. Si es 507/07 y la empresa sigue en 422/05, el aviso lo dice y no ofrece aprobarlo contra la escala 422.
4. RRHH compara tramo por tramo con la vigente y aprueba o rechaza. Nadie aplica la escala sin ese paso. Despublicar o borrar el PDF de origen no borra la propuesta.
5. Desde `vigenciaDesde`, eventuales usan la escala del dia de cada jornada (`escalaVigente`). La liquidacion de planta en pesos no cambia en este diseno.

### Retroactivos

La vigencia puede ser anterior al dia de la aprobacion (este acuerdo rige desde el 1/7/2026 y se firmo el 6/7/2026). Los contratos ya documentados no se reescriben solos. Lo ya liquidado en un mes cerrado queda marcado `RETROACTIVO_PENDIENTE`: diferencia propuesta, sin nota de credito ni regenaracion de pago. Un eventual nuevo, o un recalculo explicito de RRHH, toma la escala de la fecha de la jornada. La suma de diciembre que pasa al basico en enero 2027 no crea sola el documento de enero.

## Riesgos

- Cargar el 507/07 en la coleccion 422/05. SUVICO rotula 422/05 y no se pudo leer su PDF. Hasta que RRHH diga que Cordoba cobra la escala nacional, la propuesta 507/07 no se aprueba para Bacar.
- Gemini o un OCR inventan un basico. Por eso el parser determinista va primero y Gemini queda marcado.
- El indice de UPSRA puede subir el acta antes de la homologacion. `APROBADA` exige que RRHH haya visto la disposicion, no solo el acta.
- El buscador del Boletin Oficial no respondio. No hay poll confiable de la fuente oficial hasta resolver ese POST.
- Presentismo fijo contra el campo `pct` actual: aprobar sin traducir el importe duplicaria o anularia el concepto.
- El viatico del acta es por dia trabajado. El adicional `POR_DIA` del motor lo aplica a cada fecha de jornada, que es lo mas cerca, y RRHH tiene que confirmarlo en la comparacion.
- Retroactivo sobre un mes ya pagado, si se aplicara solo.

## Plan en 3 pasos

1. Detector. n8n mira el HTML de UPSRA y el hash del PDF. Parser de este repo. Solo log y JSON. Sin Firestore. Hecho el prototipo de este paso sobre el acta jul?dic 2026.
2. Propuesta. Callable que guarda `escalas_cct` en `PROPUESTA`, hash, fuente, y avisa a RRHH. Gemini solo si no hay capa de texto. Sigue sin tocar `escalas_salariales`.
3. Aprobacion. Pantalla de RRHH: vigente contra propuesta, convenio explicito, y recien ahi la funcion escribe `ACTIVE` por categoria y mes. Retroactivo en meses cerrados queda pendiente, no se paga solo.

## Prototipo

`scripts/escalas-cct/extraerActa.mjs` leyo el texto extraido con pypdf del acta (11 paginas, capa de texto). El PDF de SUVICO no entra: `SIN_CAPA_DE_TEXTO`.

```
node scripts/escalas-cct/eval-extraer-acta.mjs
```

Resultado corrido el 01/10/2026: `ESCALAS_CCT_EXTRACTOR_OK`, convenio `CCT_507_07`, seis tramos (julio a diciembre 2026), nueve categorias, Vigilador General julio $ 1.001.300. Salida: `scripts/escalas-cct/fixtures/acta-jul-dic-2026.extraido.json`.
