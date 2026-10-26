# Repository review and improvements

Reviewed on 2026-10-26. Scope: Flask routes and persistence, React and legacy templates, import/parsing/maintenance tools, configuration, dependency manifests, shell scripts, Docker images/Compose files, and tests. Generated captures, local credentials, virtual environments, and dependency source trees are runtime inputs rather than application source.

## Fixed security findings

| Finding | Impact before the change | Implemented change |
| --- | --- | --- |
| Predictable session secret and admin password | Forged sessions and access with known credentials | Production rejects weak/missing settings; local admin access requires an explicit password; deploy generates random values |
| Public mutation and diagnostics routes | Unauthenticated event changes, extraction resource abuse, disclosure of logs and internal paths | Authentication on extraction, extracurricular mutations, debug/capture/download/export routes |
| Repository-wide download handler | Configuration, database, and `.env` disclosure; traversal and symlink escapes | Exact export allowlist, resolved-path checks, authenticated attachments; publisher CSV remains available to admins |
| Captured HTML served inline | Fetched HTML could execute with application origin | Captured responses download as attachments; `nosniff` and frame protection |
| CSRF on authenticated mutations | Another site could modify inventory/events with a browser's credentials | Session token required on browser mutations, cross-site checks, token rotation on login, matching form/fetch integration |
| Unbounded process-local login failures | Limits could be bypassed across workers; attacker-controlled dictionary growth | Expiring SQLite-backed counters shared by workers; one authentication evaluation per request |
| Arbitrary feed URLs and redirects | Server/browser access to unintended hosts or internal services | Trusted HTTPS hosts, public DNS checks, redirect and browser-subresource validation, no ambient HTTP proxy/netrc credentials |
| Unbounded fetches and recurrence expansion | Excessive memory, disk, or worker time | Request/upload, HTTP body/time/redirect, recurrence frequency/count, and export-render concurrency limits |
| External executable admin dependencies | Authenticated admin page trusted runtime CDN code | Locally bundled admin entry and same-origin script/connect CSP |
| Stale dependency tooling | 13 npm audit findings, including critical development-tool findings | Upgraded Vite/plugin/Vitest and transitive packages; audited pinned Python runtime lock |
| Shell command interpolation / worker privileges | Config values interpreted as shell code; worker could write the source checkout | Literal argument execution, privilege drop before application setup, non-root worker with restricted state mounts |
| Unsafe calendar and spreadsheet serialization | Calendar text could introduce ICS properties or spreadsheet formulas | Library-based RFC 5545 serialization, UTC conversion, formula-safe CSV cells, atomic export writes |

Browser session cookies are HttpOnly and SameSite=Lax. Set `SESSION_COOKIE_SECURE=1` when deploying behind HTTPS. Basic-auth command-line clients without browser-origin headers can continue to make authenticated API mutations without a session token.

