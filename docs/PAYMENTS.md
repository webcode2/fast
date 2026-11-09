# Bachs payments and rider payouts

Fast Logistics uses Bachs sandbox for digital delivery payments. A customer
with verified email and phone can open a hosted checkout for the agreed fare
on an assigned trip. Checkout is restricted to NGN card payments because
Bachs does not support refunds on NGN bank-transfer collections. The API
records collection only after a signed Bachs event matches the reserved
reference, checkout, amount, and currency. The customer can check this status
using the payment verification endpoint.

The database stores all values in integer kobo. The Bachs API receives decimal
naira strings. The ledger records gross collection, a 10% platform commission
rounded down to kobo, and the remaining rider earnings. Bachs fees are
separate from the platform commission.

## Settlement policy

- Completed digital trips are eligible at **06:00 Africa/Lagos the next
  calendar day**. A trip completed at 23:59 WAT is eligible the next morning.
- An open non-delivery report blocks a new rider credit or bank payout. A
  dismissed report lifts the hold. A provider submission already in flight
  can finish.
- An upheld report queues a full customer refund. A successful refund reverses
  the commission and earnings allocations. If the rider's connected balance
  was already credited, the ledger records the rider amount as recoverable
  for operations review. The worker does not debit the rider's balance or
  silently deduct from later earnings.
- Payouts credit the rider's Bachs connected account, then send the same
  amount to the rider's approved bank destination. The bank payout is marked
  successful only when Bachs reports it completed.
- Stable idempotency keys and PostgreSQL operation records protect retries.
  If an uncertain connected-account credit is too old to retry within the
  provider's idempotency window, or the key has changed, the worker puts it
  into `needs_review`. Operations must reconcile it in Bachs before taking
  another payment action.

An initialized checkout keeps the assignment and fare reserved. Pickup
requires verified collection once checkout begins. If recovery is needed
after checkout starts, support handles the case rather than automatically
reassigning the paid trip. Native customer checkout and bank-initiated chargebacks are separate work.

## Sandbox setup and acceptance

1. Apply all migrations and set `BACHS_SANDBOX_SECRET_KEY` and
   `BACHS_SANDBOX_WEBHOOK_SECRET` in `.env`. Use the Bachs sandbox and a key
   scoped to checkout, transfer, payout, destination reads, and refunds.
2. Register or locally forward the Bachs `collection.succeeded` event to
   `POST /payments/bachs/webhook`. Use the endpoint's signing secret.
3. With Bachs Connect enabled, onboard a rider recipient with transfers and
   payouts active and an approved NGN bank destination. A verified Fast
   Logistics administrator links the pair through
   `PUT /admin/payments/riders/{riderId}/recipient` with
   `{"accountId":"acct_…","destinationId":"pd_…"}`.
4. As a verified customer on an assigned trip, call
   `POST /trips/{id}/payment/checkout`, open its `authorizationUrl`, and
   complete a sandbox card payment. Check
   `POST /trips/{id}/payment/verify` and `GET /trips/{id}/payment`.
5. Mark pickup and completion as the rider. Run
   `npm run payments:worker -w fast-logistics` continuously, or append
   `-- --once` for one pass. Verify the connected-account credit and the
   bank payout once the trip reaches the Lagos cutoff. Repeat the worker
   pass and check that Bachs shows only one credit and one payout.
6. Run separate sandbox trips for a report upheld before payout and one
   upheld after payout. Verify the refund in Bachs and the adjustment in
   PostgreSQL. These checks require your sandbox credentials and account
   capabilities.

The local application integration check runs with
`DATABASE_URL=… node apps/api/checks/payments.ts` against a fresh migrated
test database. It uses real HTTP and PostgreSQL, with controlled Bachs
responses at the network boundary. That test does not make provider calls.


## Cash commission

Select `"paymentMethod":"cash"` when creating an order. The rider receives the
full agreed fare in cash from the customer. Rider-marked completion posts one
commission debt of **10% of the agreed fare**, rounded down to kobo. Repeating
completion does not add another debt. The due time is **midnight at the end of
the delivery day in Africa/Lagos**.

Unpaid overdue debt blocks the rider from going available, appearing in nearby
dispatch, making counteroffers, claiming deliveries, or being assigned through
an existing counteroffer. The server checks the debt at the point of each
action. No scheduled job is needed to activate or lift the block.

- **Rider app → Account → Cash commission** shows the balance and opens Bachs.
  The API endpoints are `GET /cash-commission` and
  `POST /cash-commission/checkout`. The checkout batches the rider's unpaid
  commission at the time it is created. Only a verified Bachs collection
  clears those debts. New debts require a separate repayment.
- A verified administrator may reconcile an independently confirmed payment
  with `POST /admin/cash-commission/{riderId}/record`. Supply the exact
  outstanding `amountKobo` and a unique `externalReference`. The API records
  the administrator and reference and rejects manual reconciliation while
  a Bachs checkout is still pending. Use this path if Bachs declines the
  amount and an alternate repayment has actually been received.
- Cash delivery commission adjustments after a dispute require operations
  review. The digital refund worker applies to Bachs-funded delivery fares.

The payment integration check also covers cash completion, commission
accrual, the overdue block, and both reconciliation paths. Real Bachs
sandbox and native device acceptance still require credentials and a
device test.
