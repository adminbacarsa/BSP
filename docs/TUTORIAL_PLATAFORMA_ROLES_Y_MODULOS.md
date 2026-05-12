# Tutorial de uso por roles y módulos (COSP / CronoApp)

Este documento describe el uso operativo de la plataforma en flujo completo: desde crear clientes y objetivos hasta recibir y gestionar solicitudes de empleados.

## 1) Vista general del flujo operativo completo

1. **Configuración inicial**
   - Crear empresas (si aplica multiempresa).
   - Crear usuarios administradores y roles.
   - Definir permisos por módulo (read/create/update/delete).
2. **Alta comercial**
   - Crear cliente en CRM.
   - Crear objetivos/sedes y su georreferencia.
   - Cargar contratos/servicios (SLA, puestos, tipos de turno).
3. **Alta de personal**
   - Crear legajos en RRHH (manual o importación CSV).
   - Configurar convenio, categoría, restricciones, domicilio/GPS.
   - Habilitar acceso al Portal de Empleado.
4. **Planificación**
   - Asignar dotación por objetivo y período.
   - Registrar novedades de ausencias/licencias.
   - Guardar y versionar cambios.
5. **Operaciones**
   - Monitorear turnos en tiempo real.
   - Resolver ausencias/vacantes/retenciones/bajas anticipadas.
   - Escalar novedades a Planificación o RRHH.
6. **Ejecución del empleado**
   - Ver cronograma, marcar presente, enviar solicitudes, pedir intercambios.
7. **Control y cierre**
   - Reportes y exportaciones.
   - Auditoría de acciones.
   - Backups y mantenimiento controlado.

---

## 2) Roles y permisos (modelo real de la plataforma)

Los permisos se administran en **Configuración > Roles y Permisos** y se guardan por módulo con acciones:

- `read` (ver)
- `create` (crear)
- `update` (editar)
- `delete` (borrar)

Módulos configurables:

- `DASHBOARD` (Dashboard Principal)
- `PLANNING` (Planificación y Turnos)
- `RRHH` (RRHH y Legajos)
- `CLIENTS` (Clientes y Objetivos)
- `REPORTS` (Reportes)
- `ANALYSIS` (Análisis Operativo)
- `CONFIG` (Configuración Global)

### Roles típicos recomendados

- **SuperAdmin**
  - Acceso total a todos los módulos y empresas.
- **Admin**
  - Gestión integral operativa y de configuración.
- **Planificador / Scheduler**
  - Enfoque en `PLANNING`, lectura en dashboard/reportes.
- **RRHH**
  - Enfoque en `RRHH`, ausencias, convenios, portal empleado.
- **Operaciones**
  - Centro de control en vivo, cobertura de vacantes, gestión de novedades.
- **Director / Auditor**
  - Lectura de dashboard, mapas/auditoría, reportes.
- **Empleado**
  - Solo Portal de Empleado (no usa menú admin).

> Nota: el sidebar se arma dinámicamente según permisos de módulo.

---

## 3) Tutorial por módulo (admin)

## 3.1 Dashboard

Objetivo: visión diaria de cobertura, vacantes, horas y dotación.

- Revisar métricas del día.
- Detectar vacantes tempranas.
- Identificar objetivos/clientes con mayor demanda.

## 3.2 CRM Clientes (`/admin/crm`)

Objetivo: administrar clientes, objetivos y contratos base.

### Funciones principales

- Alta, edición y baja de clientes.
- Edición de datos del cliente (contacto, dirección, etc.).
- Gestión de **objetivos/sedes** por cliente:
  - Alta/edición/baja.
  - Geocodificación de sede.
  - Configuración de radio/condiciones de fichada.
- Gestión de contratos/servicios asociados.
- Historial/notas del cliente.
- Reparación de IDs de objetivo en casos históricos.

### Flujo recomendado

1. Crear cliente.
2. Cargar objetivos/sedes.
3. Georreferenciar objetivos.
4. Guardar contrato principal.
5. Verificar consistencia antes de planificar.

## 3.3 Servicios (`/admin/servicios`)

Objetivo: definir SLA operativo y reglas de cobertura por objetivo.

### Funciones principales

- Crear/editar/eliminar servicios SLA.
- Versionar servicios (nueva versión sin perder trazabilidad).
- Definir puestos por servicio.
- Definir variantes/plantillas de turnos (incluye personalizados).
- Configurar coberturas y lógica de cálculo.
- Registrar auditoría de cambios.

### Buenas prácticas

- Versionar en vez de sobrescribir reglas críticas.
- Validar puestos y turnos antes de publicar.
- Revisar KPIs mensuales del módulo.

## 3.4 RRHH (`/admin/rrhh`)

Objetivo: gestionar legajos, ausencias, convenios y acceso al portal.

### Funciones principales

- ABM de empleados.
- Bajas y reactivaciones.
- Geocodificación individual y masiva.
- Importación/exportación CSV de nómina.
- Gestión de feriados (manual y sync oficial).
- Gestión de convenios/categorías.
- Gestión de ausencias y licencias:
  - Alta, edición, rechazo, eliminación.
  - Trazabilidad en auditoría.
