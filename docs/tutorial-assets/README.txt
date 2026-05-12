Capturas PNG para docs/tutorial-interactivo.html

Credenciales (una sola vez en Windows)
----------------------------------------
Opción cómoda: copiá docs/tutorial-capture.env.example a docs/tutorial-capture.env
y completá email/contraseña. Los scripts docs:capturas y docs:capturas-flujo lo leen solos.
(tutorial-capture.env está en .gitignore — no lo subas.)

Opción CMD en una línea:
  set TUTORIAL_EMAIL=tu@cuenta.com&& set TUTORIAL_PASSWORD=tu_clave&& npm run docs:capturas

PowerShell:
  $env:TUTORIAL_EMAIL="..."; $env:TUTORIAL_PASSWORD="..."; npm run docs:capturas


Generación automática (admin + login)
-------------------------------------
Desde la raíz del repo, con Next corriendo (npm run dev:web2):

  npx playwright install chromium
  npm run docs:capturas

(si no usás tutorial-capture.env, definí antes TUTORIAL_EMAIL y TUTORIAL_PASSWORD)

  set TUTORIAL_BASE=http://127.0.0.1:3000   (opcional si no es localhost:3000)

Sin email/contraseña solo se genera plataforma/login.png.

Todo en uno (pantallas estáticas + flujos)
-------------------------------------------
npm run docs:capturas-all

Ejecuta docs:capturas y luego docs:capturas-flujo (mismas credenciales).


Secuencias por pasos (UI real)
------------------------------
npm run docs:capturas-flujo

Genera docs/tutorial-assets/flujo/ con Playwright haciendo clics reales.

CRM:
  crm-flujo-01-lista.png
  crm-flujo-02-modal-vacio.png
  crm-flujo-03-nombre-ejemplo.png

Planificación (cliente/objetivo por nombre, por defecto "Tadicor"):
  TUTORIAL_PLAN_CLIENT / TUTORIAL_PLAN_OBJECTIVE en tutorial-capture.env
  plan-flujo-01-ingreso.png
  plan-flujo-02-menu-clientes.png
  plan-flujo-03-cliente-seleccionado.png
  plan-flujo-04-menu-objetivos.png
  plan-flujo-05-grilla.png

Otros:
  serv-flujo-01-vista.png
  rrhh-flujo-01-legajos.png
  rrhh-flujo-02-novedades.png
  ops-flujo-01-vista.png
  ops-flujo-02-activos.png
  rep-flujo-01-vista.png
  cfg-flujo-01-vista.png

El tutorial enlaza estos archivos en 3.2 CRM, 3.5 Planificación (pasos A1–A5) y 3.9 Otros módulos.


Archivos que escribe el script (plataforma/)
--------------------------------------------
login.png
dashboard.png
crm-lista.png
servicios-contrato.png
rrhh-legajos.png
plan-01-planificador.png
operaciones-tabs.png
reportes.png
configuracion.png

Portal empleado (manual)
------------------------
El script no inicia sesión como empleado. Para las vistas del portal guardá:

  portal/empleado-hoy.png
  portal/empleado-presente.png

Recomendación: ancho ~390 px (viewport móvil) o captura completa vertical.

Abrir el tutorial
-----------------
Abrí docs/tutorial-interactivo.html desde la carpeta docs/ (así las rutas tutorial-assets/... funcionan).
