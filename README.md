# AC UTCN — Room Timetable Viewer# AC UTCN — Room Timetable Viewer# AC UTCN — Timetable Viewer



A production-grade **Flask + React** application that imports events from

Outlook published calendar feeds (ICS and HTML), normalizes room and subject

data, and serves a modern timetable UI.A production-grade Flask + React application that imports events from **Outlook published calendar** feeds (ICS + HTML), normalises room/subject data, and serves a modern timetable UI. Built for the Technical University of Cluj-Napoca (UTCN), Faculty of Automation and Computer Science.A modern Flask + React application for viewing and managing university timetables. Imports events from Outlook "published calendar" URLs, normalizes subjects/locations, and provides a modern single-page application (SPA) interface with schedule, departures board, and admin functionality.



Built for the **Technical University of Cluj-Napoca (UTCN)**, Faculty of

Automation and Computer Science.

---## 🎯 Table of Contents

---

- [Overview](#overview)

## Table of Contents

## Table of Contents- [Features](#features)

- [Overview](#overview)

- [Features](#features)- [Tech Stack](#tech-stack)

- [Architecture](#architecture)

- [Tech Stack](#tech-stack)- [Overview](#overview)- [Project Structure](#project-structure)

- [Project Structure](#project-structure)

- [Quick Start](#quick-start)- [Features](#features)- [Requirements](#requirements)

- [Configuration](#configuration)

- [Extraction Pipeline](#extraction-pipeline)- [Architecture](#architecture)- [Quick Start](#quick-start)

- [API Reference](#api-reference)

- [Admin Panel](#admin-panel)- [Tech Stack](#tech-stack)- [Running the App](#running-the-app)

- [Frontend Development](#frontend-development)

- [Data Storage](#data-storage)

- [Deployment](#deployment)├── app.py                          # Flask backend — routes, API, background tasks# Set admin password (optional)

- [Troubleshooting](#troubleshooting)

- [License](#license)

├── deploy.sh                       # One-command VM deployment script**Updating the app without losing data:**

---├── data/docker compose build --no-cache



## Overview

### Event Management

The system ingests room calendars published by Outlook/Exchange (~200 rooms),| `GUNICORN_MAX_REQUESTS` | `2000` | Max requests before worker restart || Table | Description |

parses ICS feeds or scrapes HTML calendar pages with Playwright, and exposes

the merged timetable through a React SPA with three views:<!--

  Clean, condensed README for the AC UTCN Timetable Viewer.

| View       | Purpose                                                       |  Replaces older/duplicated READMEs with a single authoritative document.

|------------|---------------------------------------------------------------|-->

| Schedule   | Weekly timetable grid, filterable by room, subject, professor |

| Departures | Departure-board style display for today and tomorrow          |# AC UTCN — Room Timetable Viewer

| Admin      | Manage calendars, trigger imports, add manual events          |

A production-grade Flask + React application that imports events from

---Outlook "published calendar" feeds (ICS + HTML), normalizes room/subject

data, and serves a modern timetable UI. Built for the Technical

## FeaturesUniversity of Cluj-Napoca (UTCN), Faculty of Automation and Computer

Science.

- **Dual-URL pipeline** — ICS feed (fast, concurrent) with HTML/Playwright fallback

- **Bulk CSV upload** — populate all room calendars from a single CSV---

- **React SPA** (Vite) — Schedule, Departures, and Admin views

- **Admin authentication** — session-based with CSRF protection and rate limiting## Table of contents

- **Per-calendar colors** — optional hex color for visual differentiation

- **Periodic auto-import** — background thread re-fetches every 60 minutes- Overview

- **Daily cleanup** — automatic pruning of events older than 60 days- Features

- **Subject normalization** — parses titles into subject, professor, and room- Architecture

- **Room and building aliases** — JSON-based mappings for consistent names- Tech stack

- **Playwright extractor** — headless Chromium for client-side rendered pages- Project structure

- **WAL-mode SQLite** — robust concurrent access across Gunicorn workers- Quick start

- **ICS export** — export per-room schedules as `.ics` files  - Docker (production)

- **Health check** — `GET /health` for Docker and load-balancer probes  - VM deployment

- **Debug endpoint** — `GET /debug/pipeline` for diagnostic inspection  - Local development

- Configuration

---  - Environment variables

  - CSV calendar source

## Architecture  - Room & building aliases

- Extraction pipeline

```- API reference

┌──────────────────────────────────────────────────────┐  - Public endpoints

│                  React SPA (Vite)                     │  - Admin endpoints

│           Schedule · Departures · Admin               │- Admin panel

└─────────────────────────┬────────────────────────────┘- Frontend development

                          │  HTTP (/events.json, /admin, ...)- Data storage

┌─────────────────────────▼────────────────────────────┐- Deployment operations

│               Flask + Gunicorn (gthread)              │- Troubleshooting

│         REST API · Admin Routes · Background Jobs     │- License

└─────────────────────────┬────────────────────────────┘

                          │---

          ┌───────────────┼───────────────┐

          ▼               ▼               ▼## Overview

    ┌───────────┐  ┌────────────┐  ┌────────────────┐

    │  SQLite   │  │ Extraction │  │  playwright_    │The system ingests room calendars published by Outlook/Exchange (≈200

    │ data/     │  │  Pipeline  │  │  captures/      │rooms), parses ICS feeds or scrapes HTML calendar pages with Playwright,

    │ app.db    │  │  (tools/*) │  │  events_*.json  │and exposes the merged timetable through a React SPA with three views:

    └───────────┘  └────────────┘  └────────────────┘

```| View | Purpose |

|------|---------|

**Extraction flow:**| Schedule | Weekly timetable grid (filterable by room/subject/professor) |

| Departures | Departure-board style view for today/tomorrow (lobby displays) |

1. **CSV → DB** — populate calendars; store ICS (primary) and HTML (fallback) URLs| Admin | Manage calendars, run imports, add manual/extracurricular events |

2. **Phase 1 — ICS direct** — parse ICS feeds concurrently (ThreadPoolExecutor)

   - Empty VCALENDAR (no events) counts as success; does not queue Playwright---

3. **Phase 2 — Playwright fallback** — render HTML URL when ICS parsing fails

4. **Phase 3 — Merge** — `build_schedule_by_room.py` produces `schedule_by_room.json`## Features



---- Dual-URL pipeline: ICS feed (fast, concurrent) with HTML/Playwright fallback

- Bulk CSV upload (`Rooms_PUBLISHER_HTML-ICS(in).csv`) to populate calendars

## Tech Stack- React SPA frontend (Vite) with Schedule, Departures and Admin

- Admin authentication, CSRF protection and per-IP rate limiting

| Layer     | Technology                                          |- Per-calendar color assignment

|-----------|-----------------------------------------------------|- Periodic background importer (default: every 60 minutes)

| Runtime   | Python 3.12, Flask, Gunicorn (gthread)              |- Daily cleanup and retention (default: 60 days)

| Frontend  | React 18, Vite, custom CSS                          |- Title parsing & subject normalization (subject/professor/room)

| Database  | SQLite 3 (WAL mode)                                 |- Room and building aliasing via JSON config files

| Parsing   | `ics` library + custom microformat parser           |- Playwright extractor for client-side rendered calendar pages

| Scraping  | Playwright (headless Chromium)                       |- WAL-mode SQLite for robust concurrent access

| Container | Docker multi-stage build (Node 20 + Python 3.12)    |

---

---

## Architecture (high level)

## Project Structure

The core components:

```

.- Flask backend (REST API, admin routes, background threads)

├── app.py                        # Flask backend (routes, API, background tasks)- React frontend (Vite) — SPA used by end users and admins

├── timetable.py                  # ICS parsing, event model, fetch utilities- Extraction pipeline (`tools/*`) that writes per-calendar JSON files

├── requirements.txt              # Python dependencies- `playwright_captures/` directory that stores per-calendar outputs and

├── Dockerfile                    # Multi-stage build (frontend + backend)  the merged schedule

├── docker-compose.yml            # Production compose with health checks

├── docker-compose.local.yml      # Local development overridesExtraction flow summary:

├── entrypoint.sh                 # Container entrypoint (DB setup, Gunicorn)

├── deploy.sh                     # One-command VM deployment script1. CSV → DB: populate calendars and store both ICS (primary) and HTML

├── run.sh                        # Local development start script   fallback URLs

├── setup.sh                      # First-time local setup (venv, deps)2. Phase 1 — ICS direct: parse ICS feeds concurrently (fast)

│   - Empty VCALENDAR (no events) is considered success and does not fall

├── config/     back to Playwright

│   ├── Rooms_PUBLISHER_HTML-ICS(in).csv   # Authoritative room calendar list3. Phase 2 — Playwright fallback: render the HTML URL when ICS fails

│   ├── room_aliases.json                  # Room name normalisations4. Phase 3 — Merge: `build_schedule_by_room.py` builds `schedule_by_room.json`

│   └── building_aliases.json              # Building name mappings

│---

├── data/

│   └── app.db                    # SQLite database (created at runtime)## Tech stack

│

├── frontend/- Backend: Python 3.12, Flask, Gunicorn (gthread)

│   ├── package.json- Frontend: React 18, Vite

│   ├── vite.config.js- Database: SQLite (WAL)

│   └── src/- Scraping: Playwright (headless Chromium)

│       ├── main.jsx              # Entry point- Calendar parsing: `ics` library + custom parsers

│       ├── App.jsx               # Root (tabs, live clock, header)- Container: Docker (multi-stage build: Node + Python)

│       ├── Schedule.jsx          # Weekly timetable view

│       ├── Departures.jsx        # Departure board view---

│       ├── Admin.jsx             # Admin panel

│       ├── RouteMap.jsx          # Campus map## Project structure (important files)

│       └── styles.css            # Application styles

│```

├── tools/app.py                      # Flask backend (API + routes)

│   ├── run_full_extraction.py         # Full ICS + Playwright extractiontimetable.py                # Calendar parsing utilities

│   ├── build_schedule_by_room.py      # Merge per-room files → schedulerequirements.txt            # Python dependencies

│   ├── extract_published_events.py    # Playwright-based HTML scraperDockerfile

│   ├── populate_calendars_from_csv.py # CSV → DB populationdocker-compose.yml

│   ├── subject_parser.py             # Title → subject + professorentrypoint.sh

│   ├── event_parser.py               # Event normalizationdeploy.sh

│   └── init_db.py                    # Standalone DB initializationfrontend/                   # React SPA

│tools/                      # Extraction and utility scripts

├── playwright_captures/               # Runtime output (git-ignored)config/                     # CSV + alias mappings

│   ├── events_<hash>.json            # Per-calendar eventsdata/                       # data/app.db (SQLite)

│   ├── schedule_by_room.json         # Merged schedule (API source)playwright_captures/        # Extractor outputs (git-ignored)

│   ├── calendar_map.json             # Hash → URL/name mapping```

│   ├── import_progress.json          # Live extraction progress

│   └── import_complete.txt           # Marker when extraction finishes---

│

├── templates/                         # Jinja2 templates## Quick start

└── static/                            # Static assets

```### Docker (recommended)



---```bash

git clone https://github.com/stefi19/GenerateTimetableFromOutlookCalendar.git

## Quick Startcd GenerateTimetableFromOutlookCalendar

# (optional) create .env with ADMIN_PASSWORD and FLASK_SECRET

### Docker (recommended)docker compose up -d --build

docker compose logs -f timetable

```bash```

git clone https://github.com/stefi19/GenerateTimetableFromOutlookCalendar.git

cd GenerateTimetableFromOutlookCalendarApp is available at `http://localhost:5000`.



# Optional: create .env with your settings### VM deployment

cat > .env <<EOF

ADMIN_PASSWORD=your-secure-passwordUse `deploy.sh` for a one-command deploy and safe rolling updates.

FLASK_SECRET=$(openssl rand -hex 32)

HOST_PORT=5000### Local development

EOF

```bash

docker compose up -d --buildpython3 -m venv .venv

docker compose logs -f timetablesource .venv/bin/activate

```pip install -r requirements.txt

python -m playwright install chromium

The app is available at `http://localhost:5000`.python app.py  # backend

cd frontend

### VM Deploymentnpm install

npm run dev    # frontend HMR

```bash```

git clone https://github.com/stefi19/GenerateTimetableFromOutlookCalendar.git

cd GenerateTimetableFromOutlookCalendar---

echo "ADMIN_PASSWORD=your-secure-password" > .env

docker compose up -d --build## Configuration



# Subsequent updates (preserves all data)Key environment variables (set in `.env` or Docker compose):

./deploy.sh

```- `ADMIN_PASSWORD` — admin password (change in production)

- `FLASK_SECRET` — Flask session secret

### Local Development- `GUNICORN_WORKERS`, `GUNICORN_THREADS`, `GUNICORN_WORKER_CLASS` — Gunicorn tuning

- `SQLITE_WAL_MODE` — enable WAL mode for SQLite

```bash- `PLAYWRIGHT_CONCURRENCY` / `ICS_CONCURRENCY` — extraction concurrency

python3 -m venv .venv- `DISABLE_BACKGROUND_TASKS` — set `1` to disable periodic importer

source .venv/bin/activate

pip install -r requirements.txtCSV format: `config/Rooms_PUBLISHER_HTML-ICS(in).csv` — columns include

python -m playwright install chromium`Nume_Sala`, `Email_Sala`, `Cladire`, `PublishedCalendarUrl` (HTML),

`PublishedICalUrl` (ICS). The CSV is authoritative and is used to populate

# Start backendthe calendars table.

python app.py

# → http://localhost:5000---



# In a separate terminal — frontend with hot reload## Extraction pipeline (details)

cd frontend

npm install- Phase 1: Try `parse_ics_from_url()` concurrently (fast path). Events are

npm run dev  filtered to ±60 days and written to `playwright_captures/events_<hash>.json`.

# → http://localhost:5173 (proxies API to Flask)- If the feed is an empty VCALENDAR (0 events), the run is considered

```  successful and no Playwright fallback is queued.

- Phase 2: Playwright fallback renders the HTML URL (from CSV) and

---  captures XHR responses to extract calendar items.

- Phase 3: `build_schedule_by_room.py` merges per-calendar files into

## Configuration  `schedule_by_room.json` which the frontend consumes.



### Environment Variables---



| Variable                 | Default      | Description                                     |## API reference (high level)

|--------------------------|--------------|-------------------------------------------------|

| `ADMIN_USERNAME`         | `admin`      | Admin login username                            |- `GET /` → SPA

| `ADMIN_PASSWORD`         | `admin123`   | Admin login password (change in production)     |- `GET /health` → health check

| `ADMIN_SESSION_TIMEOUT`  | `3600`       | Admin session duration in seconds               |- `GET /events.json` → merged events (supports `from`, `to`, `room`, `subject` filters)

| `FLASK_SECRET`           | `dev-secret` | Flask session secret key                        |- `GET /calendars.json` → configured calendars

| `PORT`                   | `5000`       | HTTP listen port                                |- Admin endpoints require authentication and are exposed under `/admin`.

| `GUNICORN_WORKERS`       | `8`          | Number of Gunicorn worker processes             |

| `GUNICORN_THREADS`       | `4`          | Threads per worker                              |Refer to the in-repo admin UI for exact operations (upload CSV, import,

| `GUNICORN_WORKER_CLASS`  | `gthread`    | Worker class                                    |add manual events, delete calendars).

| `GUNICORN_TIMEOUT`       | `180`        | Request timeout in seconds                      |

| `GUNICORN_MAX_REQUESTS`  | `2000`       | Max requests before worker restart              |---

| `SQLITE_WAL_MODE`        | `1`          | Enable WAL mode for concurrent reads            |

| `PLAYWRIGHT_CONCURRENCY` | `6`          | Max simultaneous Playwright browsers            |## Admin panel

| `ICS_CONCURRENCY`        | `8`          | Max simultaneous ICS HTTP fetches               |

| `DISABLE_BACKGROUND_TASKS` | `0`        | Set to `1` to skip periodic fetcher and cleanup |Accessible at `/admin`. Features include bulk CSV upload, manual event

creation, import controls, and calendar metadata editing (name, color,

### CSV Calendar Sourceenabled toggles).



File: `config/Rooms_PUBLISHER_HTML-ICS(in).csv`Security: session-based auth, CSRF protection, per-IP authentication

rate limiting.

| Column               | Index | Description                              |

|----------------------|-------|------------------------------------------|---

| Nume_Sala            | 0     | Room name                                |

| Email_Sala           | 1     | Room publisher email                     |## Troubleshooting (quick)

| Cladire              | 2     | Building name                            |

| Optiune_Delegat      | 3     | Delegation option                        |- If the UI shows 0 events: visit `/debug/pipeline` to inspect per-calendar

| PublishedCalendarUrl  | 4     | HTML calendar URL (Playwright fallback)  |  file counts and schedule state.

| PublishedICalUrl      | 5     | ICS feed URL (primary, fast path)        |- If Playwright crashes (SIGSEGV) on your host, either use the provided

  Docker image (includes system deps) or install platform-specific

Upload via the Admin panel or place in `config/` before starting.  libraries (`libnss3`, `libatk1.0-0`, etc.).

- If you see `too many open files`, increase `ulimit -n` or run inside

### Room and Building Aliases  container which sets a higher limit in `entrypoint.sh`.



- `config/room_aliases.json` — maps raw room strings to normalized names---

- `config/building_aliases.json` — maps raw building names to canonical forms

## Data & backups

---

- Database: `data/app.db` (SQLite). Persisted in Docker volume `timetable_data`.

## Extraction Pipeline- Extracted files: `playwright_captures/` (persisted in `timetable_captures`).



The pipeline runs on container start and repeats every 60 minutes:Backup example:



1. **CSV → DB** — `populate_calendars_from_csv.py` inserts URLs into SQLite,```bash

   storing both the ICS URL (primary) and HTML URL (Playwright fallback).docker run --rm -v timetable_data:/data -v $(pwd):/backup alpine \

  tar czf /backup/data-backup.tar.gz -C /data .

2. **Phase 1 — ICS Direct** (concurrent, 8 workers)```

   - Fetches each ICS URL via HTTP and parses with the `ics` library

   - Filters events to a ±60-day window---

   - Writes `events_<sha1(url)[:8]>.json` per calendar

   - Empty VCALENDAR = success; does **not** fall through to Playwright## License



3. **Phase 2 — Playwright Fallback** (concurrent, 4 workers)MIT

   - Runs only when ICS parsing fails (network error, invalid feed)

   - Launches headless Chromium against the HTML URL---

   - Intercepts XHR responses containing `CalendarItem` JSON

If you'd like, I can also: add a concise `CONTRIBUTING.md`, generate a

4. **Phase 3 — Schedule Build**clean `.gitignore`, or create a short `README_ADMIN.md` for the admin

   - `build_schedule_by_room.py` reads all `events_*.json` filesuser workflows. Which would you prefer next?

   - Produces `schedule_by_room.json` (API source) and `.csv` export| Column | Index | Description || `schedule_by_room.csv` | CSV export of room schedule |



5. **Fingerprint Cache**|--------|-------|-------------|| `calendar_full.ics` | Raw downloaded ICS file |

   - Tracks max mtime + count of `events_*.json` files

   - Skips rebuild when data has not changed| Nume_Sala | 0 | Room name || `events_<hash>.json` | Per-calendar extracted events |

   - Cross-process file lock prevents concurrent rebuilds

| Email_Sala | 1 | Room publisher email (used to generate display name) |

---

| Cladire | 2 | Building name |## Periodic Importer

## API Reference

| Optiune_Delegat | 3 | Delegation option |

### Public Endpoints

| PublishedCalendarUrl | 4 | HTML calendar URL (Playwright fallback) |The app includes a background thread that automatically imports calendars:

| Method | Endpoint              | Description                          |

|--------|-----------------------|--------------------------------------|| PublishedICalUrl | 5 | ICS feed URL (primary, fast-path) |

| GET    | `/`                   | React SPA frontend                   |

| GET    | `/health`             | Health check (200 OK)                |- **Initial Run**: Immediately on app startup

| GET    | `/events.json`        | Events with date and filter support  |

| GET    | `/calendars.json`     | Configured calendars                 |Upload via the Admin panel or place in `config/` before starting the container.- **Interval**: Every 60 minutes (configurable in `app.py`)

| GET    | `/departures.json`    | Departures board data                |

| GET    | `/export_room`        | Export room schedule as ICS          |- **Concurrency**: Uses internal lock to prevent overlapping runs

| GET    | `/debug/pipeline`     | Pipeline diagnostic (no auth)        |

| GET    | `/download/<filename>`| Download generated files             |### Room & Building Aliases



#### `GET /events.json` ParametersTo disable automatic imports, comment out the `periodic_fetcher` thread in `app.py`.



| Parameter   | Type         | Default         | Description        |- **`config/room_aliases.json`** — Maps raw room strings to normalised names

|-------------|--------------|-----------------|--------------------|

| `from`      | `YYYY-MM-DD` | today           | Start of range     |- **`config/building_aliases.json`** — Maps raw building names to canonical forms## Troubleshooting

| `to`        | `YYYY-MM-DD` | today + 60 days | End of range       |

| `subject`   | string       | —               | Filter by subject  |

| `professor` | string       | —               | Filter by professor|

| `room`      | string       | —               | Filter by room     |---### Common Issues



### Admin Endpoints



All admin endpoints require authentication (session or Basic auth).## Extraction Pipeline| Issue | Solution |



| Method   | Endpoint                          | Description                    ||-------|----------|

|----------|-----------------------------------|--------------------------------|

| GET      | `/admin`                          | Admin panel (React UI)         |The pipeline runs on container start (detached) and repeats via `periodic_fetcher` every 60 minutes:| `ModuleNotFoundError: No module named 'flask'` | Activate venv: `source .venv/bin/activate && pip install -r requirements.txt` |

| GET/POST | `/admin/login`                    | Login form / authenticate      |

| POST     | `/admin/logout`                   | End admin session              || Port 5000 already in use | Kill existing process: `kill $(lsof -ti:5000)` |

| GET      | `/admin/api/status`               | Full system status JSON        |

| GET      | `/admin/session_status`           | Session time remaining         |1. **CSV → DB** — `populate_calendars_from_csv.py` inserts all URLs from the CSV into SQLite, storing both the ICS URL (primary) and HTML URL (Playwright fallback)| Playwright fails to launch | Install browsers: `python -m playwright install chromium` |

| POST     | `/admin/extend_session`           | Reset session timeout          |

| POST     | `/admin/upload_rooms_publisher`   | Upload CSV calendar list       || DB migration errors | Check `data/app.db` permissions and legacy JSON files in `config/` |

| POST     | `/admin/import_calendar`          | Trigger extraction             |

| POST     | `/admin/set_calendar_url`         | Add a single calendar          |2. **Phase 1 — ICS Direct** (concurrent, 8 workers)

| POST     | `/admin/update_calendar`          | Update calendar metadata       |

| POST     | `/admin/update_calendar_color`    | Set calendar color             |   - Fetches each ICS URL via HTTP, parses with the `ics` library### Logs

| POST     | `/admin/delete_calendar`          | Remove a calendar              |

| POST     | `/admin/add_event`                | Add manual event               |   - Filters events to a ±60-day window

| POST     | `/admin/delete_event`             | Delete an event                |

| POST     | `/admin/delete_manual`            | Delete manual event            |   - Writes `events_<sha1(url)[:8]>.json` per calendar- Development: Logs appear on stdout

| POST     | `/admin/cleanup_old_events`       | Prune events older than 60 days|

   - Empty VCALENDAR (no bookings) = success — writes `[]`, does **not** fall through to Playwright- Background mode: Check `server.log` with `tail -f server.log`

---



## Admin Panel

3. **Phase 2 — Playwright Fallback** (concurrent, 4 workers)### Warnings (Harmless)

Access at `http://localhost:5000/admin` (login required).

   - Only for calendars where ICS parsing failed (network error, not an ICS URL)

| Feature                  | Description                                        |

|--------------------------|----------------------------------------------------|   - Launches headless Chromium against the **HTML URL** (not the ICS URL)- `DeprecationWarning: datetime.utcnow()` — Legacy datetime usage, doesn't affect functionality

| Upload CSV               | Bulk-import room calendars from the publisher CSV   |

| Import Now               | Trigger immediate full extraction                   |   - Intercepts XHR responses containing `CalendarItem` JSON- `WARNING: This is a development server` — Normal Flask development mode warning

| Add Calendar             | Add a single calendar URL with name and color       |

| Manage Calendars         | View status, toggle enabled, set color, delete      |   - Writes `events_<hash>.json`

| Manual Events            | Create one-off events with title, time, location    |

| Extracurricular Events   | Add recurring activities (clubs, sports)            |## Recommended .gitignore

| System Status            | Extraction progress, event counts, last import time |

4. **Phase 3 — Schedule Build**

**Security:**

   - `build_schedule_by_room.py` reads all `events_*.json` files```gitignore

- Session-based authentication with configurable timeout (default: 1 hour)

- CSRF token protection on all forms   - Produces `schedule_by_room.json` (served by the API) and `.csv` export# Virtual environment

- Per-IP rate limiting (10 failed attempts per 5 minutes = temporary block)

- Session extension via "Keep me logged in".venv/



---5. **Fingerprint-based Cache**venv/



## Frontend Development   - `ensure_schedule()` tracks the max mtime + count of `events_*.json` files



The React SPA lives in `frontend/` and uses Vite.   - Skips rebuild when data hasn't changed# Python cache



```bash   - Cross-process file lock prevents concurrent rebuilds across Gunicorn workers__pycache__/

cd frontend

npm install

npm run dev      # Dev server with HMR → http://localhost:5173

npm run build    # Production build → frontend/dist/---# Playwright temporary files

```

playwright_captures/*.stdout.txt

Vite proxies API calls to `http://localhost:5000` during development.

## API Referenceplaywright_captures/*.stderr.txt

| Component  | File              | Description                              |

|------------|-------------------|------------------------------------------|playwright_captures/page*.html

| App        | `App.jsx`         | Root — tab navigation, live clock        |

| Schedule   | `Schedule.jsx`    | Weekly timetable with day grouping       |### Public Endpointsplaywright_captures/json_capture_*.json

| Departures | `Departures.jsx`  | Departure board for lobby screens        |

| Admin      | `Admin.jsx`       | Calendar management, import controls     |

| RouteMap   | `RouteMap.jsx`    | Campus route and map view                |

| Method | Endpoint | Description |# Runtime files

---

|--------|----------|-------------|server.log

## Data Storage

| `GET` | `/` | React SPA frontend |data/app.db

### SQLite Database (`data/app.db`)

| `GET` | `/health` | Health check (`200 OK`) |```

| Table                    | Key Columns                                           |

|--------------------------|-------------------------------------------------------|| `GET` | `/events.json` | Events API (main data endpoint) |

| `calendars`              | `id`, `url`, `name`, `color`, `enabled`, `html_url`   |

| `manual_events`          | `id`, `start`, `end`, `title`, `location`             || `GET` | `/calendars.json` | List of configured calendars |## Contributing

| `extracurricular_events` | `id`, `title`, `organizer`, `date`, `location`        |

| `GET` | `/departures.json` | Departures board data |

The schema auto-migrates on startup via `ALTER TABLE` with try/except.

| `GET` | `/departures` | Legacy departures HTML view |### Adding New Parsers

### File-Based Storage (`playwright_captures/`)

| `GET` | `/export_room` | Export room schedule as ICS |

| File                     | Description                                |

|--------------------------|--------------------------------------------|| `GET` | `/debug/pipeline` | Pipeline diagnostic (no auth) |1. Edit `tools/subject_parser.py` for subject/location normalization

| `events_<hash>.json`     | Per-calendar events (hash = sha1(url)[:8]) |

| `schedule_by_room.json`  | Merged schedule served by the API          || `GET` | `/download/<filename>` | Download generated files |2. Add building mappings in `config/room_aliases.json`

| `schedule_by_room.csv`   | CSV export of room schedule                |

| `calendar_map.json`      | Hash → URL, name, color, building mapping  |

| `import_progress.json`   | Live extraction progress counters          |

| `import_complete.txt`    | Marker written when extraction finishes    |#### `GET /events.json`### Running the Extractor Manually



---



## DeploymentReturns a JSON array of events for the schedule view.```bash



### Docker Commandspython tools/extract_published_events.py <URL>



| Command                                    | Description                || Parameter | Type | Default | Description |```

|--------------------------------------------|----------------------------|

| `docker compose up -d --build`             | Build and start            ||-----------|------|---------|-------------|

| `docker compose down`                      | Stop (preserves volumes)   |

| `docker compose logs -f timetable`         | Follow logs                || `from` | `YYYY-MM-DD` | today − 7d | Start of date range |Check output in `playwright_captures/*.stderr.txt` for debugging.

| `docker compose restart`                   | Restart service            |

| `docker compose build --no-cache`          | Full rebuild               || `to` | `YYYY-MM-DD` | today + 7d | End of date range |

| `docker compose exec timetable bash`       | Shell into container       |

| `subject` | string | — | Filter by subject |### Frontend Development

### Docker Volumes

| `professor` | string | — | Filter by professor |

| Volume                | Contents                        |

|-----------------------|---------------------------------|| `room` | string | — | Filter by room |```bash

| `timetable_data`      | SQLite database (`data/app.db`) |

| `timetable_captures`  | Extracted events and schedules  || `building` | string | — | Filter by building |cd frontend

| `timetable_config`    | CSV and alias configuration     |

npm install

### One-Command Redeploy

### Admin Endpointsnpm run dev

```bash

./deploy.sh```

```

All admin endpoints require authentication (session or Basic auth).

| Flag                     | Default | Description                          |

|--------------------------|---------|--------------------------------------|The Vite dev server runs at `http://localhost:5173` with hot reload.

| `RUN_FULL_EXTRACTION`    | `false` | Run extraction during deploy         |

| `DO_PRUNE`               | `false` | Prune unused Docker images           || Method | Endpoint | Description |

| `INSTALL_SYSTEMD_TIMER`  | `false` | Install hourly import systemd timer  |

| `WAIT_FOR_HEALTH`        | `true`  | Wait for `/health` to return 200     ||--------|----------|-------------|---



### Backup and Restore| `GET` | `/admin` | Admin panel (React UI) |



```bash| `GET/POST` | `/admin/login` | Login form / authenticate |## Docker Deployment

# Backup

docker run --rm -v timetable_data:/data -v $(pwd):/backup alpine \| `POST` | `/admin/logout` | End admin session |

  tar czf /backup/data-backup.tar.gz -C /data .

| `GET` | `/admin/api/status` | Full system status JSON |### Quick Deploy

# Restore

docker run --rm -v timetable_data:/data -v $(pwd):/backup alpine \| `GET` | `/admin/session_status` | Session time remaining |

  tar xzf /backup/data-backup.tar.gz -C /data

```| `POST` | `/admin/extend_session` | Reset session timeout |```bash



### Resource Requirements| `POST` | `/admin/upload_rooms_publisher` | Upload CSV calendar list |# Build and start



| Resource | Minimum  | Recommended || `POST` | `/admin/import_calendar` | Trigger extraction |docker compose up -d

|----------|----------|-------------|

| CPU      | 2 cores  | 16 cores    || `POST` | `/admin/set_calendar_url` | Add a single calendar |

| RAM      | 2 GB     | 32 GB       |

| Disk     | 2 GB     | 10 GB       || `POST` | `/admin/update_calendar` | Update calendar metadata |# Check status



> Playwright uses ~300–500 MB RAM per browser instance. With| `POST` | `/admin/update_calendar_color` | Set calendar color |docker compose ps

> `PLAYWRIGHT_CONCURRENCY=6`, peak extraction memory is ~3 GB.

| `POST` | `/admin/delete_calendar` | Remove a calendar |

---

| `POST` | `/admin/add_event` | Add manual event |# View logs

## Troubleshooting

| `POST` | `/admin/delete_event` | Delete an event |docker compose logs -f timetable

| Problem                             | Solution                                                                 |

|--------------------------------------|--------------------------------------------------------------------------|| `POST` | `/admin/delete_manual` | Delete manual event |

| 0 events in UI                       | Visit `/debug/pipeline` — check `events_files_non_empty` and `schedule_rooms` |

| All `events_*.json` are 2 bytes      | ICS feeds return empty VCALENDARs — normal for rooms with no bookings    || `POST` | `/admin/cleanup_old_events` | Prune events older than 60 days |# Stop

| Playwright SIGSEGV                   | Use the Docker image or install `libnss3`, `libatk1.0-0`, etc.          |

| Port 5000 in use                     | `lsof -i:5000` and kill, or set `HOST_PORT=8080` in `.env`              |docker compose down

| `ModuleNotFoundError`                | Activate venv: `source .venv/bin/activate && pip install -r requirements.txt` |

| EMFILE (too many open files)         | Run `ulimit -n 65536` or use the container (sets it automatically)       |---```

| DB locked errors                     | Enable WAL mode: `export SQLITE_WAL_MODE=1`                             |

| Stale schedule                       | Delete `playwright_captures/schedule_by_room.json` and refresh           |

| Import stuck                         | Check `playwright_captures/extract_stderr.txt`                           |

## Admin Panel### Production Deployment

### Logs



```bash

# DockerAccess at **http://localhost:5000/admin** (login required).1. **Set environment variables:**

docker compose logs -f timetable



# Local

python app.py| Feature | Description |```bash



# Background|---------|-------------|# Create .env file

nohup python app.py > server.log 2>&1 &

tail -f server.log| **Upload CSV** | Bulk-import all room calendars from the publisher CSV |echo "FLASK_SECRET=$(openssl rand -hex 32)" > .env

```

| **Import Now** | Trigger immediate full extraction for all calendars |```

### Diagnostic Endpoints

| **Add Calendar** | Add a single calendar URL with optional name + color |

- `GET /health` — returns 200 if the app is running

- `GET /debug/pipeline` — event file counts, schedule state, extraction status| **Manage Calendars** | View all calendars with status, toggle enabled, set color, delete |2. **Deploy with Docker Compose:**



---| **Manual Events** | Create one-off events with title, time, location |



## License| **Extracurricular Events** | Add recurring activities (clubs, sports, etc.) |```bash



This software is proprietary and is licensed exclusively to the| **System Status** | View extraction progress, event counts, last import time |docker compose up -d --build

**Technical University of Cluj-Napoca (UTCN)**, Faculty of Automation

and Computer Science. See the [LICENSE](LICENSE) file for full terms.```



Unauthorized copying, distribution, or use of this software is strictlyAuthentication features:

prohibited unless explicit written permission is granted by the author.

- Session-based with configurable timeout (default 1 hour)3. **With reverse proxy (nginx):**

---

- CSRF token protection on forms

**Built for** the Technical University of Cluj-Napoca (UTCN), Faculty of

Automation and Computer Science.- Per-IP rate limiting (10 failed attempts / 5 minutes = temporary block)```nginx


- Session extension via "Keep me logged in" actionserver {

    listen 80;

---    server_name timetable.example.com;



## Frontend Development    location / {

        proxy_pass http://localhost:5000;

The React SPA lives in `frontend/` and uses Vite for builds.        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;

```bash        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

cd frontend        proxy_set_header X-Forwarded-Proto $scheme;

npm install    }

npm run dev      # Dev server with HMR at http://localhost:5173}

npm run build    # Production build → frontend/dist/```

```

### Docker Commands Reference

The Vite config proxies API calls (`/events.json`, `/admin/*`, etc.) to `http://localhost:5000` during development.

| Command | Description |

Components:|---------|-------------|

| `docker compose up -d` | Start in background |

| Component | File | Description || `docker compose down` | Stop and remove containers |

|-----------|------|-------------|| `docker compose logs -f` | Follow logs |

| `App` | `App.jsx` | Root — tab navigation, live clock, UTCN header || `docker compose restart` | Restart service |

| `Schedule` | `Schedule.jsx` | Weekly timetable with day grouping + event cards || `docker compose build --no-cache` | Rebuild from scratch |

| `Departures` | `Departures.jsx` | Departure board for lobby screens || `docker compose exec timetable bash` | Shell into container |

| `Admin` | `Admin.jsx` | Calendar management, import controls, event CRUD |

| `RouteMap` | `RouteMap.jsx` | Campus route / map view |### Volumes



---Data is persisted in Docker volumes:

- `timetable_data` — SQLite database

## Data Storage- `timetable_captures` — Playwright captures/events



### SQLite Database — `data/app.db````bash

# Backup data

| Table | Key Columns |docker compose exec timetable cat /app/data/app.db > backup.db

|-------|-------------|

| `calendars` | `id`, `url` (unique), `name`, `color`, `enabled`, `building`, `room`, `email_address`, `html_url`, `created_at`, `last_fetched` |# View volume location

| `manual_events` | `id`, `start`, `end`, `title`, `location`, `raw`, `created_at` |docker volume inspect utcn-timetable_timetable_data

| `extracurricular_events` | `id`, `title`, `organizer`, `date`, `time`, `location`, `category`, `description`, `created_at` |```



The schema auto-migrates on startup — new columns are added via `ALTER TABLE` with try/except so old databases are upgraded seamlessly.### Resource Requirements



### File-Based Event Storage — `playwright_captures/`| Resource | Minimum | Recommended |

|----------|---------|-------------|

| File | Description || CPU | 1 core | 2 cores |

|------|-------------|| RAM | 512MB | 2GB |

| `events_<hash>.json` | Per-calendar events (hash = `sha1(url)[:8]`) || Disk | 1GB | 5GB |

| `schedule_by_room.json` | Merged schedule served by `/events.json` |

| `schedule_by_room.csv` | CSV export of room schedule |*Note: Playwright/Chromium requires ~500MB RAM when running extractions.*

| `calendar_map.json` | Hash → URL/name/color/building mapping |

| `import_progress.json` | Live extraction progress counters |---

| `import_complete.txt` | Written atomically when extraction finishes |

## License

---

MIT

## Deployment Operations

---

### Docker Commands

**Built for**: Technical University of Cluj-Napoca (UTCN)  

| Command | Description |**Faculty**: Automation and Computer Science

|---------|-------------|
| `docker compose up -d --build` | Build and start |
| `docker compose down` | Stop (preserves volumes) |
| `docker compose logs -f timetable` | Follow logs |
| `docker compose restart` | Restart service |
| `docker compose build --no-cache` | Full rebuild |
| `docker compose exec timetable bash` | Shell into container |

### One-Command Redeploy

```bash
./deploy.sh
```

Flags (export before running):

| Flag | Default | Description |
|------|---------|-------------|
| `RUN_FULL_EXTRACTION` | `false` | Run Playwright extraction during deploy |
| `DO_PRUNE` | `false` | Prune unused Docker images |
| `INSTALL_SYSTEMD_TIMER` | `false` | Install hourly import systemd timer |
| `WAIT_FOR_HEALTH` | `true` | Wait for `/health` to return 200 |

### Manual Extraction

```bash
# Inside the container
docker compose exec timetable python3 tools/run_full_extraction.py

# Or a single calendar
docker compose exec timetable python3 tools/extract_published_events.py <URL>
```

### Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 16 cores |
| RAM | 2 GB | 32 GB |
| Disk | 2 GB | 10 GB |

> Playwright/Chromium uses ~300–500 MB RAM per browser instance. With `PLAYWRIGHT_CONCURRENCY=6`, peak extraction memory is ~3 GB.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **0 events in UI** | Check `/debug/pipeline` — verify `events_files_non_empty > 0` and `schedule_rooms > 0` |
| **All `events_*.json` are 2 bytes** | ICS feeds may be returning empty VCALENDARs — normal for rooms with no bookings |
| **Playwright SIGSEGV** | Install system deps (`libnss3`, `libatk1.0-0`, etc.) or use the Docker image which includes them |
| **Port 5000 in use** | `lsof -i:5000` and kill the process, or set `HOST_PORT=8080` in `.env` |
| **`ModuleNotFoundError`** | Activate the venv: `source .venv/bin/activate && pip install -r requirements.txt` |
| **EMFILE (too many open files)** | Container sets `ulimit -n 65536`; if running locally, increase with `ulimit -n 65536` |
| **DB locked errors** | Enable WAL mode: `export SQLITE_WAL_MODE=1` |
| **Stale schedule** | `rm playwright_captures/schedule_by_room.json` and hit `/events.json` to trigger rebuild |
| **Import stuck** | Check `playwright_captures/extract_stderr.txt` for errors |

### Logs

```bash
# Docker
docker compose logs -f timetable

# Local development — stdout
python app.py

# Background mode
nohup python app.py > server.log 2>&1 &
tail -f server.log
```

### Diagnostic Endpoints

- **`GET /health`** — Returns `200 OK` if the app is running
- **`GET /debug/pipeline`** — Shows event file counts, schedule state, fingerprint info, and extraction status (no auth required)

---

## License

MIT

---

**Built for**: Technical University of Cluj-Napoca (UTCN), Faculty of Automation and Computer Science
