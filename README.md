# hydrodb-frontend

## Implementation plan

Build the browser frontend incrementally against the existing HydroDB REST API.
P0.1 provides the React/TypeScript foundation and a same-origin process-liveness
probe. P0.2 adds typed transport for all six login/session/health endpoints.
P0.3 adds sign-in, reload restoration, session checks, and confirmed sign-out.
P0.4 adds separate liveness, readiness, and authenticated database-status results,
with manual refresh and UTC check timestamps. P0.5 acceptance is complete for
the browser matrix below. This completes the requested login/health P0 only;
process liveness alone is never presented as database readiness.

## Running the foundation against the test backend

```sh
npm ci
npm run build
npm run lint
npm test
npm run deploy:test
```

For repeatable Linux browser acceptance, install the pinned Playwright browsers
and NSS certificate importer (`certutil`, provided by `libnss3-tools`):

```sh
npx playwright install chromium firefox
npm run test:browser
```

The suite targets only the existing test HTTPS origin. It imports the test CA
into temporary, isolated browser profiles and leaves TLS verification enabled;
Node's API checks use the same CA through `NODE_EXTRA_CA_CERTS`. It never adds
trust to the operator's usual browser profile or system trust store.
The dedicated Reader password is read from the protected operator file, not
passed on the command line or stored in source. If that file requires root:

```sh
sudo -A env PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" npm run test:browser
```

Operators may instead supply an appropriately protected, readable credential
file using `HYDRODB_BROWSER_PASSWORD_FILE`. `HYDRODB_BROWSER_CA_FILE` overrides
the profile CA import; match Node's CA configuration if overriding it. Tests run
serially without retries. Traces, screenshots, and video are disabled; no
storage-state snapshot is saved. Teardown confirms Reader-session revocation,
closes browsers, and deletes only the profiles created by that test. Ignored
`.local/browser-results/` contains test-run status/failure context, not a reusable
login session.

Open `https://hydrodb.test:18443/` with the existing test CA trusted by the
browser. The frontend and API share that HTTPS origin. There is no direct SQL
connection, browser CORS exception, or TLS-verification bypass.

`deploy/test.sh` is deliberately restricted to the existing `hydrodb-empty-test`
installation. It validates Caddy configuration, publishes versioned static
releases under ignored `.local/test-web/`, and recreates only the ingress.
Database, application, backup, Swagger, and PEGELONLINE cron remain unchanged.
The Compose overlay must be included when recreating this frontend-enabled
ingress; running `npm run deploy:test` supplies it automatically.

Development uses the same test HTTPS ingress: rebuild/redeploy and reload the
browser. `npm run build:watch` can watch local assets, but publishing remains an
explicit deployment step. No additional HTTP development server is required.
Dependencies are pinned with `package-lock.json`; the initial build is validated
with Node 20.19.0 and npm 11.21.1.

P0.1 acceptance: production build/strict type-check and warning-free lint pass;
three UI tests pass. The deployed browser checks use only same-origin GET
requests, keyboard refresh works, and a 375-pixel viewport has no horizontal
overflow. Backend readiness remains healthy, API 401/404 responses remain JSON,
and the existing PEGELONLINE-only hourly cron entry is preserved.

P0.2 transport uses same-origin cookies, rejects redirects, disables HTTP caching,
and bounds requests (including response decoding) to 10 seconds. Callers can
abort obsolete requests. Sign-in is never automatically retried; sign-out
requires an in-memory CSRF token and a confirmed 204 response. The browser
supplies Origin/cookie headers; JavaScript does not set or inspect them.

Consumed response fields are validated at the boundary. Session restoration
accepts only user cookie sessions, not bearer-token credentials. Status exposes
only service/version/schema version, not opaque cutoffs. Readiness 503 with valid
reasons is an explicit `not_ready` result, separate from transport errors.
`ApiError` distinguishes HTTP, network, timeout, cancellation, malformed response,
and invalid-input failures. Diagnostics retain only recognized error codes,
validated request IDs and numeric Retry-After values; raw server messages,
details, request bodies, and underlying exception text are never included.
The UI keeps returned CSRF tokens in memory and clears submitted passwords
after each completed attempt.

P0.2 acceptance: production build/strict type-check, warning-free lint, and all
21 transport/UI tests pass. The deployed HTTPS browser retains keyboard
liveness refresh and has no page errors or narrow-viewport overflow. Readiness
returns 200; unauthenticated session/status reads return the expected 401 JSON.
Only same-origin GET traffic was sent during this browser check. Backend service
uptimes and the PEGELONLINE hourly schedule are unchanged. Real authenticated
cookie/CSRF acceptance remains part of P0.3/P0.5, not this transport increment.

