# Redis cache registry

Use the constants in [cache-keys.ts](../apps/api/src/cache-keys.ts). A full key is the registered prefix followed by a colon and the lookup scope. The prefixes apply to disposable cache entries. Use a dedicated Redis instance or deployment per environment.

| Feature | Constant | Lookup scope | Policy |
|---|---|---|---|
| Street routing for pickup and drop-off, fare quotes, and route previews | `ROUTE_ESTIMATE` | Hash of the provider, routing profile, ordered coordinates, and any route options that affect the response | Implemented for route distance and road geometry. Enable using `ROUTE_CACHE_TTL_SECONDS` when provider terms permit retention. Calculate the fare separately. Fall back to the routing provider on a miss or Redis outage. |
| Fare configuration displayed to customers and admins | `FARE_RULES` | Service area ID | Add with editable fare rules if needed. Invalidate after the database update commits. Order submission uses the authoritative rules. |
| Admin delivery metrics | `ADMIN_DELIVERY_METRICS` | Hash of the authorized service-area scope, time window, and filters | Add if dashboard aggregation needs it. Check admin access before lookup. Recompute from PostgreSQL on a miss or Redis outage. |

Set a TTL on every entry when its integration lands. Pick it based on how stale the result can be and what the provider permits us to retain. Bump the key namespace version when cached formats change incompatibly. Avoid raw addresses, coordinates, phone numbers, secrets, and identity data in keys.

## Other features

- **Signup, OTP, sessions, and rider identity verification.** Security state and rate limits need their own storage and failure policy. Keep them out of the evictable cache.
- **Orders, bidding, and assignment.** PostgreSQL owns the order and bid state. Nearby rider eligibility is checked against current state. Cross-instance WebSocket broadcasts would use Redis pub/sub as a separate feature.
- **Live tracking and dispatch presence.** Latest rider position and online presence may use a short-lived realtime store if needed. Define that separately with a freshness and outage policy.
- **Trip completion, reviews, and complaints.** Read and write authoritative records in PostgreSQL.
- **Chat, calls, and notifications.** Message history and delivery state need durable storage. Voice and push use their respective providers.
- **Payments, payouts, refunds, cash commission, and jobs.** Persist ledger entries, scheduled work, and idempotency records in durable storage.
- **Vendor tools.** Deferred from the alpha. Add cache keys when their access patterns are defined.

## Trip conversation realtime state

- `TRIP_REALTIME.CHANNEL` relays committed trip change notifications between API instances. Events carry a trip ID and publisher instance ID. Authorized sockets read the latest PostgreSQL state.
- `TRIP_REALTIME.PRESENCE` is scoped by trip, account, and connection. A 40-second TTL covers abrupt disconnects. The API refreshes it on snapshots and removes it on close. It represents an open conversation, separately from rider dispatch availability.
- During a Redis outage, local updates still reach local sockets immediately. A 15-second server reconciliation picks up cross-instance or worker changes from PostgreSQL.

## Dispatch geospatial benchmark

Nearby dispatch uses the GiST-backed PostGIS query. A local benchmark with
25,000 synthetic pickups and 128 rider origins compared the 5 km search with
expiry ordering and a 50-order limit. Redis used a widened radius to shortlist
candidates, then PostGIS applied the exact radius and ordering. The shortlist
produced the same ranked results for all 128 test origins.

| Concurrent reads | PostGIS reads/s | PostGIS p95 | Redis GEO reads/s | Redis GEO p95 | Redis + PostGIS reads/s | Redis + PostGIS p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 309 | 4.55 ms | 1,259 | 1.13 ms | 215 | 6.89 ms |
| 16 | 644 | 34.07 ms | 3,009 | 6.40 ms | 670 | 38.18 ms |
| 64 | 1,004 | 76.42 ms | 2,860 | 23.73 ms | 622 | 140.41 ms |

Redis-only measurements include the radius lookup. The hybrid measurements
also include the database location read, exact validation, and order ranking.
This is a local read-only workload with a preloaded Redis index. It excludes
authentication, live order churn, and index synchronization overhead.

Run `DATABASE_URL=… REDIS_URL=… node apps/api/checks/geo-benchmark.ts` against
a fresh temporary PostgreSQL database. The check creates its benchmark tables
and cleans up its temporary Redis key.

**Measurement status: open.** Keep PostGIS as the dispatch read path pending
more measurements. The next benchmark should use representative rider and
order density, live order and location writes, mixed read/write concurrency,
and p99 latency. If Redis is evaluated again, include cache maintenance and
outage recovery in the comparison.
