import { arcaEventualesDe, lineasCargaMasiva } from './arcaTxt.mjs';

/** Se muestra cuando el convenio sigue vacío: el TXT se arma y queda no enviable. */
export const AVISO_CCT_PENDIENTE = 'Pendiente: consultar al contador';

/**
 * Lo que RRHH edita en Eventuales → Parámetros → ARCA.
 * `tipo: digitos` exige exactamente `len` dígitos (se conservan los ceros).
 * `alfa` admite hasta `max` caracteres imprimibles. Vacío solo si `opcional`.
 */
export const CAMPOS_ARCA = Object.freeze([
  {
    id: 'cctCodigo',
    etiqueta: 'Código de convenio CCT',
    ayuda: 'Hasta 10 caracteres. Posiciones 91-100 del TXT de carga masiva. Sale de la tabla de convenios de ARCA; el de CCT 422/05 todavía no está confirmado.',
    tipo: 'alfa',
    max: 10,
    opcional: true,
  },
  {
    id: 'categoria',
    etiqueta: 'Categoría profesional',
    ayuda: '6 dígitos. Posiciones 101-106. Vigilador = 033104 (tabla de categorías ARCA).',
    tipo: 'digitos',
    len: 6,
    defecto: '033104',
  },
  {
    id: 'modalidadContrato',
    etiqueta: 'Modalidad de contrato',
    ayuda: '3 dígitos. Posiciones 17-19. 012 = trabajo eventual (código 12 de la tabla 3 de ARCA).',
    tipo: 'digitos',
    len: 3,
    defecto: '012',
  },
  {
    id: 'obraSocialDefault',
    etiqueta: 'Obra social por defecto (RNOS)',
    ayuda: '6 dígitos. Posiciones 40-45 cuando el vigilador no tiene RNOS propio. SUVICO = 122807.',
    tipo: 'digitos',
    len: 6,
    defecto: '122807',
  },
  {
    id: 'situacionRevistaDesistimiento',
    etiqueta: 'Situación de revista de baja / desistimiento',
    ayuda: '2 dígitos. Revista del BT si no se presentó (tabla 7). Default 30, rescisión antes del inicio.',
    tipo: 'digitos',
    len: 2,
    defecto: '30',
  },
  {
    id: 'situacionRevistaBaja',
    etiqueta: 'Motivo de baja',
    ayuda: '2 dígitos. Revista del BT de fin de contrato, posiciones 46-47. Default 30 (vencimiento art. 250).',
    tipo: 'digitos',
    len: 2,
    defecto: '30',
  },
  {
    id: 'puesto',
    etiqueta: 'Puesto',
    ayuda: 'Hasta 4 caracteres. Posiciones 85-88. 5414 es el puesto cargado hoy; hay que verificarlo en la tabla de puestos.',
    tipo: 'alfa',
    max: 4,
    defecto: '5414',
  },
  {
    id: 'sucursal',
    etiqueta: 'Sucursal',
    ayuda: '5 dígitos. Posiciones 74-78, domicilio de desempeño. 00000 = casa central.',
    tipo: 'digitos',
    len: 5,
    defecto: '00000',
  },
  {
    id: 'actividad',
    etiqueta: 'Actividad CIIU',
    ayuda: '6 dígitos. Posiciones 79-84. 801000 = servicios de seguridad.',
    tipo: 'digitos',
    len: 6,
    defecto: '801000',
  },
  {
    id: 'nocturnoPct',
    etiqueta: 'Nocturnidad de la escala (%)',
    ayuda: 'Recargo nocturno del anexo. Si la escala aprobada no trae el %, se usa este. Vacío = lo define la escala.',
    tipo: 'pct',
    opcional: true,
  },
]);

const MUESTRA = {
  contrato: { fechaAlta: '2026-10-02', fechaBaja: '2026-10-03' },
  cuil: '20999999991',
  bruto: 1000,
};

/** Textos del formulario a partir de lo que hoy generaría el TXT (defaults del grupo incluidos). */
export function valoresArcaDe(empresa) {
  const cfg = arcaEventualesDe(empresa);
  const guardado = empresa?.arcaEventuales?.nocturnoPct;
  const pct = guardado == null || guardado === '' || !Number.isFinite(Number(guardado)) ? '' : String(guardado);
  const out = {};
  for (const campo of CAMPOS_ARCA) {
    if (campo.tipo === 'pct') out[campo.id] = pct;
    else out[campo.id] = String(cfg[campo.id] ?? '');
  }
  return out;
}

export function validarParametrosArca(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errores = [];
  const doc = {};
  for (const campo of CAMPOS_ARCA) {
    const texto = src[campo.id] == null ? '' : String(src[campo.id]).trim();
    if (campo.tipo === 'pct') {
      if (!texto) {
        doc.nocturnoPct = null;
        continue;
      }
      const n = Number(texto.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        errores.push({ id: campo.id, mensaje: 'El % de nocturnidad tiene que estar entre 0 y 100.' });
      } else {
        doc.nocturnoPct = Math.round(n * 100) / 100;
      }
      continue;
    }
    if (!texto) {
      if (campo.opcional) {
        doc[campo.id] = '';
        continue;
      }
      errores.push({ id: campo.id, mensaje: `${campo.etiqueta} es obligatorio.` });
      continue;
    }
    if (campo.tipo === 'digitos') {
      if (!new RegExp(`^\\d{${campo.len}}$`).test(texto)) {
        errores.push({ id: campo.id, mensaje: `${campo.etiqueta}: tienen que ser ${campo.len} dígitos.` });
      } else {
        doc[campo.id] = texto;
      }
      continue;
    }
    if (texto.length > campo.max || /[^\x20-\x7E]/.test(texto)) {
      errores.push({ id: campo.id, mensaje: `${campo.etiqueta}: hasta ${campo.max} caracteres, sin tildes ni símbolos raros.` });
    } else {
      doc[campo.id] = texto;
    }
  }
  if (errores.length) return { ok: false, errores, doc: null };
  doc.categoriaProfesional = doc.categoria;
  doc.situacionRevistaNoInicio = doc.situacionRevistaDesistimiento;
  return { ok: true, errores: [], doc };
}

/** Línea AT de muestra con los valores ya validados. El CCT vacío deja `enviable` en false. */
export function vistaPreviaArca(doc) {
  const out = lineasCargaMasiva({
    contrato: MUESTRA.contrato,
    cuil: MUESTRA.cuil,
    bruto: MUESTRA.bruto,
    obraSocial: doc.obraSocialDefault,
    empresa: { arcaEventuales: doc },
  });
  const cct = String(doc.cctCodigo || '').trim();
  return {
    linea: out.lineas[0],
    lineaBaja: out.lineas[1],
    enviable: out.enviable,
    advertencias: out.advertencias,
    avisoCct: cct ? '' : AVISO_CCT_PENDIENTE,
  };
}

export function mensajeErroresArca(errores) {
  return (errores || []).map((e) => e.mensaje).join(' ');
}
