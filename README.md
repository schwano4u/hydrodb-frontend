# HydroDB frontend

React, TypeScript, and Dockview browser workspace for HydroDB. It uses the
same-origin REST API; access to metadata, observations, and jobs is enforced
by the backend.

## Workspace

- **View** opens dockable panels. **Layout** manages named Private and Public
  workspaces; publishing a Public layout requires `layout_publisher`.
- Right-click a panel tab and choose **Open in New Window** to move it to a
  separate browser window. Close that window to return the panel to the
  workspace. **Filters** and **Tree view** stay in the main window. Close
  secondary windows before saving or applying a named layout.
- **View > New Map** and the Map tab's **Open in New Window** open independent
  copies (up to four), without moving the primary map. Each copy starts with the
  current selection and classification. The copied filters and polygon are
  hidden and fixed, but classification remains editable. Right-click a
  panel tab in a secondary window to **Rename Panel**. Use **Copy to…** on
  the primary Map tab to add a copy to an existing secondary window, or
  **Move to…** on a map copy to move it to another secondary window.
  Each copy opens in a Dockview frame. Right-click a graph or data-table tab
  to move it to another window, split it to the right, or move it back to the
  main window. Closing a map window discards the copy and returns the other
  panels. Independent map windows are never saved in layouts.
- **View > New Time Series Graph** opens a blank graph (up to four). Select
  the graph you want to use before opening series from Metadata. Each graph
  has its own sample query and matching data table.
- **Metadata** supports browsing, filters, details, and selection. Tables under
  **By instance type** start at 10 rows. Series coverage reports the first and
  last available samples at the selected cutoff.
- **Station map** uses the metadata filters. Click the polygon icon to begin,
  click to add vertices, and double-click to close and apply. Use the same
  control again to clear the polygon. **Classify stations** colors pins by
  provider or owner, latest sample timestamp, or latest value. The sample
  modes select a parameter by name and a processing level (Raw by default);
  latest value also selects a common unit and requires a unique matching
  series. Latest timestamp picks the newest sample timestamp across all
  readable matching series.
- **Time series graph** and **Time series data** share the selected series,
  UTC window, and cutoff. The table shows one series or aligns multiple series
  by timestamp. **Columns** can show occurrence time, recording principal and
  recording time; all three are hidden by default. In aligned mode they are
  selectable per series.
- **Tools > Jobs** exposes ETL status and safe diagnostics to authorized
  operators and administrators.

## Browser implementation plan

The original milestone IDs below describe delivery order, not the priority
labels in the requirements. The test baseline is frontend
`20261124T193023-2744172` with backend
`hydrodb:test-metadata-location-20261124`. Readiness, asset checks, and six
targeted Chromium/Firefox smoke tests passed. This is not full release
qualification or a production rollout.

| Milestone | Status | Delivered scope or remaining gate |
| --- | --- | --- |
| P0: Login and health | Implemented | Same-origin REST sessions, sign-in/out and session restoration, separate liveness, readiness, and authenticated database status. No direct browser-to-PostgreSQL login. |
| P1: Workspace | Implemented and deployed to test | Dockview panels and named layouts; independent map copies; movable graph/data panels; account-scoped reload of checked series, filters, polygon, and graph queries. Named layouts remain layout-only; pop-outs do not reopen automatically. |
| P2: Catalog and map | Implemented and deployed to test | Paginated metadata, read-only details, series coverage, polygon filtering, station classification, and refresh timestamps. The Station location cell shows latitude / longitude with a Details action; historical coordinates are not substituted. |
| P3: Sample viewer | Implemented and deployed to test | Open visualization from Metadata selection, per-graph UTC ranges and cutoffs, charts with linked exact data tables, and timestamp selection with nearest-value labels. |
| P4: Scientific viewing | Implemented in part; acceptance open | Scalar/vector and interval views, quality and scientific context, and aligned tables are available. Audit the remaining requirements against independent fixtures for retained pins and lineage, calendar/period and occurrence semantics, and missing, censored, rejected, partial, or stale data. Record and close gaps rather than treating fixture smoke tests as acceptance. |
| P5: Performance | Open | Measure live catalog and map reads (including DWD and PEGELONLINE) separately from browser processing. Measure cold/warm startup, interaction, plotting, cancellation and memory under bounded workloads. Use Workers or Rust/Wasm only if measurements justify them; keep REST authoritative and narrow queries that exceed safe limits. |
| P6: Browser release | Open | Run the full supported browser matrix, including narrow windows, 200% zoom, keyboard/focus, high contrast, and reduced motion. Verify real authenticated reads, authorization and session failure paths, release rollback, build/license inventory, and endurance. Publish evidence against the requirements before proposing production deployment. |

**Real-data check (2026-11-24, test):** At a shared read cutoff, the coverage
and timestamp-summary endpoints agreed with the last sample read for DWD
00259 one-minute precipitation (60 samples in the checked hour) and
PEGELONLINE Köln river stage (4 samples). Both series opened from Metadata
into a chart and data table in Chromium and Firefox, without mocked data.
For DWD 02667, three raw wind-speed series shared the newest timestamp.
The unique-match API returned `ambiguous`; latest-timestamp mode returned
the tied timestamp and chose the series with the lowest ID. This verified
the live API, not the map UI for that station or ongoing feed freshness.

**Next:** Use DWD precipitation and PEGELONLINE river stage as real interval
and instantaneous fixtures, respectively. Add controlled fixtures for
retained versions, vectors, and non-valid or partial samples to close the P4
gaps in the [viewer requirements](../hydrodb-requirements/docs/frontend/timeseries-graph.md).
Measure the P5 budgets separately; one-hour smoke runs do not qualify them.

For P5, use the proposed requirements budgets as measurement targets: usable
cold shell within 3 s p95, interaction feedback within 100 ms p95, and a
usable plot within 1 s p95 after delivery of a complete bounded 100,000-sample
fixture, with at most 20,000 displayed vertices. Record browser, hardware,
network profile, and p50/p95 before deciding whether to change the design or
approve the budgets.

## Development

```sh
npm ci
npm run lint
npm test
npm run build
```

To run the Linux browser suite against the existing test HTTPS ingress, install
Playwright Chromium and Firefox (`npx playwright install chromium firefox`)
and the NSS certificate importer (`certutil`, from `libnss3-tools`), then run
`npm run test:browser`. The suite uses temporary browser profiles with the test
CA and reads the Reader password from a protected file. Set
`HYDRODB_BROWSER_PASSWORD_FILE` to select another protected credential file.
Use `npm run test:browser:isolated` if shared-host network changes interrupt
Chromium. Neither mode disables TLS verification.

## Test deployment

`npm run deploy:test` builds and publishes to the existing
`https://hydrodb.test:18443/` test ingress. If publishing requires elevated
access, build as the workspace user, then run `sudo -A bash deploy/test.sh`.
The deploy script is restricted to `hydrodb-empty-test` and recreates only
the ingress, using the [frontend Compose overlay](deploy/compose.frontend.yaml).
It does not deploy the backend or change the database or feed schedules.

## Requirements and previews

See the [frontend requirements](../hydrodb-requirements/docs/frontend/general.md)
and [time-series viewer requirements](../hydrodb-requirements/docs/frontend/timeseries-graph.md).
The standalone previews are generated locally from shared frontend code and
fixtures. With the requirements checkout beside this repository, run
`node build-components-preview.mjs` or `node build-timeseries-preview.mjs`.
Open the output path printed by the builder. Do not commit generated HTML.
