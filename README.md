# UTCN Timetable Viewer

UTCN Timetable Viewer is a Flask + React application for collecting, normalizing, displaying, and administering room-based university timetable data for the **Technical University of Cluj-Napoca (UTCN)**.

The system imports events from Outlook published calendars, parses ICS and HTML calendar sources, normalizes rooms/buildings/activity metadata, and exposes the resulting schedule through a modern web interface, live board, TV signage mode, and admin tools.

## Contents

- [What This Project Does](#what-this-project-does)
- [Main Features](#main-features)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Data Flow](#data-flow)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Running Locally](#running-locally)
- [Docker Deployment](#docker-deployment)
- [Frontend Development](#frontend-development)
- [Backend API](#backend-api)
- [Administration](#administration)
- [Testing](#testing)
- [Operational Tasks](#operational-tasks)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [Contributing](#contributing)
- [License](#license)

## What This Project Does

The application turns many independent UTCN room calendars into a single searchable timetable system.

It is designed to:

- collect events from room calendar publishing URLs;
- support both direct ICS feeds and Outlook HTML calendar fallbacks;
- preserve real event data instead of using mock frontend data;
- resolve rooms primarily from calendar metadata, not from fragile title guessing;
- normalize event title, subject, professor, activity type, year, group, room, and building fields;
- display schedules for normal desktop use;
- provide live board and full-screen TV signage modes;
- support admin workflows for calendar sources, manual imports, event cleanup, and diagnostics;
- run locally or in Docker.

## Main Features

### Schedule UI

- Light theme by default, with an optional dark theme.
- Day, week, and browse modes.
- Search and filters for subject, professor, room, and group.
- Calendar legend with enable/disable controls.
- Clean loading, empty, error, and nearest-day states.
- Status rendering for finished, ongoing, next, and upcoming events.
- Ongoing-event progress bars based on real event start/end timestamps.

### Live Board

- Displays classes currently in progress, upcoming classes, and tomorrow's classes.
- Building filtering.
- Rotating sections for live-board use.
- Auto-refresh for schedule data.

### TV / Campus Display Mode

Open with:

```text
/?tv=1
```

or use the **Display** button in the frontend.

TV mode includes:

- forced dark signage theme;
- large UTCN-branded clock and date;
- NOW and NEXT sections;
- room readouts optimized for distance viewing;
- status labels and live progress bars;
- free-room indicator when room metadata is available;
- adaptive pagination for wide displays and narrower stacked screens;
- optional building pinning:

```text
/?tv=1&building=Baritiu%20Electro%20Cluj
```

### Data Extraction and Parsing

- ICS fetching with retries, timeouts, and recurrence expansion.
- Outlook HTML fallback extraction where direct ICS data is unavailable.
- Europe/Bucharest local-date handling.
- Structured title parsing for common UTCN timetable title formats.
- Room/building normalization from room calendar metadata and aliases.
- Diagnostics for calendar coverage and parser behavior.

### Admin Tools

- Admin authentication with configurable credentials.
- Calendar source management.
- Manual import/refresh tools.
- Event cleanup utilities.
- Calendar diagnostics and import status views.

## Architecture

The application has three main layers:

```text
Outlook published calendars
        |
        v
Python import/parsing tools
        |
        v
JSON schedule files + SQLite metadata
        |
        v
Flask API
        |
        v
React frontend / legacy Flask templates / admin views
```

### Backend

The backend is a Flask application in [app.py](app.py). It serves:

- JSON APIs for events, calendars, departures, and status data;
- admin pages and actions;
- legacy server-rendered timetable pages;
- the built React frontend.

SQLite is used for calendar metadata and admin-managed event data. Parsed timetable output is stored in JSON files that are read and cached by the Flask app.

### Frontend

The React app lives in [frontend/src](frontend/src). It is built with Vite and includes:

- [frontend/src/App.jsx](frontend/src/App.jsx): top-level app shell, navigation, theme toggle, TV mode routing;
- [frontend/src/Schedule.jsx](frontend/src/Schedule.jsx): schedule search/filter views;
- [frontend/src/Departures.jsx](frontend/src/Departures.jsx): live board view;
- [frontend/src/TvBoard.jsx](frontend/src/TvBoard.jsx): full-screen display mode;
- [frontend/src/lib.js](frontend/src/lib.js): shared pure helpers for date/status/building/activity parsing;
- [frontend/src/styles.css](frontend/src/styles.css): shared theme and UI system.

## Repository Layout

```text
.
├── app.py                         # Main Flask application
├── timetable.py                   # Calendar/event parsing helpers
├── Dockerfile                     # Production image for app + built frontend
├── docker-compose.yml             # Main Docker Compose stack
├── docker-compose.local.yml       # Local Compose overrides
├── deploy.sh                      # Deployment helper script
├── requirements.txt               # Python dependencies
├── frontend/
│   ├── index.html                 # Vite HTML entry
│   ├── package.json               # Frontend scripts/dependencies
│   ├── vite.config.js             # Vite config and dev proxy
│   └── src/                       # React source and tests
├── templates/                     # Server-rendered Flask templates
├── static/                        # Static Flask assets
├── config/
│   ├── Rooms_PUBLISHER_HTML-ICS(in).csv
│   ├── building_aliases.json
│   └── room_aliases.json
├── tools/                         # Import, parsing, audit, and maintenance scripts
├── tests/                         # Backend tests
├── docker/                        # Worker Docker files
└── README.md
```

## Data Flow

### 1. Calendar Inventory

Room calendars are defined in CSV files such as:

```text
config/Rooms_PUBLISHER_HTML-ICS(in).csv
```

Each row typically contains:

- room/calendar display name;
- calendar email or identifier;
- canonical building;
- enabled flag;
- published HTML URL;
- published ICS URL.

### 2. Import

Import tools read the room calendar inventory and fetch events from the published URLs. Important scripts include:

- [tools/ics_fetch.py](tools/ics_fetch.py): direct ICS fetch and recurrence expansion;
- [tools/extract_published_events.py](tools/extract_published_events.py): extraction from published calendar sources;
- [tools/run_full_extraction.py](tools/run_full_extraction.py): full extraction workflow;
- [tools/build_schedule_by_room.py](tools/build_schedule_by_room.py): builds room-oriented schedule output;
- [tools/import_rooms_to_db.py](tools/import_rooms_to_db.py): imports room metadata into SQLite.

### 3. Normalization

The parser layer attempts to produce stable structured event fields:

- `display_title`
- `subject`
- `activity_type`
- `professor`
- `year`
- `group`
- `room`
- `building`
- `start`
- `end`
- `source`

The frontend consumes these structured fields when available and falls back carefully when older data is missing some fields.

### 4. Serving

The Flask app exposes parsed data through endpoints such as:

- `/events.json`
- `/departures.json`
- `/calendars.json`
- `/generate_status`

The Vite dev server proxies these endpoints to Flask during frontend development.

## Requirements

### For Docker Usage

- Docker
- Docker Compose
- Git

### For Local Development

- Python 3.11 or newer
- Node.js 20 or newer
- npm
- Playwright browser dependencies, if running HTML calendar extraction locally
- Git

## Configuration

Create a `.env` file in the repository root. If an example file exists, copy it first:

```bash
cp .env.example .env
```

Common environment variables:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
FLASK_SECRET=replace-with-a-long-random-secret
PORT=5000
PLAYWRIGHT_USERNAME=
PLAYWRIGHT_PASSWORD=
```

Important notes:

- Change `ADMIN_PASSWORD` before any shared or production deployment.
- Set `FLASK_SECRET` to a long random string for persistent, secure sessions.
- `PORT` defaults to `5000`.
- Playwright credentials are only needed if protected calendar sources require login.

## Running Locally

### Backend

Install Python dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start Flask:

```bash
python3 app.py
```

The backend defaults to:

```text
http://127.0.0.1:5000
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

The frontend dev server usually runs at:

```text
http://127.0.0.1:5173/
```

During development, Vite proxies backend API calls to Flask.

## Docker Deployment

The simplest deployment path is:

```bash
./deploy.sh
```

The deployment script is intended to:

1. stop existing containers;
2. build images;
3. start the stack;
4. wait for the app to become healthy;
5. run an admin-login smoke test.

You can also use Docker Compose directly:

```bash
docker compose up --build -d
```

Inspect logs:

```bash
docker compose logs -f
```

Stop the stack:

```bash
docker compose down
```

## Frontend Development

Frontend scripts:

```bash
cd frontend
npm test -- --run
npm run build
npm run dev -- --host 127.0.0.1
```

Development expectations:

- Schedule and TV views must use real backend data.
- Do not add mock timetable data to production UI paths.
- Keep schedule rows and TV cards as module-scope memoized components to avoid remount flicker.
- The TV clock may update every second.
- Event cards/lists should not remount or reanimate every second.
- Prefer pure helpers in `frontend/src/lib.js` for shared time/status/display logic.
- Keep the light theme as the default normal-use theme.
- Keep TV mode signage-friendly and forced dark.

## Backend API

### `GET /events.json`

Returns timetable events.

Common query parameters:

```text
from=YYYY-MM-DD
to=YYYY-MM-DD
subject=...
professor=...
room=...
group=...
```

Example:

```bash
curl "http://127.0.0.1:5000/events.json?from=2026-06-11&to=2026-06-12"
```

### `GET /departures.json`

Returns live-board style event data when available. The frontend can fall back to `/events.json` for today/tomorrow data.

### `GET /calendars.json`

Returns calendar metadata used for colors, room names, building filters, and free-room calculations.

### Generation and Admin Endpoints

The application includes admin and generation endpoints for manual imports, status checks, cleanup, and diagnostics. These routes are protected where appropriate and should be used through the admin interface unless you are maintaining the backend.

## Administration

The admin panel is available at:

```text
http://127.0.0.1:5000/admin
```

Admin capabilities include:

- viewing configured calendar sources;
- adding or editing calendar sources;
- enabling or disabling calendars;
- triggering data generation/import flows;
- inspecting generation status;
- managing manually added events;
- running cleanup tasks.

Use strong credentials in `.env` for any non-local deployment.

## Testing

### Backend Tests

Run from the repository root:

```bash
pytest
```

Important test areas:

- title parsing;
- room resolution;
- calendar inclusion;
- cleanup behavior;
- ICS fetching behavior.

### Frontend Tests

Run from the frontend directory:

```bash
cd frontend
npm test -- --run
```

### Production Frontend Build

```bash
cd frontend
npm run build
```

### Manual Smoke Test

After starting backend and frontend:

1. Open `http://127.0.0.1:5173/`.
2. Verify the Schedule view loads real rows from `/events.json`.
3. Try search and filters.
4. Switch to Live.
5. Open TV mode with `?tv=1`.
6. Confirm no visible overlap, clipping, or card flicker.
7. Confirm `/admin` login works with configured credentials.

## Operational Tasks

### Import Room Metadata

```bash
python3 tools/import_rooms_to_db.py
```

### Run Full Extraction

```bash
python3 tools/run_full_extraction.py
```

### Audit Calendar Coverage

```bash
python3 tools/audit_calendars.py
```

### Force Refresh

```bash
python3 tools/force_refresh_all.py
```

### Build Schedule by Room

```bash
python3 tools/build_schedule_by_room.py
```

Script names may evolve, so check `tools/` for the latest maintenance entry points.

## Troubleshooting

### Frontend Shows No Events

Check:

- Flask is running on the expected port.
- `/events.json?from=YYYY-MM-DD&to=YYYY-MM-DD` returns an array.
- Vite proxy is active when using the dev server.
- Calendar sources are enabled.
- Parsed schedule JSON files exist and are readable by Flask.

### TV Mode Looks Empty

Check:

- Today's date has events in the parsed data.
- The selected `building` query parameter matches a canonical building.
- `/calendars.json` includes room metadata if free-room data is expected.

### Admin Login Fails

Check:

- `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`.
- Container environment variables if running Docker.
- Browser cookies/session state.
- Flask logs for CSRF or authentication errors.

### Calendar Fetching Fails

Check:

- Published calendar URLs are still valid.
- Network access from the runtime environment.
- Outlook rate limiting or authentication requirements.
- Playwright installation if HTML fallback is required.

### Rooms Are Incorrect or Missing

Check:

- Calendar source metadata in the CSV/config files.
- `room_aliases.json`.
- `building_aliases.json`.
- Parser warnings in generated data.
- Room-resolution tests in `tests/test_room_resolution.py`.

## Security Notes

- Do not deploy with default admin credentials.
- Keep `.env` out of version control.
- Treat published calendar URLs as sensitive operational data.
- Use HTTPS in production behind a reverse proxy.
- Rotate credentials if a calendar or admin credential is exposed.
- Review admin endpoints before exposing the app beyond a trusted network.

## Contributing

Recommended workflow:

1. Create a branch from `main`.
2. Make focused changes.
3. Run relevant tests.
4. Run the frontend production build for UI changes.
5. Include screenshots or a short verification note for visual changes.
6. Open a pull request with a clear description.

Useful commands before submitting:

```bash
pytest
cd frontend
npm test -- --run
npm run build
```

Areas where contributions are especially useful:

- parser edge cases;
- room/building normalization;
- diagnostics and audit tooling;
- frontend accessibility;
- signage-mode layout testing;
- documentation and deployment notes.

## License

This project is licensed under the [MIT License](LICENSE).
