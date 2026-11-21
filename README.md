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
P1 adds the read-only Dockview workspace described below and is implemented,
deployed, and qualified against the same test backend. P2 replaces the Metadata
placeholder with the read-only catalog browser described below. The Series
viewer remains a P3 placeholder; no samples or domain editing are introduced.

## Running the foundation against the test backend

```sh
npm ci
npm run build
npm run lint
npm test
sudo -A bash deploy/test.sh
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

On shared Linux hosts, unrelated Docker interface churn can make Chromium abort
requests with `ERR_NETWORK_CHANGED`. For repeatable acceptance use:

```sh
sudo -A env PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" npm run test:browser:isolated
```

This enters only the existing test ingress's network namespace and forwards
namespace-local TCP port 18443 to its existing TLS listener on 8443. Requests
still use the same origin, real backend, CA verification, authentication, and
timeouts. No host/container network configuration, service, or trust setting is
changed. The temporary forwarder and its sockets close when the suite ends.

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
Build as the normal workspace user; elevate only `deploy/test.sh` when the test
installation requires it. Do not run the npm build through sudo.

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

The P0-qualified release was `.local/test-web/releases/20261120T080735-1844840`
(superseded by the P1 release below):

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

### P1 workspace acceptance record (2026-11-20)

The read-only workspace delivery milestone is complete at
`https://hydrodb.test:18443/`, release
`.local/test-web/releases/20261120T141205-2262067`.
It uses pinned MIT-licensed Dockview Community 8.9.1 through its imperative API,
with React owning creation and disposal. No enterprise or desktop modules are
installed. The workspace loads lazily; a failed workspace bundle shows an
explicit recovery message without disabling login, health, or sign-out.

- Three bounded singleton placeholders: **Welcome**, **Metadata**, and
  **Series viewer**. Reopening an existing panel selects it instead of creating
  another. No metadata/sample requests, charts, or domain mutations are present.
- Keyboard-accessible controls open/select/close panels, arrange them as tabs
  or side by side, choose compact/tall height, and reset the workspace.
  Dragging is not required for these operations.
- Versioned presentation-only local storage is scoped by backend origin and
  verified principal UUID. Restoration validates bounded sizes/tree structure,
  panel identities, and active references; it reconstructs trusted components
  and titles rather than accepting arbitrary components or parameters.
  Unsupported floating/popout state is rejected. No credentials, protected
  domain data, queries, or scientific cutoffs are stored.
- Invalid/obsolete layouts recover visibly; unavailable storage is reported
  while the workspace remains usable. Logout, expiry, or an unavailable session
  disposes Dockview and its listeners and removes the in-memory workspace.
  Only the presentation layout remains available for a later verified session.

Final validation passes in one run: production build/strict type-check,
warning-free lint, **46 unit/UI tests**, and **24 browser cases**. The browser
matrix is Chrome for Testing 159.0.8154.6 at 100% and native 200%, plus Firefox
159.0 at 100%. Tests include P0 regressions, bounded panel lifecycle, keyboard
arrangement, height/layout restoration, reset, invalid layout/storage recovery,
session cleanup, and failed lazy-bundle isolation. Reflow is checked at 375 CSS
pixels, with forced-colors and reduced-motion checks. Firefox native 200% and a
full accessibility audit remain unqualified.

Published assets are `index-BMGkuBcQ.js`, `index-BSG6yqVr.css`,
`Workspace-BsVjQL6Y.js`, and `Workspace-C5cJDa8H.css`. The workspace JavaScript
is a separate lazy chunk; the initial login/health JavaScript is approximately
236 KB (74 KB gzip). Current readiness is `ready`; all Reader acceptance sessions
are revoked. Actual Reader/admin/ETL credentials are absent from frontend/test
source and published static assets. Backend service start times above and the
PEGELONLINE-only hourly rolling-24-hour schedule are unchanged. Only ingress
was recreated for deployment; no database or backend deployment was required.

### P2 metadata browser

