import type { WsaaCredentials } from './wsaaDirect';

const PADRON_NS = 'http://a5.soap.ws.server.puc.sr/';

function padronUrl(production: boolean): string {
  return production
    ? 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5'
    : 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildGetPersonaV2Envelope(
  creds: WsaaCredentials,
  cuitRepresentada: number,
  idPersona: number,
): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    `                  xmlns:a5="${PADRON_NS}">`,
    '  <soapenv:Body>',
    '    <a5:getPersona_v2>',
    `      <token>${escapeXml(creds.token)}</token>`,
    `      <sign>${escapeXml(creds.sign)}</sign>`,
    `      <cuitRepresentada>${cuitRepresentada}</cuitRepresentada>`,
    `      <idPersona>${idPersona}</idPersona>`,
    '    </a5:getPersona_v2>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n');
}

function decodeXmlText(raw: string): string {
  return raw
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

function parseSoapFault(body: string): string | null {
  const fault = body.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1];
  return fault ? decodeXmlText(fault) : null;
}

function pickTag(block: string, tag: string): string {
  return block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))?.[1]?.trim() || '';
}

function pickBlock(block: string, tag: string): string {
  return block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '';
}

function pickAllBlocks(block: string, tag: string): string[] {
  if (!block) return [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[1]?.trim()) out.push(m[1]);
  }
  return out;
}

function parseImpuestoBlock(block: string): Record<string, string> {
  return {
    idImpuesto: pickTag(block, 'idImpuesto'),
    descripcionImpuesto: pickTag(block, 'descripcionImpuesto') || pickTag(block, 'descripcion'),
    estadoImpuesto: pickTag(block, 'estadoImpuesto'),
  };
}

function parseActividadBlock(block: string): Record<string, string> {
  return {
    idActividad: pickTag(block, 'idActividad') || pickTag(block, 'nomenclador'),
    descripcionActividad: pickTag(block, 'descripcionActividad') || pickTag(block, 'descripcion'),
  };
}

function pickErrorMessages(block: string): string {
  const msgs = [...block.matchAll(/<error[^>]*>([^<]*)<\/error>/gi)]
    .map((m) => decodeXmlText(m[1]))
    .filter(Boolean);
  return msgs.join(' ').trim();
}

function isPersonaNotFoundMessage(msg: string): boolean {
  return /no existe persona|persona con ese id|no se encuentra registrad|no encontrado en el padr[oó]n/i.test(msg);
}

function personaNotFoundError(idPersona: number, production: boolean): Error {
  const cuit = String(idPersona);
  if (!production) {
    return new Error(
      `CUIT ${cuit} no está en el padrón de homologación (pruebas). Si en ARCA web sí aparece, ` +
        'es normal: la web usa producción y COSP está en homologación. ' +
        'Subí certificado de producción en Configuración → Empresas y marcá «Ambiente producción AFIP». ' +
        'CUIT de prueba en homo: 33693450239.',
    );
  }
  return new Error(
    `CUIT ${cuit} no encontrado en el padrón AFIP (producción). Verificá los 11 dígitos.`,
  );
}

