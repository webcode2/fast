# Fast Logistics — Progress Report

**Product:** Hyper-local bike delivery marketplace for Port Harcourt, Nigeria  
**Version:** `0.1.0-alpha`  
**Date:** 6 September 2026  
**Sources:** `FastLogistics_PRD_Alpha_v4_Integrated_260718_032928.pdf`, `docs/PRD_ANALYSIS.md`, `docs/ARCHITECTURE.md`, current source

Overall platform estimate: **~65% complete** (vendor excluded from this build). Backend domain and gateway are far ahead of Flutter clients, live third-party providers, and the **messages/call engine** (required, not started).

**Scope change (6 Sep 2026):** Vendor is **EXCLUDED FROM ALPHA BUILD** — `services/vendor` and `web/vendor-portal` stay in the repo but are not compiled or started by `npm run build` or `docker compose up`. Opt in later with `docker compose --profile vendor up`.

---

## Feature inventory — what it is and how it was built

| Feature | How it was built |
|---|---|
| **Guest auth (device UUID)** | Gateway `POST /auth/guest` issues a device-UUID identity and JWT. Flutter customer app has a guest button but navigates to `Placeholder()` after login. |
| **Phone + OTP** | Gateway `POST /auth/otp/request` and `/verify`. Termii adapter is a stub that logs the code in dev. Customer OTP UI is a TODO. |
| **Fare floor ₦150/km** | `packages/core/src/pricing.ts` (`computeFareFloor`, `assertOfferAtOrAboveFloor`). Gateway computes street distance on `POST /orders` and rejects below-floor fares. Mapbox is a haversine×1.3 fallback. |
| **60-second P2P bidding** | Typed WS protocol in `packages/core/src/ws-protocol.ts`. Realtime service on `:8090` handles claim / counter / accept. Bid-expiry sweep every 10s. `bids.room.state` is defined and listened for in Flutter but **never emitted**. |
| **Live radar tracking** | Rider sends `tracking.location` over WS; server runs anti-spoof then broadcasts `tracking.update`. Flutter tracking screen exists; Mapbox tile token is `YOUR_TOKEN`. Rider `sendLocation()` is a comment stub. |
| **Rider ratings (1–5★)** | `reviews` table with CHECK 1–5. Gateway `POST /trips/:id/review`. Bid packets include `riderRating` and `riderTripsCompleted`. |
| **Rider KYC** | `services/kyc` workflow: license → NIN → biometric. `KycProvider` seam; mock always verifies. Flutter KYC wizard exists but calls gateway `/kyc/*` instead of `:8092`. |
| **Background geolocation** | Server anti-spoof is ready. Flutter rider app has no working background GPS; `sendLocation` does not send over WS. |
| **Super Admin portal** | Next.js 14 + Tailwind: `/login`, `/` telemetry, `/config`, `/settlements`, `/riders`, `/orders`. Talks to gateway admin routes. Missing `GET /admin/commissions`. EOD button hits the wrong host/path. |
| **Vendor catalog + order feed** | **EXCLUDED FROM ALPHA BUILD.** Scaffold remains (`services/vendor`, `web/vendor-portal`). Not in `npm run build` or default Compose. |
| **In-app messages + calls** | **Required · not started.** No chat tables, no call signaling, no Flutter inbox/call UI. Needs a dedicated comms engine (design pending). |
| **Commission 10–15%** | `computeCommission` in `@fast/core`, clamped 10–15%. Escrow row written when a bid is accepted. |
| **Digital escrow** | `services/payments` hold → release. Released on `POST /orders/:id/confirm-delivery`. Paystack/Monnify is a mock. |
| **Cash EOD settlement** | `packages/core/src/settlement.ts` + payments EOD job at 23:55. Unpaid riders are blocked at bid-claim. `POST /payments/settle` unblocks. |
| **GPS dropout (10 min)** | Realtime loop flags trip + order and emits `trip.status` = `dropout_flagged`. No FCM customer/admin alert (FCM is a no-op stub). |
| **Post-accept cancellation** | Rider cancel via `POST /trips/:id/transition` returns the order to `open_for_bids`. Visibility-score decay exists in domain; not fully applied at bid broadcast. |
| **Customer no-show** | Gateway `POST /trips/:id/customer-unavailable` exists. Documented `guardrails/noshow.ts` **does not exist** — no 10-min geofence countdown. |
| **Collusion shadowban** | Algorithm in `packages/core/src/collusion.ts` + `collusion_pairs` table. **Not called** from gateway or realtime. |
| **Anti-spoof GPS** | `packages/core/src/antiSpoof.ts` velocity/jump gates, enforced on WS location packets. Device mock-location / root checks are not in the Flutter apps. |
| **NDPR delete account** | Gateway `DELETE /auth/account` obfuscates PII. KYC `media_cleared` flag after verdict. Financial rows kept. |
| **Geolocation consent** | Documented in PRD map. No real consent UI in either Flutter app. |
| **Nearby riders** | Gateway `GET /riders/near` + PostGIS / in-memory radius query. |
| **Wallet + ledger** | Gateway `GET /payments/wallet`. Rider earnings screen exists. Settlements list calls a path that lives on the payments microservice, not the gateway. |
| **Webhooks** | Gateway `POST /webhooks/payments` and `/webhooks/kyc`. |
| **Observability** | Pino JSON logs, request IDs, `AppError` codes, `/healthz` + `/readyz` on Express services. |
| **Infra** | Docker Compose: Postgres 16 + PostGIS, Redis 7, gateway / realtime / payments / kyc. Vendor service is profile-gated. In-memory store/bus for zero-config local boot. |

