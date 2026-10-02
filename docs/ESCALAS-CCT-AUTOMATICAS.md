# Escalas CCT automáticas — CCT 422/05 (SUVICO – CAESI)

Relevamiento del 01/10/2026, rehecho el mismo día cuando Mauro confirmó que los vigiladores de Bacar cobran por el **CCT 422/05** (SUVICO, Córdoba), no por el 507/07 (UPSRA). No se escribió producción ni se desplegó nada.

## Fuente oficial del 422/05

El acto que da vigencia a cada acuerdo salarial del 422/05 es una **Disposición de la Dirección Nacional de Relaciones y Regulaciones del Trabajo (DNRYRT)**, Secretaría de Trabajo, Empleo y Seguridad Social, Ministerio de Capital Humano (Ley 14.250). La homologación es **nacional**, no provincial: SUVICO (personería gremial 1370) firma con la **CAESI** (Cámara Argentina de Empresas de Seguridad e Investigación), las partes acreditan ante la Secretaría de Trabajo de la Nación y el acta dice que "cobrará vigencia a partir de la homologación integral por la Secretaría de Trabajo de la Nación". No hay cámara cordobesa firmante ni homologación del Ministerio de Trabajo de Córdoba que reemplace esto.

Cadena de homologaciones encontrada (todas indexadas en `argentina.gob.ar/normativa`, texto en Infoleg, publicadas en el Boletín Oficial de la Nación):

| Acuerdo | Vigencia | Acto | Publicación | Anexo |
|---------|----------|------|-------------|-------|
| Acta Acuerdo Salarial 2026 SUVICO–CAESI (22/12/2025), Acuerdo **305/26** | 01/01/2026 → 30/06/2026 | **Disposición DNRYRT 120/2026** (`DI-2026-120-APN-DNRYRT#MCH`, 19/01/2026), EX-2025-142737110-APN-DGDTEYSS#MCH, RE-2025-142735643 | BORA 35924, 05/06/2026, p. 81 | https://www.argentina.gob.ar/sites/default/files/infoleg/426471/disp120.pdf (6 páginas, **con capa de texto**) |
| Acta Acuerdo Salarial 2025 (20/10/2025), Acuerdo 2890/25 | 01/10/2025 → 31/12/2025 (viáticos hasta 31/03/2026) | Disposición DNRYRT 2481/2025 | BORA | https://www.argentina.gob.ar/sites/default/files/infoleg/421457/disp2481-anexo1.pdf (anexo con tablas **sin** texto) |
| Acuerdo 2025 (RE-2025-20494329) | 2025 | Disposición DNRYRT 500/2025 | BORA 35651, 22/04/2025 | infoleg |
| Acuerdo 2024 | 2024 | Disposición 150/24 | BORA 35419, 13/05/2024 | infoleg |

Lo que trae la Disposición 120/2026 además de la grilla: suma no remunerativa mensual que se incorpora al básico en **julio 2026** (cláusula tercera), adicional vacacional por día ($18.952 ene–mar, $19.220 abr, $19.480 may, $19.920 jun, tope 21 días), FAS 1% del básico de Vigilador (cláusula quinta), aporte solidario art. 29, y próxima paritaria desde el 20/05/2026 para julio en adelante (cláusula séptima). **A la fecha no se encontró homologada la escala julio–diciembre 2026** del 422/05: la nota de prensa y los PDF que circulan para julio 2026 son del 507/07 (UPSRA–CAESI). Lo último oficial del 422/05 es la Disposición 120/2026.

### Qué publica SUVICO

- https://www.suvico.org.ar/ → botón "Escala Salarial Actualizada" → Google Drive `10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc`: **PDF escaneado, 4 páginas, sin capa de texto** (1,2 MB). Contenido leído el 01/10/2026: escala **enero a junio 2026**, dos meses por página, 14 categorías, columnas Básico* / Presentismo* / Viático Art. 106 LCT / Adicional No Remunerativo / Total Bruto, más Adicional Aeroportuario, Adicional por Vacaciones y el cálculo del adicional por nocturnidad (jornada nocturna 9 hs / 17 días). Son los mismos números que el anexo de la Disposición 120/2026.
- El Drive `1bCdrAZ-HZ0ibrggmm5996WT_fXogcDXa` no es la escala: es la **Ley provincial 10.571** (régimen de prestadores de seguridad privada de Córdoba).
- El Drive `1Sc6Xhky8MCPBy9j2c14iqrAvK94UKLqd` está rotulado como el convenio 422/05.
- Los ids de Drive pueden cambiar; `/downloads.html`, `/escala` y `/escala-salarial` responden 404. No hay RSS.
- Descarga directa: `https://drive.google.com/uc?export=download&id=<id>` (hoy entrega el PDF sin pantalla de confirmación).

