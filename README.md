# Fast Logistics

A fresh build of the Port Harcourt bike delivery platform. See [the build plan](BUILD_PLAN.md) for the approved delivery and payout flow and the implementation sequence.

## Run locally

Use Node.js 24 or later.

```sh
npm test
npm start
```

```sh
curl http://127.0.0.1:8080/healthz
```

## Local PostgreSQL and Redis

Run from the repository root with Docker Compose.

```sh
docker compose up -d --wait
docker compose ps
docker compose down
```

- PostgreSQL/PostGIS connects at `postgresql://fastlogistics:fastlogistics_local@127.0.0.1:15432/fastlogistics`.
- Redis connects at `redis://127.0.0.1:16379`.

Both ports bind to localhost and can be overridden with `POSTGRES_PORT` and
`REDIS_PORT`. The credentials are for local development.
PostgreSQL keeps its data in a named volume when Compose stops. Redis runs as
a disposable cache with persistence disabled.

## Monorepo

- `apps/api` contains the Node.js and TypeScript backend.
- `apps/admin` contains the Next.js operations dashboard.
- `apps/mobile` contains the shared Flutter app for Android and iOS. Customers and riders choose their own onboarding path at signup.

From `apps/mobile`, run `flutter pub get`, `flutter test`, or `flutter run`.

Use `main` as the integration branch. The `mobile/customer` and `mobile/rider`
branches are for role-specific work in the same app. Sync with `main` to pick
up shared changes.

## Landing page

`apps/web` is the public website, as static files that any host can serve. Preview
it with `npm run dev:web` and open `http://127.0.0.1:8092`. The host must support
range requests for video playback.

The waitlist form posts to `POST /waitlist` on the API. In production, route
`POST /waitlist` on the public website to the API. If hosting the API on a
separate domain, set the form's `action` in `apps/web/index.html` to its HTTPS
URL and add the website origin to `WAITLIST_ORIGINS`. Apply migration
`015_waitlist.sql`. Administrators see signups and remove people under **Waitlist**
in the admin dashboard. Run `DATABASE_URL=… node apps/api/checks/waitlist.ts` against
a fresh, migrated test database to exercise the flow.

