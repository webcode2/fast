import { db } from './auth.ts';
import { describeError } from './runtime.ts';
import { streetRoute, type Point } from './routing.ts';

// GPS drifts on city streets, so one far reading does not count as a missed turn.
export const offRouteMeters = 50;
export const offRouteSamples = 2;
export const rerouteCooldownMs = 20_000;
const arrivedMeters = 30;
const earthMeters = 6_371_000;

type Path = [number, number][];

/** The shortest distance in meters from a point to a line of [latitude, longitude] pairs. */
export function metersFromPath(point: Point, path: Path) {
  const radians = Math.PI / 180;
  const xScale = Math.cos(point.latitude * radians) * radians * earthMeters;
  const yScale = radians * earthMeters;
  const flat = path.map(([latitude, longitude]) => [
    (longitude - point.longitude) * xScale,
    (latitude - point.latitude) * yScale,
  ]);
  if (flat.length === 1) return Math.hypot(flat[0][0], flat[0][1]);
  let closest = Infinity;
  for (let i = 1; i < flat.length; i++) {
    const [ax, ay] = flat[i - 1];
    const dx = flat[i][0] - ax;
    const dy = flat[i][1] - ay;
    const length = dx * dx + dy * dy;
    const along = length ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length)) : 0;
    closest = Math.min(closest, Math.hypot(ax + along * dx, ay + along * dy));
  }
  return closest;
}

export type RouteState = { path: Path; samples: number; updatedAtMs: number };

/** Decides what a GPS reading means for the route the rider is following. */
export function routeDecision(state: RouteState, location: Point, nowMs: number) {
  if (metersFromPath(location, state.path) <= offRouteMeters) return 'on_route';
  return state.samples + 1 >= offRouteSamples && nowMs - state.updatedAtMs >= rerouteCooldownMs
    ? 'reroute'
    : 'drifting';
}

const inFlight = new Map<string, Promise<void>>();
const failedUntil = new Map<string, number>();
const failureCooldownMs = 30_000;

/**
 * Keeps the live road route current without holding up the rider's GPS update.
 * One update runs per trip, and a provider failure waits before trying again.
 */
export function followRoute(orderId: string, riderId: string, location: Point) {
  if (inFlight.has(orderId) || (failedUntil.get(orderId) ?? 0) > Date.now()) return;
  const work = updateRoute(orderId, riderId, location)
    .then(() => { failedUntil.delete(orderId); })
    .catch((error) => {
      failedUntil.set(orderId, Date.now() + failureCooldownMs);
      console.error(`Trip route update failed: ${describeError(error)}`);
    })
    .finally(() => { inFlight.delete(orderId); });
  inFlight.set(orderId, work);
}

/** Lets checks wait for background route updates. */
export const routeUpdatesSettled = () => Promise.all(inFlight.values());

async function updateRoute(orderId: string, riderId: string, location: Point) {
  const { rows: [trip] } = await db.query(
    `SELECT o.status, ST_Y(o.pickup::geometry) AS pickup_latitude, ST_X(o.pickup::geometry) AS pickup_longitude,
       ST_Y(o.dropoff::geometry) AS dropoff_latitude, ST_X(o.dropoff::geometry) AS dropoff_longitude,
       r.rider_id, r.target, r.path, r.off_route_samples, r.updated_at
     FROM delivery_orders o LEFT JOIN trip_routes r ON r.order_id=o.id
     WHERE o.id=$1 AND o.assigned_rider_id=$2 AND o.status IN ('assigned','picked_up')`,
    [orderId, riderId],
  );
  if (!trip) return;
  const target = trip.status === 'assigned' ? 'pickup' : 'dropoff';
  const stop: Point = { latitude: trip[`${target}_latitude`], longitude: trip[`${target}_longitude`] };
  if (metersFromPath(location, [[stop.latitude, stop.longitude]]) <= arrivedMeters) return;

  if (trip.path && trip.target === target && trip.rider_id === riderId) {
    const decision = routeDecision({
      path: trip.path,
      samples: trip.off_route_samples,
      updatedAtMs: new Date(trip.updated_at).getTime(),
    }, location, Date.now());
    if (decision !== 'reroute') {
      const samples = decision === 'on_route' ? 0 : trip.off_route_samples + 1;
      if (samples !== trip.off_route_samples) {
        await db.query('UPDATE trip_routes SET off_route_samples=$2 WHERE order_id=$1', [orderId, samples]);
      }
      return;
    }
  }

  const route = await streetRoute(location, stop);
  if (!route.path.length) return;
  await db.query(
    `INSERT INTO trip_routes (order_id,rider_id,target,path,distance_meters)
     SELECT id,$2,$3,$4::jsonb,$5 FROM delivery_orders
     WHERE id=$1 AND assigned_rider_id=$2 AND status IN ('assigned','picked_up')
     ON CONFLICT (order_id) DO UPDATE SET rider_id=excluded.rider_id, target=excluded.target, path=excluded.path,
       distance_meters=excluded.distance_meters, off_route_samples=0, updated_at=clock_timestamp()`,
    [orderId, riderId, target, JSON.stringify(route.path), route.meters],
  );
}

/** The live route when a rider is moving, otherwise the road route agreed at booking. */
export async function tripRoute(orderId: string, accountId: string) {
  const { rows: [trip] } = await db.query(
    `SELECT o.route_path, o.route_distance_meters, o.status IN ('assigned','picked_up') AS active,
       r.target, r.path, r.distance_meters, r.updated_at
     FROM delivery_orders o LEFT JOIN trip_routes r ON r.order_id=o.id
     WHERE o.id=$1 AND o.assigned_rider_id IS NOT NULL AND (o.customer_id=$2 OR o.assigned_rider_id=$2)`,
    [orderId, accountId],
  );
  if (!trip) return;
  if (trip.active && trip.path) {
    return { target: trip.target, path: trip.path, distanceMeters: trip.distance_meters, updatedAt: trip.updated_at };
  }
  return trip.route_path
    ? { target: 'dropoff', path: trip.route_path, distanceMeters: trip.route_distance_meters, updatedAt: null }
    : null;
}