P0.3 session handling restores the existing cookie session on load. A 401 shows
the login form; an unavailable or malformed session response requires an
explicit retry and never masquerades as signed-out state. Failed credentials
and throttling are shown separately, including supplied retry seconds. An
uncertain sign-in result requires a session check before another password
submission, since the server may already have created the cookie session.
Manual session checks expose expiry. Confirmed sign-out clears identity/CSRF
state; failed sign-out never claims revocation. Pending operations are cancelled
on unmount and duplicate submissions are prevented. Session changes invalidate
and refresh the separate liveness probe. No browser storage holds credentials.

P0.3 acceptance: production build/strict type-check, warning-free lint, and all
30 transport/UI tests pass. Browser checks use VS Code's embedded Chromium
150.0.7871.250 (Electron 43.8.9); standalone Chromium/Firefox qualification is
still deferred to P0.5. Against verified test HTTPS, a dedicated
`browser-test-reader` account has only Reader access to the PEGELONLINE dataset.
Browser sign-in via keyboard, failed-credential password clearing, identity
restoration after reload, and sign-out/reload pass; a protected request after
sign-out returns 401. Authenticated status separately returns HydroDB/schema 25.
Cookie flags are HttpOnly/Secure/SameSite=Strict, and missing-CSRF sign-out is
rejected with 403. Browser storage is empty, no page errors occur, and the
375-pixel viewport has no horizontal overflow. Browser requests remain within
the six-operation allowlist. Backend services and hourly PEGELONLINE cron are
unchanged. Expiry, failed logout, uncertain login, and cancellation are covered
by focused UI tests; broader browser qualification remains P0.5.
The acceptance password was rotated afterward and all acceptance sessions
revoked. Operators can obtain the Reader credential from the protected
`../staging/test/hydrodb-empty-test/frontend/reader-password` file; it is never
included in frontend source or static assets.

P0.4 runs the independent health requests concurrently on initial load, session
changes, and manual refresh. Authenticated status is requested only for a
verified, non-busy session. Results are published together for one completed
check, with its UTC completion time. During a new check, previous results and
versions are hidden rather than presented as current. Each check is bounded by
the transport's 10-second timeout.

Readiness 503 reasons are shown explicitly and are not labelled a database-only
failure. Authenticated status reports service/schema versions separately;
403/server/network failures remain visible even if readiness succeeds. A current
status 401 clears session identity/CSRF state and displays an expired-session
result. Session transitions/unmount abort obsolete checks, and a superseded
response cannot restore old health or expire a newer session. No polling,
domain reads/writes, or cutoff display is introduced.

P0.4 acceptance: build/strict type-check, warning-free lint, and all 38 tests
pass. The deployed HTTPS browser shows real liveness/readiness and authenticated
HydroDB 0.1.0/schema 25 status with the dedicated Reader; reload and keyboard
refresh preserve the expected flow and update the UTC timestamp. Browser-only
response injection verifies delayed-check invalidation, readiness 503 reasons,
403 authenticated-read failure beside healthy readiness, and 401 session expiry
with identity/version clearing. These injections do not change backend health.
Only allowlisted same-origin operations are sent, no page errors occur, and a
375-pixel viewport has no horizontal overflow. Backend service uptimes and the
hourly PEGELONLINE schedule are unchanged. The temporary acceptance credential
was rotated and all Reader acceptance sessions revoked afterward. P0.5 remains
open; this does not claim full P0/browser release qualification.

### P0.5 acceptance record (2026-11-20)

The requested **database login and health-only P0 is complete** on the test
instance, for this explicitly qualified matrix:

| Browser | Qualification |
| --- | --- |
| Chrome for Testing 159.0.8154.6, Linux/headless | Five browser cases at 100% and the same five at native 200% page zoom; device-pixel ratio asserted as 1/2, not CSS scaling or viewport emulation. |
| Firefox 159.0, Linux/headless | The same five browser cases at 100%. Firefox native 200% zoom is not qualified. |
| VS Code embedded Chromium 150.0.7871.250 | Earlier interactive checks including 375-pixel reflow; not a claim for other embedded engines. |

`npm run build`, warning-free `npm run lint`, all **38 unit/UI tests**, and all
**15 standalone browser cases** pass. Browser request guards fail on non-local
origins, URL parameters, or operations outside the six P0 endpoints and bundled
static resources. No browser script errors occurred.