### Lo que no sirve como fuente

- El buscador avanzado del BORA (`/busquedaAvanzada/realizarBusqueda`) sigue respondiendo `{"error":2}`; el buscador de `argentina.gob.ar/normativa` carga por JS (sin resultados en el HTML). Para automatizar, mirar la ficha de la última disposición conocida y las notas de prensa (perfil.com, lavoz.com.ar, lavozdelvigilador.com —estas dos últimas detrás de Cloudflare—) como **disparador**, nunca como dato.
- Boletín Oficial de Córdoba: no homologa este convenio.
- UPSRA / infovigiladores / "grilla julio 2026": **507/07**. No cargar en 422/05.

## Categorías del 422/05 y código ARCA

Las 14 categorías del anexo, en el orden del documento: Vigilador, Vigilador Bombero, Administrativo, Encargado de turno, Controlador de admisión y permanencia gral, Acude alarma, Guía Técnico, Inst. de elem. de Seg. Electrónica, Personal de Monitoreo, Supervisión de Alarma, Investigador, Custodio de Primera, Custodio Brigada, Supervisor General.

El código **033104** que usa la plataforma (`empresas.arcaEventuales.categoria`) es la categoría profesional de ARCA para **Vigilador**; está mapeado en `CATEGORIAS_422` (`codigoArca`). Las otras trece no tienen código confirmado: quedan `codigoArca: null` hasta que RRHH los indique. El extractor no deduce códigos ARCA.

Conceptos por fila (`CONCEPTOS_422`): básico (remunerativo mensual), presentismo (remunerativo, **importe fijo** mensual, no porcentaje), viático art. 106 LCT (no remunerativo, mensual —en el 422/05 no es por día—), adicional no remunerativo del acuerdo (mensual; el de junio se incorpora al básico en julio), total bruto conformado sin antigüedad. Por tramo: adicional aeroportuario (mensual) y adicional por vacaciones (por día, tope 21). El acta no trae valor hora: el CCT lo calcula sobre el básico (`divisorHoras` 200 en `remuneracion.mjs`).

## Extractor

Código en `apps/functions/src/escalas/` (lógica pura, sin Firebase, importable con `node --experimental-strip-types`):

- `escalaCct422Core.ts`
  - `parsearAnexoOficial422(texto)`: anexo de la disposición **con capa de texto** (pypdf). Una tabla por mes, 14 filas, 5 importes. Los rótulos "ESCALA SALARIAL SUVICO - MES" salen desordenados en la capa de texto, así que el mes se asigna **por posición** dentro de la vigencia que declara el acta ("meses de ENERO A JUNIO de 2026") y la fila queda `mesConfianza: MEDIA (MES_POR_POSICION)`. Saca disposición, expediente, RE, número de acuerdo, mes en que el no remunerativo pasa al básico, aeroportuario y vacaciones por mes.
  - `GEMINI_PROMPT_422` + `GEMINI_RESPONSE_SCHEMA_422`: prompt y esquema JSON para el PDF **escaneado** (Gemini visión, el PDF va `inline_data` sin rasterizar). Pide importes enteros, mes `YYYY-MM`, categoría tal cual, `confianza` por fila y `confianzaMes`, y prohíbe completar por cálculo.
  - `lecturaDesdeGemini(json)` → `armarPropuesta422(lectura, meta)`: normaliza cualquiera de las dos lecturas a la misma **propuesta** con **confianza por campo**.
  - `compararPropuestas(a, b)`: diferencias celda a celda (sirve para validar Gemini contra el anexo oficial).
  - `tablaPropuesta(p)`: tabla de texto para consola / log.
