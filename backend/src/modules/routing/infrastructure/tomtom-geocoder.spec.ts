import { TomTomGeocoder, buildGeocodeUrl, parseGeocode } from './tomtom-geocoder.js';

// Respuesta de ejemplo de TomTom Search API v2 (recortada).
const FOUND = {
  summary: { query: 'avenida alemania 1234 los angeles', numResults: 1 },
  results: [
    {
      type: 'Point Address',
      matchConfidence: { score: 0.94 },
      address: { freeformAddress: 'Avenida Alemania 1234, Los Ángeles' },
      position: { lat: -37.46512, lon: -72.35091 },
    },
  ],
};

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('TomTomGeocoder', () => {
  it('arma la consulta en Chile, cerca de Los Ángeles', () => {
    const url = new URL(buildGeocodeUrl('Av. Alemania 1234, Los Ángeles', 'CLAVE'));
    expect(url.pathname).toBe(
      '/search/2/geocode/Av.%20Alemania%201234%2C%20Los%20%C3%81ngeles.json',
    );
    expect(url.searchParams.get('countrySet')).toBe('CL');
    expect(url.searchParams.get('key')).toBe('CLAVE');
  });

  it('entrega la ubicación y si encontró el número de calle', async () => {
    const urls: string[] = [];
    const geocoder = new TomTomGeocoder('CLAVE', (url) => {
      urls.push(url);
      return reply(200, FOUND);
    });
    expect(await geocoder.geocode('Av. Alemania 1234, Los Ángeles')).toEqual({
      location: { lat: -37.46512, lng: -72.35091 },
      label: 'Avenida Alemania 1234, Los Ángeles',
      precise: true,
    });
    expect(urls).toHaveLength(1);
  });

  it('descarta resultados que no sirven para entregar', () => {
    const only = (result: object) => parseGeocode({ results: [result] });
    expect(only({ ...FOUND.results[0], type: 'Geography' })).toBeNull(); // una comuna entera
    expect(only({ ...FOUND.results[0], matchConfidence: { score: 0.3 } })).toBeNull();
    expect(only({ ...FOUND.results[0], type: 'Street' })).toMatchObject({ precise: false });
    expect(parseGeocode({ results: [] })).toBeNull();
  });

  it('informa clave rechazada, límite y falta de conexión', async () => {
    await expect(
      new TomTomGeocoder('CLAVE', () => reply(403, {})).geocode('Calle 1'),
    ).rejects.toMatchObject({ code: 'CLAVE_MAPA_INVALIDA' });
    await expect(
      new TomTomGeocoder('CLAVE', () => reply(429, {})).geocode('Calle 1'),
    ).rejects.toMatchObject({ code: 'LIMITE_MAPAS' });
    await expect(
      new TomTomGeocoder('CLAVE', () => Promise.reject(new Error('offline'))).geocode('Calle 1'),
    ).rejects.toMatchObject({ code: 'SIN_CONEXION_MAPAS' });
    await expect(
      new TomTomGeocoder('', () => reply(200, FOUND)).geocode('Calle 1'),
    ).rejects.toMatchObject({ code: 'CLAVE_MAPA_FALTANTE' });
  });
});
