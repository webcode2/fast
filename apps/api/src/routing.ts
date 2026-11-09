import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import { CACHE_KEY_PREFIX } from './cache-keys.ts';

export type Point = { latitude: number; longitude: number };

const profile = 'mapbox/driving';
const maxDistance = 10_000_000;
let cache: ReturnType<typeof createClient> | undefined;
let connection: Promise<unknown> | undefined;
let retryAt = 0;

async function routeCache() {
  const url = process.env.REDIS_URL;
  if (!url || Date.now() < retryAt) return;
  if (!cache) {
    cache = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 400, reconnectStrategy: false },
    });
    cache.on('error', () => {});
  }
  if (!cache.isOpen) {
    connection ??= cache.connect().catch(() => {
      retryAt = Date.now() + 5000;
    }).finally(() => { connection = undefined; });
  }
  await connection;
  return cache.isReady ? cache : undefined;
}

export class NoStreetRoute extends Error {}

export type StreetRoute = { meters: number; path: [number, number][] };

function cachedRoute(raw: string | null): StreetRoute | undefined {
  if (!raw) return;
  try {
    const { meters, path } = JSON.parse(raw);
    if (Number.isInteger(meters) && meters > 0 && meters <= maxDistance && Array.isArray(path)) return { meters, path };
  } catch {}
}

function routePath(coordinates: unknown): [number, number][] {
  if (!Array.isArray(coordinates)) return [];
  return coordinates.flatMap((pair): [number, number][] =>
    Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]) ? [[pair[1], pair[0]]] : []);
}

export async function streetRoute(pickup: Point, dropoff: Point): Promise<StreetRoute> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('Routing provider is not configured');

  const coordinates = [pickup, dropoff].map(({ longitude, latitude }) => `${longitude},${latitude}`).join(';');
  const key = CACHE_KEY_PREFIX.ROUTE_ESTIMATE + ':' +
    createHash('sha256').update(`${profile}:${coordinates}`).digest('hex');
  const ttl = Number(process.env.ROUTE_CACHE_TTL_SECONDS ?? 0);
  const client = Number.isInteger(ttl) && ttl > 0 && ttl <= 3600
    ? await routeCache().catch(() => undefined)
    : undefined;
  if (client) {
    const cached = await client.withAbortSignal(AbortSignal.timeout(400)).get(key).catch(() => null);
    const route = cachedRoute(cached);
    if (route) return route;
  }

  const url = new URL(`https://api.mapbox.com/directions/v5/${profile}/${coordinates}`);
  url.search = new URLSearchParams({ access_token: token, overview: 'full', geometries: 'geojson' }).toString();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Routing provider failed');
  const result = await response.json();
  if (result.code === 'NoRoute' || result.code === 'NoSegment') throw new NoStreetRoute();
  const distance = result.routes?.[0]?.distance;
  if (result.code !== 'Ok' || typeof distance !== 'number' || !Number.isFinite(distance) ||
      distance <= 0 || distance > maxDistance) throw new Error('Invalid routing response');
  const route = { meters: Math.ceil(distance), path: routePath(result.routes[0].geometry?.coordinates) };
  if (client) {
    await client.withAbortSignal(AbortSignal.timeout(400)).set(key, JSON.stringify(route), { EX: ttl }).catch(() => {});
  }
  return route;
}
