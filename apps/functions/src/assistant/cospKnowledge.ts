/** Resumen COSP para el asistente (no documentación aparte — mantener breve). */
export const COSP_PLATFORM_KNOWLEDGE = `
COSP es un sistema para empresas de seguridad privada (Grupo Bacar): planificación de turnos, operaciones en vivo, RRHH, clientes/objetivos, servicios y SLA (modelado de cobertura y análisis de esquema 6×2/6×1/4×2), reportes y configuración por empresa.

FLUJO OBLIGATORIO: CLIENTE → OBJETIVO/SEDE → SERVICIO SLA (puestos + PAX) → RRHH (legajos + novedades) → PLANIFICADOR → PUBLICAR. No se puede planificar un objetivo que no tenga servicio creado.

ADMIN — módulos típicos (menú lateral; al hablar con el usuario usá estos nombres, no URLs):
- Dashboard y Operaciones: monitor turnos activos/ausentes/vacantes, fichadas y novedades.
- Planificación y turnos: grillas mensuales por cliente/objetivo; planificado vs borrador; publicación vía colección Firestore planificacion_estados.
- RRHH: legajos, ausencias/licencias enlazadas a turnos cuando aplica.
- Clientes y objetivos (CRM): clientes con objetivos embebidos. Geolocalizarlos es clave para check-in GPS (radio 80 m).
- Servicios y SLA: contratos SLA, puestos; herramientas de esquema de turnos. Tipo puesto: 24 HS, 12 HS DIURNO, 12 HS NOCTURNO, PERSONALIZADO, ENCARGADO (sin cobertura), EVENTOS/EXTRAS (prefactura).
- Reportes, Análisis operativo, Configuración: exportes y métricas; usuarios y roles por módulo (permisos read/create/update/delete). isSuperAdmin bypasea todo.

Portal empleado (vista guardia): turnos propios, presencia según políticas GPS/portal, solicitud de ausencias. Una vez publicado el cronograma, el guardia lo ve en su portal (requiere email cargado en RRHH).

Portal cliente: consultas típicas del lado cliente cuando exista ese acceso.

Turnos colección Firestore turnos — campos comunes employeeId, objectiveId, ventanas horarias/fechas según desarrollo, código CCT donde aplique, presencia/isAbsent/isCompleted, borradores (draft). El servidor puede **totalizar horas planificadas de cobertura y horas reales fichadas** por colaborador y rango con **resumen_horas_empleado_periodo**; y **horas vendidas del SLA vs horas ya planificadas en la grilla** por objetivo/mes con **resumen_horas_objetivo_sla_periodo** (mismo criterio que comparar «Vendidas» vs «Hs. Plan.» en Planificación). Liquidación fina con nocturnas/feriados sigue en **Reportes y liquidación**.

Cuando las herramientas servidor están activadas: los datos concretos de la empresa (números, nombres, turnos) salen **solo** de esas lecturas Firestore; este párrafo describe el producto, no el contenido de la base. Sin herramientas o con nombres ambiguos: pedí aclaración y orientá en la UI.

Sesión temporal: ante dudas legales/liquidación oficial remití a RRHH/abogacía/manual interno autorizado.
`.trim();

/** Etiquetas cortas para el prompt (sin URLs; el asistente no debe repetir rutas al usuario salvo que pida la URL). */
export const ADMIN_MODULE_ROUTE_HINTS: Record<string, string> = {
  DASHBOARD: 'Panel principal (resumen y atajos).',
  OPERATIONS: 'Operaciones — monitor en tiempo real, vacantes, fichadas.',
  PLANNING: 'Planificación — grilla mensual, cliente/objetivo, publicar cronograma.',
  PLANNING_AI: 'Planificación — asistente de ajuste fino en la misma pantalla.',
  RRHH: 'RRHH — legajos, ausencias, licencias.',
  CLIENTS: 'Clientes y objetivos (CRM).',
  SERVICES: 'Servicios y SLA — contratos, puestos, esquemas de turno.',
  REPORTS: 'Reportes — horas y exportes.',
  ANALYSIS: 'Análisis operativo — métricas agregadas.',
  CONFIG: 'Configuración — empresa, usuarios y permisos.',
};

export const KNOWN_ADMIN_MODULE_KEYS = Object.keys(ADMIN_MODULE_ROUTE_HINTS);

/**
 * Guías operativas concretas (UX) injectadas sólo cuando el moduleKey coincide.
 * Mantener alineadas con la página real donde sea posible.
 */
