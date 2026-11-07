# Fast Logistics — PRD Analysis → Implementation Map

Source: `FastLogistics_PRD_Alpha_v4_Integrated_260718_032928.pdf` (4 pages, FINAL SPECIFICATION FOR ARCHITECTURE).
This document extracts every functional requirement, user flow, guardrail, and KPI from the PRD and maps it to concrete modules in this repository. Every item has a `[src]` pointer to the implementing code.

## 1. Product overview

Hyper-local bike delivery platform for **Port Harcourt, Rivers State, Nigeria** (alpha). Three sides: **consumers**, **local retail vendors**, and **independent dispatch riders**. The core differentiator is **asynchronous peer-to-peer fare negotiation** — customers propose fares, riders accept or counter-propose, with an algorithmic floor enforcing a price baseline. All of it rides on low-latency realtime tracking.

## 2. Requirement → implementation map

| # | PRD requirement | Implementation |
|---|---|---|
| R1 | **Guest-mode auth**: cached device UUID; phone+OTP deferred to checkout | `packages/core/src/db/types.ts` (`deviceUuid` on `users`, `getUserByDevice`); gateway `POST /auth/guest`; checkout OTP flow in gateway `POST /auth/otp/verify` (purpose `checkout`) |
| R2 | **Real-time bidding interface**: propose initial rate, evaluate counter-offers, locked negotiation limits | Bidding rooms in `services/realtime/src/bidding/*`; protocol `packages/core/src/ws-protocol.ts` |
| R3 | **Algorithmic bidding floor** ₦150/km via Mapbox street-network distance; below-floor offers blocked | `packages/core/src/pricing.ts` (`computeFareFloor`, `assertOfferAtOrAboveFloor`); `MapboxRoutingProvider` seam `packages/core/src/providers/index.ts` |
| R4 | **Live radar tracking** with vector interpolation (proximity streaming) | `services/realtime/src/tracking/*`; `tracking.update` carries `coord+speed+heading+ts`; `LocationPoint` stream in store |
| R5 | **Rider assessment**: verified history metrics + mandatory 1–5★ rating | `RoomBidView.riderRating/riderTripsCompleted`; `reviews` table `CHECK rating BETWEEN 1 AND 5`; gateway `POST /trips/:tripId/review` |
| R6 | **Rider automated KYC**: Driver's License + NIN + biometric via Smile ID/Prembly | `services/kyc` workflow (license → nin → biometric); `KycProvider` seam |
| R7 | **Background geolocation** (low-power native GPS) | Flutter rider app location service scaffold; server anti-spoof validates the stream |
| R8 | **Super Admin portal**: fare-floor/commission knobs, commission ledger, disputes, telemetry | `services/gateway` admin routes + `web/admin-portal`; `system_config` table + `v_admin_telemetry` view |
| R9 | **Vendor portal**: B2B catalog, live order feed, split revenue | **EXCLUDED FROM ALPHA BUILD.** Scaffold remains at `services/vendor` + `web/vendor-portal` (not compiled or started by default). |
| R10 | **Commission engine 10–15%** on bid closure | `computeCommission` (clamped `10–15%`); escrow record at bid acceptance |
| R11 | **Escrow settlement** via Paystack/Monnify; funds released only on digital delivery confirmation | `services/payments` escrow service; `escrow_transactions.status = held → released` on `confirm-delivery` |
| R12 | **Cash settlement enforcement**: rider must settle EOD commission; unpaid → blocked from accepting rides | `packages/core/src/settlement.ts` + `services/payments` EOD job + realtime bid-claim gate `assertRiderEligible` |
| R13 | **Urban transit anomaly**: 10-min GPS silence → flag + admin alert + customer notify + replacement | `services/realtime/src/guardrails/dropout.ts`; `trips.dropout_flagged_at`, `delivery_orders.anomaly_flagged` |
| R14 | **Post-accept cancellation** → order re-enters bidding room; recurring cancels degrade rider visibility | `state/order.ts` (`locked → open_for_bids`); `rider_profiles.visibility_score` decay; realtime re-broadcast |
| R15 | **Customer no-show**: 10-min countdown at dropoff geofence → rider logs "Customer Unavailable" | `services/realtime/src/guardrails/noshow.ts`; `geofenceMeters` config; `trip.customer_unavailable` |
| R16 | **Network resilience**: Hive/Isar local cache, telemetry batch sync on reconnect | Flutter scaffold offline telemetry store; documented batch-sync contract |
| R17 | **Collusion tracking**: repeated bid-accept-then-cancel → shadowban both | `packages/core/src/collusion.ts` + `collusion_pairs` table |
| R18 | **Geospatial anti-spoof**: mock-location/root checks + impossible-coordinate velocity bounds | `packages/core/src/antiSpoof.ts`; `maxSpeedKmh` config |
| R19 | **NDPR compliance**: identity media destroyed post-verification; Delete Account; PII obfuscation | KYC `media_cleared` flag; gateway `DELETE /auth/account` → `obfuscateUserPii`; financial rows preserved |
| R20 | **Explicit geolocation consent** | Customer/rider app consent flow (scaffold) + documented policy |

