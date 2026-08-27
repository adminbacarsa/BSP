/** Capa base Leaflet para Operaciones / map-view. CARTO requiere api_key desde 2024. */
export function getMapBasemapConfig(): { url: string; attribution: string } {
  const cartoKey = String(process.env.NEXT_PUBLIC_CARTO_API_KEY ?? '').trim();
  if (cartoKey) {
    return {
      url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(cartoKey)}`,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    };
  }
  return {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  };
}
