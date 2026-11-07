# Fast Logistics build plan

The PRD supplies product context. This is a fresh build. The historical progress report describes a separate, unverified implementation.

## Decisions

- The monorepo keeps the API in `apps/api` and the Flutter apps in `apps/customer` and `apps/rider`. Mobile work uses separate branches that integrate into `main`.

- Separate Flutter customer and rider apps, Next.js admin, and one Node.js/TypeScript backend with a worker for scheduled jobs.
- PostgreSQL/PostGIS owns durable state. Redis caches derived data such as route estimates. Cache misses and outages fall back to the source.
- The rider marks delivery complete. The customer may then leave a review or report non-delivery.
- Digital rider earnings are scheduled for the beginning of the following local day in Africa/Lagos. Decide the exact batch time, cutoff, and dispute rules before live payouts.
- In-app chat and voice are in the alpha. Vendor tools are deferred.

## Build order

1. **Backend foundation.** Start a runnable HTTP service and fare calculation with a smoke check. Then add local PostGIS and Redis, migrations, and a server-side routing integration with Redis caching. Verify the service can quote from street distance with Redis available or unavailable.
2. **Identity and order creation.** Add guest sessions, checkout OTP, rider onboarding and verification, and role-scoped access. Persist an order with the server-calculated route and fare floor.
3. **Dispatch and bidding.** Notify eligible nearby riders, stream bid state, support counters and expiry, and assign the order atomically. Verify competing accepts cannot create two trips.
4. **Trip and communications.** Connect the Flutter apps to the delivery flow. Add background GPS, reconnect sync, chat and voice, cancellation and no-show handling, and rider-marked completion. Verify on two phones.
5. **Reviews, disputes, and money.** Add optional reviews, non-delivery complaints, admin case handling, and sandbox collection, refunds, ledger, cash commission, and next-day payout jobs. Confirm provider support for collection and release before integrating payments. Decide how complaints affect funds before and after payout, and verify retries cannot double-pay.
6. **Pilot readiness.** Confirm mobile launch platforms, hosting ownership, and providers. Configure staging and production, deploy migrations, test backups and recovery, and field-test Port Harcourt routes and poor-network scenarios before opening the pilot.

## Current checkpoint

The HTTP service and fare-floor check are runnable locally. Persistence, Redis, provider integrations, and clients are pending. The initial fare rate comes from the PRD example. The quote accepts a distance for local verification. Before accepting orders, the backend must obtain the street distance from its routing provider.

## Mobile design reference

Use the [saved screenshot](design/mobile-app-reference.png) as a visual reference for map-led pickup and drop-off selection, trip tracking, and message and call controls. Adapt the ride-booking example to the Fast Logistics delivery flow.
