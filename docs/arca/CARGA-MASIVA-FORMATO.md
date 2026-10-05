# ARCA — Simplificación Registral: Carga Masiva de Relaciones Laborales

Fuente: Manual de Ayuda oficial ARCA (SR_Manual-de-Ayuda_20250218_definitivo.pdf, págs. 22-25),
https://www.afip.gob.ar/simplificacionregistral/ayuda/documentos/SR_Manual-de-Ayuda_20250218_definitivo.pdf
Imagen: carga-masiva-formato-registro.png

Ruta: Simplificación Registral - Empleadores → Relaciones Laborales → Carga Masiva → Listado de Novedades → Nuevo → Seleccionar archivo (.txt) → Cargar → Enviar. Tablas de códigos: link "Ver tablas informativas de códigos" en esa pantalla.
Obligatorios en todos los eventos: tipo de registro, código de movimiento, CUIL del empleado, CUIL del vinculado, código de evento y fecha de inicio del vínculo.

Registro de posiciones fijas (una línea por movimiento):

| Descripción | Desde | Hasta | Tipo | Long | Formato |
|---|---|---|---|---|---|
| Tipo de registro | 1 | 2 | NUM | 2 | 01 |
| Código de movimiento | 3 | 4 | ALFA | 2 | AT, BT, MR, NA, NB |
| CUIL del empleado | 5 | 15 | NUM | 11 | dígito verificador válido |
| Marca trabajador agropecuario | 16 | 16 | ALFA | 1 | S o N (default N) |
| Modalidad de contrato | 17 | 19 | NUM | 3 | |
| Fecha de inicio de rel. laboral | 20 | 29 | ALFA | 10 | AAAA/MM/DD |
| Fecha de fin de rel. laboral | 30 | 39 | ALFA | 10 | AAAA/MM/DD |
| Código obra social | 40 | 45 | NUM | 6 | |
| Código de situación de revista | 46 | 47 | NUM | 2 | en AT: blanco; en BT: 30 |
| Fecha recepción telegrama de renuncia | 48 | 57 | ALFA | 10 | AAAA/MM/DD (en AT: blanco) |
| Retribución pactada | 58 | 72 | NUM | 15 | pesos con 2 decimales implícitos |
| Modalidad de liquidación | 73 | 73 | NUM | 1 | |
| Sucursal / domicilio de desempeño | 74 | 78 | NUM | 5 | código del domicilio de explotación |
| Actividad en el domicilio de desempeño | 79 | 84 | NUM | 6 | la del domicilio, no la CIIU genérica |
| Puesto desempeñado | 85 | 88 | ALFA | 4 | |
| Rectificación | 89 | 90 | NUM | 2 | en AT/BT: blanco (salvo rectificación real) |
| Código de Convenio Colectivo de Trabajo | 91 | 100 | ALFA | 10 | ej. `0422/05   ` (izq.) |
| Categoría profesional | 101 | 106 | NUM | 6 | |
| Tipo de servicio | 107 | 109 | NUM | 3 | |
| Fecha de suspensión servicios temporarios | 110 | 119 | ALFA | 10 | AAAA/MM/DD (en AT: blanco) |
| Número formulario agropecuario | 120 | 129 | NUM | 10 | en AT: blanco |
| Marca trabajo licenciado COVID / tipo contrato CCG | 130 | 130 | ALFA | 1 | **blanco** (no `0`) |

## Validado contra ARCA (05/10/2026)

Prueba real: Bacar Transportadora de Caudales S.A. CUIT **30-66813497-8**, novedad **245743**, una línea AT de `lineasCargaMasiva` con CUIL inválido a propósito. Las posiciones del formato estaban bien (cada campo cayó en su columna). Errores del validador y corrección:

| Error ARCA | Qué hacer |
|---|---|
| Marca de Covid / Tipo de Contrato CCG no permitido | Posición 130 en blanco (no `0`). |
| En un ALTA no debe informar Situación de Baja, Telegrama, Rectificación, Suspensión, Formulario Agropecuario | AT: revista (46-47) y rectificación (89-90) en blanco; telegrama/suspensión/formulario ya iban en blanco. |
| CUIL del empleado no válida | Esperado (prueba). COSP valida el dígito verificador antes (`CUIL_INVALIDO`, `enviable: false`). |
| Convenio Colectivo inexistente | Código real: **`0422/05`** (SEGURIDAD, SUVICO Córdoba). Alineado a la izquierda en 10 posiciones: `0422/05   `. |
| Marca de trabajador agropecuario: S ó N | Posición 16 = `N` (configurable). |
| Puesto desempeñado inexistente | `5414` no existe. Default propuesto **`5169`** (alternativa `9152`). Queda `PUESTO_A_VERIFICAR` hasta confirmación del contador. |
| En un ALTA debe informar Remuneración Pactada y Domicilio de Desempeño | Sucursal **00000** + actividad del domicilio **749210** (no 801000). Retribución: 15 dígitos con 2 decimales implícitos (`000000000100000` → 1000,00). |

Valores finales que ARCA aceptó (solo quedó el error del CUIL inválido): modalidad **012**, CCT **`0422/05`**, puesto **5169**, sucursal **00000**, actividad **749210**, agropecuario **N**, categoría **033104**, RNOS **122807**, modalidad liquidación **5**, tipo de servicio **500**; en AT revista, rectificación y covid en blanco. BT: misma regla (revista **30**, rectificación en blanco, agropecuario N, covid en blanco).

## Tablas informativas (descargadas 29/09/2026)

Fuente pública: https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/contribuyente/RelacionLaboral/CargaMasiva_tablasInformativas.aspx?tab=N
(3 modalidad de contratación, 4 modalidad de liquidación, 7 situación de revista, 8 rechazos, 24 tipos de servicio). Copias en esta carpeta (tabla-*.txt). Puestos: ver `tabla-puestos.txt` (códigos usados; la tabla completa no está publicada fuera del portal con clave).

Datos clave para eventuales:
- Modalidad de contrato **012 = Trabajo eventual** (código 12 de la tabla, 3 posiciones). 102 = Empleado Servicio Eventual en Usuaria (Dto 762) solo si contrata una Empresa de Servicios Eventuales. El 14 que dijo el contador es Nuevo período de prueba: no se usa.
- Movimientos: AT = alta (revista en blanco), BT = baja (revista **30**, vencimiento art. 250). Si el alta ya se subió y la persona no trabajó, no se manda un movimiento NA: va por el módulo de **Anulación de Incorporaciones** (RG 2988/2010 art. 9), sin código de motivo, dentro del plazo de `plazoAnulacionAlta`. Vencida esa ventana, la baja es BT con fecha de baja = el día de inicio previsto, motivo «desistimiento / sin efectivización de tareas» y revista `situacionRevistaDesistimiento` (default 30, por empresa). MR es modificación, no este caso.
- Modalidad de liquidación: **5 = HORA**. Tipo de servicio: **500 = Servicios comunes discontinuos**.
- Actividad en el domicilio de desempeño **749210** (transporte de caudales / objetos de valor en el domicilio 00000 de Bacar Transportadora). Sucursal / domicilio de explotación = **00000**. Puesto default **5169** (verificar). Categoría profesional Vigilador = **033104**. CCT = **`0422/05`**. Defaults de `empresas/{id}.arcaEventuales` en bacarsa, grupos_bacar_sa y pruebas_sa; se editan por empresa. Obra social: RNOS de cada vigilador; si no tiene, SUVICO **122807**.
- Esos defaults viven en `empresas/{id}.arcaEventuales`. El generador es `lineasCargaMasiva`. Retribución pactada: 15 dígitos, centavos implícitos (bruto × 100). Una línea mide 130. Si faltan CCT, categoría, obra social, puesto, domicilio o actividad, o el CUIL no cierra, la línea se arma igual y `enviable` queda en false.