## 3. User flows (critical path)

### 3.1 Customer request → bid → accept → track → confirm
```
customer (guest or logged in)
  └─ POST /orders            {pickup, dropoff, proposedFareKobo, paymentMethod}
       gateway: routing.distance() → streetDistanceM → fareFloorKobo (server-authoritative)
       reject if proposedFareKobo < floor  [R3]
       order.status = open_for_bids; publish orders:new (Redis)
  └─ WS /ws/customers/:id   subscribe to room [R2]
riders (in radius, online, KYC-verified, NOT settlement-blocked)
  └─ WS /ws/riders           receive bids.order.new; bid.claim | bid.counter [R2]
customer sees RoomState / CounterReceived; bids.accept → order.locked [R2]
  └─ createTrip → order.assigned → trip.accepted
  └─ rider streams tracking.location → anti-spoof gate → tracking.update to customer [R4]
  └─ trip delivered → confirm-delivery → escrow released (digital) / settlement recorded (cash) [R11,R12]
  └─ POST /trips/:id/review  mandatory 1–5★ [R5]
```

### 3.2 Cash settlement EOD (the enforcement mechanism)
```
EOD job (services/payments)
  └─ sum cash_collected per rider/day from escrow_transactions (payment_method=cash, released)
  └─ commissionDue = cashCollected × commissionPct            [R10]
  └─ upsert settlements (business_date, cutoff_at)
next day bidding (services/realtime, bid-claim path)
  └─ assertRiderEligible(rider, userStatus)  → SETTLEMENT_BLOCKED if overdue [R12]
  └─ rider settles via wallet (SettleSettlement) → settlement_blocked=false
```

### 3.3 Rider KYC onboarding
```
rider app → POST /kyc/start (license) → submit license + NIN → submit biometric selfie
  └─ provider submitCheck → verdict (Smile ID/Prembly seam, mock in dev)
  └─ media_cleared=true after verdict (NDPR) [R19]
  └─ rider_profiles.kyc_status = verified → eligible for rides [R6]
```

## 4. KPIs and how they're measured

| KPI | Target | Measurement hook |
|---|---|---|
| Bid resolution | 85% within 60s | `bids` rows: `resolved_at - created_at`; auction window `bidWindowSec=60` |
| Order fulfillment | 90% | `trips.delivered / trips.created` rolling window |
| Uptime | 99.9% | Docker healthchecks + pino structured logs; stateless services scale horizontally |
| Cash-settlement compliance | 100% before next-day rides | `rider_profiles.settlement_blocked` gate at bid-claim |

## 5. Explicitly deferred / mocked

Third-party integrations are **adapter seams with deterministic stubs** so the platform runs and tests offline. Real credentials swap in behind `packages/core/src/providers/index.ts` with no service changes:
- Mapbox (routing) — haversine×1.3 fallback when no token
- Termii (OTP) — logs the code in dev
- FCM (push) — no-op in dev
- Smile ID / Prembly (KYC) — mock always-verify
- Paystack / Monnify (payments) — mock always-capture/refund

See `docs/ARCHITECTURE.md` for data flows, API surface, and deployment.
