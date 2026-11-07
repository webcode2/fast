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
curl 'http://127.0.0.1:8080/fare-floor?distanceMeters=1250'
```

The fare endpoint verifies the initial ₦150/km floor. It uses a supplied distance in this local build. Order creation will use street distance calculated by the backend.

## Monorepo

- `apps/api` contains the Node.js and TypeScript backend.
- `apps/customer` contains the customer Flutter app.
- `apps/rider` contains the rider Flutter app.

Both mobile apps have Android and iOS scaffolds. From either app directory,
run `flutter pub get` and `flutter run`.

Use `main` as the integration branch. Use `mobile/customer` for customer app
work and `mobile/rider` for rider app work. Both branches contain the full
monorepo, so shared API changes can be integrated through `main`.
