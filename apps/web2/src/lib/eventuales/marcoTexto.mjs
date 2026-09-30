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
