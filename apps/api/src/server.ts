import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const fareFloorKoboPerKm = 15_000;

export function route(method: string | undefined, target: string) {
  const queryStart = target.indexOf('?');
  const path = queryStart === -1 ? target : target.slice(0, queryStart);
  const query = queryStart === -1 ? '' : target.slice(queryStart + 1);
  const send = (status: number, body: object) => ({ status, body });

  if (method !== 'GET') return send(405, { error: 'Only GET is supported' });
  if (path === '/healthz') return send(200, { status: 'ok' });
  if (path !== '/fare-floor') return send(404, { error: 'Route not found' });

  const distance = new URLSearchParams(query).get('distanceMeters') ?? '';
  const distanceMeters = Number(distance);
  if (!/^[0-9]+$/.test(distance) || !Number.isSafeInteger(distanceMeters * (fareFloorKoboPerKm / 1000)) || distanceMeters <= 0) {
    return send(400, { error: 'distanceMeters must be a positive integer' });
  }

  return send(200, { fareFloorKobo: distanceMeters * (fareFloorKoboPerKm / 1000) });
}

const server = createServer((request, response) => {
  const { status, body } = route(request.method, request.url ?? '/');
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(Number(process.env.PORT ?? 8080), '127.0.0.1');
}
