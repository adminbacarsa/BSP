# Manual de usuario — COSP V 1.0 (CronoApp)

**Grupo Bacar** · Plataforma web de gestión operativa, planificación de turnos y RRHH.

Documentación complementaria:

- `docs/TUTORIAL_PLATAFORMA_ROLES_Y_MODULOS.md` (manual completo por módulo y rol).
- `docs/TUTORIAL_PORTAL_EMPLEADO_INSTALACION_Y_USO.md` (instalación y uso del Portal del Empleado).
- `docs/tutorial-interactivo.html` (versión web interactiva: pestañas, índice, búsqueda y tema claro/oscuro; abrir con doble clic en el explorador).

Este documento orienta al usuario final sobre **qué hace cada área** y **cómo se organiza el acceso**. Los textos de botones y pantallas pueden variar levemente según la versión desplegada.

---

## 1. Acceso al sistema

1. Abrí la URL que te indique el administrador (por ejemplo el sitio en Firebase Hosting).
2. En la pantalla de **inicio de sesión**, ingresá **correo** y **contraseña** provistos por administración.
3. Según tu perfil, el sistema te llevará al **panel de administración** o al **portal de empleado** (fichadas y turnos propios).

**Consejos**

- Si olvidaste la contraseña, pedí el **restablecimiento** o un usuario nuevo al responsable de sistemas (no todas las cuentas tienen recuperación automática habilitada).
- Si ves **“Vista restringida”** en la barra superior, tu usuario está asociado a **una sola empresa/cliente**: solo verás datos de ese cliente.

---

## 2. Roles y permisos

Los permisos se definen en **Configuración → Roles y permisos** (solo perfiles autorizados). Cada rol indica, por módulo, si podés **ver (R)**, **crear (C)**, **editar (U)** o **borrar (D)**.

**Ejemplos habituales**

| Rol (ejemplo) | Uso típico |
|-----------------|------------|
| **SUPERADMIN / ADMIN** | Acceso completo a configuración del sistema, usuarios y mantenimiento crítico. |
| **SP / operativo** | Planificación, operaciones y reportes según la matriz asignada; a menudo **sin** Configuración global. |
| **SOPORTE** | Suele ser **solo lectura** en varios módulos para consultas y seguimiento. |

Si cambiaron tu rol y no ves un menú que antes aparecía, **cerrá sesión y volvé a entrar**. Si el problema continúa, verificá con un administrador que el rol en **Usuarios admin** coincida con el de la matriz de permisos.

---

## 3. Estructura del menú (panel principal)

El menú lateral se arma **según tus permisos**. No todos los usuarios ven todas las secciones.

### 3.1 Operativa

- **Dashboard**  
  Resumen de indicadores del día (cobertura, alertas, carga por cliente, etc., según lo implementado en tu versión).

- **Centro Control (Operaciones)**  
  Monitor en tiempo real del día: turnos, prioridades, **vacantes**, ausentes, francos, etc. Sirve para coordinar la dotación y registrar acciones operativas.

- **Planificador**  
  Carga y edición de la **planificación de turnos** (empleados, códigos de turno, objetivos/puestos). Es la fuente principal de los turnos que luego ve operaciones.

### 3.2 Gestión (si tu rol lo permite)

- **CRM Clientes**  
  Datos de clientes y **objetivos** (puntos de servicio) asociados.

- **Servicios**  
  Definición de **servicios / SLA** vinculados a objetivos (coberturas, puestos, franjas horarias). Influye en cómo el sistema calcula cobertura y alertas.

### 3.3 Reportes y RRHH

- **Reportes**  
  Informes por empleado, por objetivo, auditoría de acciones, etc., según el rango de fechas que elijas.

- **RRHH**  
  Gestión de empleados, legajos y datos de personal (alcance según permisos).

### 3.4 Sistema

- **Configuración**  
  Parámetros generales, **usuarios de plataforma**, **roles y permisos**.  
  **Solo quienes tienen permiso de Configuración** deben entrar aquí.  
  En **Sistema** también puede existir una **zona de mantenimiento** (acciones destructivas: solo **ADMIN / SUPERADMIN** y con confirmación explícita).

- **Salir**  
  Cierra la sesión de forma segura.

---

## 4. Conceptos importantes

### Turnos

Los turnos son registros en la colección de **turnos** del sistema. Se generan o modifican principalmente desde el **Planificador** y se visualizan en **Centro Control** y en **Reportes**.

### Vacantes

Una **vacante** es un hueco de cobertura: puede ser un turno sin empleado asignado o una **alerta calculada** respecto a lo definido en **servicios / SLA**.  
Si vaciaste turnos pero seguís viendo “vacantes”, puede deberse a **servicios activos** y a la lógica de cobertura; consultá con sistemas o revisá **Servicios** y **Planificador**.

### Objetivos y clientes

Cada **cliente** puede tener uno o más **objetivos** (ubicaciones o líneas de servicio). Los turnos se asocian a **objetivo** y **puesto** según la planificación.

### Portal empleado

Los perfiles de **empleado** acceden a una vista propia (turnos, fichadas, etc.). No administran clientes ni configuración global.

---

## 5. Buenas prácticas

1. **No compartas tu usuario**; pedí un usuario individual.
2. Antes de **borrar masivamente turnos** o datos de mantenimiento, confirmá con el responsable y **respaldá** lo necesario (exportaciones, reportes).
3. Si algo no coincide con la realidad (horarios, nombres, vacantes), revisá primero **Planificador** y **Servicios**, luego **CRM / objetivos**.

---

## 6. Soporte

Para incidencias técnicas, permisos o capacitación, contactá al **área de sistemas / implementación** de tu organización e indicá:

- Pantalla o menú donde ocurre el problema  
- Fecha y hora aproximada  
- Usuario (rol) y, si aplica, cliente/objetivo  

---

*Documento generado como base para el equipo. Actualizalo cuando cambien flujos críticos o nombres de menú.*
