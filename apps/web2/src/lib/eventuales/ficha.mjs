import { RNOS_SUVICO } from './arcaTxt.mjs';
import { normalizeCuil } from './cuil.mjs';
import { GRUPO_EVENTUALES_EMPRESA_IDS, GRUPO_EVENTUALES_ID } from './grupo.mjs';
import { sumarDias } from './jornadas.mjs';

export const ACCIONES_FICHA = ['crear', 'editar', 'baja', 'reactivar'];

export function puedeGestionar(caller, accion) {
  if (caller?.isSuperAdmin) return true;
  return (caller?.permisos || []).includes(accion);
}

function texto(value) {
  return String(value ?? '').trim();
}

export function rnosDigitos(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(6, '0').slice(-6);
}

export const RNOS_DEFAULT_FICHA = RNOS_SUVICO;

/** Personal primero. Si no hay, el default SUVICO. Pendiente solo si faltan los dos. El otro legajo se sugiere, no se envía solo. */
export function sugerirObraSocial(fichaRnos, legajos, obraSocialDefault = RNOS_SUVICO) {
  const propio = rnosDigitos(fichaRnos);
  if (propio) return { rnos: propio, sugerido: false, pendiente: false, origen: 'PERSONA' };
  const otro = (legajos || []).find((l) => rnosDigitos(l?.obraSocialRnos));
  const def = rnosDigitos(obraSocialDefault);
  if (!def && !otro) return { rnos: '', sugerido: false, pendiente: true, codigo: 'RNOS_PENDIENTE' };
  return {
    rnos: def,
    origen: def ? 'DEFAULT' : '',
    sugerido: !!otro,
    sugerencia: otro ? rnosDigitos(otro.obraSocialRnos) : '',
    empresaId: otro?.empresaId || '',
    pendiente: !def,
    ...(def ? {} : { codigo: 'RNOS_PENDIENTE' }),
  };
}

export function validarFicha(input, ctx = {}) {
  const nombre = texto(input?.nombre);
  if (!nombre) return { ok: false, codigo: 'SIN_NOMBRE' };
  const cuil = normalizeCuil(input?.cuil);
  if (!cuil) return { ok: false, codigo: 'CUIL_INVALIDO' };
  const anterior = texto(input?.cuilAnterior);
  const bolsa = new Set(ctx.bolsaCuils || []);
  if (bolsa.has(cuil) && cuil !== anterior) return { ok: false, codigo: 'DUPLICADO_BOLSA' };
  if ((ctx.plantaCuils || []).includes(cuil)) return { ok: false, codigo: 'DUPLICADO_PLANTA' };
  const mail = texto(input?.mail).toLowerCase();
  if (mail && !mail.includes('@')) return { ok: false, codigo: 'MAIL_INVALIDO' };
  const empresas = [...new Set((input?.empresasHabilitadas || []).map(String))]
    .filter((id) => GRUPO_EVENTUALES_EMPRESA_IDS.includes(id));
  return {
    ok: true,
    doc: {
      grupoId: GRUPO_EVENTUALES_ID,
      cuil,
      nombre,
      dni: texto(input?.dni),
      fechaNacimiento: texto(input?.fechaNacimiento),
      domicilio: texto(input?.domicilio),
      domicilioGeo: input?.domicilioGeo || null,
      telefono: texto(input?.telefono),
      mail,
      obraSocialRnos: rnosDigitos(input?.obraSocialRnos),
      empresasHabilitadas: empresas,
      habilitacion9236: {
        numero: texto(input?.habilitacionNumero),
        vencimiento: texto(input?.habilitacionVencimiento),
      },
      credencialVencimiento: texto(input?.credencialVencimiento),
      aptoPsicofisico: {
        estado: texto(input?.aptoEstado),
        vencimiento: texto(input?.aptoVencimiento),
      },
      observaciones: texto(input?.observaciones),
      disponibilidad: 'DISPONIBLE',
    },
  };
}

export function planBaja(motivo, fecha) {
  if (!texto(motivo)) return { ok: false, codigo: 'SIN_MOTIVO' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(fecha))) return { ok: false, codigo: 'SIN_FECHA' };
  return {
    ok: true,
    patch: {
      disponibilidad: 'NO_DISPONIBLE',
      bajaBolsa: { motivo: texto(motivo), fecha: texto(fecha) },
    },
  };
}

export function planReactivar() {
  return { disponibilidad: 'DISPONIBLE', bajaBolsa: null };
}

export function vencePronto(fecha, hoy, dias = 30) {
  const iso = texto(fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !/^\d{4}-\d{2}-\d{2}$/.test(hoy)) return false;
  return iso >= hoy && iso <= sumarDias(hoy, dias);
}

/** Misma idea que el portal del legajo: Auth + claim, link de activación de 48 h. */
export function planAccesoEventual(bolsa) {
  if (!bolsa) return { ok: false, codigo: 'NO_EXISTE' };
  if (bolsa.disponibilidad === 'NO_DISPONIBLE') return { ok: false, codigo: 'NO_DISPONIBLE' };
  const mail = texto(bolsa.mail).toLowerCase();
  if (!mail.includes('@')) return { ok: false, codigo: 'SIN_MAIL' };
  return {
    ok: true,
    mail,
    claims: { role: 'EVENTUAL', type: 'eventual', bolsaCuil: bolsa.cuil },
  };
}

export function empresasDeTurnos(bolsa, contratos) {
  const ids = new Set(bolsa?.empresasHabilitadas || []);
  for (const leg of bolsa?.legajos || []) if (leg.empresaId) ids.add(leg.empresaId);
  for (const c of contratos || []) if (c.empresaId) ids.add(c.empresaId);
  return [...ids];
}
