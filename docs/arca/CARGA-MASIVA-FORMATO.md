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
| CUIL del empleado | 5 | 15 | NUM | 11 | |
| Marca trabajador agropecuario | 16 | 16 | ALFA | 1 | |
| Modalidad de contrato | 17 | 19 | NUM | 3 | |
| Fecha de inicio de rel. laboral | 20 | 29 | ALFA | 10 | AAAA/MM/DD |
| Fecha de fin de rel. laboral | 30 | 39 | ALFA | 10 | AAAA/MM/DD |
| Código obra social | 40 | 45 | NUM | 6 | |
| Código de situación de revista | 46 | 47 | NUM | 2 | |
| Fecha recepción telegrama de renuncia | 48 | 57 | ALFA | 10 | AAAA/MM/DD |
| Retribución pactada | 58 | 72 | NUM | 15 | |
| Modalidad de liquidación | 73 | 73 | NUM | 1 | |
| Sucursal - Domicilio de desempeño | 74 | 78 | NUM | 5 | |
| Actividad en el domicilio de desempeño | 79 | 84 | NUM | 6 | |
| Puesto desempeñado | 85 | 88 | ALFA | 4 | |
| Rectificación | 89 | 90 | NUM | 2 | 00,01,02,03,04,05 |
| Código de Convenio Colectivo de Trabajo | 91 | 100 | ALFA | 10 | |
| Categoría profesional | 101 | 106 | NUM | 6 | |
| Tipo de servicio | 107 | 109 | NUM | 3 | |
| Fecha de suspensión servicios temporarios | 110 | 119 | ALFA | 10 | AAAA/MM/DD |
| Número formulario agropecuario | 120 | 129 | NUM | 10 | |
| Marca trabajo licenciado COVID / tipo contrato CCG | 130 | 130 | NUM | 1 | 0-9 |

Pendiente de confirmar en las tablas de códigos del servicio: significado exacto de AT/BT/MR/NA/NB (hipótesis: AT = alta, BT = baja, MR = modificación), código de modalidad de contrato del eventual, códigos de obra social, situación de revista, CCT 422/05, categoría, puesto y sucursal/domicilio de desempeño.

## Tablas informativas (descargadas 29/09/2026)

Fuente pública: https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/contribuyente/RelacionLaboral/CargaMasiva_tablasInformativas.aspx?tab=N
(3 modalidad de contratación, 4 modalidad de liquidación, 7 situación de revista, 8 rechazos, 24 tipos de servicio). Copias en esta carpeta (tabla-*.txt).

Datos clave para eventuales:
- Modalidad de contrato **012 = Trabajo eventual** (código 12 de la tabla, 3 posiciones). 102 = Empleado Servicio Eventual en Usuaria (Dto 762) solo si contrata una Empresa de Servicios Eventuales. El 14 que dijo el contador es Nuevo período de prueba: no se usa.
- Movimientos: AT = alta, BT = baja. La baja lleva situación de revista **30** (Vencimiento de plazo / ART. 250 LCT). El alta lleva **01** (Activo).
- Modalidad de liquidación: **5 = HORA**.
- Actividad CIIU **801000**. Sucursal / domicilio de explotación = principal de la empresa, código **00000**. Puesto **5414** (verificar en la tabla de puestos). Categoría: Vigilador General; el código numérico de 6 posiciones sigue pendiente. CCT 422/05: el código de 10 posiciones de la tabla de convenios sigue pendiente. Obra social: RNOS del legajo.
- Esos defaults viven en `empresas/{id}.arcaEventuales`. El generador es `lineasCargaMasiva`. Retribución pactada: 15 dígitos, centavos implícitos (bruto × 100). Una línea mide 130. Si faltan CCT, categoría u obra social, la línea se arma igual y `enviable` queda en false.
