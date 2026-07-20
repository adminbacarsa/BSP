export { leerSlaYDerivarCobertura, filtrarNeedsParaFecha, agruparNeedsPorBanda } from './s1-leer-sla';
export { calcularMasaCritica, calcularMinimoParaBanda, generarAlertasDeficit, hayDeficit } from './s2-masa-critica';
export { detectarEstadoServicio, detectarEstadoDesdeMemoria } from './s3-detectar-estado';
export { detectarBandasEspeciales, esBandaDe12h, proponer12hEquivalente } from './s4-bandas-especiales';
export { inferirCoberturaFeriados, feriadosConCobertura, fechasFeriadosConCobertura, esFeriadoConCobertura } from './s5-cobertura-feriados';
