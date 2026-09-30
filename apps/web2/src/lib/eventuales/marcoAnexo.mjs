import { createHash, randomInt } from 'node:crypto';
import { sumarDias } from './jornadas.mjs';
import {
  AVISO_MARCO_DIAS, CARPETA_EVENTUALES, CODIGO_ANEXO_MINUTOS, CUENTA_DRIVE_EVENTUALES,
  DRIVE_ROOT_EVENTUALES_DEFAULT, MOTIVO_SIN_MARCO, VIGENCIA_MARCO_DIAS,
} from './marcoAnexoConst.mjs';

export {
  AVISO_MARCO_DIAS, CARPETA_EVENTUALES, CODIGO_ANEXO_MINUTOS, CUENTA_DRIVE_EVENTUALES,
  DRIVE_ROOT_EVENTUALES_DEFAULT, MOTIVO_SIN_MARCO, VIGENCIA_MARCO_DIAS,
};

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

export function clausulasMarco() {
  return [
    'PRIMERA: El contrato es de naturaleza eventual, arts. 99 y 100 de la LCT (t.o. Decreto 390/76), modificado por la Ley 24.013. El empleador contrata al trabajador para tareas eventuales de servicio de seguridad y vigilancia.',
    'SEGUNDA: La prestación cubre necesidades transitorias del empleador, en particular demanda extraordinaria de personal. No hay un plazo cierto de finalización del vínculo.',
    'TERCERA: La remuneración es la que resulte de la escala salarial vigente del CCT 422/05 (SUVICO) para la categoría del trabajador, según las jornadas de cada convocatoria. No es un monto fijo.',
    'CUARTA: El trabajador presta el servicio con puntualidad, asistencia y dedicación, y guarda reserva de la información a la que acceda.',
    'QUINTA: Cumple las órdenes sobre el modo de ejecución del trabajo y conserva los instrumentos de trabajo. Toma conocimiento de las normas internas de la empresa, que integran este contrato.',
    'SEXTA: Los domicilios legales son los denunciados en este contrato. Las partes se someten a la Justicia Ordinaria de Córdoba.',
    'SÉPTIMA: Cada convocatoria que el trabajador acepte en la aplicación COSP constituye un ANEXO de este contrato. El anexo detalla la causa, las jornadas, los horarios, el lugar y la remuneración de esa convocatoria. La aceptación con código de verificación tiene valor de conformidad expresa respecto de ese anexo.',
  ];
}

export function textoMarco({ empresaNombre, empresaCuit, empresaDomicilio, trabajadorNombre, trabajadorDni, trabajadorDomicilio, fecha }) {
  const partes = [
    'CONTRATO MARCO DE TRABAJO EVENTUAL',
    `En ${fecha || 'la fecha de firma'}, entre ${empresaNombre || 'LA EMPRESA'}, CUIT ${empresaCuit || '—'}, domicilio ${empresaDomicilio || '—'}, en adelante EL EMPLEADOR, y ${trabajadorNombre || 'EL TRABAJADOR'}, DNI ${trabajadorDni || '—'}, domicilio ${trabajadorDomicilio || '—'}, en adelante EL TRABAJADOR, se celebra este contrato marco.`,
    ...clausulasMarco(),
    'La firma de este marco es en papel, de puño y letra. Cada anexo posterior se acepta en la aplicación COSP. Se firman dos ejemplares de un mismo tenor.',
  ];
  return partes.join('\n\n');
}

export function textoAnexo({ marcoFecha, causa, jornadas, lugar, bruto, empresaNombre }) {
  const filas = (jornadas || []).map((j) => `${j.fecha} ${j.horaInicio}–${j.horaFin} (${j.horas} h)`).join('\n');
  return [
    'ANEXO POR CONVOCATORIA',
    `Referencia: contrato marco de ${empresaNombre || 'la empresa'} firmado el ${marcoFecha || '—'}.`,
    `Causa: ${causa || '—'}`,
    `Lugar: ${lugar || '—'}`,
    'Jornadas:',
    filas || '—',
    `Remuneración bruta de esta convocatoria, según escala CCT 422/05 vigente: ${bruto == null ? 'a liquidar' : bruto}`,
  ].join('\n');
}

export function textoConstancia({ uid, codigoVerificado, fechaHora, hashAnexo, dispositivo, ip, ubicacion }) {
  return [
    'CONSTANCIA DE ACEPTACIÓN',
    `Usuario: ${uid || '—'}`,
    `Código verificado: ${codigoVerificado ? 'sí' : 'no'}`,
    `Fecha y hora del servidor: ${fechaHora || '—'}`,
    `Hash SHA-256 del anexo: ${hashAnexo || '—'}`,
    `Dispositivo: ${dispositivo || '—'}`,
    `IP: ${ip || '—'}`,
    `Ubicación: ${ubicacion || 'no informada'}`,
  ].join('\n');
}

function pdfEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** PDF de una página con Helvetica. Alcanza para marco, anexo y constancia. */
export function pdfDeTexto(texto) {
  const limpio = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x0A\x20-\x7E]/g, ' ');
  const lineas = limpio.split('\n').flatMap((linea) => {
    const trozos = [];
    let resto = linea;
    while (resto.length > 90) {
      trozos.push(resto.slice(0, 90));
      resto = resto.slice(90);
    }
    trozos.push(resto);
    return trozos;
  }).slice(0, 48);
  const comandos = ['BT', '/F1 10 Tf', '50 800 Td', '14 TL'];
  lineas.forEach((linea, i) => {
    if (i) comandos.push('T*');
    comandos.push(`(${pdfEscape(linea)}) Tj`);
  });
  comandos.push('ET');
  const stream = comandos.join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(body.length);
    body += obj;
  });
  const xrefAt = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((off) => { xref += `${String(off).padStart(10, '0')} 00000 n \n`; });
  body += `${xref}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

function limpio(value) {
  return String(value ?? '').replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function legajoDe(bolsa) {
  const directo = limpio(bolsa?.legajo || bolsa?.legajoPlanilla);
  if (directo) return directo;
  const item = (bolsa?.legajos || []).find((l) => limpio(l?.fileNumber || l?.legajo || l?.nro));
  return limpio(item?.fileNumber || item?.legajo || item?.nro);
}

/** Con legajo: `Legajo {nro} - {APELLIDO, Nombre} - {CUIL}`. Sin legajo: `{CUIL} - {Nombre}`. */
export function nombreCarpetaPersona({ cuil, nombre, legajo }) {
  const quien = limpio(nombre) || 'SIN NOMBRE';
  const id = limpio(cuil);
  const nro = limpio(legajo);
  if (nro) return `Legajo ${nro} - ${quien} - ${id}`;
  return `${id} - ${quien}`;
}

/** Si la raíz ya se llama Eventuales se usa directa. No se arma Eventuales/Eventuales. */
export function planCarpetaEventuales(nombreRaiz) {
  const raiz = limpio(nombreRaiz).toLowerCase();
  return { usarRaiz: raiz === CARPETA_EVENTUALES.toLowerCase(), nombre: CARPETA_EVENTUALES };
}

export function planRenombre(nombreActual, nombreNuevo) {
  if (!nombreActual || nombreActual === nombreNuevo) return { renombrar: false, nombre: nombreNuevo };
  return { renombrar: true, nombre: nombreNuevo };
}

export function nombreArchivo({ tipo, fecha, lugar, empresa }) {
  const emp = limpio(empresa) || 'Empresa';
  const dia = String(fecha || '').slice(0, 10);
  if (tipo === 'MARCO') return `${emp}-Marco-${dia}.pdf`;
  if (tipo === 'ARCA') return `${emp}-ARCA-${dia}.pdf`;
  const slug = limpio(lugar || 'convocatoria').slice(0, 40);
  return `${emp}-Anexo-${dia}-${slug}.pdf`;
}

export function destinoGuardado(folderId) {
  return String(folderId || '').trim() ? 'DRIVE' : 'STORAGE';
}

export function nuevoCodigoAnexo() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

export function hashCodigo(codigo, salt) {
  return sha256(`${salt}:${String(codigo || '').trim()}`);
}

export function planConfirmarAnexo({ codigo, salt, hash, usado, venceMs, ahoraMs }) {
  if (usado) return { ok: false, codigo: 'CODIGO_USADO' };
  if (!venceMs || ahoraMs > venceMs) return { ok: false, codigo: 'CODIGO_VENCIDO' };
  if (!codigo || hashCodigo(codigo, salt) !== hash) return { ok: false, codigo: 'CODIGO_INVALIDO' };
  return { ok: true };
}

export const MENSAJE_SIN_CANAL = 'No pudimos enviarte el código. Contactá a RRHH.';

/** Lo que se muestra después del @. «terminado en gmail.com». */
export function sufijoMail(mail) {
  const texto = String(mail || '').trim().toLowerCase();
  const at = texto.lastIndexOf('@');
  if (at < 1 || at === texto.length - 1) return '';
  return texto.slice(at + 1);
}

/** PUSH si hay token FCM. MAIL si hay casilla. WhatsApp no está integrado. */
export function canalCodigo({ mail, tienePush }) {
  const canales = [];
  if (tienePush === true) canales.push('PUSH');
  if (String(mail || '').includes('@')) canales.push('MAIL');
  if (!canales.length) return { ok: false, codigo: 'SIN_CANAL', mensaje: MENSAJE_SIN_CANAL, canales };
  return { ok: true, canales, mensaje: mensajeEnvioCodigo({ canales, mail }) };
}

export function mensajeEnvioCodigo({ canales, mail }) {
  const lista = canales || [];
  const push = lista.includes('PUSH');
  const porMail = lista.includes('MAIL');
  const sufijo = sufijoMail(mail);
  if (push && porMail) {
    return `Te enviamos un código de 6 dígitos a tu app y a tu mail terminado en ${sufijo}.`;
  }
  if (push) return 'Te enviamos un código de 6 dígitos a tu app.';
  if (porMail) return `Te enviamos un código de 6 dígitos a tu mail terminado en ${sufijo}.`;
  return MENSAJE_SIN_CANAL;
}
