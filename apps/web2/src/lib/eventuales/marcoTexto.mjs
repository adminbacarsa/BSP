/** Estado y texto del contrato marco. Sin dependencias de Node: lo usan el front (impresión en lote) y el servidor. */
import { sumarDias } from './jornadas.mjs';
import { AVISO_MARCO_DIAS, VIGENCIA_MARCO_DIAS } from './marcoAnexoConst.mjs';

export function planMarco({ firmado, fechaFirma, vigenciaDias, hoy }) {
  if (!firmado || !/^\d{4}-\d{2}-\d{2}$/.test(String(fechaFirma || ''))) {
    return { estado: 'SIN_MARCO', vencimiento: null, avisar: false };
  }
  const dias = Number(vigenciaDias) > 0 ? Number(vigenciaDias) : VIGENCIA_MARCO_DIAS;
  const vencimiento = sumarDias(fechaFirma, dias);
  if (vencimiento < hoy) return { estado: 'VENCIDO', vencimiento, avisar: false };
  return { estado: 'MARCO_VIGENTE', vencimiento, avisar: vencimiento <= sumarDias(hoy, AVISO_MARCO_DIAS) };
}

export function marcoDeBolsa(bolsa, empresaId, hoy) {
  const guardado = bolsa?.marcos?.[empresaId] || null;
  if (!guardado) return planMarco({ firmado: false, hoy });
  return planMarco({
    firmado: guardado.firmado === true,
    fechaFirma: guardado.fechaFirma,
    vigenciaDias: guardado.vigenciaDias,
    hoy,
  });
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function dato(value, vacio = '—') {
  const s = String(value ?? '').trim();
  return s || vacio;
}

/** CUIT y CUIL de 11 dígitos como XX-XXXXXXXX-X. Si no cierra, se deja el texto. */
function idFiscal(value) {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length !== 11) return dato(value);
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/** Teléfono y mail de la bolsa, más el resto que el marco imprime del trabajador. */
export function datosTrabajador(bolsa, cuil) {
  const b = bolsa || {};
  const domicilio = [b.domicilio, b.localidad].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
  return {
    trabajadorNombre: String(b.nombre || '').trim(),
    trabajadorDni: String(b.dni || '').trim(),
    trabajadorCuil: String(cuil || b.cuil || '').replace(/\D/g, ''),
    trabajadorDomicilio: domicilio,
    telefono: String(b.telefono || '').trim(),
    mail: String(b.mail || '').trim(),
  };
}

/** ISO o dd/mm/aaaa → «1 de octubre de 2026». Si no se puede leer, se deja el texto. */
export function fechaLarga(raw) {
  const s = String(raw ?? '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  const y = iso ? Number(iso[1]) : dmy ? Number(dmy[3]) : 0;
  const m = iso ? Number(iso[2]) : dmy ? Number(dmy[2]) : 0;
  const d = iso ? Number(iso[3]) : dmy ? Number(dmy[1]) : 0;
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return s || '—';
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

export function fechaCorta(raw) {
  const s = String(raw ?? '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s || '—';
}

/**
 * Las 12 cláusulas del Anexo A del instructivo de RRHH. El teléfono y el mail
 * van en la DÉCIMA. El resto del texto es el modelo; no se reescribe acá.
 */
export function clausulasMarco({ telefono, mail } = {}) {
  return [
    { titulo: 'PRIMERA – Naturaleza.', cuerpo: 'Las partes convienen que la relación que las vincula es de naturaleza EVENTUAL, dentro de los alcances de los arts. 99, 100 y concordantes de la Ley de Contrato de Trabajo (t.o. Decreto 390/76), modificada por la Ley 24.013. El empleador contrata al trabajador para la realización de tareas eventuales de Servicio de Seguridad y Vigilancia.' },
    { titulo: 'SEGUNDA – Causa.', cuerpo: 'Las prestaciones tendrán como fin la satisfacción de resultados concretos vinculados con necesidades transitorias y extraordinarias del empleador, tales como eventos, reemplazo de personal ausente o demanda extraordinaria de personal. La causa concreta de cada prestación se indicará en el anexo de la convocatoria respectiva.' },
    { titulo: 'TERCERA – Jornadas.', cuerpo: 'Los días, horarios, lugar y cantidad de horas de cada prestación se fijarán en cada anexo de convocatoria, respetando la jornada máxima legal y convencional y un descanso mínimo de doce (12) horas entre jornadas.' },
    { titulo: 'CUARTA – Remuneración.', cuerpo: 'La remuneración será la que resulte de la escala salarial vigente del CCT 422/05 (SUVICO) para la categoría Vigilador General, calculada sobre las jornadas efectivamente prestadas en cada convocatoria, con los adicionales que correspondan por convenio y ley (nocturnidad, sábados, domingos y feriados, horas extraordinarias), y se abonará por mes vencido. Al finalizar cada convocatoria se liquidarán los proporcionales de SAC y vacaciones.' },
    { titulo: 'QUINTA – Obligaciones.', cuerpo: 'El trabajador se compromete a prestar el servicio con puntualidad, asistencia regular y dedicación adecuada, y a observar el deber de fidelidad que derive de la índole de las tareas asignadas, guardando reserva o secreto de las informaciones a que tenga acceso y que exijan tal comportamiento.' },
    { titulo: 'SEXTA – Instrucciones.', cuerpo: 'El trabajador deberá observar las órdenes e instrucciones que se le impartan sobre el modo de ejecución del trabajo, ya sea por el empleador o por su representante, y conservar los instrumentos o útiles de trabajo.' },
    { titulo: 'SÉPTIMA – Normas internas.', cuerpo: 'El trabajador presta conformidad con las normas internas de la empresa, que forman parte integrante de este contrato y de las cuales toma conocimiento en este acto.' },
    { titulo: 'OCTAVA – Registración.', cuerpo: 'El empleador registrará cada prestación ante ARCA (Simplificación Registral) con carácter previo a su inicio, informando el alta y la baja correspondientes a cada convocatoria.' },
    { titulo: 'NOVENA – Anexos por convocatoria.', cuerpo: 'Cada convocatoria que el trabajador acepte a través de la aplicación COSP, mediante el ingreso del código de verificación personal que recibe en la aplicación o en su correo electrónico, constituye un ANEXO de este contrato. El anexo detalla la causa, las jornadas, los horarios, el lugar y la remuneración de esa convocatoria. La aceptación así realizada tiene valor de conformidad expresa respecto del anexo, que queda registrado con fecha, hora y constancia de aceptación, a disposición del trabajador en la aplicación.' },
    { titulo: 'DÉCIMA – Medios digitales.', cuerpo: `El trabajador declara como medios de contacto el teléfono ${dato(telefono)} y el correo electrónico ${dato(mail)}, y se obliga a informar sus cambios. Las convocatorias, anexos y notificaciones cursadas por la aplicación COSP o a esos medios se tendrán por válidas.` },
    { titulo: 'UNDÉCIMA – Vigencia.', cuerpo: 'Este contrato marco tendrá vigencia de un (1) año desde su firma. Su vencimiento no afecta las convocatorias en curso. Cualquiera de las partes podrá darlo por concluido comunicándolo a la otra, sin perjuicio de las convocatorias ya aceptadas.' },
    { titulo: 'DUODÉCIMA – Domicilios y jurisdicción.', cuerpo: 'A todos los efectos contractuales y extracontractuales las partes constituyen sus domicilios legales en los arriba indicados, donde se tendrán por válidas y eficaces todas las notificaciones efectuadas. Las partes se someten voluntaria y exclusivamente a la competencia de la Justicia Ordinaria de Córdoba, renunciando a cualquier otro fuero y/o jurisdicción que pudiera corresponderles.' },
  ];
}

export const CIERRE_MARCO = 'En prueba de conformidad, se firman dos ejemplares de un mismo tenor y a un solo efecto, en el lugar y fecha indicados.';
export const TITULO_MARCO = 'CONTRATO MARCO DE TRABAJO EVENTUAL';

/** Encabezado de partes. La empresa sale de empresas/{id}; nada queda fijo de Bacar. */
export function encabezadoMarco({
  fecha, empresaNombre, empresaCuit, empresaDomicilio,
  trabajadorNombre, trabajadorDni, trabajadorCuil, trabajadorDomicilio, telefono, mail,
}) {
  return `En la ciudad de Córdoba, a los ${fechaLarga(fecha)}, entre ${dato(empresaNombre, 'LA EMPRESA')}, CUIT ${idFiscal(empresaCuit)}, con domicilio en ${dato(empresaDomicilio)}, en adelante «el EMPLEADOR»; y ${dato(trabajadorNombre, 'EL TRABAJADOR')}, DNI ${dato(trabajadorDni)}, CUIL ${idFiscal(trabajadorCuil)}, con domicilio en ${dato(trabajadorDomicilio)}, teléfono ${dato(telefono)} y correo electrónico ${dato(mail)}, en adelante «el TRABAJADOR»; se celebra el presente contrato marco de trabajo eventual, sujeto a las siguientes cláusulas y condiciones:`;
}

export function textoMarco(input = {}) {
  const clausulas = clausulasMarco(input);
  return [
    TITULO_MARCO,
    encabezadoMarco(input),
    ...clausulas.map((c) => `${c.titulo} ${c.cuerpo}`),
    CIERRE_MARCO,
  ].join('\n\n');
}

function horasDe(jornada) {
  if (jornada?.horas == null || jornada.horas === '') return '—';
  return `${jornada.horas} h`;
}

function horarioDe(jornada) {
  const ini = String(jornada?.horaInicio || '').trim();
  const fin = String(jornada?.horaFin || '').trim();
  if (ini && fin) return `${ini} a ${fin}`;
  return ini || fin || '—';
}

/** Anexo C. `plano` es el texto canónico (se hashea). La tabla sale aparte en el PDF. */
export function modeloAnexo(input = {}) {
  const jornadas = Array.isArray(input.jornadas) ? input.jornadas : [];
  const fechas = jornadas.map((j) => String(j?.fecha || '').slice(0, 10)).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  const alta = fechaCorta(input.fechaAlta || fechas[0]);
  const baja = fechaCorta(input.fechaBaja || fechas[fechas.length - 1]);
  const numero = dato(input.numero);
  const bloques = [
    { titulo: 'Partes:', cuerpo: `${dato(input.empresaNombre, 'LA EMPRESA')}, CUIT ${idFiscal(input.empresaCuit)} (EMPLEADOR), y ${dato(input.trabajadorNombre, 'EL TRABAJADOR')}, DNI ${dato(input.trabajadorDni)}, CUIL ${idFiscal(input.trabajadorCuil)} (TRABAJADOR).` },
    { titulo: 'Contrato marco de referencia:', cuerpo: `firmado el ${fechaCorta(input.marcoFecha)}, vigente hasta el ${fechaCorta(input.marcoVencimiento)}.` },
    { titulo: 'Causa de la eventualidad:', cuerpo: `${dato(input.causa)}.` },
    { titulo: 'Lugar de prestación:', cuerpo: `${dato(input.lugar)}.` },
    { titulo: 'Tareas:', cuerpo: 'Servicio de Seguridad y Vigilancia, categoría Vigilador General (CCT 422/05).' },
  ];
  const filas = jornadas.map((j) => [fechaCorta(j.fecha), horarioDe(j), horasDe(j), dato(j.observacion)]);
  const monto = input.bruto == null || input.bruto === '' ? '[monto calculado]' : String(input.bruto);
  const remuneracion = `Remuneración bruta de esta convocatoria: según escala salarial CCT 422/05 vigente, con los adicionales que correspondan: ${monto}, más SAC y vacaciones proporcionales al cierre. Se abona por mes vencido.`;
  const arca = `Registración ARCA: alta el ${alta} (antes de la primera jornada) y baja el ${baja} (día en que termina la última jornada). Modalidad 012 – Trabajo eventual.`;
  const cierre = 'Este anexo integra el contrato marco según su cláusula novena. El trabajador lo aceptó a través de la aplicación COSP mediante código de verificación personal, según la constancia adjunta.';
  const plano = [
    `ANEXO N.º ${numero} AL CONTRATO MARCO DE TRABAJO EVENTUAL`,
    ...bloques.map((b) => `${b.titulo} ${b.cuerpo}`),
    'Jornadas:',
    ...(filas.length ? filas.map((f) => f.join(' | ')) : ['—']),
    remuneracion,
    arca,
    cierre,
  ].join('\n');
  return {
    titulo: `ANEXO N.º ${numero} AL CONTRATO MARCO DE TRABAJO EVENTUAL`,
    bloques,
    filas,
    remuneracion,
    arca,
    cierre,
    plano,
  };
}

export function textoAnexo(input) {
  return modeloAnexo(input).plano;
}

/** Anexo D. Hoja final del PDF del anexo. */
export function textoConstancia({
  numero, marcoFecha, trabajadorNombre, cuil, mail, uid,
  convocatoriaEnviada, fechaHora, codigoVerificado, dispositivo, ip, ubicacion, hashAnexo,
} = {}) {
  const verificado = codigoVerificado ? 'verificado' : 'no verificado';
  return [
    `Documento: Anexo N.º ${dato(numero)} al contrato marco del ${fechaCorta(marcoFecha)}`,
    `Trabajador: ${dato(trabajadorNombre)} · CUIL ${idFiscal(cuil)}`,
    `Usuario de la app: ${dato(mail || uid)} (cuenta EVENTUAL)`,
    `Convocatoria enviada: ${dato(convocatoriaEnviada)}`,
    `Aceptación: ${dato(fechaHora)} (hora del servidor)`,
    `Código de verificación: ${verificado}`,
    `Dispositivo: ${dato(dispositivo)}`,
    `IP: ${dato(ip)}`,
    `Ubicación informada: ${dato(ubicacion, 'no informada')}`,
    'Huella digital del anexo (SHA-256):',
    dato(hashAnexo),
    'Cualquier modificación posterior del documento cambia su huella digital y puede detectarse comparándola con la registrada en COSP.',
  ].join('\n');
}
