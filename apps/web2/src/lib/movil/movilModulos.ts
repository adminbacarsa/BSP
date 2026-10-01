/** Punto de entrada del shell: importar de acá garantiza que todos los módulos estén registrados. */
import './modulosPlataforma';
import './modulosRrhh';

export * from './modulos';
export { esAlertaDeOperacion, esAlertaDePlanificacion } from './modulosPlataforma';
export { esAlertaDeRrhh, esAlertaDeEventuales } from './modulosRrhh';