const PLANNING_OPS = `
Planificador — Armar y Publicar Cronogramas (Instructivo 07):

**Prerequisitos obligatorios:** Cliente + Objetivo geolocalizado (CRM) → Servicio con puestos + PAX (Servicios) → Legajos completos + Novedades del mes (RRHH) → recién entonces Planificador.

**Grilla mensual:** columnas = días del mes, filas = guardias asignados al objetivo. Selector de Cliente y Objetivo en la parte superior. Fines de semana en rosa. Fila inferior “Cobertura” muestra ratio por día (ej. 6/6 verde = completo, 4/6 rojo = faltante).

**Diagnóstico de Cobertura:** clic en el badge “Diagnóstico Cobertura” → muestra días 100%, Parcial, Sin cerrar, bandas faltantes (M/T/N) día a día. Revisar antes de publicar. Botones **CERRAR BANDA M/T/N** asignan automáticamente personal disponible para cerrar huecos.

**Armar cronograma desde cero (primer mes):** asignar turno celda a celda o con selección masiva → revisar Diagnóstico → GUARDAR → PUBLICAR.

**Copiar mes anterior:** desde el 2° mes en adelante, clic en el ícono de plantilla (calendario con lupa) junto al selector de mes → replica el cronograma del mes anterior → ajustar novedades y bajas.

**Asignar turno individual:** clic en celda (fila = guardia, columna = día) → modal → elegir banda (M/T/N/D12/N12/F/RET/REF/ESC). Si el guardia tiene **puesto fijo** el modal filtra las bandas de ese puesto; si no tiene, pide Puesto + turno.

**Asignación masiva:** clic + arrastrar sobre bloque de celdas → barra flotante → elegir banda → aplica a todas. Ctrl+Z deshace. Portapapeles: Copiar bloque → pegar en otro sector.

**Buscar personal para asignar:**
- **Lupa** (junto a ASIGNAR): busco por nombre, elijo, asigno directo. Muestra distancia al objetivo si el guardia tiene coordenadas en RRHH.
- **ASIGNAR:** listado global de todos los objetivos con cruces de turnos del mes — para ver quién ya tiene cobertura en otro lado antes de asignar.

**Puesto fijo:** clic en la etiqueta de puesto junto al nombre → PUESTO + TURNO → elegir puesto y banda habitual. Los volantes/rotativos quedan sin puesto fijo.

**Estados del cronograma:** BORRADOR (editable libremente) → PUBLICADO (oficial, guardias lo ven en portal) → CORRECCIÓN ACTIVA → RE-PUBLICAR (naranja, confirma cambios sobre publicado).

**Publicar cronograma:**
1. Planificación → elegir Cliente y Objetivo → navegar al mes.
2. Verificar Diagnóstico Cobertura = 0 huecos (o justificar faltantes).
3. GUARDAR si hay cambios pendientes.
4. Clic en **PUBLICAR** → badge cambia a PUBLICADO (verde).

**Modificar cronograma publicado:**
- **Franco Trabajado (FT):** clic en celda F → Asignar FT → elegir puesto y banda.
- **Otros cambios:** CORREGIR → editar → GUARDAR → **RE-PUBLICAR**. Sin re-publicar los cambios no impactan el cronograma oficial.

**Cobertura cuando hay ausencia:**
- Clic en celda → **Cobertura / Liberación** → Declarar novedad (E/AA) + armar Ext+Adel con guardias del cronograma.
- **Extensión (+):** guardia de la banda anterior suma horas al final de su turno.
- **Adelanto (+):** guardia de la banda siguiente entra antes.
- **Liberar a RET:** el titular pasa a stand-by, recomponer con Ext+Adel.
- **Vacaciones (V):** clic en celda V → Re-procesar cobertura → elegir días → Traer suplente o Ext+Adel → Marcar vacante → GUARDAR.

**Regla importante:** un cronograma en borrador NO impacta la operación hasta que se publica. Siempre guardar antes de salir (la barra “PLANIFICANDO COMO” muestra cambios pendientes).

**Siglas CCT 422/05 en la grilla:** M/T/N (8h), D12/N12 (12h), F/FF/FT (francos), V/L/E/A/PG/SGS/SUS/AA (ausencias/licencias — se cargan en RRHH Novedades), RET/REF/ESC (operativos sin cobertura SLA), C (consolidado), LOCKED, SWAP/S! (permutas).

**Automatizar cronograma (agente planificación COSP):**
1. Con Cliente, Objetivo y SLA activo para el mes.
2. Botón **Automatizar** (wizard): primero viabilidad (dotación vs SLA + CCT 200h).
3. Si es viable, genera el mes (motor determinístico) y reprocesa descansos/slots.
4. Opcional: ajuste fino IA (Gemini) — solo correcciones puntuales.
5. Revisar verificación de cobertura, guardar y publicar.
`.trim();