| P0 gate | Evidence |
| --- | --- |
| Reader sign-in/reload | Actual verified-HTTPS cookie flow, restored identity, authenticated status, and displayed service/schema versions. |
| Failed credentials/throttling/unavailability | Actual incorrect password; browser-injected 429/503/network/malformed outcomes remain distinct, clear passwords, expose retry seconds, and do not auto-submit again. |
| Sign-out/CSRF | Actual missing-CSRF DELETE rejected with 403; keyboard sign-out returns 204, protected reads then return 401, and reload remains signed out. Injected failed logout does not claim revocation. |
| Health separation | Actual liveness/readiness/status; injected readiness 503 reasons and status 403/401 remain separate, clear stale versions, and expire identity on current 401. |
| Timeout/stale results | A browser-injected stalled fetch uses the actual 10-second timer (asserted 9.9-12 seconds); green results/timestamps disappear during checks, late completion cannot restore them, and refresh recovers. Focused UI tests also prove superseded/logout response rejection. |
| Keyboard/reflow | Tab-only field/action navigation, keyboard submission/refresh/logout, visible 3-pixel focus outline, labelled fields, textual statuses, and no horizontal overflow through Chromium native 200% zoom. |
| Read-only request scope | Every observed browser operation passes the endpoint/origin guard; fixture cleanup uses only session identity/revocation. No domain mutation or ETL control is sent. |
| Release/rollback | Retained HTML rollback and restoration verified byte-for-byte; current hashed assets stay available while old HTML is served. Credential scans, API error routing, and preserved service/schedule checks pass. |

Failure injection is browser-local: the database was not stopped, real lockout
limits were not deliberately exhausted, and no backend privileges were changed.
All acceptance sessions were confirmed revoked; the protected Reader credential
was not changed or printed by this suite. Actual Reader/admin/ETL credentials
were checked absent from static assets and frontend/test source. HttpOnly,
Secure, SameSite=Strict, empty browser storage, API JSON 401/404 preservation,
missing-asset 404, and current CSP/security headers were verified.

Qualified release remains `.local/test-web/releases/20261120T080735-1844840`
(the application assets are unchanged by this test-only increment):

- Frontend package: `0.1.0`.
- JavaScript: `index-byfsPiV0.js`, SHA-256
  `b43bc541796c11a758011fd1975c58554fbe7d133d00568734cd851526fc9d1c`.
- CSS: `index-MMZZyRsi.css`, SHA-256
  `76ea76cc415c72d2ecca7b899190c8819737c809d585b1201a329acecde65134`.
- Backend: HydroDB `0.1.0`, schema `25`, image
  `hydrodb:test-r8-pegel-20261120`.
- Rollback target tested: `20261120T075648-1830036`; original current release
  restored afterward with no service recreation or database change.
- App/backup start times remain `2026-11-20T06:16:18Z`, Swagger
  `2026-11-20T06:16:21Z`, and DB `2026-11-19T09:18:54Z`.
- PEGELONLINE remains the only managed feed cron: `0 * * * *`, rolling 24 hours.

This is not a full accessibility audit, a general browser-version guarantee,
Safari/mobile qualification, broader requirements-P0 completion, or production
acceptance (M7 remains separate). Later scientific/workspace features and full
release qualification remain P1-P6 below.

To roll back static assets, atomically replace `.local/test-web/current` with a
relative symlink to a retained release under `.local/test-web/releases/`.
Shared hashed assets are retained so already-open pages can finish loading the
previous build. This does not migrate or change the database.

References:

- [Frontend requirements](../hydrodb-requirements/docs/frontend.md).
- [Backend OpenAPI contract](../hydrodb/openapi/hydrodb-v1.json).
- [Session implementation](../hydrodb/src/http/sessions.rs).
- [Health and status implementation](../hydrodb/src/http/system.rs).

**P0 below is the requested first delivery milestone: database login and health
check only.** It does not constitute completion of the broader requirements
currently labelled P0. P1-P6 below are delivery milestones, not changes to those
requirement priorities. Desktop delivery is outside this browser implementation
plan and remains deferred.

## P0: browser login and database health

### Scope

Deliver one small browser screen containing:

- HydroDB title and a persistent **Read-only** indicator.
- Configured backend origin, shown read-only.
- Username/password sign-in form.
- Signed-in identity and sign-out control.
- Backend/database health result, last-check time, and **Check again** control.
- Explicit submitting, checking, failed, unavailable, and session-expired states.

