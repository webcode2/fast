import { createServer, type IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { auth, db } from './auth.ts';
import { cashCommission } from './cash-commission.ts';
import { dispatch, isDispatchPath, streamSnapshots } from './dispatch.ts';
import { orders } from './orders.ts';
import { payments } from './payments.ts';
import { places } from './places.ts';
import { riderIdentity } from './rider-identity.ts';
import { describeError, requireConfig } from './runtime.ts';
import { staffApi } from './staff.ts';
import { tripComms } from './trip-comms.ts';
import { tripFeedback } from './trip-feedback.ts';
import { attachTripRealtime, tripChanged } from './trip-realtime.ts';
import { staffResolveTrip } from './trip-resolution.ts';
import { trips } from './trips.ts';
import { staffWaitlist, waitlistHeaders, waitlistSignup } from './waitlist.ts';

type Result = { status: number; body: object };
type Route = {
  name: string;
  matches: (path: string) => boolean;
  run: (request: IncomingMessage, path: string, target: string) => Promise<Result>;
  unavailable: string;
};

// Checked in order. Each route's failure is logged once, with this name.
const routes: Route[] = [
  { name: 'waitlist', matches: (path) => path === '/waitlist',
    run: (request) => waitlistSignup(request), unavailable: 'Signup temporarily unavailable. Please try again.' },
  { name: 'staff-waitlist', matches: (path) => path === '/admin/waitlist' || path.startsWith('/admin/waitlist/'),
    run: (request, path) => staffWaitlist(request, path), unavailable: 'Waitlist temporarily unavailable' },
  { name: 'staff-trip-resolve', matches: (path) => /^\/admin\/trips\/[^/]+\/resolve$/.test(path),
    run: (request, path) => staffResolveTrip(request, path), unavailable: 'Trip resolution temporarily unavailable' },
  { name: 'auth', matches: (path) => path.startsWith('/auth/'),
    run: (request, path) => auth(request, path), unavailable: 'Authentication temporarily unavailable' },
  { name: 'payments', matches: (path) => path === '/payments/bachs/webhook' ||
      /^\/trips\/[^/]+\/payment(?:\/|$)/.test(path) || path.startsWith('/admin/payments/'),
    run: (request, path) => payments(request, path), unavailable: 'Payments temporarily unavailable' },
  { name: 'cash-commission', matches: (path) => /^\/(?:admin\/)?cash-commission(?:\/|$)/.test(path),
    run: (request, path) => cashCommission(request, path), unavailable: 'Cash commission temporarily unavailable' },
  { name: 'identity', matches: (path) => path.startsWith('/identity/') || path === '/admin/rider-identity',
    run: (request, path) => riderIdentity(request, path), unavailable: 'Identity verification temporarily unavailable' },
  { name: 'places', matches: (path) => path.startsWith('/places/'),
    run: (request, _path, target) => places(request, target), unavailable: 'Place search temporarily unavailable' },
  { name: 'orders', matches: (path) => path === '/orders/quote' || path === '/orders',
    run: (request, path) => orders(request, path), unavailable: 'Orders temporarily unavailable' },
  { name: 'dispatch', matches: isDispatchPath,
    run: (request, path) => dispatch(request, path), unavailable: 'Dispatch temporarily unavailable' },
  { name: 'trip-comms', matches: (path) => /^\/trips\/[^/]+\/comms(?:\/|$)/.test(path),
    run: (request, _path, target) => tripComms(request, target), unavailable: 'Communications temporarily unavailable' },
  { name: 'trip-feedback', matches: (path) => path === '/trips/feedback' ||
      /^\/trips\/[^/]+\/(feedback|review|dispute)$/.test(path) || /^\/admin\/disputes(?:\/|$)/.test(path),
    run: (request, path) => tripFeedback(request, path), unavailable: 'Feedback temporarily unavailable' },
  { name: 'staff', matches: (path) => /^\/admin\/(staff|archives)(?:\/|$)/.test(path),
    run: (request, path) => staffApi(request, path), unavailable: 'Staff operation temporarily unavailable' },
  { name: 'trips', matches: (path) => path.startsWith('/trips/'),
    run: (request, path) => trips(request, path), unavailable: 'Trip temporarily unavailable' },
];

const logFailure = (name: string, request: IncomingMessage, error: unknown) =>
  console.error(`${request.method} ${name} failed: ${describeError(error)}`);

export function route(method: string | undefined, target: string): Result {
  if (method !== 'GET') return { status: 405, body: { error: 'Only GET is supported' } };
  if (target.split('?', 1)[0] === '/healthz') return { status: 200, body: { status: 'ok' } };
  return { status: 404, body: { error: 'Route not found' } };
}

async function ready(): Promise<Result> {
  try {
    await db.query('SELECT 1');
    return { status: 200, body: { status: 'ready' } };
  } catch (error) {
    console.error(`Readiness check failed: ${describeError(error)}`);
    return { status: 503, body: { status: 'unavailable' } };
  }
}

export const server = createServer(async (request, response) => {
  const target = request.url ?? '/';
  const path = target.split('?', 1)[0];
  const streamPath = path.endsWith('/stream') ? path.slice(0, -7) : '';
  const tripStream = /^\/trips\/[^/]+$/.test(streamPath);
  if (request.method === 'GET' && (tripStream || streamPath === '/dispatch/nearby' || /^\/orders\/[^/]+\/bids$/.test(streamPath))) {
    const read = () => tripStream ? trips(request, streamPath) : dispatch(request, streamPath);
    const result = await streamSnapshots(request, response, read).catch((error) => {
      logFailure('stream', request, error);
      return { status: 503, body: { error: 'Dispatch temporarily unavailable' } };
    });
    if (!result || response.headersSent) return;
    response.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(result.body));
    return;
  }
  if (path === '/waitlist' && request.method === 'OPTIONS') {
    const headers = waitlistHeaders(request);
    response.writeHead('Access-Control-Allow-Origin' in headers ? 204 : 403, headers).end();
    return;
  }

  const matched = routes.find((candidate) => candidate.matches(path));
  const result: Result = path === '/readyz' && request.method === 'GET' ? await ready()
    : matched ? await matched.run(request, path, target).catch((error) => {
      logFailure(matched.name, request, error);
      return { status: 503, body: { error: matched.unavailable } };
    })
    : route(request.method, target);

  const tripMutation = path.match(/^\/(?:admin\/)?trips\/([\da-f-]{36})\/(?:comms\/(?:messages|call|answer|hangup)|pickup|complete|cancel|replace|no-show|resolve)$/i);
  if (request.method === 'POST' && result.status < 300 && tripMutation) tripChanged(tripMutation[1]);
  response.writeHead(result.status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(path === '/waitlist' ? waitlistHeaders(request) : {}),
  }).end(JSON.stringify(result.body));
});

attachTripRealtime(server);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireConfig('api');
  server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '127.0.0.1');
}
