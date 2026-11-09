import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createClient } from 'redis';
import { WebSocketServer, WebSocket } from 'ws';
import { tripComms } from './trip-comms.ts';
import { TRIP_REALTIME } from './cache-keys.ts';

const origin = randomUUID();
const listeners = new Map<string, Set<() => void>>();
const notify = (trip: string) => listeners.get(trip)?.forEach(refresh => refresh());
let publisher: ReturnType<typeof createClient> | undefined;
let subscriber: ReturnType<typeof createClient> | undefined;

function startRedis() {
  if (publisher || !process.env.REDIS_URL) return;
  publisher = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true });
  subscriber = publisher.duplicate();
  publisher.on('error', () => {});
  subscriber.on('error', () => {});
  void publisher.connect().catch(() => {});
  void subscriber.connect().then(() => subscriber!.subscribe(TRIP_REALTIME.CHANNEL, message => {
    const [source, trip] = message.split(':');
    if (source !== origin && trip) notify(trip);
  })).catch(() => {});
}

export function tripChanged(trip: string) {
  trip = trip.toLowerCase();
  notify(trip);
  startRedis();
  if (publisher?.isReady) void publisher.publish(TRIP_REALTIME.CHANNEL, origin + ':' + trip).catch(() => {});
}

export function attachTripRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('listening', startRedis);
  server.on('upgrade', (request, socket, head) => {
    const [, id] = (request.url ?? '').match(/^\/trips\/([\da-f-]{36})\/comms\/ws$/i) ?? [];
    if (!id) return socket.destroy();
    const trip = id.toLowerCase();
    const path = '/trips/' + trip + '/comms';
    const ignoreError = () => {};
    socket.on('error', ignoreError);
    void tripComms(request, path).then(initial => {
      if (socket.destroyed) return;
      if (initial.status !== 200) {
        socket.end(`HTTP/1.1 ${initial.status} Rejected\r\nConnection: close\r\n\r\n`);
        return;
      }
      startRedis();
      wss.handleUpgrade(request, socket, head, ws => {
        socket.off('error', ignoreError);
        let refreshing = false;
        let pending = false;
        let alive = true;
        const presence = TRIP_REALTIME.PRESENCE + ':' + trip + ':' +
          (initial.body as { accountId: string }).accountId + ':' + randomUUID();
        const refresh = async () => {
          if (refreshing) { pending = true; return; }
          refreshing = true;
          try {
            do {
              pending = false;
              const result = await tripComms(request, path);
              if (ws.readyState !== WebSocket.OPEN) return;
              if (result.status !== 200) {
                ws.send(JSON.stringify(result));
                ws.close(1008);
                return;
              }
              if (ws.bufferedAmount > 512 * 1024) { ws.terminate(); return; }
              ws.send(JSON.stringify(result));
              if (publisher?.isReady) void publisher.set(presence, '1', { EX: 40 }).catch(() => {});
            } while (pending);
          } catch {
            ws.close(1011);
          } finally {
            refreshing = false;
          }
        };
        const group = listeners.get(trip) ?? new Set();
        group.add(refresh);
        listeners.set(trip, group);
        ws.on('pong', () => { alive = true; });
        ws.on('message', () => ws.close(1008));
        ws.on('error', () => ws.terminate());
        // Reconcile missed events, worker transitions, and session expiry.
        const heartbeat = setInterval(() => {
          if (!alive) { ws.terminate(); return; }
          alive = false;
          ws.ping();
          void refresh();
        }, 15_000);
        ws.once('close', () => {
          clearInterval(heartbeat);
          group.delete(refresh);
          if (!group.size) listeners.delete(trip);
          if (publisher?.isReady) void publisher.del(presence).catch(() => {});
        });
        void refresh();
      });
    }).catch(() => socket.destroy());
  });
  server.once('close', () => {
    for (const ws of wss.clients) ws.terminate();
    if (subscriber?.isOpen) subscriber.destroy();
    if (publisher?.isOpen) publisher.destroy();
    publisher = subscriber = undefined;
  });
}