“Database login” means signing in to a HydroDB-managed local user account through
the REST API. The browser never connects to PostgreSQL or receives PostgreSQL
credentials. Successful sign-in does not imply permission to read every dataset.
Use an existing Reader account for acceptance; account creation and grants remain
operator tasks outside the GUI.

No metadata navigation, datasets browser, samples, charts, Dockview workspace,
maps, ETL controls, administration, SSO, desktop packaging, offline mode, or
scientific processing is included in P0.

### API contract

| Operation | Existing endpoint | Required behavior |
| --- | --- | --- |
| Sign in | `POST /api/v1/auth/sessions` | Send username/password once per explicit submission. Accept the backend session cookie and retain the returned CSRF token in memory. |
| Restore/check session | `GET /api/v1/auth/me` | Recover identity and CSRF token after a page reload. A 401 means sign-in is required; network/server errors remain distinct from signed-out state. |
| Sign out | `DELETE /api/v1/auth/sessions/current` | Send `x-csrf-token` using the backend session protocol. Confirm revocation before reporting successful sign-out. |
| Process liveness | `GET /health/live` | Shows whether the API process responds. This endpoint does **not** check PostgreSQL. |
| Database/backend readiness | `GET /health/ready` | Treat 200 with `status: ready` as ready. Show 503 and supplied reasons as not ready; do not label it a database-only failure. |
| Authenticated database read | `GET /api/v1/status` | After sign-in, confirm an authorized database-backed request and display service/schema versions. Keep session, readiness, and authenticated-read results separate. |

Readiness includes database access, schema compatibility, history state, runtime
privileges, and configured checkpoint freshness. A live process, a successful
login, or a previous successful check must not be presented as current readiness.
Do not display or persist the status endpoint's opaque read cutoff in P0.

### Architecture and deployment

- React + TypeScript strict mode, built as a static SPA with Vite. Pin dependency
  versions and commit the package-manager lockfile at implementation time.
- Start with a small application component, a narrow typed API module, and
  semantic HTML/CSS. No global store, full query framework, panel manager, or
  runtime Node/SSR service is needed for these six endpoints.
- Validate consumed response fields at the API boundary. Unexpected or malformed
  successful responses are errors, not successful health/login results.
- Serve assets and REST endpoints under the same HTTPS origin through the
  existing ingress. Route `/api/*` and `/health/*` to the backend before any SPA
  fallback; preserve backend error responses and existing operational routes.
- Development must exercise HTTPS and the same-origin proxy arrangement.
  Trust the test CA properly; do not disable certificate verification or cookie
  protections to make development work.
- Use browser-managed `HttpOnly; Secure; SameSite=Strict` session cookies.
  JavaScript must not extract or persist the session credential.
- Keep CSRF tokens in memory. Never put passwords, session secrets, or CSRF
  tokens in URLs, browser storage, logs, or diagnostic payloads. Clear the
  submitted password after the request completes.
- Abort obsolete requests on logout/unmount. Bound requests with timeouts and
  prevent older health responses from overwriting a newer check. Do not
  automatically retry password submissions.
- Check health on initial load, after sign-in, and on manual refresh; continuous
  polling is not required. Show check time and invalidate misleading healthy
  state when a new check fails.
- Use local bundled assets, basic CSP, and no mandatory external telemetry/CDN.

### Small implementation increments

| Increment | Deliverable | Check before continuing |
| --- | --- | --- |
| P0.1 Foundation | Minimal React/TypeScript/Vite application, unit-test setup, static HTTPS hosting and API proxy. | Production build/type-check passes; browser reaches the intended backend without CORS workarounds or TLS bypasses. |
| P0.2 Transport | Typed, bounded requests for the six allowlisted endpoints, error decoding, response validation, and cancellation. | Tests distinguish 401, 403, 429, 503, timeout, network failure, and malformed responses; secrets are absent from diagnostics. |
| P0.3 Login | Sign-in, reload/session restoration, identity display, and confirmed sign-out. | Real cookie/CSRF flow succeeds; failed credentials and session expiry produce explicit states. No domain mutation is sent. |
| P0.4 Health | Separate liveness, readiness, and authenticated-read results; manual refresh and check timestamp. | Liveness alone never becomes “database ready”; 503 reasons and failed authenticated reads remain visible. |
| P0.5 Test deployment | Deploy static assets beside the existing test backend and record build/API versions. | Browser acceptance passes against the actual HTTPS service; existing backend and PEGELONLINE scheduling are unchanged. |