const OPERATIONS_OPS = `
Operaciones: monitor en tiempo cercano por objetivos/puestos; vacantes, ausencias tardías, fichadas. Usá filtros de fecha/período o barra lateral según apareza en esa versión cuando el usuario no vea algo.
`.trim();

const RRHH_OPS = `
RRHH — Gestión de Personal (Instructivo 05):

**Pestañas del módulo:** Dashboard, Legajos, Novedades, Tipos, Feriados, Convenios, Correcciones, Ausentismo, Empleados.

**Dashboard RRHH:** indicadores de Total plantilla, Activos, Ausentismo hoy, Portal activo. Gráficos de antigüedad y distribución por objetivo. Para ver un resumen rápido del estado del personal sin abrir legajos.

**Crear legajo (+ NUEVO LEGAJO):**
- Solapa **PERSONAL** (obligatoria): Nombre, Apellido, DNI, CUIL, Género, Email (muy importante para notificaciones), Teléfono, Dirección. Para geolocalizar domicilio: completar dirección y clic en **GEOLOCALIZAR** — sirve para calcular distancia al objetivo.
- Solapa **LABORAL** (obligatoria): Legajo N°, Fecha ingreso, Convenio (CCT 422/05), Categoría (Vigilador, Supervisor, etc.), Objetivo preferido (no es asignación fija, orienta al planificador), Estado (Activo/Inactivo).
- Solapa **VOLANTE** (opcional): objetivos donde puede cubrir como comodín además de su objetivo base. El motor de cobertura lo considera para reemplazos.
- Guardar con botón **GUARDAR CAMBIOS** (naranja).

**Editar legajo:** RRHH → Legajos → buscar por nombre o número de legajo → clic en el nombre → editar campos → Guardar cambios.

**Registrar novedad (+ NUEVA NOVEDAD):**
1. RRHH → pestaña **Novedades** → **+ NUEVA NOVEDAD** (rojo/naranja).
2. Campos: Empleado (buscar y seleccionar), Tipo (Vacaciones/Enfermedad/Permiso Gremial/Licencia, etc.), Estado (Autorizada/Justificada/Pendiente), Fecha inicio, Fecha fin, Motivo, Presenta certificado.
3. Clic en **Registrar**.
Impacto: la novedad aparece en el Planificador automáticamente y el sistema la respeta al armar cronogramas. Si el cronograma ya estaba publicado puede requerir reasignar turnos.

**Correcciones (ajustes puntuales):** RRHH → Correcciones → seleccionar empleado → **+ Nueva Corrección**. Tipos: Ajuste de Horas (sumar/restar), Corrección Presencia, Corrección Código, Retención No Registrada. Siempre completar el campo Motivo. Usar Correcciones para errores de registro (olvidó marcar, marcó de más). Usar Novedades para ausencias reales (enfermedad, vacaciones).

**Regla antes de planificar:** verificar que los legajos estén completos (Personal + Laboral) y que las novedades del período estén cargadas. Las novedades impactan directamente en el Planificador.
`.trim();

const SERVICES_OPS = `
Servicios y SLA (Instructivo 01 — secciones 8-11):

**Dos pestañas:** CONTRATOS SLA (servicios regulares mensuales) y EVENTOS (servicios especiales puntuales, independientes del cronograma mensual como Plaza de la Música, Los Pumas, etc.).

**Crear servicio (+ NUEVO SERVICIO):**
1. Servicios → **+ NUEVO SERVICIO**.
2. Seleccionar **Cliente** y **Objetivo** (deben existir en CRM).
3. Definir **Inicio / Fin** del período, días excluidos, estructura operativa (puestos).
4. Guardar. El contador superior derecho muestra horas totales con desglose nocturnas/fin de semana (CCT 422/05).

**Agregar puestos (+ AGREGAR PUESTO):** cada servicio tiene tantos puestos como requiera el contrato (recepción, playa, bunker, control y vigilancia, etc.). Cada puesto tiene:
- **Tipo de cobertura:** 24 HORAS (turnos M+T+N o D12+N12), 12 HS DIURNO, 12 HS NOCTURNO, PERSONALIZADO (turnos a medida con PAX propio por banda), ENCARGADO DE SERVICIO (sin cobertura, no genera vacantes en Planificador), EVENTOS/EXTRAS (pedidos puntuales del cliente, aparecen como vacantes en Planificador).
- **PAX:** cantidad de personas requeridas por turno/banda. En un puesto 24hs con PAX 3: 3 personas a las 07:00, 3 a las 15:00, 3 a las 23:00. El sistema calcula rotación mínima CCT 422/05.
- **Nombre del puesto, Sigla (Planif.)** (abreviatura en la grilla), Días operativos, Género requerido.
- **Horario base:** inicio del turno Mañana (T y N se encadenan automáticamente en bloques de 8h). D12/N12 se configuran independientemente.

**Puesto PERSONALIZADO:** cada turno tiene su propio PAX. Crear turno → elegir días de la semana, fechas específicas o calendario del mes → definir PAX del turno → + Agregar → Confirmar.

**Regla clave:** sin puestos configurados no se pueden generar vacantes en Planificación. El Planificador usa exactamente los puestos y bandas definidos aquí.
`.trim();

