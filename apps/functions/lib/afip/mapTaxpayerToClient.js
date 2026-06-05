"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapAfipPersonaToClient = mapAfipPersonaToClient;
const parseAfipPersona_1 = require("./parseAfipPersona");
function unwrapPersonaReturn(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    if (typeof o.personaReturnXml === 'string' && o.personaReturnXml.trim()) {
        return o.personaReturnXml;
    }
    return null;
}
function personaFromLegacyObject(raw) {
    const dg = raw.datosGenerales || raw;
    const dom = dg.domicilioFiscal || dg.dependencia || {};
    const mono = raw.datosMonotributo || {};
    const rg = raw.datosRegimenGeneral || {};
    const impBlocks = [];
    const imp = rg.impuesto;
    if (Array.isArray(imp)) {
        for (const i of imp) {
            impBlocks.push(`<impuesto><idImpuesto>${i.idImpuesto || ''}</idImpuesto><descripcionImpuesto>${i.descripcionImpuesto || i.descripcion || ''}</descripcionImpuesto><estadoImpuesto>${i.estadoImpuesto || ''}</estadoImpuesto></impuesto>`);
        }
    }
    else if (imp && typeof imp === 'object') {
        impBlocks.push(`<impuesto><idImpuesto>${imp.idImpuesto || ''}</idImpuesto><descripcionImpuesto>${imp.descripcionImpuesto || imp.descripcion || ''}</descripcionImpuesto><estadoImpuesto>${imp.estadoImpuesto || ''}</estadoImpuesto></impuesto>`);
    }
    else if (typeof imp === 'string' && imp.trim()) {
        impBlocks.push(`<impuesto>${imp}</impuesto>`);
    }
    const actBlocks = [];
    const act = rg.actividad;
    if (Array.isArray(act)) {
        for (const a of act) {
            actBlocks.push(`<actividad><idActividad>${a.idActividad || ''}</idActividad><descripcionActividad>${a.descripcionActividad || a.descripcion || ''}</descripcionActividad></actividad>`);
        }
    }
    else if (act && typeof act === 'object') {
        actBlocks.push(`<actividad><idActividad>${act.idActividad || ''}</idActividad><descripcionActividad>${act.descripcionActividad || act.descripcion || ''}</descripcionActividad></actividad>`);
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
    return (0, parseAfipPersona_1.buildParsedAfipPersona)(fakeXml);
}
function toLookupResult(p, cuit) {
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
    const impuestosLabel = p.impuestos.length > 0
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
        ivaStatus: (0, parseAfipPersona_1.formatIvaStatusFromParsed)(p),
        estadoClave: p.estadoClave || undefined,
        tipoPersona: tipo || undefined,
        actividadPrincipal: (0, parseAfipPersona_1.mainActividadFromParsed)(p) || undefined,
        mesCierre: p.mesCierre || undefined,
        afipImpuestos: impuestosLabel,
    };
}
function mapAfipPersonaToClient(raw, cuit) {
    const xml = unwrapPersonaReturn(raw);
    if (xml) {
        return toLookupResult((0, parseAfipPersona_1.buildParsedAfipPersona)(xml), cuit);
    }
    const o = raw;
    const persona = o?.personaReturn || o;
    if (!persona || typeof persona !== 'object') {
        throw new Error('Contribuyente no encontrado en el padrón AFIP.');
    }
    return toLookupResult(personaFromLegacyObject(persona), cuit);
}
//# sourceMappingURL=mapTaxpayerToClient.js.map