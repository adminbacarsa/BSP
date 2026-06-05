import type { NormalizedCuit } from './normalizeCuit';
import {
  buildParsedAfipPersona,
  formatIvaStatusFromParsed,
  mainActividadFromParsed,
  type ParsedAfipPersona,
} from './parseAfipPersona';

export type AfipClientLookupResult = {
  taxId: string;
  legalName: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode?: string;
  ivaStatus: string;
  estadoClave?: string;
  tipoPersona?: string;
  actividadPrincipal?: string;
  mesCierre?: string;
  afipImpuestos?: string;
  afipWarning?: string;
};

function unwrapPersonaReturn(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.personaReturnXml === 'string' && o.personaReturnXml.trim()) {
    return o.personaReturnXml;
  }
  return null;
}

function personaFromLegacyObject(raw: Record<string, any>): ParsedAfipPersona {
  const dg = raw.datosGenerales || raw;
  const dom = dg.domicilioFiscal || dg.dependencia || {};
  const mono = raw.datosMonotributo || {};
  const rg = raw.datosRegimenGeneral || {};
  const impBlocks: string[] = [];
  const imp = rg.impuesto;
  if (Array.isArray(imp)) {
    for (const i of imp) {
      impBlocks.push(
        `<impuesto><idImpuesto>${i.idImpuesto || ''}</idImpuesto><descripcionImpuesto>${i.descripcionImpuesto || i.descripcion || ''}</descripcionImpuesto><estadoImpuesto>${i.estadoImpuesto || ''}</estadoImpuesto></impuesto>`,
      );
    }
  } else if (imp && typeof imp === 'object') {
    impBlocks.push(
      `<impuesto><idImpuesto>${imp.idImpuesto || ''}</idImpuesto><descripcionImpuesto>${imp.descripcionImpuesto || imp.descripcion || ''}</descripcionImpuesto><estadoImpuesto>${imp.estadoImpuesto || ''}</estadoImpuesto></impuesto>`,
    );
  } else if (typeof imp === 'string' && imp.trim()) {
    impBlocks.push(`<impuesto>${imp}</impuesto>`);
  }
  const actBlocks: string[] = [];
  const act = rg.actividad;
  if (Array.isArray(act)) {
    for (const a of act) {
      actBlocks.push(
        `<actividad><idActividad>${a.idActividad || ''}</idActividad><descripcionActividad>${a.descripcionActividad || a.descripcion || ''}</descripcionActividad></actividad>`,
      );
    }
  } else if (act && typeof act === 'object') {
    actBlocks.push(
      `<actividad><idActividad>${act.idActividad || ''}</idActividad><descripcionActividad>${act.descripcionActividad || act.descripcion || ''}</descripcionActividad></actividad>`,
    );
  }
  const catMono = mono.categoriaMonotributo?.descripcionCategoria || mono.categoriaMonotributo || '';
  const actMono = mono.actividadMonotributista;
  const fakeXml = [
    '<personaReturn>',
    '<datosGenerales>',
    `<tipoPersona>${dg.tipoPersona || ''}</tipoPersona>`,
    `<apellido>${dg.apellido || ''}</apellido>`,
    `<nombre>${dg.nombre || ''}</nombre>`,
    `<razonSocial>${dg.razonSocial || ''}</razonSocial>`,
    `<estadoClave>${dg.estadoClave || ''}</estadoClave>`,
    `<mesCierre>${dg.mesCierre || ''}</mesCierre>`,
    '<domicilioFiscal>',
    `<direccion>${dom.direccion || ''}</direccion>`,
    `<localidad>${dom.localidad || ''}</localidad>`,
    `<descripcionProvincia>${dom.descripcionProvincia || ''}</descripcionProvincia>`,
    `<codPostal>${dom.codPostal || ''}</codPostal>`,
    '</domicilioFiscal>',
    '</datosGenerales>',
    mono && (catMono || actMono)
      ? `<datosMonotributo>${catMono ? `<categoriaMonotributo><descripcionCategoria>${catMono}</descripcionCategoria></categoriaMonotributo>` : ''}${actMono ? `<actividadMonotributista><descripcionActividad>${actMono.descripcionActividad || actMono.descripcion || ''}</descripcionActividad><idActividad>${actMono.idActividad || ''}</idActividad></actividadMonotributista>` : ''}</datosMonotributo>`
      : '',
    impBlocks.length || actBlocks.length
      ? `<datosRegimenGeneral>${impBlocks.join('')}${actBlocks.join('')}</datosRegimenGeneral>`
      : '',
    '</personaReturn>',
  ].join('');
  return buildParsedAfipPersona(fakeXml);
}

function toLookupResult(p: ParsedAfipPersona, cuit: NormalizedCuit): AfipClientLookupResult {
  const tipo = String(p.tipoPersona || '').toUpperCase();
  const legalName = tipo === 'FISICA'
    ? `${String(p.apellido || '').trim()} ${String(p.nombre || '').trim()}`.trim()
    : String(p.razonSocial || '').trim();
  if (!legalName) {
    throw new Error('AFIP no devolvió razón social para este CUIT.');
  }
  const address = String(p.domicilio.direccion || '').trim();
  const cp = String(p.domicilio.codPostal || '').trim();
  const fullAddress = [address, cp].filter(Boolean).join(address && cp ? ' — CP ' : '');

  const impuestosLabel =
    p.impuestos.length > 0
      ? p.impuestos.map((i) => (i.estado ? `${i.descripcion} (${i.estado})` : i.descripcion)).join(' · ')
      : undefined;

  return {
    taxId: cuit.formatted,
    legalName,
    name: legalName,
    address: fullAddress || address,
    city: String(p.domicilio.localidad || '').trim(),
    state: String(p.domicilio.provincia || '').trim(),
    postalCode: cp || undefined,
    ivaStatus: formatIvaStatusFromParsed(p),
    estadoClave: p.estadoClave || undefined,
    tipoPersona: tipo || undefined,
    actividadPrincipal: mainActividadFromParsed(p) || undefined,
    mesCierre: p.mesCierre || undefined,
    afipImpuestos: impuestosLabel,
  };
}

export function mapAfipPersonaToClient(raw: unknown, cuit: NormalizedCuit): AfipClientLookupResult {
  const xml = unwrapPersonaReturn(raw);
  if (xml) {
    return toLookupResult(buildParsedAfipPersona(xml), cuit);
  }
  const o = raw as Record<string, any>;
  const persona = o?.personaReturn || o;
  if (!persona || typeof persona !== 'object') {
    throw new Error('Contribuyente no encontrado en el padrón AFIP.');
  }
  return toLookupResult(personaFromLegacyObject(persona), cuit);
}
