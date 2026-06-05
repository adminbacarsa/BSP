"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickAllBlocks = pickAllBlocks;
exports.pickTag = pickTag;
exports.pickBlock = pickBlock;
exports.buildParsedAfipPersona = buildParsedAfipPersona;
exports.formatIvaStatusFromParsed = formatIvaStatusFromParsed;
exports.mainActividadFromParsed = mainActividadFromParsed;
function pickAllBlocks(block, tag) {
    if (!block)
        return [];
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(block)) !== null) {
        if (m[1]?.trim())
            out.push(m[1]);
    }
    return out;
}
function pickTag(block, tag) {
    return block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))?.[1]?.trim() || '';
}
function pickBlock(block, tag) {
    return block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '';
}
function parseImpuestoBlock(block) {
    const descripcion = pickTag(block, 'descripcionImpuesto') || pickTag(block, 'descripcion');
    if (!descripcion)
        return null;
    return {
        id: pickTag(block, 'idImpuesto') || undefined,
        descripcion,
        estado: pickTag(block, 'estadoImpuesto') || undefined,
    };
}
function parseActividadBlock(block, principal = false) {
    const descripcion = pickTag(block, 'descripcionActividad') || pickTag(block, 'descripcion');
    if (!descripcion)
        return null;
    return {
        id: pickTag(block, 'idActividad') || pickTag(block, 'nomenclador') || undefined,
        descripcion,
        principal,
    };
}
function buildParsedAfipPersona(personaReturnXml) {
    const dg = pickBlock(personaReturnXml, 'datosGenerales');
    const errConst = pickBlock(personaReturnXml, 'errorConstancia');
    const dom = pickBlock(dg, 'domicilioFiscal') || pickBlock(dg, 'dependencia');
    const mono = pickBlock(personaReturnXml, 'datosMonotributo');
    const rg = pickBlock(personaReturnXml, 'datosRegimenGeneral');
    const impuestos = [];
    for (const b of pickAllBlocks(rg, 'impuesto')) {
        const p = parseImpuestoBlock(b);
        if (p)
            impuestos.push(p);
    }
    for (const b of pickAllBlocks(mono, 'impuesto')) {
        const p = parseImpuestoBlock(b);
        if (p)
            impuestos.push(p);
    }
    const actividades = [];
    const actMono = pickBlock(mono, 'actividadMonotributista');
    const am = parseActividadBlock(actMono, true);
    if (am)
        actividades.push(am);
    for (const b of pickAllBlocks(rg, 'actividad')) {
        const a = parseActividadBlock(b, actividades.length === 0);
        if (a)
            actividades.push(a);
    }
    for (const b of pickAllBlocks(mono, 'actividad')) {
        const a = parseActividadBlock(b, false);
        if (a)
            actividades.push(a);
    }
    const catMono = pickTag(pickBlock(mono, 'categoriaMonotributo'), 'descripcionCategoria') ||
        pickTag(mono, 'descripcionCategoria');
    return {
        tipoPersona: pickTag(dg, 'tipoPersona') || (pickTag(errConst, 'apellido') ? 'FISICA' : ''),
        apellido: pickTag(dg, 'apellido') || pickTag(errConst, 'apellido'),
        nombre: pickTag(dg, 'nombre') || pickTag(errConst, 'nombre'),
        razonSocial: pickTag(dg, 'razonSocial') || pickTag(errConst, 'razonSocial'),
        estadoClave: pickTag(dg, 'estadoClave'),
        mesCierre: pickTag(dg, 'mesCierre') || undefined,
        domicilio: {
            direccion: pickTag(dom, 'direccion'),
            localidad: pickTag(dom, 'localidad'),
            provincia: pickTag(dom, 'descripcionProvincia'),
            codPostal: pickTag(dom, 'codPostal'),
        },
        impuestos,
        actividades,
        monotributoCategoria: catMono || undefined,
    };
}
function formatIvaStatusFromParsed(p) {
    if (p.monotributoCategoria) {
        return `Monotributo — ${p.monotributoCategoria}`;
    }
    const iva = p.impuestos.find((i) => i.id === '30' || /iva/i.test(i.descripcion));
    if (iva) {
        return iva.estado ? `${iva.descripcion} (${iva.estado})` : iva.descripcion;
    }
    const exento = p.impuestos.find((i) => /exento|exclusi[oó]n/i.test(i.descripcion));
    if (exento)
        return exento.descripcion;
    if (p.impuestos.length === 1) {
        const i = p.impuestos[0];
        return i.estado ? `${i.descripcion} (${i.estado})` : i.descripcion;
    }
    if (p.impuestos.length > 1) {
        return p.impuestos
            .slice(0, 3)
            .map((i) => (i.estado ? `${i.descripcion} (${i.estado})` : i.descripcion))
            .join(' · ');
    }
    return '';
}
function mainActividadFromParsed(p) {
    const main = p.actividades.find((a) => a.principal) || p.actividades[0];
    if (!main)
        return '';
    return main.id ? `${main.descripcion} (${main.id})` : main.descripcion;
}
//# sourceMappingURL=parseAfipPersona.js.map