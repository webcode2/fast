import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { reversePlace, searchPlaces } from './places.ts';
import { streetRoute } from './routing.ts';
import { metersFromPath, rerouteCooldownMs, routeDecision } from './trip-route.ts';

const network = globalThis.fetch;
afterEach(() => { globalThis.fetch = network; });

function provider(body: object, seen: URL[] = []) {
  process.env.MAPBOX_ACCESS_TOKEN = 'test-token';
  globalThis.fetch = (async (input: string | URL) => {
    seen.push(new URL(String(input)));
    return Response.json(body);
  }) as typeof fetch;
  return seen;
}

test('search stays in Nigeria, prefers nearby places, and drops malformed results', async () => {
  const seen = provider({ features: [
    { properties: { name: 'RSUTH', place_formatted: 'Harley Street, Port Harcourt',
      coordinates: { latitude: 4.8, longitude: 7 } } },
    { properties: { name: 'No coordinates' } },
  ] });
  assert.deepEqual(await searchPlaces('rsu', { latitude: 4.81, longitude: 7.01 }), [
    { latitude: 4.8, longitude: 7, name: 'RSUTH', detail: 'Harley Street, Port Harcourt' },
  ]);
  assert.equal(seen[0].searchParams.get('country'), 'ng');
  assert.equal(seen[0].searchParams.get('proximity'), '7.01,4.81');
});

test('reverse lookup returns null when the provider has no match', async () => {
  provider({ features: [] });
  assert.equal(await reversePlace({ latitude: 4.81, longitude: 7.01 }), null);
});

test('malformed geocoding responses fail instead of returning no results', async () => {
  provider({ message: 'Not Authorized' });
  await assert.rejects(searchPlaces('rsu'));
});

test('street route returns the road line as latitude and longitude pairs', async () => {
  const seen = provider({ code: 'Ok', routes: [{ distance: 1250.2, geometry: {
    coordinates: [[7, 4.81], [7.01, 4.815], ['bad', 4.82]],
  } }] });
  assert.deepEqual(await streetRoute({ latitude: 4.81, longitude: 7 }, { latitude: 4.815, longitude: 7.01 }), {
    meters: 1251,
    path: [[4.81, 7], [4.815, 7.01]],
  });
  assert.equal(seen[0].searchParams.get('geometries'), 'geojson');
  assert.equal(seen[0].searchParams.get('overview'), 'full');
});

const road: [number, number][] = [[4.8, 7], [4.81, 7], [4.81, 7.01]];
const now = 1_000_000;
const settled = { path: road, samples: 0, updatedAtMs: now - rerouteCooldownMs };

test('distance from a route measures to the nearest road segment', () => {
  assert.ok(metersFromPath({ latitude: 4.805, longitude: 7 }, road) < 1);
  const beside = metersFromPath({ latitude: 4.805, longitude: 7.001 }, road);
  assert.ok(beside > 105 && beside < 115, `got ${beside}`);
});

test('a rider on the road stays on route, even with GPS drift', () => {
  assert.equal(routeDecision(settled, { latitude: 4.805, longitude: 7.0003 }, now), 'on_route');
});

test('one far reading waits, and a confirmed missed turn reroutes', () => {
  const missed = { latitude: 4.805, longitude: 7.002 };
  assert.equal(routeDecision(settled, missed, now), 'drifting');
  assert.equal(routeDecision({ ...settled, samples: 1 }, missed, now), 'reroute');
});

test('rerouting waits for the cooldown so a lost rider cannot flood the provider', () => {
  const recent = { path: road, samples: 5, updatedAtMs: now - rerouteCooldownMs + 1 };
  assert.equal(routeDecision(recent, { latitude: 4.805, longitude: 7.002 }, now), 'drifting');
});
