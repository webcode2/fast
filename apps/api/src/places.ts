import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, limited } from './auth.ts';
import { point } from './orders.ts';
import { clientAddress } from './runtime.ts';
import type { Point } from './routing.ts';

export type Place = Point & { name: string; detail: string };

const send = (status: number, body: object) => ({ status, body });
const maxQuery = 120;

function placesFromProvider(result: { features?: unknown }): Place[] {
  if (!Array.isArray(result.features)) throw new Error('Invalid geocoding response');
  return result.features.flatMap((feature) => {
    const properties = feature?.properties;
    const location = point(properties?.coordinates);
    if (!location || typeof properties.name !== 'string' || !properties.name) return [];
    return [{ ...location, name: properties.name, detail: String(properties.place_formatted ?? '') }];
  });
}

async function geocode(endpoint: 'forward' | 'reverse', query: Record<string, string>) {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('Geocoding provider is not configured');
  const url = new URL(`https://api.mapbox.com/search/geocode/v6/${endpoint}`);
  url.search = new URLSearchParams({ ...query, access_token: token, country: 'ng' }).toString();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Geocoding provider failed');
  return placesFromProvider(await response.json());
}

export const searchPlaces = (text: string, near?: Point) => geocode('forward', {
  q: text,
  limit: '6',
  ...(near ? { proximity: `${near.longitude},${near.latitude}` } : {}),
});

export const reversePlace = async ({ latitude, longitude }: Point) =>
  (await geocode('reverse', { latitude: String(latitude), longitude: String(longitude), limit: '1' }))[0] ?? null;

function queryPoint(query: URLSearchParams) {
  if (!query.has('latitude') || !query.has('longitude')) return;
  return point({ latitude: Number(query.get('latitude')), longitude: Number(query.get('longitude')) });
}

export async function places(request: IncomingMessage, target: string) {
  if (request.method !== 'GET') return send(405, { error: 'Only GET is supported' });
  const url = new URL(target, 'http://local');
  if (url.pathname !== '/places/search' && url.pathname !== '/places/reverse') {
    return send(404, { error: 'Route not found' });
  }
  const account = await authenticatedAccount(request);
  if (!account && request.headers.authorization) return send(401, { error: 'Sign in required' });
  const near = queryPoint(url.searchParams);
  const text = url.searchParams.get('q')?.trim() ?? '';
  if (url.pathname === '/places/search' ? text.length < 2 || text.length > maxQuery : !near) {
    return send(400, { error: 'Provide a valid place search' });
  }
  // Search runs as the customer types, so it allows more requests than quotes.
  const bucket = account ? `places:${account.id}` : `guest-places:${clientAddress(request)}`;
  if (await limited(bucket, account ? 300 : 60)) return send(429, { error: 'Too many place requests' });
  try {
    return url.pathname === '/places/search'
      ? send(200, { places: await searchPlaces(text, near) })
      : send(200, { place: await reversePlace(near as Point) });
  } catch {
    return send(503, { error: 'Place search temporarily unavailable' });
  }
}