P2 implements the updated requirements' three linked metadata views:
**Filters**, **Tree view**, and **By instance type**. Filters and Tree view
are separate singleton tabs in the original native Dockview left edge group,
ordered Filters then Tree view and pinned open by default. They open when
Metadata or Map is first opened, not with the default
Welcome-only sign-in. Restoring an already-open Metadata panel also supplies
both tools, including from layouts that previously remembered their closure. Metadata
keeps the central instance-type list and icon-only **Reload** action; its old view
buttons are removed. The shared session-owned selection and one captured cutoff
apply to these panels and Map, including while a tab is inactive. Refresh captures a
new cutoff without clearing filters. The shared selection
supports multiple values per attribute (OR), combined attributes (AND), and
explicit refresh of the current catalog. A keyboard-accessible **?** control
to the right of **Filter attribute** reveals or hides the matching rules and
selection limits; the explanation is hidden by default.
Active selections show compact attribute/value chips without a "Remove instance"
prefix. Each chip's **x** button deselects only that value; **Clear all** removes
all filters, with its button matching the filter-chip height. The **Tree view** toolbar has a **Design** selector on the left,
currently offering only **Station tree**, and the settings icon on the right.
Additional designs are reserved for future work; the selector does not change
the current station-based hierarchy. The icon opens **Tree naming settings**,
offering multi-select **Name** and **ID** checkboxes independently for each instance
type shown in the tree, including linked Instruments. **Name** alone is the default;
selecting both displays **Name / ID**, and at least one must remain selected.
These session-owned choices
apply immediately without rereading metadata, resetting expanded branches, or
changing table/detail labels. Name mode uses the stable ID when a name is absent.
Accessible labels and tooltips retain both name and ID to distinguish duplicates.
Available filter values and Tree view entries are ordered alphabetically across
all pages by case-insensitive label/name, falling back to ID. Tree ordering
preserves the hierarchy and does not change when Name/ID visibility changes.
Available values use the Metadata pagination controls: **Rows per page**
(10, 25, or 50; default 50), **of XXX total rows**, first/previous/next/last icons,
and **Page current / total**. Totals count distinct authorized values after
excluding the current attribute's filter. Selecting/deselecting values preserves
the current page without rereading its choices; changing the attribute, page size,
other filters, or read context returns to page 1.
Only the **Available values** area scrolls in Filters. Active selection chips,
Clear all, the attribute/help controls, search, and pagination stay fixed above
it. The values area supports keyboard scrolling and returns to the top when its
page, page size, search, attribute, or read context changes.
Tree view uses the same controls above the tree, paginating only first-level
Stations (10, 25, or 50; default 50). Totals count matching authorized Stations.
Changing the page closes expanded Stations; changing the page size, filters, or
read context returns to page 1. Tree page size is independent of Metadata page
size. Second-level and deeper descendants have no pagination: expanding a
Station automatically loads all matching child paths in sequential bounded
requests at the captured cutoff, retaining earlier paths as later ones arrive.
**Search available values**, directly below **Filter attribute**, narrows choices
by a case-insensitive literal substring of their labels or values across all
pages. Search changes return to page 1 and update the total without changing
selected filters, the tree, or the table. Clearing the search restores all
choices matching the other filters; existing selections remain selected.
Available-value checkboxes have fixed, non-shrinking 16-pixel dimensions,
matching the tree-naming and column checkboxes even when labels wrap.
**Select all on this page** selects or deselects only the currently displayed
values, preserving selections on other pages or hidden by the search. A mixed
checkbox indicates partial page selection. Selecting a page is disabled with an
explanation if it would exceed 20 values per attribute or 12 filter attributes;
deselecting an already selected page remains available. Empty pages disable it.
The download icon beside Reload offers **CSV**, **JSON**, and **Parquet** for
all rows matching the selected instance type and filters, not just the displayed
page. Pages are fetched sequentially with the table's captured cutoff and existing
read limits. Downloads can be cancelled; changing type/filters, reloading, closing
Metadata, or signing out cancels the export. No partial file is downloaded on
failure. Browser exports are limited to 50 MiB of serialized table data and final
file size; larger exports will need future backend download support.
The responsive metadata toolbar places **Instance type** and its selector plus
a **Columns** multi-select dropdown on the left, with matching selector/button
styling, and Reload/download icons on
the right, on one row when space allows. Columns enables/disables table columns
(at least one remains visible). Selectors and icon buttons throughout the
application use a shared 36-pixel control height, including header, tree,
pagination, docking, and Map controls. The circular **?** filter attribute help
button is an exception at 24 by 24 pixels. Graphics inside those icon buttons are
24 pixels; dropdown arrows, checkboxes, logos, and other graphics retain their
existing sizes. Docking tab-close graphics also retain their original 11-pixel
size within the 36-pixel button.
There are no width controls in the dropdown.
Metadata and Map use the same Lucide **refresh-cw** reload graphic, at 24 pixels
inside a 36-pixel button. Its [ISC notice](./public/assets/lucide-LICENSE.txt)
is distributed with the frontend.
The table fills 100% of its panel's available width. Header separators resize
columns by dragging or with Left/Right arrows (10px steps), scaling all visible
columns to their right proportionally while leaving columns to their left unchanged.
Home/End move to the minimum/maximum permitted width without collapsing another
column; the minimum adapts in narrow panels. The last column has no separator.
Width proportions and visibility are retained per instance type while Metadata remains open.
Click a sortable header to alternate ascending/descending order over **all
matching rows before pagination**, using backend sort and the captured cutoff.
Numbers sort numerically; structured values use deterministic PostgreSQL JSON
order; nulls stay last and stable IDs break ties. Current-only Station location
and location status are deliberately unsortable. Sort changes return to the first
page; hiding the sorted column clears that sort. Pagination above the table has
**Rows per page** (10, 25, or 50; default 50) followed by **of XXX total rows**,
icon-only first/previous/next/last
buttons, and **Page current / total**. Exact totals and direct last-page reads
come from the backend at the same cutoff and selection, within the existing
query budget. Empty selections display Page 1 / 1 and of 0 total rows with navigation disabled.
Catalog panels omit the read-context disclosure; reads and exports still use the captured cutoff.
Exports use only enabled columns and the table's global sort order. The combined
name/ID column exports separate name and ID fields. Changes to enabled columns or
sort cancel an in-progress export; resizing alone does not.
JSON retains structured
values, with exact bigint values encoded as decimal strings. CSV and Parquet
encode structured cells as JSON text; Parquet columns are nullable UTF-8 strings
to preserve IDs, revision pins, and timestamp precision. CSV quotes all cells and
prefixes spreadsheet formula-like cells with an apostrophe. Missing cells are
null in JSON/Parquet and empty in CSV. JSON and Parquet include the read context;
CSV contains the table columns only. Historical coordinates are never substituted.
The visible Metadata browser heading,
name/ID search, UTC as-of entry, Active selections heading, and empty-filter
explanation are omitted. Filter chips, clearing filters, and catalog refresh
remain available. Switching views or instance
types does not clear the selection. Active values can be removed individually
or cleared together. Duplicate names remain distinguishable by stable IDs.

