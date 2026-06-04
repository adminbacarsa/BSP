import type { NormalizedCuit } from './normalizeCuit';

export type AfipClientLookupResult = {
  taxId: string;
  legalName: string;
  name: string;
  address: string;
  city: string;
  state: string;
  ivaStatus: string;
  estadoClave?: string;
  tipoPersona?: string;
};

function unwrapPersona(raw: unknown): Record<string, any> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  if (o.datosGenerales) return o;
  if (o.personaReturn?.datosGenerales) return o.personaReturn;
  if (o.persona) {
    const p = Array.isArray(o.persona) ? o.persona[0] : o.persona;
    return p && typeof p === 'object' ? p : null;
  }
  return o;
}

function extractIvaStatus(persona: Record<string, any>): string {
  const mono = persona.datosMonotributo;
  if (mono && (mono.categoriaMonotributo || mono.actividadMonotributista)) {
    const cat = mono.categoriaMonotributo?.descripcionCategoria || mono.categoriaMonotributo;
    return cat ? `Monotributo${cat ? ` — ${cat}` : ''}` : 'Monotributo';
  }
  const rg = persona.datosRegimenGeneral;
  const impuestos = rg?.impuesto;
  const list = Array.isArray(impuestos) ? impuestos : impuestos ? [impuestos] : [];
  const iva = list.find((i: any) => {
    const id = String(i?.idImpuesto ?? '');
    const desc = String(i?.descripcionImpuesto ?? i?.descripcion ?? '');
    return id === '30' || /iva/i.test(desc);
  });
  if (iva) {
    const estado = String(iva.estadoImpuesto || '').trim();
    const desc = String(iva.descripcionImpuesto || iva.descripcion || 'IVA').trim();
    return estado ? `${desc} (${estado})` : desc;
  }
  return '';
}

export function mapAfipPersonaToClient(raw: unknown, cuit: NormalizedCuit): AfipClientLookupResult {
  const persona = unwrapPersona(raw);
  if (!persona) {
    throw new Error('Contribuyente no encontrado en el padrón AFIP.');
  }
  const dg = persona.datosGenerales || persona;
  const dom = dg.domicilioFiscal || dg.dependencia || {};
  const tipo = String(dg.tipoPersona || '').toUpperCase();
  const legalName = tipo === 'FISICA'
    ? `${String(dg.apellido || '').trim()} ${String(dg.nombre || '').trim()}`.trim()
    : String(dg.razonSocial || '').trim();
  if (!legalName) {
    throw new Error('AFIP no devolvió razón social para este CUIT.');
  }
  const address = String(dom.direccion || '').trim();
  const city = String(dom.localidad || '').trim();
  const state = String(dom.descripcionProvincia || '').trim();
  const cp = String(dom.codPostal || '').trim();
  const fullAddress = [address, cp].filter(Boolean).join(address && cp ? ' — CP ' : '');

  return {
    taxId: cuit.formatted,
    legalName,
    name: legalName,
    address: fullAddress || address,
    city,
    state,
    ivaStatus: extractIvaStatus(persona),
    estadoClave: String(dg.estadoClave || '').trim() || undefined,
    tipoPersona: tipo || undefined,
  };
}
