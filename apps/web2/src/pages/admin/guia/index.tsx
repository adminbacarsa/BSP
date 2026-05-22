import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  MapPin,
  Radio,
  Calendar,
  BarChart3,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';

const STORAGE_KEY = 'cosp_guia_paso';

type Step = {
  id: string;
  title: string;
  subtitle?: string;
  body: React.ReactNode;
  /** Ruta interna para el botón “Abrir módulo” */
  href?: string;
  /** Permiso mínimo para habilitar el botón (ver AuthContext / roles) */
  moduleKey?: 'CLIENTS' | 'PLANNING' | 'DASHBOARD' | 'REPORTS' | 'RRHH';
};

export default function GuiaInteractivaPage() {
  const { canReadModule, loading } = useAuth();
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const n = parseInt(saved, 10);
        if (!Number.isNaN(n) && n >= 0) setStep(n);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(step));
    } catch {
      /* ignore */
    }
  }, [step]);

  const steps: Step[] = useMemo(
    () => [
      {
        id: 'bienvenida',
        title: 'Bienvenida al recorrido',
        subtitle: 'Un solo hilo: del cliente al reporte',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              <strong>COSP</strong> organiza la vigilancia y la dotación en cadena: primero definís <em>quién contrata</em>{' '}
              y <em>dónde</em> se trabaja, luego <em>cuántos puestos</em> y <em>qué turnos</em>, cargás la <em>nómina</em>,{' '}
              planificás el calendario, operás el día y cerrás con <em>números</em> en reportes.
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Cómo usar esta guía
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  Los pasos siguen el orden recomendado de implementación; podés saltar con los puntos si ya tenés parte
                  hecha.
                </li>
                <li>
                  En cada módulo, el botón <strong>Abrir módulo</strong> te lleva a la pantalla real (si tu rol tiene
                  permiso).
                </li>
                <li>El último paso visitado se guarda en este navegador para retomar después.</li>
              </ul>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 border-l-4 border-indigo-200 dark:border-indigo-800 pl-3">
              Tip: si compartís la cuenta o usás otro equipo, el progreso guardado puede no coincidir; usá{' '}
              <strong>Reiniciar guía</strong> cuando quieras empezar de cero.
            </p>
          </div>
        ),
      },
      {
        id: 'cliente',
        title: '1. Crear el cliente',
        subtitle: 'CRM — ficha del contratante',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              <strong>CRM Clientes</strong> es el maestro de cuentas: cada registro representa al contratante (empresa o
              cuenta) con el que se firma el servicio. Desde aquí se enlazan contratos, cotizaciones, sedes/objetivos y
              métricas de seguimiento.
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Qué podés hacer en la ficha
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>INFO</strong>: datos generales, razón social, contactos y edición de la información base del
                  cliente.
                </li>
                <li>
                  <strong>CONTRATOS</strong>: vínculo con documentación comercial vigente (se usa como referencia junto al
                  resto del expediente).
                </li>
                <li>
                  <strong>SERVICIOS</strong> (en CRM): vista de servicios asociados al cliente desde la perspectiva
                  comercial; el detalle operativo fino de puestos y SLA suele administrarse también desde el módulo{' '}
                  <strong>Servicios</strong> del menú.
                </li>
                <li>
                  <strong>SEDES</strong>: aquí se administran los <strong>objetivos</strong> (lugares físicos donde se
                  presta el servicio).
                </li>
                <li>
                  <strong>COTIZACIONES</strong> e <strong>HISTORIAL</strong>: trazabilidad de propuestas y movimientos
                  relevantes del cliente.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Listado y búsqueda
              </h3>
              <p className="text-sm">
                El listado permite filtrar y ubicar clientes rápido; el panel resume indicadores (vendido / planificado /
                ejecutado) para detectar cuellos de botella. Buscá siempre antes de dar de alta para evitar duplicar
                cuentas.
              </p>
            </div>
          </div>
        ),
        href: '/admin/crm',
        moduleKey: 'CLIENTS',
      },
      {
        id: 'objetivos',
        title: '2. Objetivos del cliente',
        subtitle: 'Dónde se presta el servicio',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              Un <strong>objetivo</strong> (también llamado sede en la interfaz) es cada lugar concreto donde la empresa
              contratante necesita cobertura: sucursal, depósito, estacionamiento, planta industrial, etc. Es la unidad a
              la que se asocian <strong>turnos</strong>, <strong>servicios SLA</strong> y, en muchos casos, el mapa en
              operaciones.
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Datos típicos de un objetivo
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Nombre</strong> identificatorio y <strong>dirección</strong> para reconocer el sitio en listas y
                  reportes.
                </li>
                <li>
                  <strong>Coordenadas (lat / lng)</strong> cuando las cargás: sirven para mapas, distancias y lógica de
                  cercanía en el Centro de operaciones.
                </li>
                <li>
                  <strong>Contacto local</strong> y <strong>notas</strong> para el equipo de campo o la supervisión.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Por qué importa antes de planificar
              </h3>
              <p className="text-sm">
                El <strong>Planificador</strong> y el módulo <strong>Servicios</strong> eligen <strong>cliente + objetivo</strong>:
                si el objetivo no existe o está mal nombrado, los turnos y las horas contratadas no van a cuadrar con la
                realidad. Revisá nombres y ubicaciones antes de publicar la grilla.
              </p>
            </div>
          </div>
        ),
        href: '/admin/crm',
        moduleKey: 'CLIENTS',
      },
      {
        id: 'servicios',
        title: '3. Servicios y cobertura (SLA)',
        subtitle: 'Qué se debe cubrir y en qué franjas',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              El módulo <strong>Servicios</strong> (contratos SLA) define <em>qué se debe cubrir</em> en cada objetivo:
              cantidad de puestos, tipo de cobertura por puesto, turnos permitidos y vigencia del contrato. Es la regla
              contra la que el sistema compara la planificación y lo que ocurre en <strong>Centro de operaciones</strong>{' '}
              (vacantes, horas, alertas).
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Componentes de un servicio SLA
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Cliente y objetivo</strong>: deben ser coherentes; el sistema valida que el objetivo pertenezca
                  al cliente elegido.
                </li>
                <li>
                  <strong>Vigencia</strong> (fecha inicio / fin): no pueden superponerse dos SLAs activos para el mismo
                  objetivo en el mismo rango.
                </li>
                <li>
                  <strong>Puestos</strong>: podés sumar varios; cada uno tiene nombre, <strong>tipo de cobertura</strong>{' '}
                  (por ejemplo 24 h, franja diurna, etc.), <strong>cantidad</strong> de guardias simultáneas, días de la
                  semana activos y <strong>tipos de turno permitidos</strong> (variantes M, T, N, turnos de 12 h, etc.).
                </li>
                <li>
                  <strong>Estado</strong>: el servicio puede estar activo o inactivo; dejalo inactivo mientras terminás la
                  carga para no generar expectativas en monitores.
                </li>
                <li>
                  El sistema calcula <strong>horas mensuales totales</strong> del contrato según puestos y reglas cargadas.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Buenas prácticas
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>Acordá con Planificación los códigos de turno y franjas antes de activar el SLA.</li>
                <li>Los cambios fuertes en puestos impactan vacantes y reportes de horas; comunicá cambios al equipo.</li>
              </ul>
            </div>
          </div>
        ),
        href: '/admin/servicios',
        moduleKey: 'CLIENTS',
      },
      {
        id: 'empleados-alta',
        title: '4. Dar de alta empleados',
        subtitle: 'Personal — legajo y objetivo preferido',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              <strong>Personal</strong> es la pantalla ágil para dar de alta y mantener <strong>legajos</strong>: cada
              persona que puede aparecer en el planificador y en operaciones debe existir como empleado con datos mínimos
              coherentes (identidad, categoría, estado).
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Alta de legajo (formulario)
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Nombre y apellido</strong>, <strong>DNI</strong> (obligatorio al guardar), <strong>número de
                  legajo</strong> y datos de contacto (teléfono, correo).
                </li>
                <li>
                  <strong>Categoría</strong> operativa (por ejemplo Vigilador, Supervisor, Monitoreo, Custodia) según
                  cómo clasifiques la dotación.
                </li>
                <li>
                  <strong>Estado</strong> activo/inactivo para excluir a quien ya no debe recibir turnos.
                </li>
                <li>
                  <strong>Convenio colectivo</strong> (p. ej. SUVICO) cuando aplica a tu liquidación o reglas internas.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Dotación fija (cliente y objetivo preferido)
              </h3>
              <p className="text-sm">
                Podés vincular al empleado a un <strong>cliente</strong> y un <strong>objetivo preferido</strong>: es la
                “casa” por defecto del guardia. El planificador usa esto para sugerir ubicaciones y filtros; no reemplaza
                la asignación concreta de cada turno, pero ordena la operación diaria.
              </p>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Altas masivas, importación y bajas formales con más controles se gestionan en <strong>RRHH</strong> (siguiente
              paso).
            </p>
          </div>
        ),
        href: '/admin/empleados',
        moduleKey: 'RRHH',
      },
      {
        id: 'rrhh',
        title: '5. Módulo RRHH',
        subtitle: 'Nómina, importación CSV y bajas',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              <strong>RRHH</strong> es el módulo completo de <strong>recursos humanos</strong> sobre la misma nómina que
              usa el planificador: legajos, historial, importación/exportación y acciones sensibles (bajas, reingresos,
              limpiezas) con registro en auditoría cuando corresponde.
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Funciones principales
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Listado y ficha</strong>: buscar por apellido, legajo o DNI; abrir el detalle para editar todos
                  los campos administrativos del empleado.
                </li>
                <li>
                  <strong>Alta y edición</strong>: mismo núcleo de datos que en Personal, con formularios pensados para
                  carga prolongada y revisión de expediente.
                </li>
                <li>
                  <strong>Importación CSV</strong>: subir muchos registros a la vez (útil al migrar desde planillas o
                  actualizar masivamente); el sistema suele mostrar una vista previa antes de confirmar.
                </li>
                <li>
                  <strong>Exportación</strong>: descargar la nómina para auditorías externas, sindicatos o análisis en
                  Excel.
                </li>
                <li>
                  <strong>Bajas y reactivaciones</strong>: registrar motivo y fechas de baja; reactivar legajos cuando
                  vuelve el personal, sin perder el historial si la lógica del sistema lo conserva.
                </li>
                <li>
                  <strong>Auditoría</strong>: muchas acciones críticas dejan rastro para cumplimiento y seguimiento
                  interno.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Personal vs RRHH
              </h3>
              <p className="text-sm">
                <strong>Personal</strong> sirve para altas rápidas y mantenimiento cotidiano; <strong>RRHH</strong> agrupa
                procesos masivos, controles y trazabilidad. Elegí según volumen y responsabilidad del rol.
              </p>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              El ítem <strong>RRHH</strong> en el menú lateral solo aparece si tu rol tiene permiso; si necesitás estas
              funciones y no lo ves, solicitá acceso a un administrador.
            </p>
          </div>
        ),
        href: '/admin/rrhh',
        moduleKey: 'RRHH',
      },
      {
        id: 'planificacion',
        title: '6. Planificación de turnos',
        subtitle: 'Quién trabaja y cuándo',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              El <strong>Planificador</strong> es el calendario operativo: aquí se asignan <strong>empleados</strong> a{' '}
              <strong>turnos</strong> por <strong>objetivo</strong> y fechas, usando los <strong>tipos de turno</strong>{' '}
              y reglas que definieron el contrato (SLA) y la empresa. Todo lo que quede publicado impacta directamente en{' '}
              <strong>Centro de operaciones</strong> (quién debe estar en puesto) y en <strong>Reportes</strong> (horas y
              liquidación).
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Funciones que vas a usar seguido
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Selección de objetivo y período</strong>: concentrarte en un sitio y rango de fechas para cargar
                  o revisar la grilla.
                </li>
                <li>
                  <strong>Asignación de turnos</strong>: arrastrar o asignar empleados a celdas según el código de turno
                  (mañana, tarde, noche, franco, etc.).
                </li>
                <li>
                  <strong>Empleados disponibles</strong>: filtrar por quien está habilitado para el objetivo (dotación
                  fija, convenio, etc.).
                </li>
                <li>
                  <strong>Feriados y calendario</strong>: tener en cuenta días no laborables para no planificar en
                  falso.
                </li>
                <li>
                  <strong>Cambios y novedades</strong>: enroques, cambios de franco, cargas masivas según permisos; muchas
                  acciones dejan registro en auditoría para reportes posteriores.
                </li>
                <li>
                  <strong>Vacantes</strong>: turnos sin persona asignada aparecen como huecos que operaciones debe cubrir o
                  justificar.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Coherencia con Servicios y RRHH
              </h3>
              <p className="text-sm">
                Si el SLA pide más puestos de los que la nómina puede cubrir, vas a ver tensión entre vacantes y
                personal; si los objetivos no existen en CRM, no vas a poder planificar bien. Por eso el orden de la guía:
                cliente → objetivos → servicios → empleados → planificación.
              </p>
            </div>
          </div>
        ),
        href: '/admin/planificacion',
        moduleKey: 'PLANNING',
      },
      {
        id: 'operaciones',
        title: '7. Centro de operaciones',
        subtitle: 'El día a día',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              <strong>Centro de operaciones</strong> (Centro Control) es la consola del <strong>turno en vivo</strong>:
              muestra qué debía pasar según la planificación, qué está pasando (presentes, ausencias, vacantes) y permite
              tomar decisiones: relevos, coberturas, novedades y comunicación con el personal.
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Qué mirás en pantalla
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Turnos del día</strong> por objetivo y puesto, con estado (pendiente, presente, ausente,
                  vacante, franco, etc.).
                </li>
                <li>
                  <strong>Mapa</strong> (cuando hay coordenadas): ubicación de objetivos y apoyo para decisiones de
                  cercanía o intercambio entre sedes vecinas.
                </li>
                <li>
                  <strong>Ingreso y relevo</strong>: registrar ingreso a tiempo o tarde, y elegir a quién se releva al
                  entrar el nuevo guardia.
                </li>
                <li>
                  <strong>Ausencias</strong>: confirmar falta al puesto; puede abrir el flujo de <strong>cobertura de
                  vacante</strong> (retención/doble turno, vecinos cercanos, volantes).
                </li>
                <li>
                  <strong>Baja anticipada o interrupción</strong>: cuando alguien se retira antes, con lógica de si el
                  puesto queda solo o cubierto por compañeros.
                </li>
                <li>
                  <strong>Contacto rápido</strong>: acciones para avisar por WhatsApp o teléfono a candidatos o guardias
                  en servicio.
                </li>
                <li>
                  <strong>Novedades</strong>: registrar situaciones que deban quedar documentadas para planificación o
                  auditoría.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Rol y permisos
              </h3>
              <p className="text-sm">
                El acceso suele estar ligado a <strong>Dashboard</strong> u operaciones; algunos equipos comparten
                acceso con quien tiene <strong>Planificación</strong>. Si no ves el menú, coordiná con tu administrador de
                roles.
              </p>
            </div>
          </div>
        ),
        href: '/admin/operaciones',
        moduleKey: 'DASHBOARD',
      },
      {
        id: 'reportes',
        title: '8. Reportes',
        subtitle: 'Liquidación y análisis',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p>
              <strong>Reportes</strong> cierra el circuito: toma los <strong>turnos</strong> y movimientos del período y
              los presenta para liquidación, control de horas, análisis por cliente/objetivo y trazabilidad de{' '}
              <strong>auditoría</strong>. Es la pantalla que usa RRHH, finanzas o supervisión para validar lo operado.
            </p>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Pestañas y contenido
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Por empleado</strong>: consolidado de horas y turnos según reglas del sistema (ordinarias,
                  nocturnas, etc., según configuración y diccionario de códigos operativos).
                </li>
                <li>
                  <strong>Por objetivo</strong>: agregado por sede/cliente; útil para facturar o comparar contra el SLA
                  (incluye métricas como turnos cubiertos y vacantes cuando aplica).
                </li>
                <li>
                  <strong>Auditoría</strong>: listado de acciones relevantes (altas/bajas, cambios de turno, exportaciones,
                  etc.) con actor y detalle para cumplimiento interno.
                </li>
                <li>
                  <strong>Turnos / detalle</strong>: profundizar en asignaciones y movimientos del rango elegido cuando
                  necesitás el detalle fino.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 mb-2">
                Salidas y uso
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                <li>
                  <strong>Rango de fechas</strong>: ajustá el período (quincena, mes, auditoría puntual) antes de generar.
                </li>
                <li>
                  <strong>Exportar CSV</strong>: bajá tablas para Excel; las exportaciones suelen registrarse en
                  auditoría.
                </li>
                <li>
                  <strong>Impresión</strong>: versión pensada para papel o PDF cuando necesitás documento firmable.
                </li>
              </ul>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Si tu usuario tiene <strong>vista restringida a un cliente</strong>, los reportes se filtran a ese
              contratante.
            </p>
          </div>
        ),
        href: '/admin/reportes',
        moduleKey: 'REPORTS',
      },
      {
        id: 'cierre',
        title: 'Listo para producción',
        subtitle: 'Checklist rápido',
        body: (
          <div className="space-y-5 text-slate-600 dark:text-slate-300">
            <p className="font-medium text-slate-800 dark:text-slate-100">Checklist de implementación</p>
            <ol className="list-decimal pl-5 space-y-3 text-sm leading-relaxed">
              <li>
                <strong>CRM</strong>: cliente creado, datos de contacto revisados, sin duplicados.
              </li>
              <li>
                <strong>Objetivos (SEDES)</strong>: todas las sedes con nombre, dirección y coordenadas si usás mapa.
              </li>
              <li>
                <strong>Servicios SLA</strong>: puestos, cobertura, turnos permitidos y vigencia alineados al contrato.
              </li>
              <li>
                <strong>Nómina</strong>: legajos en Personal o alta/import en RRHH; empleados activos con categoría y
                convenio correctos.
              </li>
              <li>
                <strong>Planificación</strong>: grilla cargada para el período, feriados considerados, vacantes
                identificadas.
              </li>
              <li>
                <strong>Operaciones</strong>: equipo entrenado en ingresos, ausencias y cobertura de vacantes.
              </li>
              <li>
                <strong>Reportes</strong>: rango de fechas probado, CSV validado contra planilla interna.
              </li>
            </ol>
            <p className="text-sm pt-1 border-t border-slate-100 dark:border-slate-700">
              Podés <strong>reiniciar la guía</strong> desde abajo o retomar el último paso guardado en este navegador.
            </p>
          </div>
        ),
      },
    ],
    []
  );

  const total = steps.length;
  const current = steps[step];

  const canOpenStep = (s: Step): boolean => {
    if (!s.href) return false;
    if (s.id === 'operaciones') return canReadModule('DASHBOARD') || canReadModule('PLANNING');
    if (s.id === 'empleados-alta') return canReadModule('RRHH') || canReadModule('PLANNING');
    if (s.moduleKey && canReadModule(s.moduleKey)) return true;
    return false;
  };

  const resetGuia = () => {
    setStep(0);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[40vh] text-slate-500 font-medium">Cargando…</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Head>
        <title>Guía interactiva | COSP</title>
      </Head>

      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 shrink-0">
            <BookOpen size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Guía interactiva
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
              Primeros pasos — del cliente al reporte
            </p>
          </div>
        </div>

        {/* Progreso */}
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(i)}
              className={`h-2.5 rounded-full transition-all ${
                i === step ? 'w-10 bg-indigo-600' : i < step ? 'w-2.5 bg-indigo-300 dark:bg-indigo-700' : 'w-2.5 bg-slate-200 dark:bg-slate-600'
              }`}
              title={s.title}
              aria-label={`Paso ${i + 1}: ${s.title}`}
            />
          ))}
          <span className="text-[10px] font-bold text-slate-400 ml-2 uppercase tracking-wider">
            {step + 1} / {total}
          </span>
        </div>

        {/* Tarjeta paso */}
        <div className="rounded-xl border shadow-lg overflow-hidden" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3 bg-gradient-to-br from-indigo-50 to-white dark:from-slate-800 dark:to-slate-800">
            {current.id === 'bienvenida' && <Sparkles className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'cliente' && <Building2 className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'objetivos' && <MapPin className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'servicios' && <ShieldCheck className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'empleados-alta' && <UserPlus className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'rrhh' && <Users className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'planificacion' && <Calendar className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'operaciones' && <Radio className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'reportes' && <BarChart3 className="text-indigo-500 shrink-0" size={22} />}
            {current.id === 'cierre' && <CheckCircle2 className="text-emerald-500 shrink-0" size={22} />}
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">{current.title}</h2>
              {current.subtitle && <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{current.subtitle}</p>}
            </div>
          </div>
          <div className="p-6 md:p-8 text-base leading-relaxed">{current.body}</div>
          <div className="px-6 md:px-8 pb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {current.href && (
                <>
                  {canOpenStep(current) ? (
                    <Link
                      href={current.href}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-md transition-colors"
                    >
                      Abrir módulo
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 text-xs font-medium">
                      Sin permiso para abrir este módulo — consultá a un administrador
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowLeft size={18} /> Anterior
              </button>
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
                disabled={step >= total - 1}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-bold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={resetGuia}
            className="text-xs font-bold text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 uppercase tracking-wider"
          >
            Reiniciar guía desde el paso 1
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