**View > Map** opens a dockable OpenStreetMap station panel. With no selection,
it shows all authorized stations; shared filters restrict the station set, with
multiple selected station values combined using the same OR/AND rules as Metadata.
Available-value search alone does not filter the map until values are selected.
All matching station pages are read at the shared cutoff before displaying markers.
Known latitude/longitude coordinates are plotted; missing coordinates are counted
explicitly rather than replaced with zero. Coordinates are current-only; historical
views do not substitute current positions. Stations use 24-pixel-high blue location
pins with white circular centers. Clicking or keyboard-activating a pin highlights
it with a subtle blue halo and white outline and opens a text-only popup linking
the station's exact retained Details. Closing the popup clears that highlight.
The station/coordinate count shares the row above the map with the Reload icon
on the right; the former current-coordinate toolbar text is omitted.
Reload map refreshes the shared metadata view.
The map adapts to docking/resizing and fits newly loaded stations; its position and
station data are not stored in the workspace layout.

Basemap images come directly from `https://tile.openstreetmap.org`, with visible
OpenStreetMap attribution, normal browser caching, and origin-only tile referrers.
OSM receives normal image-request information and viewport tile coordinates, not
station names, IDs, metadata, or HydroDB credentials. Failed tile or station reads
remain explicit and retryable. The CSP allows this image host only; scripts and
API connections remain same-origin. This uses OpenLayers 10.11.0, distributed with its
[BSD license](./public/assets/openlayers-LICENSE.txt), and follows the
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

All nine entity types have paginated lists and linked read-only retained
details. The Station tree expands bounded paths through optional Sampling
positions, Deployments, Parameters/groups and Series, with linked Instruments.
Units and Quality codebooks remain available in instance lists and Details,
but are omitted from the tree. The tree has no list bullets. Each Station and
every child node with descendants has an icon-only chevron toggle with an
accessible Expand/Collapse name and expansion state; leaves have no toggle.
Stations start collapsed; child branches (including the second level) start
expanded and retain their individual states when an
ancestor is collapsed and reopened. Closing a Station still cancels its reads.
Authorized empty groups, standalone installations,
Stations without children, and orphan instances are not invented or hidden by
mandatory browser-side inner joins. Dataset Readers still see only metadata
reachable through their actual grants; an empty type is legitimate.

Navigation uses the backend's documented `GET /api/v1/metadata/browser` extension
rather than fetching the catalog into JavaScript. Retained revisions and lazy
scientific context use the existing read endpoints. The first read captures a
cutoff reused across pages, facets, paths, exact linked details, revisions and
context; explicit refresh starts a new view. Coordinates are labelled
current-only, not historical observation locations or measurement references.
The metadata client and Details retain as-of coordinate suppression, although
the catalog no longer exposes an as-of input. Exact reference pins,
bigint versions, IDs, microsecond timestamps, and structured JSON types are
preserved. Structured attributes render as text/data, never executable markup;
processing-input and measurement-Unit links retain their scientific pins.

Budgets are explicit: 10/25/50 table rows, filter values, or first-level Stations
per page (default 50), 25 child paths and sequential export rows per request;
at most three expanded
Station branches; four simultaneous metadata reads; 2 MiB response limit;
12 cached entries and a 4 MiB encoded-payload cache budget (individual cached
responses at most 1 MiB). SQL catalog execution is capped at 9 seconds and the
browser transport at 10 seconds. Oversized, malformed, unauthorized, unavailable
history, and failed reads have explicit states/retry; none become empty success.
Superseded reads are cancelled/ignored and a current 401 expires the workspace.
There is no polling or focus refetch.

