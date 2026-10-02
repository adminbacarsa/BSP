/**
 * Avisos por empresa. Un destinatario es una persona o un rol.
 * El rol se resuelve contra los roles que ya existen (permiso de lectura del módulo).
 * Si el rol todavía no tiene nadie, la lista queda vacía y no rompe el envío.
 */
export const TIPOS_AVISO = ['ARCA_ALTA_PENDIENTE', 'ARCA_BAJA_PENDIENTE', 'ARCA_ERROR', 'MARCO_POR_VENCER', 'CRONOGRAMA_SIN_PUBLICAR', 'ESCALA_CCT_PROPUESTA'];

/** Roles de destino futuros. Hoy se cruzan con el módulo que ya usa COSP. */
export const ROL_DESTINO_MODULO = {
  OPERADOR: 'OPERATIONS',
  PLANIFICACION: 'PLANNING',
  RRHH: 'RRHH',
  SUPERVISION: 'SUPERVISION',
  EVENTUALES: 'EVENTUALES',
};

export function usuariosDelRol(rolDestino, usuarios, roles) {
  const modulo = ROL_DESTINO_MODULO[rolDestino];
  if (!modulo) return [];
  const ids = new Set(
    (roles || [])
      .filter((rol) => (rol.permissions?.[modulo] || []).includes('read'))
      .map((rol) => rol.id),
  );
  return (usuarios || []).filter((u) => {
    if (u.status === 'INACTIVE') return false;
    return ids.has(u.role) || ids.has(u.roleId);
  });
}

function canalesDe(dest) {
  if (dest.tipo === 'ROL') {
    return {
      push: dest.canales?.push !== false,
      mail: dest.canales?.mail !== false,
      whatsapp: dest.canales?.whatsapp === true,
    };
  }
  return {
    push: dest.push === true,
    mail: Boolean(dest.mail),
    whatsapp: Boolean(dest.whatsapp),
  };
}

/**
 * Push si hay token. Sin token, el mismo destinatario cae a mail y WhatsApp
 * cuando esos canales están cargados.
 */
export function resolverAvisos({ avisos, tipo, usuarios, roles, tokens }) {
  const pushes = [];
  const mails = [];
  const whatsapps = [];
  for (const dest of avisos?.[tipo] || []) {
    const canales = canalesDe(dest);
    const personas = dest.tipo === 'ROL'
      ? usuariosDelRol(dest.rolDestino, usuarios, roles).map((u) => ({
        uid: u.uid || u.id,
        mail: u.email || '',
        whatsapp: u.phone || u.whatsapp || '',
      }))
      : [{ uid: dest.uid || '', mail: dest.mail || '', whatsapp: dest.whatsapp || '' }];

    for (const persona of personas) {
      const propios = (tokens || []).filter((t) => t.uid && t.uid === persona.uid && t.token);
      if (canales.push && propios.length) {
        for (const t of propios) pushes.push({ uid: persona.uid, token: t.token });
        continue;
      }
      if (canales.mail && persona.mail) mails.push(persona.mail);
      if (canales.whatsapp && persona.whatsapp) whatsapps.push(persona.whatsapp);
    }
  }
  return {
    pushes,
    mails: [...new Set(mails)],
    whatsapps: [...new Set(whatsapps)],
  };
}
