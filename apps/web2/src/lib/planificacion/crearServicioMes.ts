/**
 * Crear el servicio del mes.
 * Automático: solo M-1 abierto y cliente activo (abrir Planificación, Preparar, publicar).
 * Manual: el botón puede copiar el último SLA, con confirmación si hay hueco o está cerrado.
 */
import { decidirCopiaSlaMes, nombreMesDeClave, type ClienteCopiaSla } from '../servicios/copiarSlaMes';
import { persistirCopiaSlaMes } from '../servicios/copiarSlaMesCliente';

export type PlanServicioMes =
  | { estado: 'tiene' }
  | { estado: 'no_se_puede'; motivo: string; mes: string }
  | {
      estado: 'crear';
      mes: string;
      mesOrigen: string;
      requiereConfirmacion: boolean;
      confirmacion: string;
      run: (ctx: { empresaId: string; migracionCompleta: boolean; scopeEmpresa: boolean; via: string }) => Promise<unknown>;
    };

function clienteDe(input: { cliente?: ClienteCopiaSla | null; clienteActivo?: boolean }): ClienteCopiaSla | null | undefined {
  if (input.clienteActivo === false) return { ...(input.cliente || {}), status: 'INACTIVE' };
  if (input.cliente === null) return null;
  if (input.cliente) return input.cliente;
  if (input.clienteActivo === true) return { status: 'ACTIVE' };
  return undefined;
}

/** `matching` = servicios de ese objetivo (ya filtrados); `month` 1-12. */
export function planServicioMes(input: {
  matching: any[];
  year: number;
  month: number;
  clienteActivo?: boolean;
  cliente?: ClienteCopiaSla | null;
  modo?: 'automatico' | 'manual';
}): PlanServicioMes {
  const mesKey = `${input.year}-${String(input.month).padStart(2, '0')}`;
  const mes = nombreMesDeClave(mesKey);
  const decision = decidirCopiaSlaMes(input.matching, mesKey, {
    modo: input.modo ?? 'automatico',
    cliente: clienteDe(input),
  });
  if (decision.accion === 'existe') return { estado: 'tiene' };
  if (decision.accion === 'sin_origen') {
    return { estado: 'no_se_puede', mes, motivo: 'No hay servicio anterior para copiar: crealo en Servicios.' };
  }
  if (decision.accion === 'omitir') return { estado: 'no_se_puede', mes: decision.mesNombre, motivo: decision.aviso };
  const confirmacion = decision.requiereConfirmacion
    ? `${decision.aviso} ¿Crearlo copiando ${decision.mesOrigenNombre}?`
    : '';
  return {
    estado: 'crear',
    mes: decision.mesNombre,
    mesOrigen: decision.mesOrigenNombre,
    requiereConfirmacion: decision.requiereConfirmacion,
    confirmacion,
    run: (ctx) => persistirCopiaSlaMes(decision, ctx),
  };
}
