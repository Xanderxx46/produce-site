# PLU Hub

A small produce reference website and Android companion sharing one Express API and SQLite catalog. This is an unofficial reference, not affiliated with Walmart. Codes and barcode acceptance can vary by store, variety and size.

## What is included

- Search-first responsive reader, accent/alias-aware search, categories, device-local favorites and large barcode view.
- Native Android package containing the same offline-capable reader assets. The latest public catalog is cached locally and refreshed when connected.
- Desktop website administration using the existing configured username/password. Mobile browsers are blocked from web-admin pages and cookie-authenticated web writes.
- A separate Android editor authenticating with the same existing credentials through app-specific API endpoints. No device enrollment, certificates or extra admin authentication ceremony.
- Add, real edit, revision conflict handling, deletion, an activity log and restoration of deleted entries.
- Website change notifications via SSE, with foreground polling/focus refresh as fallback.

**The mobile-browser gate is deliberately best-effort.** User-Agent checks can be spoofed. Password/session or app-token authorization remains mandatory on all writes; an app install or a forged app header grants no privilege.

## Architecture

Website + Android app -> HTTPS Express API -> one server-side `data/plu.db` database.

Android stores only a public catalog snapshot and favorites on disk. Its admin bearer token is held in memory, not localStorage; restarting the app requires signing in again. The password is never embedded in the app, and is cleared from its input after sign-in. Server app-session records store token hashes and expiry, not raw bearer tokens.

The existing credential values stay in `.env`. Never commit that file or database/signing material. A database schema migration adds revision/timestamp, audit, catalog-version and app-session tables without reseeding or replacing existing entries.

## Development

Node22 or newer:

```sh
npm ci
npm run build
npm test
npm start
```

Set `AUTH_USER`, `AUTH_PASSWORD`, `SESSION_SECRET`, `PORT` and `NODE_ENV` in your local protected environment. Tests use isolated fixtures and never require production credentials. For a disposable test database, set `PLU_DB_PATH` to a separate path. Never point tests at the production database.

`npm run seed` is for an intentional initial catalog setup, NOT normal deployment. No researched-but-unverified Walmart PLU candidates are automatically imported.

## Android

The Capacitor8 Android project is in `android/`, package `xyz.xanderxx.pluhub`, minimum Android7/API24, target API36. The packaged app uses HTTPS origin `https://plus.xanderxx.xyz`; `PLU_APP_API_BASE` can select another HTTPS origin at build time. It must not contain credentials or a path.

```sh
npm run android:sync
# With Android SDK and Java21 configured:
cd android
./gradlew assembleDebug
```

For a signed release, supply `PLU_KEYSTORE_PATH` and `PLU_STORE_PASSWORD` securely to Gradle; the keystore is PKCS12 with alias `pluhub`. Signing material stays outside Git. Package signing is a standard Android distribution requirement, not admin-device enrollment. CI builds a signed APK with encrypted repository secrets and uploads only the APK, never the keystore/password. No Firebase/account/API key is required.

The v1 reader is usable from its cached catalog offline; editing is online-only. There is no camera scanner in this version. Barcode format matches the previous website and still needs real checkout/scanner testing before relying on it at a register.

## Main API paths

- Public: `GET /api/items`, `/api/health`, `/api/events`.
- Website login/session: `POST /api/login`, `/api/logout`; `GET /api/me`.
- Cookie-authenticated desktop writes: `POST /api/items`, `PATCH/DELETE /api/items/:id`; CSRF header required. Send the current item revision on edits/deletes.
- Android login: `POST /api/app/login`; token returned only after valid credentials. `GET /api/app/me`, `POST /api/app/logout` use bearer authorization.
- Android writes: `POST /api/app/items`, `PATCH/DELETE /api/app/items/:id` use the bearer token.
- Authenticated activity/restore: `/api/audit` and `/api/app/audit`; `POST .../:id/restore`.

## Deployment precautions

1. Back up current source, package files, protected environment and a consistent SQLite snapshot using SQLite backup, including WAL-aware handling. Preserve any existing uncommitted work.
2. Build/test on staging and confirm catalog values survive schema migration.
3. Install runtime dependencies in staging on the correct host architecture. Do not copy x86 node_modules to ARM.
4. Preserve `.env` credential values and `data/`. Do not run the seeder, reset the live Git checkout or replace the database with a fixture.
5. Restart only PLU Hub under the verified existing PM2 manager. Verify other applications/PIDs were not restarted, existing login works, mobile web admin is blocked and the public/native read paths respond.
6. A prior source backup is not an automatic database rollback plan after new edits. Never overwrite new catalog changes or restore old DB/session snapshots blindly.

## Source provenance

The first staging-branch commit preserves the previously deployed, uncommitted UI/dependency baseline. The feature commit contains the redesign/Android/shared-API work. That baseline snapshot is not a claim of original authorship and was not made by resetting or cleaning the live checkout.