`apps/web/media/walkthrough.mp4` is a recording of the real app running in preview
mode. After a visible app change, build the preview as in
[Mobile design preview](#mobile-design-preview) using `flutter build web --profile`
and the same `--dart-define` values, then run `node scripts/app-video/record.mjs`.
It needs Google Chrome and briefly opens an off-screen window. If screen timings
change, update each `data-at` value in `apps/web/index.html` from the new
`apps/web/media/chapters.json`.

## Admin dashboard

From the repository root, run `npm install` and `npm run dev:admin`.
Open `http://127.0.0.1:3000`. Run `npm run build:admin` for a production build.

The dashboard currently displays a static operations overview. Add server-side
admin authentication and authorization before connecting operational data.

## Authentication

1. Run `docker compose up -d --wait` and apply the auth migration:

   ```sh
   for migration in apps/api/migrations/*.sql; do
     docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fastlogistics -d fastlogistics < "$migration" || exit 1
   done
   ```

2. Copy `.env.example` to `.env`, set `AUTH_CODE_SECRET` with
   `openssl rand -hex 32`, and run `npm run start:env -w fast-logistics`.
   For local testing, set `AUTH_DEV_CODES=1` and read verification and reset
   codes from the API process output. In production, set
   `AUTH_DELIVERY_WEBHOOK` and `AUTH_DELIVERY_TOKEN`. The relay receives a
   bearer-authenticated JSON POST with `purpose`, `channel`, `recipient`,
   and `code`. Configure it to deliver SMS or email using your providers.
3. For admin access, provision an account with
   `npm run auth:admin -w fast-logistics` and supply `ADMIN_EMAIL`,
   `ADMIN_PHONE` (international format), `ADMIN_NAME`, and `ADMIN_PASSWORD`
   in the command environment. Admin accounts are provisioned through this
   command. Public registration creates customer and rider accounts.
4. Run `npm run dev:admin` for the web dashboard. On Android emulator,
   `flutter run` from `apps/mobile` uses `10.0.2.2:8080` in debug mode.
   Release mobile builds require `--dart-define=AUTH_API_URL=https://…`.
   Use HTTPS for admin and mobile production traffic.

New accounts verify email and phone from their profile. Password recovery uses
a verified email. Password updates and resets revoke existing sessions. A rider
with an active session gets HTTP 409 on a second sign-in. Sign out on the
original device, reset the password via verified email, or wait for the
24-hour session to expire before signing in elsewhere. Keep auth state in
PostgreSQL and periodically purge expired sessions, codes, and rate-limit
buckets. The Redis instance is for disposable cache data.

To rerun the API auth integration check, apply the migration to a fresh test
database and run `DATABASE_URL=… node apps/api/checks/auth.ts`. The check
creates a synthetic rider and exercises concurrent sign-in and account recovery.


## Delivery quotes and orders

Set the server-only `MAPBOX_ACCESS_TOKEN` in `.env`. Set
`ROUTE_CACHE_TTL_SECONDS=60` to enable Redis for local testing where permitted
by your provider terms. The API falls back to Mapbox when Redis is unavailable.

Guests can request a quote without a token. A quote accepts coordinates and
returns distance in meters, the fare floor in kobo, and currency `NGN`.

```sh
curl -fsS http://127.0.0.1:8080/orders/quote \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pickup":{"latitude":4.81,"longitude":7.01},"dropoff":{"latitude":4.82,"longitude":7.02}}'
```

To place an order, sign in as a customer, verify your phone using the SMS code,
and POST the same coordinates plus `offeredFareKobo` to
`/orders`. The customer must have a verified phone. Send a fresh UUID in
`Idempotency-Key` for each new order and reuse it with the same payload on
retries. A new order returns 201 with status `pending_dispatch`. A replay
returns the original order with 200. Reusing the key with a changed payload
returns 409. The API rejects below-floor offers with 422.


## Dispatch and bidding

Apply all migrations before using these endpoints. Dispatch uses a 60-second
bidding window, a 5 km pickup radius, and a two-minute rider location freshness
limit for the pilot. Refresh availability before that limit elapses.

| Endpoint | Caller | Payload or result |
| --- | --- | --- |
| `POST /dispatch/riders/{riderId}/identity` | Verified admin | Record the rider identity decision. With Smile ID configured, approval requires both checks to clear and staff to confirm they identify the same person. |
| `PUT /dispatch/availability` | Approved rider | Set `available` and include a `location` with latitude and longitude when going online or refreshing. |
| `GET /dispatch/nearby` | Rider | List available orders within pickup range. |
| `POST /orders/{id}/bids` | Eligible rider | Submit or replace a counteroffer with `fareKobo`. |
| `GET /orders/{id}/bids` | Order owner | Read the current bids, expiry, and assignment. |
| `POST /orders/{id}/claim` | Eligible rider | Send an empty JSON object to claim at the original fare. |
| `POST /orders/{id}/accept` | Order owner | Accept a counteroffer using its `bidId` and displayed `fareKobo`. |

Append `/stream` to either GET endpoint for authenticated server-sent
snapshots. Streams close after roughly 24 seconds. Reconnect to resume.
A claim or accepted counteroffer assigns one rider and takes them out of
dispatch availability. Expired orders stop appearing in nearby results.
PostgreSQL stores bids, eligibility decisions, and assignments.

Use a fresh, migrated test database with
`DATABASE_URL=… node apps/api/checks/dispatch.ts` to exercise the flow.

## Trip lifecycle and tracking

A trip uses its assigned order ID. The customer and assigned rider can read
`GET /trips/{id}` or subscribe to `GET /trips/{id}/stream` with their bearer
token. Each snapshot includes status, pickup and drop-off, the agreed fare,
and the latest rider location with its timestamp when available.

- The assigned rider uses `POST /trips/{id}/pickup` to move from `assigned`
  to `picked_up`, then `POST /trips/{id}/complete` to mark delivery complete.
  Repeating a completed transition returns the saved state.
- While assigned or picked up, the rider sends
  `POST /trips/{id}/location` with
  `{"location":{"latitude":4.81,"longitude":7.01},"recordedAtMs":1780000000000}`.
  Use the device's current observation time in Unix milliseconds. The API
  rejects stale, out-of-order, and implausible jumps between accepted points.
- Completion clears the last tracking point and allows the rider to go
  available again. The customer can read completion without confirming it.

The Docker-backed dispatch check also exercises trip access, location
streaming, completion, and rider availability.

## Road routes

Every route line and distance comes from Mapbox Directions road geometry. If a
provider response has no road geometry, the app shows the two pins and no line.
It never joins them with a straight line.

- A quote returns the road `path` and `distanceMeters`. The fare floor uses that
  distance, and the order keeps it fixed.
- While the rider shares GPS, the API keeps a live road route from the rider to
  the next stop. Two readings in a row more than 50 m from the route count as a
  missed turn, and the API then finds a new road route from the rider's position.
  It reroutes at most once every 20 seconds per trip.
- `GET /trips/{id}/route` returns the current route to the customer and assigned
  rider. A changed `routeUpdatedAt` in the trip snapshot means there is a new one.
- A new route never changes the booked distance or the agreed fare.

Apply migration `013_trip_routes.sql`. Run
`DATABASE_URL=… node apps/api/checks/trip-route.ts` against a migrated test
database to exercise the flow.

## Arrival and rider actions

Trip snapshots include `atStop`, which is `pickup` or `dropoff` while the rider's
recent GPS is within 100 m of the next stop. The rider gets one alert per stop, with
quick **Call customer** and **Message customer** actions, and the customer sees that
the rider has arrived.

If the phone is locked or the app is in the background, the rider gets a notification
instead, with **Call** and **Message** buttons. It shows no address. The app detects
arrival from its own background GPS, so no push service is needed. This has limits:

- It only works while **Share trip location** is on, and the rider's trip screen is
  still open behind the lock screen or another app.
- Force-quitting the app ends the GPS stream, so no alert can follow.
- Notifications must be allowed. The app asks when sharing starts, and says so if
  alerts are off.
- Customers only see the arrival with the app open. Alerts on a customer's locked
  phone need a real push service, which is not built.

The **More actions** menu on the rider's trip covers calling and messaging,
navigation in Google Maps, reporting a problem, marking the customer unavailable
after the 10-minute drop-off wait, cancelling or asking support to step in, and
calling 112.

`POST /trips/{id}/issues` records a rider report with a `category` and optional
`details`. Reports appear under **Rider reports** on the admin dashboard, safety
reports first, for staff with the recovery operator role. Apply migration
`014_trip_issues.sql`.

## Trip recovery

- The assigned rider can use `POST /trips/{id}/cancel`. Before pickup, the
  API reopens the order for 60 seconds, clears old bids, and records the
  cancellation. The departing rider cannot reclaim the same order.
- After ten minutes without GPS updates, trip snapshots show
  `trackingDropout`. The order owner can use `POST /trips/{id}/replace`.
  Before pickup this reopens bidding. After pickup, cancellation or
  replacement requests go to support while the original assignment stays
  in place.
- Verified admins can see tracking interruptions and support requests on
  the dashboard or at `GET /trips/recovery-alerts`. Alerts reflect the
  current state when read.
- After pickup, a rider within 100 m of the drop-off starts a ten-minute
  no-show wait. Leaving the area or losing fresh tracking restarts the
  wait. The assigned rider can then use `POST /trips/{id}/no-show` to
  record `customer_unavailable` and release the rider for other work.
- Two pre-pickup rider cancellations within 24 hours delay the rider's
  access to new bidding rooms by ten seconds. No-shows carry no such penalty.

## Trip chat and voice

In the Flutter app, sign in as the customer or assigned rider and open
**Menu → Active trips**. Open the same assignment on both devices.
The conversation receives new messages, call signaling state, and delivery
status over an authenticated WebSocket at `/trips/{id}/comms/ws`. The API
keeps message sends and history on HTTP and stores messages in PostgreSQL.
A replacement rider starts with a separate conversation.

Set `REDIS_URL` for cross-instance updates and expiring connection presence.
Configure the staging and production proxy to forward WebSocket upgrades over
HTTPS. The server reconciles the snapshot every 15 seconds so it can recover
missed events or changes made by workers. Run
`node apps/api/checks/trip-realtime.ts` with a disposable migrated database and
Redis to verify cross-instance messaging, trip status, and presence cleanup.

Voice calls use the device microphone and audio-only WebRTC over authenticated
TURN. Both participants need the trip conversation open for incoming calls.
Start a voice call from the Messages app bar. The full-screen incoming,
outgoing, and connected call views provide answer or decline, cancel, and
mute or hang up, respectively. Allow microphone access when prompted. Completing or reopening a trip ends its signaling
session. The API stores call setup descriptions for the active assignment and
does not record audio.

For Linux development, configure these in the repository's `.env`:

- `TURN_LISTEN_IP` is the host interface address reachable by the test devices.
- `TURN_SHARED_SECRET` is an independent random secret from `openssl rand -hex 32`.
- `TURN_URLS` is the client-visible URL, such as
  `turn:<host-ip>:3478?transport=udp`. If `TURN_PORT` is set, use that port here.

Start the local relay with
`docker compose -f compose.yaml -f compose.turn.yaml up -d turn`. For
cross-network device tests, set `TURN_URLS` to a reachable TURN service with
the same shared secret. Keep the API on HTTPS for mobile release clients.
The Compose overlay is intended for a controlled development network.

Run `DATABASE_URL=… TURN_SHARED_SECRET=… TURN_URLS=… node apps/api/checks/comms.ts`
against a fresh, migrated test database with Chrome installed. It opens two
authenticated browser peers, exchanges persisted chat, and checks received
audio over TURN using a generated input waveform. Native handset acceptance
also requires a customer and rider to exchange messages and hear each other on
two devices using their microphones and speakers.

## Reviews and non-delivery reports

Customers can open **Menu → Reviews and reports** in the Flutter app.
Each rider-completed delivery supports one optional rating and comment and one
independent non-delivery report. The customer can view their report status
and the admin's resolution summary.

Verified admins can open **Disputes** from the dashboard to review open reports
and uphold or dismiss them. The API records the deciding admin and timestamp.
Upholding a report on a collected digital payment queues a refund through the
Bachs payment worker.

- `GET /trips/feedback` lists the signed-in customer's recent completed trips.
- `GET /trips/{id}/feedback` returns the customer's review and report.
- `POST /trips/{id}/review` accepts `rating` from 1 to 5 and optional `comment`.
- `POST /trips/{id}/dispute` accepts non-delivery `details`.
- `GET /admin/disputes` lists open cases for verified admins.
- `POST /admin/disputes/{id}/resolve` accepts `decision` of `upheld` or
  `dismissed` and a customer-visible `resolution`.

## Account lifecycle and staff access

After applying the migrations, set `ACCOUNT_ARCHIVE_KEY` in `.env` using
`openssl rand -hex 32`. Use the same key for the API and the lifecycle worker.
Start the worker alongside the API with
`npm run accounts:maintain -w fast-logistics`. It checks the 30-day recovery and
120-day archive deadlines automatically. A single pass is available with
`npm run accounts:maintain -w fast-logistics -- --once`.

The admin dashboard provides **Archives** and **Staff roles** to users with
the corresponding permissions. See the [lifecycle specification](docs/ACCOUNT_LIFECYCLE.md)
for data handling, staff permissions, and operational requirements.

## Bachs payments

The API supports sandbox checkout, verified collections, next-day rider
payouts, and refunds for upheld non-delivery reports. See the
[payment setup and acceptance checklist](docs/PAYMENTS.md).

## Mobile design preview

Run every mobile screen in Chrome with sample data and no backend. Preview mode
is excluded from release builds.

```sh
cd apps/mobile
flutter run -d chrome --dart-define=APP_PREVIEW=true \
  --dart-define='TRIP_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png' \
  --dart-define='TRIP_MAP_ATTRIBUTION=© OpenStreetMap contributors'
```

The preview opens signed out on the welcome screen. Sign up as either role with
any details, using any six digits as the phone code. Signing in with an email
containing `rider` opens the rider app. Routes use real roads from the public OSRM
demo router, and the sample rider misses a turn once, about 18 seconds into a trip. The public OpenStreetMap tile server is for this
preview only. Use a contracted tile provider in production. Chat works with
sample replies, and voice calls need two real devices.

## Place search

`GET /places/search?q=…` and `GET /places/reverse?latitude=…&longitude=…` use
Mapbox Geocoding through the server-only `MAPBOX_ACCESS_TOKEN`, limited to
Nigeria. Apply migration `012_order_place_labels.sql`, which stores the pickup and
drop-off names on each order. Confirm that your Mapbox plan permits storing
geocoding results before launch.

## Mobile customer booking

Sign in as a customer. The home screen opens on the map with the pickup under the
pin. Tap **Where to & for how much?**, search for or pin the drop-off, set your
offer, choose cash or card, and tap **Find riders**. Rider offers appear on the
next screen, and you confirm the rider, fare, and payment before accepting.
**Menu → Delivery history** reopens recent orders.

For card orders, use **Pay with Bachs**, then **Check payment** after returning
from checkout. Explicit card orders require verified collection before the
rider can mark pickup.

## Mobile rider dispatch

Sign in as an approved rider. The home screen is dispatch. Tap
**Go available** and grant foreground location access. The screen refreshes
the rider location while open, shows eligible nearby orders, and lets the
rider claim the offered fare or send a counteroffer. A rider with overdue
cash commission sees the dispatch restriction on this screen.

Open **Assigned delivery** after a claim or accepted counteroffer. The rider
can mark pickup and confirm delivery completion. Card trips show a waiting
state until the API confirms collection. The assigned trip also links to
the customer conversation.

Dispatch availability expires when the API has no fresh location for two
minutes. This screen does not collect background location. Device acceptance
still needs a rider and customer to test assignment and completion together.

## Mobile trip tracking

On an assigned delivery, the rider turns on **Share trip location**. The app
streams GPS to the trip API and retries the newest recent point after a
connection interruption. The rider can stop sharing. Sharing also stops
when the trip finishes or the rider leaves the assigned delivery screen.

The customer opens **Delivery history → Track delivery** to see the rider's
last position, update time, and stale or interrupted tracking status.
For the booking and tracking maps, configure an approved HTTPS raster
tile template and its attribution:

```sh
flutter run \
  --dart-define='TRIP_MAP_TILE_URL=https://your-tile-host/{z}/{x}/{y}.png' \
  --dart-define='TRIP_MAP_TILE_URL_DARK=https://your-tile-host/dark/{z}/{x}/{y}.png' \
  --dart-define='TRIP_MAP_ATTRIBUTION=Your map provider attribution'
```

Use only publishable credentials in the tile template. Without tiles,
tracking still shows the last update time and trip status.

Android uses a foreground location service with a notification for an active
trip. iOS declares background location for an active stream. Start sharing
while the assigned delivery screen is visible. Reconnect recovery keeps the
latest point in memory. A force-quit ends the stream and requires the rider
to reopen the trip and start sharing again.

Native acceptance remains open. On two phones, verify that a customer can
see a rider move, that updates continue with the rider phone locked, that the
latest position returns after reconnecting, and that completion ends
location sharing.


### Rider identity verification

The shared mobile app opens Smile ID hosted checks for Nigerian NIN with
biometrics and a Nigerian driver’s licence. Staff compare the two results in
Smile ID and record the decision in the admin dashboard. Fast Logistics stores
check status and provider references, while document images and biometrics
stay with Smile ID.

Apply migration `011_rider_identity_checks.sql`. Set
`SMILE_SANDBOX_PARTNER_ID` and `SMILE_SANDBOX_API_KEY` to the Smile ID sandbox
credentials. Set `SMILE_CALLBACK_SECRET` to a random secret of at least 32
characters, `SMILE_CALLBACK_BASE_URL` to the public HTTPS API origin, and
`SMILE_PRIVACY_URL` to the public HTTPS privacy policy. Leaving the partner ID
unset preserves the external review workflow. Smile ID sandbox approval is
disabled in production.

Run `node apps/api/checks/rider-identity.ts` against a fresh migrated test
database via `DATABASE_URL` to exercise the API and database with controlled
Smile ID responses. Live sandbox acceptance requires the hosted links, provider
callbacks and staff review to work together with the configured Smile ID account.
See the [Smile ID Smile Links API](https://github.com/smileidentity/api-reference/blob/main/specs/v3/v3-smile-links.yaml).

## PostgreSQL backup and restore drill

Run from the repository root with local Compose PostgreSQL running and all
migrations applied. Use a private directory for the backup because it contains
account, delivery, and payment data.

```sh
umask 077
backup_dir=$(mktemp -d)
docker compose exec -T postgres pg_dump -U fastlogistics -Fc fastlogistics \
  > "$backup_dir/fastlogistics.dump"
bash scripts/check-postgres-backup.sh "$backup_dir/fastlogistics.dump"
```

Use only a trusted dump. The drill restores into a temporary database, runs a
PostGIS distance query, prints counts for key tables, and removes the restored
database on exit. Redis is disposable. Keep the matching
`ACCOUNT_ARCHIVE_KEY` separately in the secret store to decrypt account archives
after recovery. Delete the local dump when the drill ends.

Before the pilot, repeat recovery on an isolated staging cluster, validate
the restored app and archive decryption, and record the recovery time. Set
production backup access, retention, and recovery objectives with the hosting
owner.