The cache and selections exist only in the verified session's Workspace;
logout, expiry, workspace unmount or explicit session revalidation dispose them. Seven
bounded singleton panels include **Welcome**, **Health**, **Metadata**, **Map**,
**Filters**, **Tree view**, **Series viewer**, and **Details**. Presentation layout format 2
rejects obsolete layouts visibly; it never stores queries, selected IDs, pins,
cutoffs, metadata bodies, or credentials. Opening a linked detail selects the
same Details panel rather than accumulating panels.

After sign-in, backend/database health is opened through **Tools > Health**,
not displayed above the workspace. It supports
the same docking, closing and presentation-only layout restoration as other
singleton panels; closing it cancels its pending checks. Database login/session
controls are under the always-visible identity/avatar button at the top-right
of the sticky header. It shows only the signed-in initials or a generic user
icon; the session identity remains inside the popup. The popup supports keyboard opening,
Escape with focus return, and outside-click dismissal; closing clears any
unsubmitted password. Successful login closes it, while expiry and session
errors remain explicit. No remote avatar service or browser credential storage
is used. Public health checks remain available
before sign-in and while session verification or workspace loading fails.
Existing version-2 layouts remain valid.

Health-panel refinement (2026-11-20): release
`.local/test-web/releases/20261120T163446-2518771` passes build/type-check,
warning-free lint, **54 unit/UI tests**, and all **30 browser cases**.
Browser checks cover Health singleton opening/closing, docking/restoration,
narrow-screen use, expiry, and lazy-workspace failure recovery. Only frontend
ingress was recreated; backend readiness remains `ready` and all Reader
acceptance sessions are revoked.

Full-width/header-icons refinement (2026-11-20): release
`.local/test-web/releases/20261120T165712-2561734` passes build/type-check,
warning-free lint, **55 unit/UI tests**, and **six focused browser cases** across
Chromium, Chromium at native 200% zoom, and Firefox. Checks cover full-width
layout, Help/Settings keyboard opening and dismissal, avatar login/session
controls, narrow popup bounds, workspace docking/restoration, and sign-out.
Backend readiness remains `ready` and no Reader acceptance sessions remain.

The workspace fills the browser width and all remaining height directly below
the menu bar, with no side gutters, enclosing card, panel count, or footer.
The header title is **Next-generation HydroDB Demonstrator** and wraps on narrow
screens without pushing the identity controls off-screen.
The header uses 9-pixel vertical padding and has a normal desktop height
of 55 pixels with 36-pixel icon click targets.
There are no fixed-height/tall/compact controls; resizing the browser resizes
the dock. Panel contents scroll independently of the header and menu bar.
The top-right header contains an icon-only Settings placeholder followed
by a compact 26-pixel purple circular avatar without an enclosing box or visible
username. Both icons use 36-pixel click targets, 24-pixel graphics, and rounded-square
hover backgrounds.
The header Settings icon matches Tree view's settings gear, including artwork,
color, stroke weight, and size.
The username remains available in the session popup and its accessible
description. Settings opens a dismissible placeholder popup and does not change
application configuration. Help is available as a dummy menu entry, not a
second header icon.

The menu bar contains **File**, **Edit**, **View**, **Tools**, and **Help**.
View manages Welcome, Metadata, Map, Series viewer, and layout commands. Filters
and Tree view are selected through their edge tabs, not View menu entries. Tools opens
Health; its checkmark indicates whether Health is open. Details opens from
instance links in Metadata, including reopening after closing its tab.
Neither Health nor Details appears in View. File, Edit, and Help remain disabled
placeholders. These menus replace the individual panel buttons and panel selector:

- Select a closed panel to create it; select an open panel to activate its tab
  and bring its group forward without creating a duplicate.
- Newly opened Welcome, Health, Metadata, Map, and Series viewer panels share the
  central tab group. Newly opened or reopened Details opens to the right of
  the source panel, rather than a fixed central group. An already-open Details
  panel is activated in its existing docking position.
  Filters and Tree view default to the pinned left edge group, ordered Filters
  then Tree view; they can be
  selected and dragged, but cannot be closed while Metadata or Map is open. Their
  tabs have no close button, Delete/Backspace does not close them, and
  **Close Active Panel** is disabled for them. Closing the last Metadata/Map panel removes both
  tools; reopening either supplies both again. Arrange as Tabs/Side by Side
  leave these tool panels in place.
- Close other tabs with their **x**, or use **View > Close Active Panel**.
- Drag tabs to dock them. **Shift-drag** uses Dockview's native floating gesture;
  **View > Float Active Panel** is the keyboard alternative.