- Acceso Portal Empleado:
  - Enviar acceso individual.
  - Envío masivo.
  - Reset de invitaciones.
  - Bandeja de solicitudes pendientes.

## 3.5 Planificación (`/admin/planificacion`)

Objetivo: construir y mantener la planificación operativa.

### Funciones principales

- Selección de contexto cliente/objetivo.
- Asignación y desasignación de personal.
- Transferencia entre objetivos.
- Registro de novedades RRHH desde planificación.
- Gestión de vacantes con reemplazos.
- Guardado masivo de cambios.
- Historial/versionado por período y objetivo.
- Centro de notificaciones (leídas/no leídas, limpieza).
- Ordenamiento y reorganización de dotación.

### Flujo recomendado

1. Seleccionar cliente y objetivo.
2. Cargar/ajustar turnos y ausencias.
3. Validar conflictos/restricciones.
4. Guardar planificación.
5. Revisar historial si hubo cambios críticos.

## 3.6 Operaciones (Centro Control) (`/admin/operaciones`)

Objetivo: ejecutar la operación diaria en tiempo real.

### Funciones principales

- Vista táctica por estados:
  - Plan
  - Activos
  - Ausentes
  - Vacantes
  - Retenidos
- Dar presente / marcar ausente.
- Gestión de salida y baja anticipada.
- Cobertura de vacante:
  - Reasignación.
  - Retención.
  - Escalado a planificación.
- Registro de novedades operativas.
- Mapa táctico externo (`map-view`) para seguimiento en vivo.

### Automatizaciones relevantes (backend)

- Detección automática de ausencias.
- Gestión automática de vacantes (escalado progresivo).
- Autocompletado de turnos según relevo.

## 3.7 Reportes (`/admin/reportes`)

Objetivo: análisis, control y exportación para gestión/liquidación.

### Funciones principales

- Reporte por objetivos.
- Reporte por empleados.
- Detalle por turnos/eventos.
- Exportación a CSV.
- Impresión.
- Registro de exportaciones en auditoría.
- Vista de auditoría operativa.

## 3.8 Configuración (`/admin/configuracion`)

### Sistema

- Tema visual (claro, oscuro, contraste, azul, sistema).
- Datos de organización.
- Acceso a panel de cámaras NVR.
- Zona de mantenimiento (solo roles autorizados):
  - Limpieza de historial operativo.
  - Borrado masivo de turnos (con frase de confirmación).

### Usuarios Admin

- Crear, editar y eliminar usuarios de plataforma.
- Asignar rol y empresa.
- Gestión opcional de PIN de supervisor.

### Roles y Permisos

- Crear, editar y eliminar roles.
- Matriz de permisos por módulo y acción.

### Empresas

- Crear empresa.
- Cambiar empresa activa (superadmin).
- Migrar datos para completar `empresaId`.

### Backups

- Ejecutar backup manual a Drive (producción).
- Restaurar backup (`merge` o `full`).
- En emulador: cargar backup JSON local para poblar datos.

---

## 4) Tutorial de punta a punta: de crear cliente a recibir solicitudes

## Paso 1: Crear cliente y objetivo

1. Ir a `CRM Clientes`.
2. Crear cliente.
3. Crear objetivo/sede.
4. Cargar dirección y coordenadas.
5. Guardar.

## Paso 2: Definir servicio y puestos

1. Ir a `Servicios`.
2. Crear contrato/servicio para ese objetivo.
3. Crear puestos y variantes de turnos.
4. Guardar y verificar versión activa.

## Paso 3: Cargar personal

1. Ir a `RRHH`.
2. Crear legajos (manual o CSV).
3. Revisar datos laborales, convenios y restricciones.
4. Enviar acceso al portal al personal con email.

## Paso 4: Planificar

1. Ir a `Planificación`.
2. Seleccionar cliente/objetivo.
3. Asignar personal y turnos.
4. Cargar novedades de ausencias si aplica.
5. Guardar cambios.

## Paso 5: Operar en vivo

1. Ir a `Operaciones`.
2. Monitorear estados y vacantes.
3. Gestionar ausencias/bajas/reemplazos.
4. Escalar casos a planificación si corresponde.

## Paso 6: Recibir y gestionar solicitudes de empleados

Las solicitudes entran por estos canales:

- **Solicitud de presente** (`requestCheckIn`) desde Portal.
- **Solicitud de ausencia/licencia** (colección `ausencias`).
- **Solicitud de intercambio de turno/franco** (`swap_requests` vía cloud functions).
- **Notificaciones de cambios** (`user_notifications` / `novedades`).

Dónde se gestionan:

- **RRHH**: ausencias/licencias y seguimiento administrativo.
- **Planificación**: impacto en la grilla y cobertura.
- **Operaciones**: ejecución inmediata y resolución táctica.

## Paso 7: Cierre y trazabilidad

1. Ir a `Reportes` para exportar resultados.
2. Revisar auditoría.
3. Ejecutar backup si corresponde.

---

## 5) Recomendaciones operativas

- Definir siempre permisos mínimos por rol.
- Validar georreferencia de objetivos antes de habilitar fichada GPS.
- Evitar borrados masivos sin backup previo.
- Usar auditoría para trazabilidad de cambios críticos.
- Ante cambios de rol/permisos, cerrar y volver a iniciar sesión.