- `escalaCct422Gemini.ts`: `leerEscala422ConGemini({ pdfBase64, apiKey })` (REST `generateContent`, `temperature 0`, `response_schema`). Valida que sea PDF, tope 12 MB.
- `extraerEscalaCct422.ts`: callable **`extraerEscalaCct422`** (exportada en `index.ts`, **sin deploy**). Permiso: SuperAdmin o rol con `RRHH` `create|update|adjust`. Entrada `{ pdfBase64 }` (escaneado → Gemini) o `{ textoAnexo }` (parser), más `fuenteUrl`, `titulo`, `empresaId`, `guardar`. Devuelve la propuesta; con `guardar: true` escribe `escalas_cct/CCT_422_05_{vigenciaDesde}_{hash8}` en `estado: PROPUESTA` (idempotente por hash del PDF) y un `audit_logs` `ESCALA_CCT_PROPUESTA`. **No toca `escalas_salariales`** ni aprueba nada. Producción: `runWith({ secrets: ['GEMINI_API_KEY'] })`; emulador: la clave de `apps/functions/.env`.

### Confianza por campo

Cada importe sale como `{ valor, confianza: ALTA | MEDIA | BAJA, motivo? }`:

| Situación | Confianza |
|-----------|-----------|
| Texto oficial y `básico + presentismo + viático + no rem. = total` | ALTA |
| Gemini, suma cierra, modelo declara ≥ 0,85 o no declara | ALTA |
| Gemini, suma cierra, modelo declara 0,60–0,84 | MEDIA |
| Suma **no cierra** (algún dígito mal leído) | **BAJA** en los 5 campos de la fila, `SUMA_NO_CIERRA` |
| Celda vacía | BAJA, `SIN_VALOR` (el resto de la fila MEDIA, `SUMA_NO_VERIFICABLE`) |
| Básico menor al del mes anterior | MEDIA, `BASICO_MENOR_AL_MES_ANTERIOR` |
| Mes asignado por posición (anexo con texto) | MEDIA, `MES_POR_POSICION` |
| Categoría que no está en las 14 | `codigo: DESCONOCIDA_*` + advertencia |

`confianzaGlobal` es la peor de todas. Advertencias: categorías faltantes o de más, saltos de mes, notas del modelo (páginas borrosas, textos al pie). RRHH ve la tabla con la confianza al lado de cada fila y aprueba o corrige; **nada se aplica solo**.

### Prueba contra el PDF de SUVICO (01/10/2026, scratch, sin escribir prod)

```
node scripts/escalas-cct/extraer-escala-422.mjs --texto <anexo disp120.txt> --out oficial-120.json
node scripts/escalas-cct/extraer-escala-422.mjs --pdf suvico-escala.pdf --comparar oficial-120.json --out suvico-gemini.json
```

- Anexo oficial (texto): 6 tramos × 14 categorías, las 84 filas con suma verificada (ALTA); vigencia 2026-01-01 → 2026-06-30; `DI-2026-120-APN-DNRYRT#MCH`, Acuerdo 305/26; no remunerativo al básico desde 2026-07-01. Confianza global MEDIA solo por el mes por posición.
- PDF escaneado (Gemini 2.5 Flash, 77–88 s, ~18–25 k tokens): 6 tramos × 14 categorías, meses leídos del rótulo (ALTA). **5 diferencias en 420 celdas** contra el oficial, y las 5 están en filas marcadas **BAJA / SUMA_NO_CIERRA** (ningún error pasó en silencio): marzo Personal de Monitoreo total 1.648.800 (oficial 1.649.800); abril Administrativo total 1.670.100 (1.671.100); abril Guía Técnico total 1.676.100 (1.671.100); junio Acude alarma y Personal de Monitoreo básico 981.300 (983.100). Vigilador 033104: junio básico 911.650, total 1.644.650, igual al oficial.

Tabla extraída (Vigilador, código ARCA 033104, escaneado SUVICO = Disposición 120/2026):

| Mes 2026 | Básico | Presentismo | Viático | No rem. | Total | Aeroportuario | Vacaciones/día |
|----------|-------:|------------:|--------:|--------:|------:|--------------:|---------------:|
| enero | 867.200 | 165.000 | 473.800 | 10.000 | 1.516.000 | 117.490 | 18.952 |
| febrero | 876.000 | 165.000 | 473.800 | 25.000 | 1.539.800 | 118.685 | 18.952 |
| marzo | 884.800 | 165.000 | 473.800 | 25.000 | 1.548.600 | 119.880 | 18.952 |
| abril | 893.650 | 165.000 | 480.500 | 25.000 | 1.564.150 | 121.080 | 19.220 |
| mayo | 902.600 | 165.000 | 487.000 | 30.000 | 1.584.600 | 122.290 | 19.480 |
| junio | 911.650 | 165.000 | 498.000 | 70.000 | 1.644.650 | 123.515 | 19.920 |

