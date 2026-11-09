const CACHE_PREFIX = 'fastlogistics:cache:v1';

export const CACHE_KEY_PREFIX = {
  ROUTE_ESTIMATE: `${CACHE_PREFIX}:routing:estimate`,
  FARE_RULES: `${CACHE_PREFIX}:pricing:rules`,
  ADMIN_DELIVERY_METRICS: `${CACHE_PREFIX}:admin:delivery-metrics`,
} as const;

export const TRIP_REALTIME = {
  CHANNEL: 'fastlogistics:realtime:v1:trip-updates',
  PRESENCE: 'fastlogistics:realtime:v1:trip-presence',
} as const;
