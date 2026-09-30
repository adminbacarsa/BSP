import { contratosAbiertosDeEmpresa } from './planilla.mjs';

/**
 * Eventual → planta permanente en la misma empresa (art. 90: la antigüedad
 * sigue desde el 1º ingreso). No llama a ARCA: deja la modificación pendiente.
 */
export function planEfectivizacion(input) {
  const modalidad = input?.modalidadActual;
  if (modalidad !== 'EVENTUAL' && modalidad !== 'PLAZO_FIJO') {
    return { ok: false, error: 'NO_ES_EVENTUAL' };
  }
  const primerIngreso = String(input.primerIngreso || '');
  const fecha = String(input.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primerIngreso) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { ok: false, error: 'FECHA_INVALIDA' };
  }
  if (fecha < primerIngreso) {
    return { ok: false, error: 'FECHA_ANTERIOR_AL_INGRESO' };
  }

  const contratosCerrados = contratosAbiertosDeEmpresa(input.contratos, input.empresaId).map((c) => ({
    id: c.id,
    estado: 'FINALIZADO',
    arcaBajaPendiente: c.estado === 'ALTA_ARCA' || c.estado === 'VIGENTE',
  }));

  const legajosRestantes = (input.bolsaLegajos || []).filter(
    (l) => !(l.empresaId === input.empresaId && l.employeeId === input.employeeId),
  );
  const sigueEnBolsa = legajosRestantes.some(
    (l) => l.modalidad === 'EVENTUAL' || l.modalidad === 'PLAZO_FIJO',
  );

  return {
    ok: true,
    legajo: {
      employeeId: input.employeeId,
      empresaId: input.empresaId,
      modalidad: 'INDETERMINADO',
      fechaEfectivizacion: fecha,
      startDate: primerIngreso,
      contractType: 'FullTime',
      historyItem: {
        modalidad: 'INDETERMINADO',
        desde: fecha,
        motivo: 'EFECTIVIZACION',
        setByUid: input.setByUid || '',
        setAt: input.nowIso || '',
      },
    },
    contratosCerrados,
    bolsa: sigueEnBolsa
      ? {
          cuil: input.bolsaCuil,
          accion: 'QUITAR_LEGAJO',
          disponibilidad: 'DISPONIBLE',
          legajos: legajosRestantes,
        }
      : {
          cuil: input.bolsaCuil,
          accion: 'SALIR',
          disponibilidad: 'NO_DISPONIBLE',
          legajos: legajosRestantes,
        },
    arca: {
      tipo: 'MODIFICACION_MODALIDAD',
      empresaId: input.empresaId,
      cuil: input.bolsaCuil,
      estado: 'PENDIENTE',
    },
  };
}

export function causaContratoValida(causa) {
  return typeof causa === 'string' && causa.trim().length > 0;
}