Las 14 categorías de los seis meses están en `scripts/escalas-cct/fixtures/disp-120-2026.extraido.json` (lo regenera el test). La lectura cruda de Gemini quedó en `fixtures/suvico-ene-jun-2026.gemini.json` para probar sin red.

Test (sin red, usa los fixtures): `npm run eval:escalas-cct` → `ESCALAS_CCT_422_OK`.

## Cómo lo usa la plataforma hoy

- `apps/web2/src/lib/eventuales/remuneracion.mjs`: el bruto del eventual sale de `escalaVigente` sobre `escalas_salariales` (`status: ACTIVE`, id `{convenio}_{categoria}_{vigenciaDesde}`, `basicoMensual / divisorHoras` 200). `presentismo.pct` espera un porcentaje: en el 422/05 es un **importe fijo** → al aprobar hay que guardarlo como adicional `FIJO_PERIODO` o un campo de importe, no como `pct`. El viático del 422/05 es **mensual**, no `POR_DIA`.
- `escalaPropuesta.mjs` (marca `ESCALA_SUVICO_TABLA`) queda como carga asistida manual; el camino nuevo es la callable.
- `payroll-api` deja `cctVersion: '422/05'` y no usa el básico: aprobar una escala no cambia la liquidación de planta hasta que alguien la conecte.

## Modelo `escalas_cct/{CCT_422_05}_{vigenciaDesde}_{hash8}`

Un documento por acuerdo (no una fila por categoría): `cct`, `estado PROPUESTA | APROBADA | RECHAZADA` (nunca nace APROBADA), `extraccion TEXTO_OFICIAL | GEMINI_VISION`, `partes`, `vigenciaDesde/Hasta`, `tramos[]` (mes, 14 categorías con los 5 campos con confianza, aeroportuario, vacaciones/día), `conceptos`, `noRemunerativoSeIncorporaAlBasicoDesde`, `fuente` (url, título, disposición, expediente, RE, acuerdo, BORA), `documentoHash` (sha256 del PDF o del texto), `confianzaGlobal`, `advertencias`, `modelo`, `creadoPor/En`, `aprobadoPor/En`. Si el hash ya existe no se crea otra propuesta.

## Flujo propuesto

1. **Disparador** (n8n, diario): hash del binario del Drive de SUVICO + ficha de la última disposición conocida en `argentina.gob.ar/normativa` + notas de prensa como aviso. Si cambia algo, descarga el PDF.
2. **Lectura**: la callable. Con capa de texto → parser; sin texto → Gemini. Resultado en `escalas_cct` como PROPUESTA, con la confianza y el origen a la vista. Push/mail a RRHH diciendo convenio, vigencia y cuántas filas quedaron BAJA.
3. **Aprobación** (pendiente de implementar): pantalla de RRHH, vigente contra propuesta, celda por celda. Una función del servidor (no el cliente) escribe `escalas_salariales` `ACTIVE` por categoría y mes, con presentismo fijo y viático mensual bien traducidos. La propuesta queda en `escalas_cct` como APROBADA. Lo ACTIVE de otro convenio no se pisa.
4. **Retroactivos**: la vigencia suele ser anterior a la homologación (el 2026 rige desde el 01/01 y se homologó el 19/01, BORA 05/06). Lo liquidado en meses cerrados queda `RETROACTIVO_PENDIENTE`; nada se recalcula solo. El no remunerativo de junio que pasa al básico en julio no crea solo el documento de julio: lo trae el acuerdo siguiente.

## Riesgos

- Gemini lee mal un dígito: cubierto por la suma por fila (5 de 5 detectados en la prueba). Un error que mantenga la suma (dos dígitos compensados) no se detecta: por eso RRHH compara contra el anexo oficial cuando lo hay, y la propuesta GEMINI_VISION se muestra como tal.
- Cargar el 507/07 en la colección 422/05: el extractor rechaza textos sin "422/05" y anota si el modelo leyó otro convenio.
- El anexo de 2025 (`disp2481-anexo1.pdf`) tiene las tablas como imagen aunque el acta tenga texto: el parser devuelve `SIN_TABLAS` y hay que pasar por Gemini igual.
- Reglas Firestore de `escalas_cct` (lectura admin, escritura solo servidor) agregadas en `firestore.rules`, **sin publicar**.
