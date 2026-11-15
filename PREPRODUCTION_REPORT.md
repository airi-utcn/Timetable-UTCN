# Preproduction verification — 15 November 2026

This report covers the current working tree. No production deployment was performed, and browser mutations used a disposable QA database.

## Findings corrected

- Day and Week now share one selected date. Legacy week links and date-only links open a consistent period, and impossible dates are rejected.
- A daily agenda that is following today advances at midnight. Historical selections remain on their chosen dates.
- Upgraded Soup Sieve from 3.0.4 to 4.0 for [GHSA-mmhr-3c5m-f64f](https://github.com/facelessuser/soupsieve/security/advisories/GHSA-mmhr-3c5m-f64f). Added the safe lower bound to `requirements.txt`. Python 3.11.5+ is required; CI and production use 3.12.
- Added five regression tests for the date cases above, two HTML fallback parser tests for the dependency update, and corrected midnight tests to dispatch events through React's test utilities.

## Results

| Check | Result |
| --- | --- |
| Python backend suite, Python 3.12 / Europe/Bucharest | 144 passed |
| Frontend suite, Europe/Bucharest | 54 passed across 9 files |
| Frontend suite in Node 22 Linux container | 54 passed |
| Date/helper tests under UTC | 34 passed |
| Production Vite build | Passed; public and admin entry points built |
| Browser integration against two Gunicorn workers and the production bundle | 15 scenarios passed; zero JavaScript errors |
| Automated WCAG scans | Zero violations on seven timetable screens |
| Responsive overflow checks | Passed at 320, 390, 768, 1024 and 1920 pixels |
| npm audit, including development dependencies | Zero reported vulnerabilities |
| pip-audit of `requirements.lock` after update | Zero reported vulnerabilities |
| Python dependency compatibility (`pip check`) | Passed |
| Python compile checks, shell syntax checks, whitespace checks | Passed |
| Real public Outlook ICS fetch and parse, room 40 | Passed; 5 events in the 15-day test window |
| Final production Docker image and startup smoke | Passed; healthy, non-root Gunicorn, local `.env` excluded; patched Soup Sieve 4.0 confirmed |

The 15 browser scenarios covered production assets/security headers; date arrows/Today; shared week-to-day navigation; search and keyboard suggestions; subject/professor/room/group filters; event details/focus restoration; calendar selections/favorites/share reload; verified free/occupied/unknown rooms; failed refresh retention; Live/Display modes; responsive layouts/sidebar focus/reduced motion; accessibility; admin login/search/edit/CSRF/manual event creation/deletion/session extension/logout; unauthorized routes/invalid intervals; and 40 concurrent-batch API reads with consistent responses.

Browser fixtures were clearly labeled QA data and loaded into an isolated temporary backend. The separate Outlook check used a genuine public feed and did not import anything into the user's database or change production data.

## Commands

```bash
TZ=Europe/Bucharest python -m pytest -q
cd frontend
TZ=Europe/Bucharest npm test -- --run
npm run build
npm audit
cd ..
python -m pip check
python -m pip_audit -r requirements.lock --disable-pip --no-deps
for script in entrypoint.sh deploy.sh deployment/*.sh; do bash -n "$script" || exit 1; done
python -m compileall -q app.py timetable.py tools deployment
git diff --check
docker build -t utcn-timetable:preproduction-check .
python deployment/smoke_image.py utcn-timetable:preproduction-check
```

Raw XML reports, advisory scans, browser results, fixture scripts and container logs from this run are under `/tmp/utcn-release-check/` (temporary local artifacts).

Tested local image: `utcn-timetable:preproduction-check` (ARM64), ID `sha256:c4e2f2c3820b0e7094853e0bf7961bc6a9ef2890f95d48606c8e29f33f1e59aa`. The disposable smoke-test container was removed.

## Boundaries before deployment

- There is no configured lint or TypeScript-check script in this JavaScript project. Build and compile checks passed; no separate lint/type check is claimed.
- Browser coverage used desktop/headless Chrome, not Safari, Firefox, VoiceOver or real phone hardware. Automated accessibility checks are not a full manual WCAG audit.
- The Docker build is native Linux ARM64 on this Mac. The CI workflow separately builds AMD64 and ARM64; an AMD64 build was not run locally.
- One genuine upstream calendar was checked. This does not establish that every university feed is available or that production has a current successful import.
- An empty local database is not a working timetable installation. Configure calendars and complete a successful import in the target environment; `/health` is a liveness check, not proof of timetable freshness.
- Production DNS/TLS, server secrets, backups, registry publication and deployment/rollback on the target VM were not exercised. Deployment rollback behavior is covered by the backend tests.