- Reopening other panels prefers its previous tab index/group, neighboring split, or floating
  bounds. Closed-panel positions survive reload without undoing other panels.
  If the previous location no longer exists, use the panel's default location.
- **Reset Layout** clears remembered positions and returns to Welcome only.
  **Arrange as Tabs** and **Arrange Side by Side** remain keyboard alternatives.

Menus support keyboard opening, arrow navigation, Escape, and outside dismissal.
View and Tools are unavailable before sign-in or while the workspace is loading/failed.
Presentation-only layout format 2 validates bounded floating groups, the trusted
left edge group, and closed-panel snapshots. Previously saved stacked
Filters/Tree view panels are returned to the original edge tabs without resetting
other panels; the stable internal panel IDs are retained.
Other edge positions, popout windows, arbitrary components/parameters, and
protected domain state remain excluded. Legacy fixed heights are ignored.

Menu/full-viewport acceptance (2026-11-20): release
`.local/test-web/releases/20261120T172529-2611683` passes build/type-check,
warning-free lint, **61 unit/UI tests**, and all **33 browser cases**.
The matrix covers Chromium at 100% and native 200% zoom and Firefox at 100%.
Real tab dragging, Shift-drag floating, close/reopen after reload, singleton
activation, Reset Layout, failure recovery, metadata browsing, and session
expiry pass. Geometry checks verify that the dock reaches both browser edges
and fills the height below the menu bar at desktop and narrow widths without
document scrolling. Floating restoration allows one CSS pixel for browser
subpixel quantization.

The subsequent CSS-only title/avatar reduction is published as
`.local/test-web/releases/20261120T173119-2626474`, with build/type-check, lint,
and the three workspace browser cases passing. Computed title sizes are
19.2 pixels (14.72 on narrow screens), reduced by 20%; the avatar is 26 pixels
with a 16-pixel signed-out glyph and an unchanged 40-pixel click target.

Panel-menu/tree refinement (2026-11-20): release
`.local/test-web/releases/20261120T174124-2642877` passes build/type-check,
warning-free lint, **62 unit/UI tests**, and **12 focused browser cases** across
Chromium, native 200% zoom, and Firefox. Checks cover Tools > Health readiness,
View exclusions, Details reopening from Metadata, icon-only Station toggles,
tree reference exclusions, and all nine instance lists. Tools stays disabled
until its workspace action is ready, avoiding a login/loading menu race.
Backend readiness is `ready`; no Reader acceptance sessions remain.

Compact-header/nested-tree refinement (2026-11-20): release
`.local/test-web/releases/20261120T174924-2656826` passes build/type-check,
warning-free lint, **three focused metadata UI tests**, and **six focused
browser cases** across Chromium, native 200% zoom, and Firefox. Checks verify
the 59-pixel desktop header, retained 40-pixel icon targets, bullet-free tree,
nested mouse/keyboard toggles, collapsed Stations and expanded child defaults,
preserved descendant states, and exact Details navigation pins.
Backend readiness remains `ready`; no Reader acceptance sessions remain.

Metadata-controls removal (2026-11-21 local time): release
`.local/test-web/releases/20261120T232636-2955464` passes build/type-check,
warning-free lint, and **four focused metadata UI tests**. All **six P2 browser
cases** are qualified across Chromium, native 200% zoom, and Firefox: real
catalog cases passed first, followed by the corrected, explicitly scoped
structured-attributes fixture cases. The removed heading, Search/As-of fields,
Active selections heading, and empty-filter explanation are absent; refresh,
filter chips, Details pins, historical coordinate suppression in the component,
and explicit errors/expiry remain covered. Backend readiness is `ready`;
no Reader acceptance sessions remain.

Pinned left-edge tools acceptance (2026-11-21 local time): release
`.local/test-web/releases/20261120T234120-2980025` passes build/type-check,
warning-free lint, **67 unit/UI tests**, and **15 focused browser cases** across
Chromium, native 200% zoom, and Firefox. Checks cover real native left-edge
placement, shared filters/cutoff, Details pins, all entity lists, explicit
errors/expiry, independent tool closure/reopening, layout reload/reset,
and floating bounds remembered after sidebar-induced reflow.
The final release `.local/test-web/releases/20261120T234430-2987653` additionally
qualifies restoring older layouts with Metadata already open: build/type-check,
lint, **67 unit/UI tests**, and the **three expanded left-edge browser cases**
pass. Empty auto-reveal edges use the live group API before their first panel,
because Dockview intentionally omits them from serialization.
Backend readiness remains `ready`; no Reader acceptance sessions remain.