const REPORTS_OPS = `
Reportes: exportes/consultas de horas liquidación según período y filtros. Recordá período/fecha correctos ante totales inconsistentes.
`.trim();

const CLIENTS_OPS = `
CRM — Clientes y Objetivos (Instructivo 01):

**Crear cliente:** CRM → botón **+ CLIENTE** (naranja, esquina superior derecha) → completar Nombre comercial (obligatorio), Razón social, CUIT, Condición IVA, teléfono/email, dirección, contacto. Tip: ingresá CUIT y clic en **AFIP** para autocompletar razón social y condición IVA desde el padrón.

**Listar clientes:** la pantalla principal muestra el **Centro de mando** con indicadores SLA vendidas, Plan cobertura, Realizadas, Activos y listado con buscador. Desde cada tarjeta se puede ver detalle, prefacturar o eliminar.

**Ficha del cliente (pestañas):** INFO (datos AFIP), CONTRATOS, SERVICIOS, SEDES, PREFACTURA, COTIZACIONES, HISTORIAL. Para ver los objetivos: pestaña **SEDES**.

**Crear sede/objetivo:** Ficha del cliente → pestaña **SEDES** → **+ NUEVA SEDE** → completar Nombre de la sede, Dirección completa, Latitud/Longitud (manual o automática), Contacto, Notas. Para geolocalizar: completar dirección y clic en el botón naranja de ubicación — el sistema obtiene coordenadas GPS automáticamente. Esas coordenadas ubican el objetivo en el mapa de operaciones.

**Check-in por GPS:** al activarlo, el empleado debe estar a menos de **80 m** del objetivo para poder marcar entrada/salida.

**Regla clave:** cada objetivo que vaya a tener servicio y planificación debe estar creado y geolocalizado antes de pasar al módulo Servicios.
`.trim();

const CONFIG_OPS = `
Configuración: empresa, usuarios y **roles**/permiso por módulo (read/create/update/delete). Si algo “no aparece”: rol/módulo.
`.trim();

const EMPLOYEE_PORTAL_OPS = `
Portal empleado: sólo vista propia — turnos aceptados/recibidos, marcar presencia según política, solicitar ausencias. No orientar con URLs de administración salvo el usuario pregunte por el acceso de oficina.
`.trim();

const CLIENT_PORTAL_OPS = `
Portal cliente: consultas y datos limitados según ese diseño — sin información de otros contratos/clientes.
`.trim();

/** Texto español corto por clave inferida en cliente. */
const MODULE_OPS: Record<string, string> = {
  PLANNING: PLANNING_OPS,
  PLANNING_AI: PLANNING_OPS,
  OPERATIONS: OPERATIONS_OPS,
  RRHH: RRHH_OPS,
  CLIENTS: CLIENTS_OPS,
  SERVICES: SERVICES_OPS,
  REPORTS: REPORTS_OPS,
  ANALYSIS:
    'Análisis operativo: métricas y vistas agregadas; probá período/objetivos visibles cuando no cuadren totales.',
  CONFIG: CONFIG_OPS,
  DASHBOARD:
    'Dashboard: atajo a KPIs/atención rápida; la guía puntual viene del módulo al que lleve cada tarjeta o menú lateral.',
  EMPLOYEE_PORTAL: EMPLOYEE_PORTAL_OPS,
  CLIENT_PORTAL: CLIENT_PORTAL_OPS,
};

export function operationalGuideForModuleKey(moduleKey: string | null | undefined): string {
  const k = typeof moduleKey === 'string' ? moduleKey.trim() : '';
  if (!k || !MODULE_OPS[k]) return '';
  return `GUÍA OPERATIVA (moduleKey="${k}" — sólo usar si la pregunta es procedimental/UI):\n${MODULE_OPS[k]}`;
}
