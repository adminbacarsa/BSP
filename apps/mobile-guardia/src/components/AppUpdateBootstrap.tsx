/**
 * Deshabilitado temporalmente: el chequeo OTA al boot + updates nativos
 * dejaba la app en gris / crash al 2º arranque en algunos Android.
 * La descarga manual sigue en Más → Descargar actualización.
 */
export function AppUpdateBootstrap() {
  return null;
}
