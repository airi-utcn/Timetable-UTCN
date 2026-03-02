## UTCN Timetable — User & Admin Guide

This document explains how to use the timetable web application (user-facing UI), how administrators can manage calendar sources and imports, how the extraction/build pipeline works, and common troubleshooting and deployment steps.

Keep this guide with the codebase so operators and new contributors can quickly get productive.

## Quick overview

- Backend: Flask application in `app.py`. Provides API endpoints such as `/events.json`, `/departures.json`, `/calendars.json`, `/health`, `/debug/pipeline` and admin endpoints under `/admin`.
- Frontend: React + Vite in `frontend/`. Main UI screens are Schedule (calendar/day/week), Departures (live board) and Admin React shell.
- Data pipeline: `tools/` scripts + Playwright captures (files under `playwright_captures/`) produce per-source `events_*.json` and a merged `playwright_captures/schedule_by_room.json` used by the app.
- Storage: local SQLite (`data/app.db`) for admin data and session info. Extracted JSON files live under `playwright_captures/`.
- Deployment: containerized (Docker + docker-compose). See `Dockerfile` and `docker-compose.yml`.

## User-facing UI

The application exposes two primary public interfaces for end users:

- Schedule (calendar): a calendar-like view with Day / Week / Calendar modes. It shows scheduled classes/events grouped by room and time.
- Departures (live board): a short "now & next" type view for building entrances / live changes (useful for transit displays or building live boards).

Main behaviors and controls

- Date range and navigation: Use the UI controls to switch between Day / Week / Calendar modes. The frontend requests `/events.json` with `from` and `to` query parameters for the displayed range. If the frontend does not send date parameters, the backend will return all available schedule events.
- Search & filters: The schedule UI supports text search and colored calendars legend. Search affects displayed events.
- Calendar legend: Toggles visibility of specific calendars/sources.
- Refresh: The UI periodically refreshes events. The live board refresh interval is configured to 5 minutes.

If you are an end user, nothing special is required; just visit the public site and use the controls.

## Admin interface (what admins can do)

The admin UI is reachable at `/admin` and provides a React-based management shell. Typical admin tasks:

- Login: The admin UI uses a login form; session data is persisted (see `app.py` auth helpers). If your session expires, you'll be redirected to login.
- Add a calendar source: Use the admin UI form to add a published calendar URL (an ICS or HTML source). The UI posts to `/admin/set_calendar_url` or similar admin endpoint.
- Update / Delete calendar sources: Admin UI includes controls to edit or remove calendar entries.
- Trigger an import: Use the Import button in the admin panel to request a re-import/processing of calendar sources. This calls an admin API (`/admin/import_calendar`) which will schedule or run the extractor pipeline.
- Monitor extraction status: Visit `/admin` or call `/admin/api/status` to see import progress, counts, and recent errors. For more detailed run metadata, use `/debug/pipeline` (requires appropriate access on deployed instances).

Common admin endpoints (useful to know)

- POST /admin/set_calendar_url — add or update a calendar source URL
- POST /admin/import_calendar — trigger a re-import for one or more sources
- GET /admin/api/status — JSON status about imports, counts and schedules
- GET /debug/pipeline — diagnostic view of pipeline state and generated files (events files, schedule range, counts)
- GET /events.json?from=YYYY-MM-DD&to=YYYY-MM-DD — return flattened events for a given date window

Notes on admin API usage

- The backend was adjusted to only apply date filtering when the `from` or `to` query parameters are explicitly provided. This prevents accidental empty API responses when the server's default date window doesn't match the extracted schedule range.

## Extraction & schedule build pipeline

The project's extraction pipeline is built around Playwright captures and a set of utility scripts in `tools/`:

- Playwright captures: interactive or scripted captures saved under `playwright_captures/` (files: `calendar_full.ics`, `events_*.json`, `calendar_map.json`, etc.).
- tools/extract_published_events.py (and similar) parse remote ICS/HTML sources and write per-source `events_*.json` files.
- tools/build_schedule_by_room.py reads `playwright_captures/events_*.json` (or `events.json`) and builds `playwright_captures/schedule_by_room.json` and `schedule_by_room.csv`.

How to run the build locally

1. Ensure Python environment: install requirements from `requirements.txt`.
2. Run extraction (if you have credentials / Playwright setup): follow `playwright_login.py` to capture pages, or use administrator-provided ICS URLs.
3. Run the schedule builder (example):

   python3 tools/build_schedule_by_room.py --from 2026-02-01 --to 2026-04-30

This will load per-source `events_*.json`, optionally add `events.json`, learn subject mappings, filter by date range and produce `playwright_captures/schedule_by_room.json` and CSV. See the script header for more usage examples.

Key script behaviours