Metadata tools/download acceptance (2026-11-21 local time): release
`.local/test-web/releases/20261121T063150-3460998` passes build/type-check,
warning-free lint, **76 unit/UI tests**, and **18 focused browser cases** across
Chromium, native 200% zoom, and Firefox. Checks cover non-closable companion
tabs, removal with Metadata and restoration/reload/reset, source-relative
Details positioning (including the native left edge), icon-only Reload,
all-page CSV/JSON/Parquet downloads, readable Parquet contents, exact structured
values, cancellation, the actual 50 MiB export threshold, explicit errors/expiry,
and remembered split/floating layouts. Backend readiness is `ready`;
no Reader acceptance sessions remain. Backend export support remains future work.

Metadata table acceptance (2026-11-21 local time): release
`.local/test-web/releases/20261121T064511-3484147` passes build/type-check,
warning-free lint, **80 unit/UI tests**, and **15 focused browser cases** across
Chromium, native 200% zoom, and Firefox. Three additional download/table runs
verify actual rendered widths after keyboard and pointer resizing. Checks cover
column visibility, per-type widths, global ascending/descending sort and
pagination reset, top pagination, selected-column CSV/JSON/Parquet exports,
real authorized sorting, exact values, errors/expiry, and protected tool lifecycle.
Backend image `hydrodb:test-table-20261121` passes targeted clippy and two
PostgreSQL catalog regressions, including numeric order, nulls-last, tied values,
stable pagination after later revisions, and invalid sorting/cursor rejection.
The configured test-image tag is promoted to the same image; rollback image
`hydrodb:test-pre-table-20261121` is retained. No schema or hourly-feed changes
are required. Backend readiness remains `ready`.

Compact metadata toolbar/pagination acceptance (2026-11-21 local time): release
`.local/test-web/releases/20261121T070832-3518173` passes build/type-check,
warning-free lint, **81 unit/UI tests**, and **15 focused browser cases** across
Chromium, native 200% zoom, and Firefox. Checks cover responsive one-row
left/right toolbar alignment, the Columns checkbox multi-select, header-only
resizing with an actual 300-pixel rendered width, native download popovers,
selected-column all-row exports, exact totals, first/previous/next/last navigation,
and 10/25/50-row page sizes (default 50). Invalid or unsafe response totals fail
explicitly. The initial combined browser run exposed a test race with native
menu opening focus; the helper now waits for that focus before selecting an item,
and the full focused matrix passes. Backend image
`hydrodb:test-toolbar-20261121` passes two PostgreSQL catalog regressions and
targeted clippy, covering authorized counts, pinned globally sorted pages,
empty/out-of-range pages, and invalid numbered-page inputs. The configured
test-image tag points to this image; rollback image
`hydrodb:test-pre-toolbar-20261121` is retained. Deployment waited for active
hourly ingestion to finish and recreated only the application and frontend
ingress. No schema, feed, or schedule changes were made. Backend readiness is
`ready`; no Reader acceptance sessions remain.

Alphabetical navigation acceptance (2026-11-21): release
`.local/test-web/releases/20261121T111206-3760737` passes build/type-check,
warning-free lint, **27 focused unit/UI tests**, and **12 browser cases** across
Chromium, native 200% zoom, and Firefox. Real catalog checks verify alphabetical
ordering across available-value pages, numbered pagination, retained selections,
and tree ordering alongside naming, downloads, details, and explicit errors.
Backend image `hydrodb:test-alphabetical-20261121` passes **three PostgreSQL
catalog regressions** and all-target Clippy, including frozen name/ID ordering,
hierarchical branch pagination, authorized facet totals, empty pages, own-filter
exclusion, and invalid cursor rejection. Branch labels are aggregated set-wise;
path bodies are constructed only after limiting the ordered page.
The configured test-image tag points to this image; rollback image
`hydrodb:test-pre-alphabetical-20261121` is retained. Only the application and
frontend ingress were recreated, after confirming ingestion and jobs were idle.
No schema, feed, schedule, or edge-layout changes were made. Backend readiness
is `ready`; no Reader acceptance sessions remain.

Available-value search acceptance (2026-11-21): release
`.local/test-web/releases/20261121T112109-3776222` passes build/type-check,
warning-free lint, **nine focused UI tests**, **three PostgreSQL catalog
regressions**, all-target Clippy, and **six browser cases** across Chromium,
native 200% zoom, and Firefox. Checks cover search placement below the selector,
case-insensitive label/value substrings across pages, matching totals, empty
results, clearing back to page 1, retained selections, authorized-only choices,
literal wildcard characters, frozen cutoffs, and searched cursor pagination.
Backend image `hydrodb:test-value-search-20261121` is promoted to the configured
test-image tag; rollback image `hydrodb:test-pre-value-search-20261121` is retained.
Only the application and frontend ingress were recreated while ingestion and
jobs were idle. Schema, feeds, schedules, and edge layout are unchanged.