The network policy follows the allowlist approach described in the [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). Cookie, request-size, CSRF, and response-header choices also follow [Flask's security guidance](https://flask.palletsprojects.com/en/stable/web-security/). Custom providers require exact hostnames in `CALENDAR_ALLOWED_HOSTS`. Network-level egress rules remain appropriate defense in depth, particularly for custom providers; DNS validation is not socket-level address pinning.

Tracked runtime logs, fetched HTML, and bytecode were removed from Git's index; local copies remain. This does not erase historical commits. If an older version was publicly deployed, rotate its session secret and admin password because its download handler could expose them. Investigate access logs before deciding whether any calendar publication tokens need replacement.

## Fixed correctness and performance findings

- Cleanup retains future bookings; the previous 60-day future cutoff conflicted with the 240-day extraction window.
- Failed or malformed imports retain authoritative future data. Missing captures and failed browser navigation no longer publish empty snapshots.
- JSON publication uses unique temporary files and atomic replacement. Metadata merges lock the complete read/modify/write operation across processes.
- The full import pipeline is shared by periodic refresh and admin refresh, with full-run and per-calendar locks. Inventory uploads refuse active imports instead of killing arbitrary PIDs.
- Inventory uploads validate the complete CSV before writing, preserve manual/extracurricular records, update metadata transactionally, and launch extraction outside the HTTP request. The old request could synchronously fetch every calendar and time out after destructive resets.
- SQLite schema setup is cached per database identity and serialized. Connections close deterministically; no global monkey-patch of `sqlite3.connect` remains. WAL and bounded connection caches replace repeated schema checks and large per-connection allocations.
- Schedule normalization runs once per input generation and is indexed by date. Group/room/subject/professor filters apply consistently to imported and manually entered events.
- Schedule fingerprints cover every input's nanosecond timestamp, size, and inode, plus the local date. Workers reuse a persisted build fingerprint. Lock contention never launches a competing fallback builder.
- Per-calendar snapshots take priority over stale merged output, so removed bookings are not resurrected. Staging files are excluded from schedule input.
- JSON and parser caches are bounded. Public departure polls do not append duplicate-event logs or mutate shared cached event objects. Log tail reads are bounded.
- Disabled calendars stay disabled across ordinary population and are excluded from public events and extraction scheduling.
- Frontend filters debounce requests, reuse the unfiltered lookahead, and ignore aborted results. Week/day queries use local dates; calendar-day arithmetic preserves dates across daylight-saving transitions. Sunday inclusion and exact event-end status were corrected.
- Admin polling slows while idle; log membership checks use a set rather than repeated linear scans.
- Export rendering uses in-memory bytes and blocks page network access, avoiding leaked temporary directories.

A local synthetic benchmark with 10,000 structured bookings, three warmup requests, and 20 `/events.json` requests measured median latency of **61.47 ms before vs 53.19 ms after** (p95 62.48 vs 55.72 ms). Both variants used the same current dependency environment. This is a single-process application benchmark, not a production capacity claim; JSON serialization still dominates large unfiltered responses.

## Verification

- Backend: 114 tests passed, including authentication/CSRF, safe downloads, URL and redirect policy, bounded HTTP fetches, concurrent process writes, cache invalidation, schedule lock contention, disabled-calendar filtering, upload preservation, recurrence limits, and ICS escaping.
- Frontend: 29 tests passed in `TZ=Europe/Bucharest`, including date-boundary and daylight-saving checks.
- Production frontend build passed, including the separate admin entry.
- `npm audit`: zero known findings.
- `pip-audit -r requirements.lock`: zero known findings for the locked runtime graph.
- `pip check`, Python compilation, shell syntax, Compose configuration validation, and `git diff --check` passed.
- Headless Chromium smoke test passed for form login, bundled admin loading, a CSRF-protected mutation, schedule, live board, and TV navigation. No page exceptions or third-party requests occurred in that test. Test data and databases were temporary.
- Both the main and worker Docker images built successfully. The main image passed an isolated startup/health check with all Gunicorn processes running as UID 1000 and no local `.env` copied into the image. Chromium launched successfully as the non-root user in both images. No production containers or volumes were used.
- Live Outlook extraction was not run: it requires network/provider integration verification, particularly if custom calendar providers or authenticated profiles are used.

## Deployment changes

1. Configure `ADMIN_PASSWORD` (at least 12 characters) and a random `FLASK_SECRET` (at least 32 characters). `deploy.sh` generates these if absent or weak; direct Compose startup requires them explicitly. Existing weak credentials no longer work. Changing the secret invalidates existing sessions.
2. Install the locked runtime with `pip install -r requirements.lock`; rebuild the frontend with Node 22.12+ and `npm ci && npm run build`. Admin JavaScript now comes from that build too.
3. Use HTTPS with `SESSION_COOKIE_SECURE=1`; configure proxy trust explicitly if required. Gunicorn no longer trusts forwarded headers from every address.
4. If an uploaded inventory must survive image updates, set `KEEP_VOLUME_CSV=1`.
5. Worker bind mounts require the appropriate `WORKER_UID` / `WORKER_GID` for writable state directories. Source and configuration are no longer writable through the worker's project-wide bind mount.
6. Room export and diagnostics now require admin authentication. Publisher CSV and approved schedule exports remain downloadable by admins.

## Recommended next scaling work

| Priority | Work | Reason |
| --- | --- | --- |
| High | Make the importer a single dedicated service with durable jobs and shared progress | File locks coordinate processes on one shared local filesystem, not independent replicas. Web-process scheduling and in-memory status still have lifecycle limits. |
| High | Store normalized events in an indexed database and serve bounded date queries; use PostgreSQL when adding replicas | Whole-semester JSON snapshots and SQLite serialize writes and duplicate memory across Gunicorn workers. Current indexes cover manually entered events, not imported snapshots. |
| High | Consolidate legacy repair/force-refresh commands into the canonical importer | Some maintenance scripts still have separate file-based workflows and can bypass canonical coordination if run directly. Avoid running those alongside production imports. |
| Medium | Use building + room as a composite room identity throughout exports and availability counts | Room numbers are reused across buildings; the existing room-only aggregate keys and free-room sets remain ambiguous when viewing all buildings. |
| Medium | Add response caching/ETags, pagination or explicit range requirements, and compression at the proxy | Large unfiltered API responses still serialize and transfer the complete schedule. Preserve the current list-shaped API or introduce a versioned contract. |
| Medium | Add a migration command, Flask application factory, route modules, and a shared event/query layer | `app.py` and legacy/React representations still duplicate responsibilities and swallow some operational errors. Extract incrementally with compatibility tests. |
| Medium | Add CI and production measurements | Run tests/builds/audits on every change; measure p95 latency, memory per worker, import duration, upstream failures, and actual concurrency before changing worker counts. |
| Medium | Rotate extractor logs and retain a bounded history of captures | Public polling no longer grows diagnostic files, but extraction logs/captures still require an explicit retention policy. |

Dependency audits reflect known advisories at review time, not a guarantee that all security defects are absent. TLS/proxy configuration, host/network policy, and live Outlook compatibility remain deployment concerns.
