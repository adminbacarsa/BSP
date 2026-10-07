/**
 * Archivo y lectura de certificados. No guarda diagnóstico ni texto clínico.
 * Nómina: puede justificar E/L/ART. Eventual: solo «Certificado recibido» (no paga).
 */

export const CONFIANZA_ALTA = 0.85;
export const MODO_DEFAULT = 'PROPUESTA';

const TIPOS = new Set(['enfermedad', 'art', 'estudio', 'otro']);

const LICENCIA = {
  enfermedad: { code: 'E', label: 'Enfermedad' },
  art: { code: 'ART', label: 'ART' },
  estudio: { code: 'L', label: 'Licencia' },
};

function texto(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function dia(value) {
  const raw = texto(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function confianza(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return Math.min(1, n / 100);
  return Math.max(0, Math.min(1, n));
}

function siNo(value) {
  if (value === true || value === false) return value;
  const t = texto(value).toLowerCase();
  if (['si', 'sí', 'true', '1', 'visible'].includes(t)) return true;
  if (['no', 'false', '0', 'ausente'].includes(t)) return false;
  return null;
}

export function diasEntre(desde, hasta) {
  const a = dia(desde);
  const b = dia(hasta) || a;
  if (!a) return 0;
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms / 86400000) + 1;
}

/** Carpeta de la persona. Si ya hay una en la bolsa, se reutiliza y no se renombra. */
export function nombreCarpetaLegajo({ apellido, nombre, cuil, legajo }) {
  const quien = texto(`${apellido || ''} ${nombre || ''}`) || 'SIN NOMBRE';
  const partes = [quien];
  const id = texto(cuil).replace(/\D/g, '');
  if (id) partes.push(id);
  const nro = texto(legajo);
  if (nro) partes.push(`Legajo ${nro}`);
  return partes.join(' · ');
}

export function nombreArchivoCertificado({ fecha, tipo, desde, hasta, ext }) {
  const diaArchivo = dia(fecha) || dia(desde) || 'sin-fecha';
  const label = texto(tipo) || 'certificado';
  const a = dia(desde);
  const b = dia(hasta) || a;
  const rango = a && b && a !== b ? `${a}–${b}` : (a || 'sin-fechas');
  const sufijo = texto(ext).replace(/^\./, '').toLowerCase() || 'jpg';
  return `${diaArchivo} · ${label} · ${rango}.${sufijo}`.replace(/[\\/:*?"<>|]/g, '-');
}

/** Deja solo los campos operativos. Descarta diagnóstico y cualquier texto clínico. */
export function lecturaLimpia(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const conf = src.confianza && typeof src.confianza === 'object' ? src.confianza : {};
  const tipo = texto(src.tipo).toLowerCase();
  const lectura = {
    fechaEmision: dia(src.fechaEmision),
    medico: texto(src.medico).slice(0, 80),
    matricula: texto(src.matricula).slice(0, 30),
    reposoDesde: dia(src.reposoDesde),
    reposoHasta: dia(src.reposoHasta),
    tipo: TIPOS.has(tipo) ? tipo : 'otro',
    firmaVisible: siNo(src.firmaVisible),
    selloVisible: siNo(src.selloVisible),
    legible: siNo(src.legible),
    nombre: texto(src.nombre).slice(0, 80),
    dni: texto(src.dni).replace(/\D/g, '').slice(0, 11),
    confianza: {
      fechaEmision: confianza(conf.fechaEmision ?? src.confianzaFecha),
      medico: confianza(conf.medico ?? src.confianzaMedico),
      matricula: confianza(conf.matricula),
      reposoDesde: confianza(conf.reposoDesde ?? src.confianzaReposo),
      reposoHasta: confianza(conf.reposoHasta ?? src.confianzaReposo),
      tipo: confianza(conf.tipo ?? src.confianzaTipo),
      firmaVisible: confianza(conf.firmaVisible ?? 1),
      legible: confianza(conf.legible ?? 1),
    },
  };
  return lectura;
}

/** Lo que devuelve Gemini: saca el cerco ```json y descarta el diagnóstico. */
export function parseRespuestaGemini(text) {
  const limpio = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return lecturaLimpia(JSON.parse(limpio));
  } catch {
    return lecturaLimpia({});
  }
}

function normalizarNombre(value) {
  return texto(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function personaCoincide(ausencia, lectura) {
  const dni = lectura.dni;
  const doc = `${ausencia?.dni || ''} ${ausencia?.cuil || ''}`.replace(/\D/g, '');
  if (dni && doc && (doc.includes(dni) || dni.includes(doc))) return true;
  const cert = normalizarNombre(lectura.nombre);
  const persona = normalizarNombre(ausencia?.employeeName || `${ausencia?.apellido || ''} ${ausencia?.nombre || ''}`);
  if (!cert || !persona) return null;
  const tokens = cert.split(' ').filter((t) => t.length > 2);
  if (tokens.length === 0) return null;
  const hits = tokens.filter((t) => persona.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}

export function compararCertificado(ausencia, lectura) {
  const dudas = [];
  if (lectura.legible === false) dudas.push('No se lee bien');
  if (lectura.firmaVisible !== true && lectura.selloVisible !== true) dudas.push('Sin firma ni sello');
  for (const campo of ['tipo', 'reposoDesde', 'reposoHasta']) {
    if ((lectura.confianza?.[campo] ?? 0) < CONFIANZA_ALTA) dudas.push(`Baja confianza en ${campo}`);
  }
  const persona = personaCoincide(ausencia, lectura);
  if (persona === false) dudas.push('No coincide la persona');
  const desde = dia(ausencia?.startDate);
  const hasta = dia(ausencia?.endDate) || desde;
  const rangoDifiere = !!(lectura.reposoDesde && lectura.reposoHasta && (lectura.reposoDesde !== desde || lectura.reposoHasta !== hasta));
  const coincideDias = !rangoDifiere && diasEntre(desde, hasta) > 0 && diasEntre(desde, hasta) === diasEntre(lectura.reposoDesde, lectura.reposoHasta);
  return {
    coincidePersona: persona !== false,
    coincideDias,
    rangoDifiere,
    dudas,
    confianzaAlta: dudas.length === 0,
  };
}

export function textoPropuesta(lectura, licencia, dias) {
  const dr = lectura.medico ? `Dr. ${lectura.medico}` : 'médico sin nombre';
  const mp = lectura.matricula ? ` MP ${lectura.matricula}` : '';
  const n = dias > 0 ? dias : 1;
  return `Justificar como ${licencia.code} · ${n} día${n === 1 ? '' : 's'} · ${dr}${mp}`;
}

/**
 * PROPUESTA no toca la ausencia. AUTOMATICO justifica solo si no hay dudas.
 * Un rango de reposo distinto se ajusta y se avisa. El eventual nunca queda E/L/A.
 */
export function decidirCertificado({ modo, lectura, comparacion, esEventual }) {
  const limpia = lecturaLimpia(lectura);
  const cmp = comparacion || compararCertificado({}, limpia);
  if (esEventual) {
    return {
      accion: 'RECIBIDO',
      texto: 'Certificado recibido',
      tocaAusencia: false,
      paga: false,
      dudas: cmp.dudas,
    };
  }
  const licencia = LICENCIA[limpia.tipo] || null;
  const dias = diasEntre(limpia.reposoDesde, limpia.reposoHasta);
  if (!licencia) {
    return { accion: 'DUDA', texto: 'Certificado recibido', tocaAusencia: false, dudas: [...cmp.dudas, 'Tipo sin licencia'] };
  }
  const propuesta = textoPropuesta(limpia, licencia, dias);
  if (!cmp.confianzaAlta) {
    return { accion: 'DUDA', texto: propuesta, tocaAusencia: false, dudas: cmp.dudas, code: licencia.code, label: licencia.label };
  }
  if (texto(modo).toUpperCase() === 'AUTOMATICO') {
    return {
      accion: 'JUSTIFICAR',
      texto: propuesta,
      tocaAusencia: true,
      paga: true,
      code: licencia.code,
      label: licencia.label,
      ajustarRango: cmp.rangoDifiere === true,
      reposoDesde: limpia.reposoDesde,
      reposoHasta: limpia.reposoHasta,
      justificadaPor: 'IA',
    };
  }
  return {
    accion: 'PROPUESTA',
    texto: propuesta,
    tocaAusencia: false,
    code: licencia.code,
    label: licencia.label,
    ajustarRango: cmp.rangoDifiere === true,
    reposoDesde: limpia.reposoDesde,
    reposoHasta: limpia.reposoHasta,
  };
}

/** El eventual con aviso o certificado no es falta sin aviso. */
export function cuentaComoFaltaSinAviso(aus) {
  if (!aus || aus.reverted) return false;
  const eventual = aus.esEventual === true || !!texto(aus.bolsaCuil);
  if (eventual && (aus.conAviso === true || aus.conCertificado === true || aus.avisoPortal === true)) return false;
  const code = texto(aus.code || aus.absenceType || aus.type).toUpperCase();
  const origin = texto(aus.origin).toUpperCase();
  if (!eventual && ['E', 'L', 'A', 'V', 'PG', 'ART', 'SGS', 'SUS'].includes(code)) return false;
  const falta = code === 'AA' || origin === 'AUTO_T30' || origin === 'AUSENCIA_AUTO' || code.includes('AUSENCIA');
  if (!eventual && !falta) return false;
  return true;
}

export const PROMPT_CERTIFICADO = [
  'Leé el certificado y devolvé solo JSON.',
  'Campos: fechaEmision (YYYY-MM-DD), medico, matricula, reposoDesde, reposoHasta, tipo (enfermedad|art|estudio|otro), firmaVisible, selloVisible, legible, nombre, dni, confianza (0 a 1 por campo).',
  'No incluyas diagnóstico, síntomas ni ningún texto clínico.',
].join(' ');