Checkbox/page-selection acceptance (2026-11-21): release
`.local/test-web/releases/20261121T112903-3787010` passes build/type-check,
warning-free lint, **10 focused UI tests**, and **six browser cases** across
Chromium, native 200% zoom, and Firefox. Checks verify actual 16-by-16 CSS-pixel
checkbox dimensions throughout a 50-value page, keyboard bulk selection,
mixed state, page/search-local deselection, preserved off-page selections,
selection of exactly 20 values, and explicit rejection of a 21st bulk value.
Only the frontend ingress was recreated; the backend, schema, feeds, schedules,
and edge layout are unchanged. Readiness is `ready`; acceptance sessions are revoked.

Map/menu acceptance (2026-11-21): release
`.local/test-web/releases/20261121T115839-3825159` passes build/type-check,
warning-free lint, **32 focused unit/UI tests**, and **15 browser cases** across
Chromium, native 200% zoom, and Firefox. Checks cover all-page authorized station
reads, all stations with empty filters, synchronized selections, exact Details
navigation, explicit coordinate/read errors, real OSM tiles and attribution,
Map layout restoration, and companion-tool ownership. Filters and Tree view
remain native edge tabs, not View menu entries; regressions also verify native
tab collapse/reveal, keyboard controls, protected tools, and saved-layout recovery.
Browser navigation reveals hidden edge panels without collapsing visible ones.
The Leaflet license is served with the client assets. Only frontend deployment
changed; backend, schema, feeds, and schedules are unchanged. Readiness is
`ready`; acceptance sessions are revoked.

Filters values-only scrolling deployment (2026-11-21): release
`.local/test-web/releases/20261121T130619-3928666` keeps Filters controls fixed
above the independently scrolling Available values area. Build/type-check,
warning-free lint, and 12 focused metadata tests pass. Three deployed browser
checks pass in Chromium, native 200% zoom, and Firefox, verifying keyboard
scrolling, stationary upper controls, and scroll reset after page changes.
The served entrypoint matches the build and backend readiness reports `ready`.
Only frontend ingress was recreated.

24-pixel help button deployment (2026-11-21): release
`.local/test-web/releases/20261121T130244-3922723` reduces the circular **?**
button to 24 by 24 pixels, leaving other controls unchanged. Build/type-check
and warning-free lint pass. Three deployed browser checks pass in Chromium,
native 200% zoom, and Firefox, verifying help dimensions and filter/tree keyboard
controls. The served entrypoint matches the build and backend readiness reports
`ready`. Only frontend ingress was recreated.

Tree root pagination and help sizing deployment (2026-11-21): release
`.local/test-web/releases/20261121T125816-3916077` includes first-level-only
numbered Tree pagination, automatic child-path loading, and the 30-pixel **?**
button. Build/type-check, warning-free lint, and 12 focused metadata tests pass.
Three deployed browser checks pass in Chromium, native 200% zoom, and Firefox,
covering help sizing and filter/tree keyboard controls. The served entrypoint
matches the build and backend readiness reports `ready`. Only frontend ingress
was recreated.

Shared control sizing acceptance (2026-11-21): release
`.local/test-web/releases/20261121T122504-3864958` passes build/type-check,
warning-free lint, and **12 browser cases** across Chromium, native 200% zoom,
and Firefox. Rendered measurements verify 36-pixel selectors/icon buttons and
24-pixel graphics inside icon buttons, with dropdown arrows remaining 16 pixels.
Checks cover toolbar alignment, header and docking controls, pagination, tree
settings/disclosure, filter-chip removal, Clear all height matching, and Map
zoom/popup controls. Responsive layouts, keyboard navigation, exports, and Map
error/retry behavior remain qualified. Only frontend ingress was recreated;
readiness is `ready` and acceptance sessions are revoked.

OpenLayers/pin acceptance (2026-11-21): release
`.local/test-web/releases/20261121T124013-3889701` replaces Leaflet with
OpenLayers 10.11.0 and passes build/type-check, warning-free lint, **22 focused
unit/UI tests**, and **six Map browser cases** across Chromium, native 200% zoom,
and Firefox. Checks verify real OSM tiles rendered onto the canvas, origin-only
tile referrers, authorized all-page reads, shared filters, 24-pixel blue pins with
white centers, keyboard selection/highlighting and popup dismissal, exact Details,
valid polar coordinates, explicit read/tile retries, and restored Map/tool layouts.
The station count is below the map and the current-coordinate toolbar text is
absent. The served OpenLayers BSD notice matches the installed dependency.
Only frontend ingress was recreated; backend, schema, feeds, and schedules are
unchanged. Readiness is `ready`; acceptance sessions are revoked.

Count placement follow-up: release `20261121T124249-3894571` restores the
station count above the map, while leaving the old coordinate toolbar text
removed. Build/type-check, lint, and all three focused Map browser cases pass.