---

## What is complete

These are implemented, wired on the critical path, and (for domain logic) covered by unit tests.

| Area | Status | Where |
|---|---|---|
| Domain types, money, geo, config, errors, RBAC, JWT | Complete | `packages/core` |
| Fare floor + commission math | Complete + tested | `pricing.ts` |
| Order / trip state machines | Complete + tested | `packages/core/src/state` |
| Settlement eligibility + EOD math | Complete + tested | `settlement.ts` |
| Anti-spoof + collusion **algorithms** | Complete + tested | `antiSpoof.ts`, `collusion.ts` |
| In-memory DataStore + EventBus | Complete + tested | `packages/core/src/db/memory.ts` |
| Postgres / PostGIS schema | Complete | `infra/postgres/init/001_schema.sql` |
| PostgresDataStore implementation | Written (unverified by integration test) | `packages/core/src/db/postgres.ts` |
| Auth: guest, register, login, OTP, refresh, NDPR delete | Complete (OTP via stub) | `services/gateway/src/routes/auth.ts` |
| Orders: create, list, accept, confirm, cancel | Complete | `services/gateway/src/routes/orders.ts` |
| Trips: transition, review, customer-unavailable HTTP | Complete | `services/gateway/src/routes/trips.ts` |
| Admin: telemetry, config, settlements, block rider, flags, orders | Complete (minus commissions route) | `services/gateway/src/routes/admin.ts` |
| Bidding WS: claim, counter, accept, expiry | Complete | `services/realtime/src/main.ts` |
| Tracking WS + anti-spoof + dropout flag | Complete (flag only) | same |
| Escrow + daily EOD job + rider block | Complete | `services/payments` |
| Express bootstrap, health, auth middleware | Complete | `packages/server` |
| Gateway smoke test (in-memory critical path) | Complete | `services/gateway/src/__tests__/smoke.test.ts` |
| 61 `@fast/core` unit tests | Complete | `packages/core/src/*.test.ts` |
| Docker Compose for PostGIS + Redis + 4 alpha services | Complete | `infra/docker-compose.yml` (vendor profile-gated) |

---

## What has been done but is not finished

| Area | Done | Still open |
|---|---|---|
| **Realtime bidding room** | Claim / counter / accept / expiry | Never sends `bids.room.state`; no region filtering of riders |
| **Admin portal** | Six Next.js pages + login + API client | `GET /admin/commissions` missing; EOD button calls gateway instead of `payments /api/settlement/run` |
| **Customer Flutter app** | Auth, home+map, bid room, tracking screens | Post-guest nav is `Placeholder()`; phone OTP TODO; Mapbox `YOUR_TOKEN`; `uuid` not in pubspec; `WebSocketChannel` import missing |
| **Rider Flutter app** | Auth, KYC, dashboard, trip, earnings | Post-KYC nav is `Placeholder()`; `sendLocation` stub; KYC/settlement URLs hit gateway; open orders fetched from `/admin/orders` |
| **KYC microservice** | Start + status + mock provider | Always-verify mock; no Smile ID/Prembly; clients call the wrong host |
| **Vendor service + portal** | Scaffold exists | **EXCLUDED FROM ALPHA BUILD** — not in remaining work |
| **Provider seams** | Interfaces + offline stubs | Setting real keys **throws** (“adapter not implemented”) for Mapbox, Termii, FCM |
| **Postgres runtime** | Full store (~900 lines) | `postgres.integration.test.ts` missing; Postgres event bus throws |
| **Guardrails** | Dropout detector + no-show HTTP | No-show countdown job missing; collusion unused; FCM alerts missing |

