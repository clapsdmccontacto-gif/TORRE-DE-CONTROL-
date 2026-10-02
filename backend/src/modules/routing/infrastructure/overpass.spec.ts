import { buildRoadsideQuery, OverpassRoadsideLookup, parseRoadside } from './overpass.js';

const path = Array.from({ length: 300 }, (_, i) => ({ lat: -37.47 + i * 0.0001, lng: -72.35 }));

it('buildRoadsideQuery busca semáforos y casetas de peaje a lo largo del trazado', () => {
  const query = buildRoadsideQuery(path);
  expect(query).toContain('["highway"="traffic_signals"]');
  expect(query).toContain('["barrier"="toll_booth"]');
  expect(query).toContain('around:25,-37.47000,-72.35000,');
  // 80 puntos como máximo para no exceder el tamaño de la consulta.
  const coordinates = query.match(/around:25,([^)]*)\)/)![1].split(',');
  expect(coordinates).toHaveLength(160);
});

describe('parseRoadside', () => {
  it('cuenta un semáforo por esquina y una plaza de peaje por grupo de casetas', () => {
    const features = parseRoadside({
      elements: [
        { type: 'node', lat: -37.4693, lon: -72.3527, tags: { highway: 'traffic_signals' } },
        { type: 'node', lat: -37.46935, lon: -72.35275, tags: { highway: 'traffic_signals' } },
        { type: 'node', lat: -37.475, lon: -72.34, tags: { highway: 'traffic_signals' } },
        { type: 'node', lat: -37.3, lon: -72.4, tags: { barrier: 'toll_booth' } },
        {
          type: 'way',
          center: { lat: -37.3001, lon: -72.4002 },
          tags: { barrier: 'toll_booth', name: 'Peaje Las Maicas' },
        },
        { type: 'node', tags: { highway: 'traffic_signals' } },
      ],
    });
    expect(features.trafficSignals).toHaveLength(2);
    expect(features.tollBooths).toHaveLength(1);
    expect(features.tollBooths[0].name).toBe('Peaje Las Maicas');
  });

  it('tolera respuestas vacías', () => {
    expect(parseRoadside(null)).toEqual({ trafficSignals: [], tollBooths: [] });
  });
});

describe('OverpassRoadsideLookup', () => {
  it('envía la consulta por POST y traduce la respuesta', async () => {
    let body = '';
    const lookup = new OverpassRoadsideLookup(async (_url, init) => {
      body = String(init?.body);
      return new Response(
        JSON.stringify({
          elements: [
            { type: 'node', lat: -37.47, lon: -72.35, tags: { highway: 'traffic_signals' } },
          ],
        }),
      );
    });
    const features = await lookup.features(path);
    expect(decodeURIComponent(body)).toContain('traffic_signals');
    expect(features.trafficSignals).toEqual([{ lat: -37.47, lng: -72.35 }]);
  });

  it('no consulta sin trazado y avisa si OpenStreetMap no responde', async () => {
    const failing = new OverpassRoadsideLookup(async () => new Response('busy', { status: 504 }));
    await expect(failing.features(path.slice(0, 1))).resolves.toEqual({
      trafficSignals: [],
      tollBooths: [],
    });
    await expect(failing.features(path)).rejects.toMatchObject({ code: 'OSM_NO_DISPONIBLE' });
  });
});