Reload/header-row acceptance: release `20261121T124638-3900131` uses Lucide's
shared refresh-cw graphic for Metadata and Map. Build/type-check, lint, **13
focused UI tests**, and **six browser cases** pass across Chromium, native
200% zoom, and Firefox. The Map count and reload button share one row above
the map, with measured center alignment and unchanged 24/36-pixel sizing.
Map retries, pin interaction, and Metadata exports remain qualified.

The Health panel also contains **Check session**, alongside **Check health
again**. It revalidates the signed-in session and refreshes the workspace and
health state; it is disabled during session operations. Identity details and
**Sign out** remain under the avatar. Recovery after an unavailable or uncertain
session still offers **Retry session check** in the login popup.

Health/session and compact-avatar refinements (2026-11-20): release
`.local/test-web/releases/20261120T170131-2570769`. The session move passes
build/type-check, lint, **56 unit/UI tests**, and six focused browser cases.
The subsequent CSS-only refinement passes build/type-check, lint, and the three
workspace browser cases, asserting rounded-square hover backgrounds, 32-pixel
avatars, and unchanged 40-pixel click targets across Chromium, native 200% zoom,
and Firefox.

Header-identity refinement (2026-11-20): release
`.local/test-web/releases/20261120T164726-2541099` passes build/type-check,
warning-free lint, **55 unit/UI tests**, and all **30 browser cases**.
Checks cover keyboard login/session/logout, popup dismissal and focus return,
the sticky avatar after scrolling, and a viewport-bounded popup at narrow
widths and native 200% zoom. The initial browser run exposed a misplaced
keyboard-test edit; the corrected case passes across all three configurations.
Backend readiness remains `ready`; no Reader acceptance sessions remain.
Backend/database services and hourly ingestion were unchanged.

Samples/charts, editing, exports, transforms, jobs, ETL controls, historical
coordinate reconstruction, and scientific execution remain outside P2.
Next is **P3: first sample viewer**. Full accessibility, endurance, broader
browser support, and production acceptance remain separate qualification.

#### P2 acceptance record (2026-11-20)

Production build/strict type-check, warning-free lint, and **53 unit/UI tests**
pass. The complete **30-case P0/P1/P2 browser suite** passes in one run using
`test:browser:isolated`: Chrome for Testing 159.0.8154.6 at 100% and native 200%,
plus Firefox 159.0 at 100%. The namespace runner avoids observed shared-host
`ERR_NETWORK_CHANGED` failures without retries, longer deadlines, TLS bypass,
or changes to the application's transport behavior.

Real Reader flows cover paging, three shared filter values, Station expansion,
linked retained details, all nine result types, scientific context/revisions,
one cutoff, session disposal, no mutations, no protected layout persistence,
375-CSS-pixel reflow, forced colors and reduced motion. Browser-local fixtures
cover maximum bigint pins, nested JSON types/non-executable markup, pinned
processing-input and measurement-Unit links, as-of coordinate suppression after
cutoff capture, HTTP 403/404/409 and current-401 cleanup.

Backend validation passed all 31 metadata and six route-contract tests, followed
by the expanded focused catalog regression after the final graph/owner-version
fixes; all-target warning-free Clippy passes. Coverage includes authorization,
duplicate names, orphan Units, empty groups, standalone deployments, optional
path levels, exact retained versions, literal search, and rejected input.
Entity identity columns are not outgoing references, and a Parameter group's
own version is retained rather than stripped as if it were a Parameter pin.

On the actual test catalog, nine bounded list reads measured **265-550 ms**;
the sampled relational filter, Station branch and facet reads measured
**267-481 ms**, scientific context **135 ms**, and retained revisions **311 ms**.
These are individual acceptance observations, not load/endurance guarantees.
Authorization and commit visibility are evaluated set-wise; query-local JIT
settings do not alter database-wide configuration.

- Frontend release: `.local/test-web/releases/20261120T154431-2423356`.
- Assets: `index-CiiwSSjc.js`, `index-DOMYh-Dk.css`,
  `Workspace-C4zP8X-_.js`, and `Workspace-C5cJDa8H.css`.
- Backend: HydroDB `0.1.0`, schema `25`, image `hydrodb:test-p2-20261120`,
  SHA-256 `0ae3693960bbc5448f79cf315d7dc0a068124f8807cd8db5c4a9305a6247ee3c`.
- No database migration or grant/credential change. DB, backup and Swagger
  retain their previous start times; hourly PEGELONLINE/rolling-24-hour ingestion
  is unchanged. Deployment recreated only the application and ingress.
- Final readiness is `ready`, active Reader acceptance sessions are zero, and
  actual protected Reader/admin/ETL credentials are absent from all 132 scanned
  source/test and built/published-asset files.

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

**P0.1-P0.5, P1 and P2 complete. Next browser milestone: P3 first sample viewer.**