# Fast Logistics build plan

The PRD supplies product context. This is a fresh build. The historical progress report describes a separate, unverified implementation.

## Decisions

- The monorepo keeps the API in `apps/api` and the shared Flutter app in `apps/mobile`. Mobile work uses separate branches that integrate into `main`.

- One Flutter app with customer and rider signup paths, Next.js admin, and one Node.js/TypeScript backend with a worker for scheduled jobs.
- PostgreSQL/PostGIS owns durable state. Redis caches derived data such as route estimates. Cache misses and outages fall back to the source.
- The rider marks delivery complete. The customer may then leave a review or report non-delivery.
- Digital rider earnings are scheduled for the beginning of the following local day in Africa/Lagos. Decide the exact batch time, cutoff, and dispute rules before live payouts.
- The fare stays fixed once a rider is assigned. A new route after a missed turn or detour does not change the agreed fare or booked distance. Support handles exceptions such as a closed road.
- In-app chat and voice are in the alpha. Vendor tools are deferred.

## Build order

1. **Backend foundation.** Start a runnable HTTP service and fare calculation with a smoke check. Then add local PostGIS and Redis, migrations, and a server-side routing integration with Redis caching. Verify the service can quote from street distance with Redis available or unavailable.
2. **Identity and order creation.** Connect the customer and rider signup paths to the backend. Add customer guest sessions and checkout OTP, rider identity verification, and server-enforced role access. Persist an order with the server-calculated route and fare floor.
3. **Dispatch and bidding.** Notify eligible nearby riders, stream bid state, support counters and expiry, and assign the order atomically. Verify competing accepts cannot create two trips.
4. **Trip and communications.** Connect the Flutter app to the delivery flow. Add background GPS, reconnect sync, chat and voice, cancellation and no-show handling, and rider-marked completion. Verify on two phones.
5. **Reviews, disputes, and money.** Add optional reviews, non-delivery complaints, admin case handling, and sandbox collection, refunds, ledger, cash commission, and next-day payout jobs. Confirm provider support for collection and release before integrating payments. Decide how complaints affect funds before and after payout, and verify retries cannot double-pay.
6. **Account lifecycle and staff access.** Add 30-day recovery, a 120-day archive with audited exports and automatic purge, separate customer and rider profiles, and multi-role staff authorization. [Account lifecycle specification](docs/ACCOUNT_LIFECYCLE.md)
7. **Pilot readiness.** Confirm mobile launch platforms, hosting ownership, and providers. Configure staging and production, deploy migrations, test backups and recovery, and field-test Port Harcourt routes and poor-network scenarios before opening the pilot.

## Current checkpoint

The API calculates street-route quotes using Mapbox Directions and the PRD's
initial ₦150/km fare floor. Redis can cache route estimates with a provider
fallback. Verified customers can create pending orders in PostgreSQL/PostGIS
with retry protection. Live Mapbox testing needs a configured token. Guests can quote, then sign in and verify
their phone before ordering. Admins can record rider identity decisions after
external review. Nearby discovery, counteroffers, expiry, live snapshots, and
transactional assignment are implemented in the API. The customer app can search
places, quote, place cash or card orders, reopen recent orders, and accept rider
counteroffers. Booking supports place search and pin selection with configured map tiles. The rider app supports foreground availability,
nearby orders, claiming and counteroffers, pickup, and completion. Smile ID sandbox onboarding is implemented for rider NIN and driver’s
licence checks, with staff review before dispatch approval. Live Smile ID sandbox
verification, native device acceptance, and production rollout remain open.
Assigned trips support pickup,
latest-position tracking snapshots, and rider-marked completion. The mobile
rider can start trip GPS sharing, and the customer can view live positions
and update times. Native background and reconnect acceptance remains open. Trip recovery
supports pre-pickup re-bidding, no-show handling, and an admin alert queue
for tracking dropouts and post-pickup support requests. Chat and voice use
assignment-scoped PostgreSQL records. The conversation receives chat and trip
status over WebSocket, with Redis presence and cross-instance notifications.
Voice uses audio-only TURN-relayed WebRTC. Native
two-device chat and voice acceptance remains open. Reviews and non-delivery
reports are available on completed trips, with an admin resolution queue.
Account recovery, encrypted archives, timed purge, separate profiles, and
staff roles are implemented. Production automatic purge requires running the
maintenance worker with its archive key. Bachs sandbox checkout, the payment ledger, 06:00 WAT next-day payout
processing, and dispute refunds are implemented. Real Bachs sandbox acceptance
remains open. Cash commission accrual, Bachs repayment, and the overdue dispatch
block are implemented. [Payment spec](docs/PAYMENTS.md)

The local PostgreSQL backup and restore drill is documented in the README.
Staging recovery, backup retention, and hosting ownership remain open.

## Mobile design reference

See the [mobile UI guide](design/MOBILE_UI_GUIDE.md) for the map, rider offer,
and confirmation layouts.

Use the [saved screenshot](design/mobile-app-reference.png) as a visual reference for map-led pickup and drop-off selection, trip tracking, and message and call controls. Adapt the ride-booking example to the Fast Logistics delivery flow.

## Mobile implementation requirements

- Use the Fast Logistics blue palette with a dark default theme and a white light theme. Keep colors and common styles in the shared Flutter theme. Follow the [mobile UI guide](design/MOBILE_UI_GUIDE.md) for layouts.
- Keep screen widgets focused and extract components shared across customer and rider flows.
- Treat signup routing as presentation. The API must verify identity and enforce roles and ownership on every protected operation. Store session secrets with platform-backed secure storage. Keep provider credentials on the backend and avoid logging tokens or sensitive user data.

Redis cache names and usage are defined in the [cache registry](docs/REDIS_CACHE.md).

## Authentication checkpoint

The API, mobile app, and admin dashboard share PostgreSQL-backed authentication.
Customer and rider registration is public. Admin accounts are provisioned through
the operator command. Accounts can verify email and phone, manage their display
name, and reset or change their password. A second rider sign-in is rejected
while the first session is active.

Wire the production SMS and email relay before enabling live verification or
password recovery. The current checkout converts guests to signed-in, phone-verified customers
before creating an order.

Redis GEO versus PostGIS dispatch performance remains [open for further measurements](docs/REDIS_CACHE.md#dispatch-geospatial-benchmark).