### P0 acceptance gate

Use Vitest/React Testing Library for focused state and response-validation tests,
and Playwright for the real browser session flow. Declare tested browser versions;
start with Chromium, then qualify Firefox before claiming both are supported.

P0 is complete only when:

1. A Reader user signs in over verified HTTPS and identity survives page reload.
2. Incorrect credentials, throttling, expired sessions, and unavailable backend
   have distinct, actionable messages without exposing credentials.
3. Sign-out uses the required CSRF protection; a subsequent protected request
   returns 401. Failed sign-out does not falsely claim server-session revocation.
4. Health shows actual readiness, reports 503 reasons, and does not confuse
   liveness with a working database. Authenticated status succeeds separately.
5. Timeouts and superseded responses cannot leave or restore a misleading green
   status. Malformed responses are rejected explicitly.
6. Keyboard-only use, labelled fields, visible focus, non-colour-only status,
   and 200% zoom are usable.
7. Browser traffic contains only the six endpoint operations above. No domain
   writes, direct SQL connections, admin operations, or ETL actions occur.
8. The deployed build/type-check and focused tests pass, secrets are not shipped,
   and a previous static build can be restored without changing the database.

## Subsequent browser milestones

Advance only after the preceding gate passes. Keep each milestone deployable;
do not install later-stage libraries until their functionality is needed.

| Milestone | Scope | Acceptance gate |
| --- | --- | --- |
| P1: read-only workspace | Add the shared React/Dockview shell, navigation placeholders, bounded panel lifecycle, and explicit keyboard alternatives to dragging. Persist presentation layout only. | Opening/closing/resetting panels works; invalid layouts recover visibly; sign-out clears protected in-memory state. No data editing or desktop dependency is introduced. |
| P2: metadata browser | Searchable paginated lists and linked details for Stations, Sampling positions, Instruments, Instrument deployments, Parameters, Parameter groups, Quality codebooks, Time series, and Units. Add typed read contracts and bounded query caching. | IDs and bigint owner pins retain exact precision. Authorized pages and retained references resolve at one cutoff. Unknown values stay unknown; Station coordinates are labelled current-only and remain distinct from measurement references. |
| P3: first sample viewer | One supported instantaneous scalar series per panel, UTC `[start, end)` selection defaulting to 24 hours, current/as-of reads, Apache ECharts, and a separate exact paginated table. | Values, timestamps, quality meanings, and retained scientific pins agree between chart/table/backend. Keep exact timestamps separate from chart coordinates. Missing values are not zero-filled; unsupported shapes/support are rejected explicitly. Old responses cannot replace a newer selection. |
| P4: complete scientific viewing | Vector2/vector3, interval/statistic/method semantics, timestamp positions, extremum occurrence times, calendars, censored/rejected results, all processing levels, lineage, and supplied aggregate coverage/partial/stale status. | Independent fixtures preserve scientific meaning and precision. Unknown occurrences are not invented; no latest-definition substitution, silent resampling, implicit aggregation, or transformation/job creation occurs. |
| P5: bounded presentation processing | Add dedicated Web Workers and qualified Rust/Wasm decoding/plot preparation where measured sizes require them. Backend REST remains the scientific execution path; JSON remains the baseline. | Declare row/byte/render/cache/concurrency budgets. Prove cancellation, crash recovery, bounded peak memory, gap/extremum-preserving labelled display reduction, and exact-data availability. Enable Arrow only after equivalent interpretation/precision is qualified. |
| P6: browser release qualification | Supported browser matrix, accessibility, read-only request enforcement, session/restore failures, deployment rollback, build/license inventory, diagnostics, and performance/endurance evidence. | Publish measured results against approved budgets and requirement coverage. No unsupported browser, incomplete scientific path, or unqualified capability is advertised as complete. |

Cross-cutting rules apply from the first relevant milestone: backend authorization
is authoritative; versions and cutoffs are not silently replaced; domain reads
remain bounded and read-only; errors never masquerade as empty or complete data.
If sample sizes exceed the pre-worker viewer's safe limit, narrow/page the request
or defer the feature rather than run heavy processing on the UI thread.

Tauri delivery, external identity providers, coordinate history, native executors,
and local scientific transformations require separate future scope and
qualification. Browser components should remain free of desktop-only APIs so
that later packaging does not require rewriting the UI.

**P0.1-P0.5 complete. Next browser milestone: P1 read-only workspace.**