---

## Yet to be done

Priority order for a working alpha:

1. **Messages / call engine** — in-app chat + voice (or audio) between customer and rider. Not started; design next.
2. **Emit `bids.room.state`** on customer WS join and after each bid so the Flutter bid room can render.
3. **Fix Flutter auth navigation** — guest/KYC success → Home / Dashboard, not `Placeholder()`.
4. **Unify API routing** — proxy `/kyc` and payments settlement through the gateway, or point clients at `:8091` / `:8092`.
5. **Rider GPS** — background location + real WS `tracking.location` send; replace `YOUR_TOKEN`.
6. **Wire collusion** — call `collusion.ts` on accept-then-cancel; persist `collusion_pairs`; shadowban at bid-claim.
7. **No-show countdown** — 10-min dropoff geofence job (`guardrails/noshow.ts`).
8. **Phase F tests** — realtime / payments / kyc suites + Postgres integration test (vendor suite excluded).
9. **Real providers** — Mapbox Directions, Termii SMS, FCM, Smile ID/Prembly, Paystack/Monnify.
10. **Offline + consent** — Hive batch-sync (R16) and explicit geolocation consent (R20).
11. **Postgres event bus** — or keep Redis-only and document that.

---

## PRD scorecard (R1–R20)

| # | Requirement | Status |
|---|---|---|
| R1 | Guest-mode auth | **Partial** — backend done; Flutter nav broken |
| R2 | Realtime bidding | **Partial** — room-state event missing |
| R3 | Fare floor ₦150/km | **Complete** (stub routing) |
| R4 | Live radar tracking | **Partial** — map token + GPS send |
| R5 | Rider ratings | **Complete** (thin client UX) |
| R6 | Automated KYC | **Partial** — mock + wrong client host |
| R7 | Background GPS | **Not wired** |
| R8 | Super Admin portal | **Partial** — commissions + EOD path |
| R9 | Vendor portal | **Excluded from alpha build** |
| R10 | Commission 10–15% | **Complete** |
| R11 | Digital escrow | **Complete** (mock PSP) |
| R12 | Cash EOD enforcement | **Complete** (admin trigger path wrong) |
| R13 | GPS dropout anomaly | **Partial** — flag only |
| R14 | Post-accept cancel | **Partial** — visibility decay not wired |
| R15 | Customer no-show | **Partial** — HTTP only |
| R16 | Offline cache / batch sync | **Not wired** |
| R17 | Collusion shadowban | **Not wired** |
| R18 | Anti-spoof | **Complete** (server only) |
| R19 | NDPR delete / PII | **Complete** |
| R20 | Explicit geo consent | **Not wired** |
| NEW | In-app messages + calls | **Not started** — required for this build |

**7 complete · 8 in progress · 4 not wired · 1 excluded (R9) · 1 required new (messages/calls)**

---

## How the system is built (architecture)

Three in-scope clients talk to four Node services that share `@fast/core`:

```
Customer / rider apps + admin portal
    REST + WS
        -> gateway   :8080
        -> realtime  :8090
        -> payments  :8091
        -> kyc       :8092
        -> Redis pub/sub
        -> Postgres + PostGIS

vendor :8093 + vendor portal  -- EXCLUDED FROM ALPHA BUILD
```

- **Shared domain** lives in `packages/core` (types, pricing, settlement, anti-spoof, WS protocol, DataStore / EventBus seams).
- **Services** are Express (except realtime, which is raw `http` + `ws`).
- **Default local mode** is in-memory store + memory bus — no Docker required.
- **Production mode** is `DATA_STORE=postgres` + `EVENT_BUS=redis` via Compose.
- Third-party systems are **adapter seams**: the platform runs offline; real keys are not implemented yet.

---

## Suggested next milestone

Ship a **closed-loop demo** (guest order → bid → accept → chat/call → track → confirm). Messages/calls are now in-scope and not started — confirm the comms design before implementation. Vendor catalog is out of this build.