function extractPersonaPayload(soapBody: string, idPersona: number, production: boolean): unknown {
  const fault = parseSoapFault(soapBody);
  if (fault) {
    if (isPersonaNotFoundMessage(fault)) {
      throw personaNotFoundError(idPersona, production);
    }
    throw new Error(`Padrón AFIP: ${fault}`);
  }

  const personaReturn = soapBody.match(/<personaReturn[^>]*>([\s\S]*?)<\/personaReturn>/i)?.[1];
  if (!personaReturn) {
    throw new Error('Respuesta de padrón AFIP sin datos de persona.');
  }

  const dg = pickBlock(personaReturn, 'datosGenerales');
  const errConst = pickBlock(personaReturn, 'errorConstancia');
  const dom = pickBlock(dg, 'domicilioFiscal') || pickBlock(dg, 'dependencia');
  const mono = pickBlock(personaReturn, 'datosMonotributo');
  const rg = pickBlock(personaReturn, 'datosRegimenGeneral');

  const razonSocial = pickTag(dg, 'razonSocial') || pickTag(errConst, 'razonSocial');
  const apellido = pickTag(dg, 'apellido') || pickTag(errConst, 'apellido');
  const nombre = pickTag(dg, 'nombre') || pickTag(errConst, 'nombre');
  const tipoPersona = pickTag(dg, 'tipoPersona') || (apellido || nombre ? 'FISICA' : '');
  const hasIdentity = !!(razonSocial || apellido || nombre);

  const errMsgRaw = errConst ? pickErrorMessages(errConst) : '';
  if (errMsgRaw && isPersonaNotFoundMessage(errMsgRaw)) {
    throw personaNotFoundError(idPersona, production);
  }
  const isDfePending = /domicilio fiscal electr[oó]nico|RG 4280/i.test(errMsgRaw);

  if (errMsgRaw && !hasIdentity) {
    if (isDfePending) {
      throw new Error(
        'AFIP no entrega constancia para este CUIT: tiene pendiente el domicilio fiscal electrónico (RG 4280/18). ' +
          'El contribuyente debe regularizarlo en AFIP. En homologación este aviso es frecuente aunque el CUIT exista en producción.',
      );
    }
    throw new Error(`Padrón AFIP: ${errMsgRaw}`);
  }

  const impuestosRg = pickAllBlocks(rg, 'impuesto').map(parseImpuestoBlock).filter((i) => i.descripcionImpuesto);
  const impuestosMono = pickAllBlocks(mono, 'impuesto').map(parseImpuestoBlock).filter((i) => i.descripcionImpuesto);
  const actividadesRg = pickAllBlocks(rg, 'actividad').map(parseActividadBlock).filter((a) => a.descripcionActividad);
  const actMonoBlock = pickBlock(mono, 'actividadMonotributista');
  const actMono = actMonoBlock ? parseActividadBlock(actMonoBlock) : null;
  const catMonoBlock = pickBlock(mono, 'categoriaMonotributo');

  const data = {
    personaReturnXml: personaReturn,
    personaReturn: {
      datosGenerales: {
        tipoPersona,
        apellido,
        nombre,
        razonSocial,
        estadoClave: pickTag(dg, 'estadoClave'),
        mesCierre: pickTag(dg, 'mesCierre') || undefined,
        domicilioFiscal: {
          direccion: pickTag(dom, 'direccion'),
          localidad: pickTag(dom, 'localidad'),
          descripcionProvincia: pickTag(dom, 'descripcionProvincia'),
          codPostal: pickTag(dom, 'codPostal'),
        },
      },
      datosMonotributo: mono
        ? {
            categoriaMonotributo: pickTag(catMonoBlock, 'descripcionCategoria') || pickTag(mono, 'descripcionCategoria')
              ? {
                  descripcionCategoria:
                    pickTag(catMonoBlock, 'descripcionCategoria') || pickTag(mono, 'descripcionCategoria'),
                }
              : undefined,
            actividadMonotributista: actMono?.descripcionActividad ? actMono : undefined,
          }
        : undefined,
      datosRegimenGeneral:
        impuestosRg.length || actividadesRg.length
          ? {
              impuesto: impuestosRg.length === 1 ? impuestosRg[0] : impuestosRg,
              actividad: actividadesRg.length === 1 ? actividadesRg[0] : actividadesRg.length ? actividadesRg : undefined,
            }
          : impuestosMono.length
            ? { impuesto: impuestosMono.length === 1 ? impuestosMono[0] : impuestosMono }
            : undefined,
    },
  };

  if (errMsgRaw && hasIdentity) {
    const warning = isDfePending
      ? 'AFIP: domicilio fiscal electrónico pendiente (RG 4280/18). Se cargó razón social/nombre; domicilio e IVA pueden estar incompletos.'
      : errMsgRaw;
    return { ...data, afipWarning: warning };
  }
  return data;
}

function padronHttpError(status: number, body: string): string {
  const fault = parseSoapFault(body);
  if (fault) return `Padrón AFIP: ${fault}`;
  const snippet = decodeXmlText(body).replace(/\s+/g, ' ').slice(0, 240);
  return snippet
    ? `Padrón AFIP respondió HTTP ${status}: ${snippet}`
    : `Padrón AFIP respondió HTTP ${status}. Revisá certificado homo/prod y autorización ws_sr_constancia_inscripcion.`;
}

export async function getTaxpayerFromPadron(
  creds: WsaaCredentials,
  cuitRepresentada: number,
  idPersona: number,
  production: boolean,
): Promise<unknown> {
  const soap = buildGetPersonaV2Envelope(creds, cuitRepresentada, idPersona);
  const res = await fetch(padronUrl(production), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""',
    },
    body: soap,
    signal: AbortSignal.timeout(90_000),
  });
  const body = await res.text();
  if (!res.ok) {
    if (body.includes('<personaReturn')) {
      try {
        return extractPersonaPayload(body, idPersona, production);
      } catch {
        /* seguir con error HTTP */
      }
    }
    const fault = parseSoapFault(body);
    if (fault && isPersonaNotFoundMessage(fault)) {
      throw personaNotFoundError(idPersona, production);
    }
    throw new Error(padronHttpError(res.status, body));
  }
  return extractPersonaPayload(body, idPersona, production);
}
