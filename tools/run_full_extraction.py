#!/usr/bin/env python3
"""
Run extraction for all enabled calendars in the DB.

For every enabled calendar this writes playwright_captures/events_<hash>.json
(hash = sha1(url)[:8]) and updates calendar_map.json with the calendar's
name/color/building/room so downstream room resolution can map events back to
the room calendar they came from. Finally it rebuilds the merged schedule.

Pipeline guarantees:
  * every calendar is attempted — one failure never aborts the run
    (allSettled semantics via ThreadPoolExecutor + per-future try/except)
  * ICS fetching has timeouts + retries with backoff (tools/ics_fetch.py)
  * recurring Outlook events are expanded inside the window
  * a calendar that fetches OK but has zero events gets an EMPTY events file
    (so stale data is cleared) and is reported in the summary
  * a calendar that FAILS keeps its previous events file (graceful fallback)
  * a final extraction_report.json + log summary shows: discovered, fetched,
    failed, zero-event rooms, and whether numeric rooms (e.g. "40") are in.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta

import hashlib

# ensure project root is on path when run as a script from different CWDs
proj_root = pathlib.Path(__file__).parent.parent
if str(proj_root) not in sys.path:
    sys.path.insert(0, str(proj_root))

try:
    from tools.ics_fetch import fetch_ics_events, FetchError
except ImportError:
    from ics_fetch import fetch_ics_events, FetchError  # type: ignore

DB = pathlib.Path('data') / 'app.db'
OUT_DIR = pathlib.Path('playwright_captures')
OUT_DIR.mkdir(exist_ok=True)

# Extraction window: small past buffer + full semester ahead.
# Must cover the build window used by ensure_schedule() in app.py.
PAST_DAYS = int(os.environ.get('EXTRACT_PAST_DAYS', '30'))
FUTURE_DAYS = int(os.environ.get('EXTRACT_FUTURE_DAYS', '240'))


def sha8(s: str) -> str:
    return hashlib.sha1(s.encode('utf-8')).hexdigest()[:8]


def get_enabled_calendars(db_path):
    """Return list of dicts for all enabled calendars (url, name, html_url, color, building, room)."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    try:
        cur.execute("""SELECT url, name, html_url, color, building, room
                       FROM calendars WHERE enabled = 1 AND url IS NOT NULL""")
        rows = [dict(r) for r in cur.fetchall()]
    except sqlite3.OperationalError:
        cur.execute("SELECT url, name FROM calendars WHERE enabled = 1 AND url IS NOT NULL")
        rows = [{'url': r[0], 'name': r[1], 'html_url': None,
                 'color': None, 'building': None, 'room': None}
                for r in cur.fetchall()]
    conn.close()
    return rows


_map_lock = threading.Lock()


def update_calendar_map(entries: dict):
    """Merge entries (hash -> metadata) into calendar_map.json atomically."""
    map_path = OUT_DIR / 'calendar_map.json'
    with _map_lock:
        cmap = {}
        if map_path.exists():
            try:
                cmap = json.loads(map_path.read_text(encoding='utf-8'))
            except Exception:
                cmap = {}
        cmap.update(entries)
        tmp = map_path.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(cmap, indent=2, ensure_ascii=False), encoding='utf-8')
        tmp.replace(map_path)


