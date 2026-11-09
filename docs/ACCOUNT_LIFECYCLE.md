# Account lifecycle and staff access

## Account deletion and retention

1. A customer or rider requests deletion after confirming their password. Access and existing sessions end immediately. Active delivery custody must be resolved first.
2. For 30 days after the request, the user can explicitly recover the account using their existing credentials. A normal login does not cancel deletion.
3. At day 30, recovery closes. The maintenance worker moves personal account and profile data into a restricted archive and removes it from active account records.
4. The archive expires 120 days after the recovery deadline, 150 days after the original request. Authorized staff can export it during that window. Export is audited and does not extend retention. Expired records are unavailable for export and are automatically purged by the worker.

Operational trip, dispute decision, and financial records may reference an opaque account ID after personal data is removed. Credentials and sessions are excluded from exports. The archive policy governs the live system. Deployment must also configure backup expiration and control access to exported copies.

## Profiles

Authentication identity belongs to the account. A separate profile record holds the account type, display name, and role-specific profile details. Customer and rider profiles each belong to exactly one account. Rider operational and identity-review records remain separate.

## Staff access

A staff account can hold multiple roles simultaneously. Authorized staff managers can assign or remove operational roles. The API checks roles server-side at the point of use. The administrator role controls elevated assignments and provisioning. Customer and rider accounts cannot assign themselves roles.

## Implementation and operations

- The mobile account screen exposes **Delete account**. The sign-in screen
  exposes **Recover a deleted account**. Both actions require the current
  password. A pending deletion cancels unassigned customer orders.
- The archive is encrypted in PostgreSQL using the separate
  `ACCOUNT_ARCHIVE_KEY` environment secret. It includes profile and contact
  data, authored messages and feedback, and customer delivery coordinates.
  The live copies of those personal fields are removed at archiving. Trip
  totals, ratings, decision status, and audit references use opaque account IDs.
- The admin dashboard lists unexpired archives and offers an audited JSON
  download. Credentials and session tokens are excluded. Exports contain
  personal data and must be handled under the same access and retention policy.
- Run `npm run accounts:maintain -w fast-logistics` continuously with the API
  environment. The worker checks every minute and uses database row locks to
  process due accounts in batches. Use `-- --once` for a single run. Set the
  same `ACCOUNT_ARCHIVE_KEY` on the API and worker before archiving any data.
- Provision an operator using the existing `auth:admin` command. Set
  `ADMIN_ACCOUNT_TYPE=staff` for an operator with no initial roles. The default
  `admin` provisions the protected `administrator` role. Staff verify email
  and phone before using assigned permissions.
- `staff_manager` manages dispute, rider-verification, and recovery roles for
  other staff. Only an administrator can grant `staff_manager` or
  `archive_exporter`, and nobody can modify their own role assignments through
  the API. Assignments and removals take effect on subsequent requests.
