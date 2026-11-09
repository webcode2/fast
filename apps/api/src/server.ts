import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { auth } from './auth.ts';
import { dispatch, isDispatchPath, streamSnapshots } from './dispatch.ts';

import { orders } from './orders.ts';
import { places } from './places.ts';
import { staffWaitlist, waitlistHeaders, waitlistSignup } from './waitlist.ts';
import { trips } from './trips.ts';
import { attachTripRealtime, tripChanged } from './trip-realtime.ts';
import { tripComms } from './trip-comms.ts';
import { tripFeedback } from './trip-feedback.ts';
import { staffApi } from './staff.ts';
import { payments } from './payments.ts';
import { cashCommission } from './cash-commission.ts';
import { riderIdentity } from './rider-identity.ts';

export function route(method: string | undefined, target: string) {
  if (method !== 'GET') return { status: 405, body: { error: 'Only GET is supported' } };
  if (target.split('?', 1)[0] === '/healthz') return { status: 200, body: { status: 'ok' } };
  return { status: 404, body: { error: 'Route not found' } };
}

export const server = createServer(async (request, response) => {
  const target = request.url ?? '/';
  const path = target.split('?', 1)[0];
  const unavailable = { status: 503, body: { error: 'Dispatch temporarily unavailable' } };
  const streamPath = path.endsWith('/stream') ? path.slice(0, -7) : '';
  const tripStream = /^\/trips\/[^/]+$/.test(streamPath);
  if (request.method === 'GET' && (tripStream || streamPath === '/dispatch/nearby' || /^\/orders\/[^/]+\/bids$/.test(streamPath))) {
    const read = () => tripStream ? trips(request, streamPath) : dispatch(request, streamPath);
    const result = await streamSnapshots(request, response, read).catch(() => unavailable);
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
  const result = path === '/waitlist'
    ? await waitlistSignup(request).catch(() => ({ status: 503, body: { error: 'Signup temporarily unavailable. Please try again.' } }))
    : path === '/admin/waitlist' || path.startsWith('/admin/waitlist/')
    ? await staffWaitlist(request, path).catch(() => ({ status: 503, body: { error: 'Waitlist temporarily unavailable' } }))
    : path.startsWith('/auth/')
    ? await auth(request, path).catch(() => ({ status: 503, body: { error: 'Authentication temporarily unavailable' } }))
    : path === '/payments/bachs/webhook' || /^\/trips\/[^/]+\/payment(?:\/|$)/.test(path) || path.startsWith('/admin/payments/')
      ? await payments(request, path).catch(() => ({ status: 503, body: { error: 'Payments temporarily unavailable' } }))
      : /^\/(?:admin\/)?cash-commission(?:\/|$)/.test(path)
        ? await cashCommission(request, path).catch(() => ({ status: 503, body: { error: 'Cash commission temporarily unavailable' } }))
        : path.startsWith('/identity/') || path === '/admin/rider-identity'
          ? await riderIdentity(request, path).catch(() => ({ status: 503, body: { error: 'Identity verification temporarily unavailable' } }))
          : path.startsWith('/places/')
            ? await places(request, target).catch(() => ({ status: 503, body: { error: 'Place search temporarily unavailable' } }))
          : path === '/orders/quote' || path === '/orders'
      ? await orders(request, path).catch(() => ({ status: 503, body: { error: 'Orders temporarily unavailable' } }))
      : isDispatchPath(path)
        ? await dispatch(request, path).catch(() => unavailable)
        : /^\/trips\/[^/]+\/comms(?:\/|$)/.test(path)
          ? await tripComms(request, target).catch(() => ({ status: 503, body: { error: 'Communications temporarily unavailable' } }))
          : path === '/trips/feedback' || /^\/trips\/[^/]+\/(feedback|review|dispute)$/.test(path) ||
              /^\/admin\/disputes(?:\/|$)/.test(path)
            ? await tripFeedback(request, path).catch(() => ({ status: 503, body: { error: 'Feedback temporarily unavailable' } }))
            : /^\/admin\/(staff|archives)(?:\/|$)/.test(path)
              ? await staffApi(request, path).catch(() => ({ status: 503, body: { error: 'Staff operation temporarily unavailable' } }))
              : path.startsWith('/trips/')
              ? await trips(request, path).catch(() => ({ status: 503, body: { error: 'Trip temporarily unavailable' } }))
              : route(request.method, target);
  const tripMutation = path.match(/^\/trips\/([\da-f-]{36})\/(?:comms\/(?:messages|call|answer|hangup)|pickup|complete|cancel|replace|no-show)$/i);
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
  server.listen(Number(process.env.PORT ?? 8080), '127.0.0.1');
}
