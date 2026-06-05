export declare function pickAllBlocks(block: string, tag: string): string[];
export declare function pickTag(block: string, tag: string): string;
export declare function pickBlock(block: string, tag: string): string;
export type ParsedAfipImpuesto = {
    id?: string;
    descripcion: string;
    estado?: string;
};
export type ParsedAfipActividad = {
    id?: string;
    descripcion: string;
    principal?: boolean;
};
export type ParsedAfipPersona = {
    tipoPersona?: string;
    apellido?: string;
    nombre?: string;
    razonSocial?: string;
    estadoClave?: string;
    mesCierre?: string;
    domicilio: {
        direccion?: string;
        localidad?: string;
        provincia?: string;
        codPostal?: string;
    };
    impuestos: ParsedAfipImpuesto[];
    actividades: ParsedAfipActividad[];
    monotributoCategoria?: string;
};
export declare function buildParsedAfipPersona(personaReturnXml: string): ParsedAfipPersona;
export declare function formatIvaStatusFromParsed(p: ParsedAfipPersona): string;
export declare function mainActividadFromParsed(p: ParsedAfipPersona): string;
