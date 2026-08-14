export type CategoriaAptitud = 'licencia' | 'certificacion' | 'habilidad';

export interface AptitudType {
    id?: string;
    empresaId?: string;
    codigo: string;
    nombre: string;
    categoria: CategoriaAptitud;
    icono: string;
    requiereVigencia: boolean;
    isSystem: boolean;
    status: 'ACTIVE' | 'INACTIVE';
    sortOrder: number;
}

export interface EmpleadoAptitud {
    codigo: string;
    vigencia?: string;   // YYYY-MM-DD, vacío/null si no vence
    notas?: string;
}

export const CATEGORIA_LABELS: Record<CategoriaAptitud, string> = {
    licencia:      'Licencias de conducir',
    certificacion: 'Certificaciones',
    habilidad:     'Habilidades',
};

export const APTITUD_SEEDS: Omit<AptitudType, 'id' | 'empresaId'>[] = [
    // Licencias
    { codigo: 'LICENCIA_AUTO',      nombre: 'Licencia auto (cat. B)',      categoria: 'licencia',      icono: '🚗', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 10 },
    { codigo: 'LICENCIA_MOTO',      nombre: 'Licencia moto (cat. A)',      categoria: 'licencia',      icono: '🏍️', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 11 },
    { codigo: 'LICENCIA_CAMION',    nombre: 'Licencia camión (C/D/E)',     categoria: 'licencia',      icono: '🚛', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 12 },
    { codigo: 'LICENCIA_MAQUINARIA',nombre: 'Maquinaria pesada',           categoria: 'licencia',      icono: '🚜', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 13 },
    // Certificaciones
    { codigo: 'BOMBERO',            nombre: 'Bombero voluntario',          categoria: 'certificacion', icono: '🔥', requiereVigencia: false, isSystem: true, status: 'ACTIVE', sortOrder: 20 },
    { codigo: 'PRIMEROS_AUXILIOS',  nombre: 'Primeros auxilios',           categoria: 'certificacion', icono: '🩹', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 21 },
    { codigo: 'RCP',                nombre: 'RCP certificado',             categoria: 'certificacion', icono: '❤️', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 22 },
    { codigo: 'SEGURIDAD_INCENDIO', nombre: 'Prevención de incendios',     categoria: 'certificacion', icono: '🧯', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 23 },
    { codigo: 'ALTURAS',            nombre: 'Trabajo en alturas',          categoria: 'certificacion', icono: '🏔️', requiereVigencia: true,  isSystem: true, status: 'ACTIVE', sortOrder: 24 },
    // Habilidades
    { codigo: 'INGLES',             nombre: 'Inglés',                      categoria: 'habilidad',     icono: '🌐', requiereVigencia: false, isSystem: true, status: 'ACTIVE', sortOrder: 30 },
    { codigo: 'PORTERIA_VIP',       nombre: 'Seguridad VIP / eventos',     categoria: 'habilidad',     icono: '⭐', requiereVigencia: false, isSystem: true, status: 'ACTIVE', sortOrder: 31 },
    { codigo: 'ARMAMENTO_ESPECIAL', nombre: 'Armamento especial',          categoria: 'habilidad',     icono: '🔫', requiereVigencia: false, isSystem: true, status: 'ACTIVE', sortOrder: 32 },
];