def write_events_file(h: str, events: list, cal: dict):
    """Write per-calendar events file, tagging each event with its source hash."""
    for ev in events:
        ev['source'] = h
        if cal.get('color'):
            ev['color'] = cal['color']
    ev_out = OUT_DIR / f'events_{h}.json'
    tmp = ev_out.with_suffix('.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(events, f, indent=2, ensure_ascii=False, default=str)
    tmp.replace(ev_out)


def main():
    calendars = get_enabled_calendars(DB)
    total = len(calendars)
    if not calendars:
        print('No enabled calendars found in DB')
        return 1

    today = date.today()
    from_d = today - timedelta(days=PAST_DAYS)
    to_d = today + timedelta(days=FUTURE_DAYS)

    print(f'Discovered {total} enabled calendars in DB')
    print(f'Extraction window: {from_d} .. {to_d} (Europe/Bucharest)')

    # quick visibility for the historically-missing numeric rooms
    numeric_rooms = [c.get('name') or c['url'] for c in calendars
                     if (c.get('name') or '').strip().split(' ')[-1].isdigit()]
    has_room_40 = any((c.get('name') or '').strip().endswith(' 40') for c in calendars)
    print(f'Numeric-named room calendars: {len(numeric_rooms)} '
          f'(room "40" included: {"YES" if has_room_40 else "NO"})')

    ics_concurrency = int(os.environ.get('ICS_CONCURRENCY', '8'))
    pw_concurrency = int(os.environ.get('PLAYWRIGHT_CONCURRENCY', '4'))

    ok = 0
    fail = 0
    zero_event_rooms = []
    failed_calendars = []
    progress_lock = threading.Lock()
    progress_path = OUT_DIR / 'import_progress.json'

    def write_progress(last=None):
        try:
            info = {'total': total, 'succeeded': ok, 'failed': fail, 'last': last}
            with open(progress_path, 'w', encoding='utf-8') as pf:
                json.dump(info, pf, indent=2, ensure_ascii=False)
        except Exception as e:
            print('Failed to write progress file:', e)

    # ── Phase 1: ICS fetch in parallel (bounded) ──
    playwright_queue = []

    def try_ics_only(cal: dict):
        url = cal['url']
        name = cal.get('name') or url
        h = sha8(url)
        try:
            events = fetch_ics_events(url, from_d, to_d)
        except FetchError as e:
            print(f'  ✗ ICS failed: {name} -> {e}')
            return (cal, False, None)
        except Exception as e:  # never let one calendar kill the pool
            print(f'  ✗ ICS unexpected error: {name} -> {e}')
            return (cal, False, None)
        write_events_file(h, events, cal)
        update_calendar_map({h: {
            'url': url,
            'name': cal.get('name') or '',
            'color': cal.get('color'),
            'building': cal.get('building'),
            'room': cal.get('room'),
        }})
        if events:
            print(f'  ✓ ICS OK: {name} ({len(events)} events)')
        else:
            print(f'  ✓ ICS OK (0 events in window): {name}')
        return (cal, True, len(events))

    print(f'Phase 1: ICS fetch for {total} calendars (concurrency={ics_concurrency})...')
    with ThreadPoolExecutor(max_workers=ics_concurrency) as pool:
        futures = {pool.submit(try_ics_only, cal): cal for cal in calendars}
        for future in as_completed(futures):
            cal = futures[future]
            try:
                cal, success, n_events = future.result()
            except Exception as e:
                print(f'  ✗ worker crashed for {cal.get("name") or cal["url"]}: {e}')
                success, n_events = False, None
            with progress_lock:
                if success:
                    ok += 1
                    if n_events == 0:
                        zero_event_rooms.append(cal.get('name') or cal['url'])
                else:
                    playwright_queue.append(cal)
                write_progress(last=cal.get('name') or cal['url'])

    print(f'Phase 1 complete: {ok} via ICS, {len(playwright_queue)} need Playwright fallback')

    # ── Phase 2: Playwright fallback (limited concurrency) ──
    if playwright_queue:
        env = os.environ.copy()
        env.setdefault('PYTHONUTF8', '1')
        print(f'Phase 2: Playwright extraction for {len(playwright_queue)} calendars '
              f'(concurrency={pw_concurrency})...')

        def run_playwright_for(cal: dict):
            url = cal['url']
            name = cal.get('name') or url
            pw_url = cal.get('html_url') or url
            h = sha8(url)  # hash is always based on the primary (ICS) URL
            tmp_out = OUT_DIR / f'_tmp_{h}'
            tmp_out.mkdir(parents=True, exist_ok=True)
            sub_env = dict(env)
            sub_env['EXTRACT_OUTPUT_DIR'] = str(tmp_out)
            cmd = [sys.executable, str(pathlib.Path('tools') / 'extract_published_events.py'), pw_url]
            try:
                proc = subprocess.run(cmd, check=False, env=sub_env, timeout=300)
                rc = proc.returncode
            except subprocess.TimeoutExpired:
                print(f'  ✗ Playwright timeout: {name}')
                return (cal, False, None)
            except Exception as e:
                print(f'  ✗ Playwright error: {name} -> {e}')
                return (cal, False, None)
            finally:
                pass
            ev_in = tmp_out / 'events.json'
            n_events = None
            success = False
            if ev_in.exists():
                try:
                    data = json.loads(ev_in.read_text(encoding='utf-8'))
                except Exception:
                    data = []
                write_events_file(h, data, cal)
                update_calendar_map({h: {
                    'url': url,
                    'name': cal.get('name') or '',
                    'color': cal.get('color'),
                    'building': cal.get('building'),
                    'room': cal.get('room'),
                }})
                n_events = len(data)
                success = True
                print(f'  ✓ Playwright OK: {name} ({n_events} events)')
            else:
                success = (rc == 0)
                if not success:
                    print(f'  ✗ Playwright produced no events.json: {name}')
            try:
                import shutil
                shutil.rmtree(tmp_out, ignore_errors=True)
            except Exception:
                pass
            return (cal, success, n_events)

        with ThreadPoolExecutor(max_workers=pw_concurrency) as pool:
            futures = {pool.submit(run_playwright_for, cal): cal for cal in playwright_queue}
            for future in as_completed(futures):
                cal = futures[future]
                try:
                    cal, success, n_events = future.result()
                except Exception as e:
                    print(f'  ✗ worker crashed for {cal.get("name") or cal["url"]}: {e}')
                    success, n_events = False, None
                with progress_lock:
                    if success:
                        ok += 1
                        if n_events == 0:
                            zero_event_rooms.append(cal.get('name') or cal['url'])
                    else:
                        fail += 1
                        failed_calendars.append(cal.get('name') or cal['url'])
                    write_progress(last=cal.get('name') or cal['url'])

    # ── Summary ──
    print('─' * 60)
    print(f'EXTRACTION SUMMARY')
    print(f'  calendars discovered : {total}')
    print(f'  fetched successfully : {ok}')
    print(f'  failed               : {fail}')
    if failed_calendars:
        print(f'  failed calendars     : {", ".join(failed_calendars[:20])}'
              + (' …' if len(failed_calendars) > 20 else ''))
    print(f'  rooms with 0 events  : {len(zero_event_rooms)}')
    if zero_event_rooms:
        print(f'    {", ".join(zero_event_rooms[:20])}'
              + (' …' if len(zero_event_rooms) > 20 else ''))
    print(f'  room "40" included   : {"YES" if has_room_40 else "NO — check CSV/DB!"}')
    print('─' * 60)

    report = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'window': {'from': from_d.isoformat(), 'to': to_d.isoformat()},
        'discovered': total,
        'succeeded': ok,
        'failed': fail,
        'failed_calendars': failed_calendars,
        'zero_event_rooms': zero_event_rooms,
        'room_40_included': has_room_40,
    }
    try:
        with open(OUT_DIR / 'extraction_report.json', 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print('Failed to write extraction report:', e)

    # ── Rebuild schedule for the same window ──
    print('Rebuilding schedule from', from_d.isoformat(), 'to', to_d.isoformat())
    cmd = [sys.executable, str(pathlib.Path('tools') / 'build_schedule_by_room.py'),
           '--from', from_d.isoformat(), '--to', to_d.isoformat()]
    try:
        subprocess.run(cmd, check=False, timeout=300)
        print('Schedule rebuild finished (check playwright_captures/schedule_by_room.json)')
    except Exception as e:
        print('Schedule rebuild failed:', e)
        return 1

    # ── Final import marker ──
    try:
        if ok + fail == total:
            marker = OUT_DIR / 'import_complete.txt'
            tmp = OUT_DIR / (marker.name + '.tmp')
            write_progress(last=None)

            files_count = 0
            for _attempt in range(5):
                try:
                    files_count = len(list(OUT_DIR.glob('events_*.json')))
                except Exception:
                    files_count = 0
                if files_count >= ok:
                    break
                time.sleep(1)

            try:
                prog = json.loads(progress_path.read_text(encoding='utf-8'))
            except Exception:
                prog = {}
            prog['files_count'] = files_count
            prog['finished'] = True
            prog['finished_at'] = datetime.utcnow().isoformat() + 'Z'
            with open(progress_path, 'w', encoding='utf-8') as pf:
                json.dump(prog, pf, indent=2, ensure_ascii=False)

            with open(tmp, 'w', encoding='utf-8') as mf:
                mf.write('Import complete\n')
                json.dump(report, mf, indent=2, ensure_ascii=False)
            tmp.replace(marker)
            print('Import complete — marker written to', marker)
    except Exception as e:
        print('Error while finalizing import marker:', e)

    return 0


if __name__ == '__main__':
    sys.exit(main())
