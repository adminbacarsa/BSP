const GEO_HEADERS = { 'Accept-Language': 'es' };

const parseAddress = (raw: string) => {
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const street = parts[0] || '';
    const city = parts[1] ? tc(parts[1]) : 'Córdoba';
    const state = parts[2] ? tc(parts[2]) : city;
    const stateClean = state.toLowerCase() === city.toLowerCase() ? city : state;
    return { street, city, state: stateClean };
};

export async function geocodeAddress(raw: string): Promise<{ lat: string; lon: string; display_name: string } | null> {
    const { street, city, state } = parseAddress(raw);
    const nom = async (params: string) => {
        const r = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&${params}`,
            { headers: GEO_HEADERS },
        );
        const d = await r.json();
        return d?.length > 0 ? d[0] : null;
    };
    let res = await nom(`street=${encodeURIComponent(street)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&country=Argentina`);
    if (!res) res = await nom(`q=${encodeURIComponent(`${street}, ${city}, Argentina`)}`);
    if (!res) res = await nom(`q=${encodeURIComponent(raw.replace(/,/g, ', '))}`);
    if (!res) {
        const noNum = street.replace(/\s+\d+.*$/, '').trim();
        if (noNum && noNum !== street) res = await nom(`q=${encodeURIComponent(`${noNum}, ${city}, Argentina`)}`);
    }
    return res;
}