- `build_schedule_by_room.py` tries to guess subject, professor and room from raw event titles and locations. It also consults `playwright_captures/subject_mappings.json` when available to improve subject extraction.
- Room normalization logic and aliases: `config/room_aliases.json` can be used to map room names to canonical display strings.

## Deployment (Docker)

The app ships with a `Dockerfile` and `docker-compose.yml` for local or production deployments. Basic steps to run locally (macOS zsh):

1. Build images (if the project root has Docker context):

   docker compose build

2. Start services (web + worker if using worker compose file):

   docker compose up -d

3. Check service health:

   curl -fsS http://localhost:8000/health

If using the worker or Playwright services, ensure they are configured in `docker/docker-compose.worker.yml` and the worker image is built (`docker/Worker.Dockerfile`).

When deploying remotely, ensure the host environment has access to Playwright (if running captures), and that persistent volumes are used for `playwright_captures/` and `data/` so extracted files survive container restarts.

## Common troubleshooting

1. Problem: UI shows "0 events" or the calendar is empty

   - First check the diagnostic endpoint: GET /debug/pipeline. Look for `schedule_total_events` and `events_files_non_empty`.
   - Then check GET /events.json (no params) and GET /events.json?from=YYYY-MM-DD&to=YYYY-MM-DD. If the latter returns events but the former returns `[]`, the issue is often date filtering. The backend will only apply date filtering when `from` or `to` are present. If your frontend did not pass these, the backend will return all events; if your backend is still returning `[]`, inspect `playwright_captures/schedule_by_room.json`.
   - If schedule files are missing or empty, run the extraction/build scripts locally and watch for errors: `python3 tools/build_schedule_by_room.py`.

2. Problem: After import the UI still shows old data

   - Check timestamps and mtimes under `playwright_captures/` and the admin `/debug/pipeline` output. Some import runs write intermediate files and the server serves the latest merged JSON. If you see stale mtimes, re-run the build or restart the web service.

3. Problem: Intermittent 500 when loading `/`

   - Check the web server logs (Gunicorn logs, container logs). Ensure static `frontend/dist/index.html` exists and the server has read permissions.

4. Problem: Extraction failing (Playwright / login issues)

   - Use `playwright_login.py` and the Playwright debug captures under `playwright_captures/` to verify the login flow. When running Playwright inside Docker, ensure the browser dependencies are available and the image used has Playwright installed.

Useful diagnostic endpoints

- GET /health — basic service health status (use first to confirm the web service is reachable)
- GET /debug/pipeline — shows counts of event files, schedule ranges and import statuses
- GET /events.json?from=YYYY-MM-DD&to=YYYY-MM-DD — verify events are returned for explicit window

## Developer notes (key files to know)

- `app.py` — Flask application, API and admin routes. Main logic for `/events.json` is here.
- `frontend/src/Schedule.jsx` — calendar UI; frontend constructs `from`/`to` params for event fetches.
- `frontend/src/Departures.jsx` — live board UI.
- `tools/build_schedule_by_room.py` — build schedule grouped by room and export JSON/CSV.
- `tools/extract_published_events.py` (and other scripts) — helpers to extract events from published ICS/HTML sources.
- `playwright_captures/` — directory containing event captures and produced schedule files.
- `config/room_aliases.json` and `config/building_aliases.json` — mapping files used for normalization and display.

## Runbook: How to recover from an empty UI (step-by-step)

1. Visit `/health` — ensure service is up.
2. Visit `/debug/pipeline` — note `schedule_total_events` and `events_files_non_empty`.
3. If `schedule_total_events` > 0 but GET `/events.json` returns `[]`:
   - Call `/events.json?from=<start>&to=<end>` with a date range inside `schedule_date_range` returned by `/debug/pipeline`. If this returns events, the problem is how the frontend constructs queries. Confirm the frontend sends date params.
4. If schedule files are missing/empty, run locally:

   python3 tools/build_schedule_by_room.py --from 2026-02-01 --to 2026-04-30

5. If you changed or regenerated `playwright_captures/schedule_by_room.json`, restart the web service or touch a file that triggers reload, then re-check `/events.json`.

## Next steps & optional improvements

- Add small unit tests for `tools/` parsers (subject/room extraction) to make subject-room inference safer.
- Improve admin import logs: expose last successful build mtime and list of recent errors in `/admin/api/status`.
- Automate scheduled Playwright captures via a worker and provide an operator command to re-run specific calendar sources.

## Contact & context

If you're reading this file as a new operator or developer, start by running the build script and inspecting `playwright_captures/` files. If you need help, consult the project README and the code comments in `tools/` for parsing heuristics.

Thank you — this guide should help you operate and administer the UTCN Timetable app. Create an issue or PR in the repository for any requested improvements to the guide.
