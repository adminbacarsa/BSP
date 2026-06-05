"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginWsaaDirect = loginWsaaDirect;
const arca_cert_1 = require("arca-cert");
const empresaAfipStore_1 = require("./empresaAfipStore");
const taCache = new Map();
function artIso(d) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${g.year}-${g.month}-${g.day}T${g.hour}:${g.minute}:${g.second}-03:00`;
}
function createTraXml(service) {
    const now = Date.now();
    const uid = Math.floor(Math.random() * 2_000_000_000);
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<loginTicketRequest version="1.0">',
        '  <header>',
        `    <uniqueId>${uid}</uniqueId>`,
        `    <generationTime>${artIso(new Date(now - 5 * 60 * 1000))}</generationTime>`,
        `    <expirationTime>${artIso(new Date(now + 5 * 60 * 1000))}</expirationTime>`,
        '  </header>',
        `  <service>${service}</service>`,
        '</loginTicketRequest>',
    ].join('\n');
}
function buildLoginCmsEnvelope(cmsBase64) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
        '                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
        '  <soapenv:Body>',
        '    <wsaa:loginCms>',
        `      <wsaa:in0>${cmsBase64}</wsaa:in0>`,
        '    </wsaa:loginCms>',
        '  </soapenv:Body>',
        '</soapenv:Envelope>',
    ].join('\n');
}
function parseSoapFault(body) {
    const faultstring = body.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1];
    if (!faultstring)
        return null;
    const faultcode = body.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/i)?.[1] || '';
    const msg = faultstring
        .replace(/&#xF3;/g, 'ó')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
    const code = faultcode.replace(/^[^:]+:/, '').trim();
    return { code, message: msg };
}
function parseLoginCmsResponse(soapResponse) {
    const returnMatch = soapResponse.match(/<loginCmsReturn[^>]*>([\s\S]*?)<\/loginCmsReturn>/);
    if (!returnMatch) {
        throw new Error('Respuesta WSAA inválida (sin loginCmsReturn).');
    }
    const xmlContent = returnMatch[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
    const token = xmlContent.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim();
    const sign = xmlContent.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim();
    if (!token || !sign)
        throw new Error('WSAA no devolvió token/sign.');
    const expRaw = xmlContent.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]?.trim();
    const expirationTime = expRaw ? new Date(expRaw) : new Date(Date.now() + 12 * 60 * 60 * 1000);
    return { token, sign, expirationTime };
}
function wsaaUrl(production) {
    return production
        ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
        : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';
}
async function loginWsaaDirect(certPem, privateKeyPem, service, production, empresaId) {
    const empId = String(empresaId ?? '').trim().toLowerCase();
    const cacheKey = `${production ? 'prod' : 'homo'}:${service}:${empId || 'global'}`;
    const cached = taCache.get(cacheKey);
    if (cached && cached.expirationTime.getTime() > Date.now() + 60_000) {
        return cached;
    }
    if (empId) {
        const persisted = await (0, empresaAfipStore_1.loadEmpresaAfipTaCache)(empId);
        if (persisted) {
            taCache.set(cacheKey, persisted);
            return persisted;
        }
    }
    const tra = createTraXml(service);
    const cms = (0, arca_cert_1.signTRA)(tra, certPem, privateKeyPem);
    const soap = buildLoginCmsEnvelope(cms);
    const res = await fetch(wsaaUrl(production), {
        method: 'POST',
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: '""',
        },
        body: soap,
        signal: AbortSignal.timeout(90_000),
    });
    const body = await res.text();
    const fault = parseSoapFault(body);
    const alreadyHasTa = fault?.code === 'coe.alreadyAuthenticated' ||
        /ya posee un ta valido|alreadyauthenticated/i.test(fault?.message || '');
    if (alreadyHasTa && body.includes('<token>')) {
        try {
            const creds = parseLoginCmsResponse(body);
            taCache.set(cacheKey, creds);
            if (empId)
                await (0, empresaAfipStore_1.saveEmpresaAfipTaCache)(empId, creds);
            return creds;
        }
        catch {
        }
    }
    if (alreadyHasTa && cached) {
        return cached;
    }
    if (alreadyHasTa && empId) {
        const persisted = await (0, empresaAfipStore_1.loadEmpresaAfipTaCache)(empId);
        if (persisted) {
            taCache.set(cacheKey, persisted);
            return persisted;
        }
    }
    if (alreadyHasTa) {
        for (const [, v] of taCache) {
            if (v.expirationTime.getTime() > Date.now() + 60_000)
                return v;
        }
    }
    if (fault?.code === 'cms.cert.untrusted') {
        throw new Error('Certificado no válido en AFIP producción (homologación ≠ producción). ' +
            'Generá el cert en el portal productivo de ARCA o usá AFIP_PRODUCTION=false (npm run afip:secrets:homo).');
    }
    if (fault?.code === 'coe.notAuthorized') {
        throw new Error(production
            ? 'AFIP producción: el alias del certificado no está autorizado para ws_sr_constancia_inscripcion. ' +
                'En ARCA → Administrador de Relaciones de Clave Fiscal, asociá el certificado (mismo alias del CSR: COSP o barrera) ' +
                'al servicio ws_sr_constancia_inscripcion para el CUIT representado.'
            : 'AFIP homologación: el certificado no está autorizado para ws_sr_constancia_inscripcion. ' +
                'En WSASS (ambiente de prueba) agregá esa autorización al alias del certificado.');
    }
    if (alreadyHasTa) {
        throw new Error('AFIP ya tiene un ticket activo para este certificado. Esperá unos minutos y volvé a intentar.');
    }
    if (fault) {
        throw new Error(`WSAA: ${fault.message} [${fault.code}]`);
    }
    if (!res.ok) {
        throw new Error(`WSAA respondió HTTP ${res.status}.`);
    }
    const creds = parseLoginCmsResponse(body);
    taCache.set(cacheKey, creds);
    if (empId)
        await (0, empresaAfipStore_1.saveEmpresaAfipTaCache)(empId, creds);
    return creds;
}
//# sourceMappingURL=wsaaDirect.js.map