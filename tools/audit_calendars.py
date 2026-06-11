#!/usr/bin/env python3
"""Audit the calendar pipeline: CSV -> DB -> events files -> schedule.

Prints a clear report showing where rooms could get lost:
  * how many calendars the publisher CSV defines
  * how many are in the DB and enabled
  * which CSV rooms are missing from the DB
  * how many events_<hash>.json files exist and which calendars lack one
  * which rooms appear in schedule_by_room.json
  * explicit check for numeric rooms such as "40"

Exit code 0 when the pipeline is consistent (CSV == enabled DB calendars and
room 40, if defined in the CSV, is present everywhere it should be), 1 otherwise.

Usage: python3 tools/audit_calendars.py [--check-room 40]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from room_csv import room_from_sala_name  # noqa: E402

CSV_NAME = 'Rooms_PUBLISHER_HTML-ICS(in).csv'
DB_PATH = ROOT / 'data' / 'app.db'
CAP_DIR = ROOT / 'playwright_captures'


def sha8(s: str) -> str:
    return hashlib.sha1(s.encode('utf-8')).hexdigest()[:8]


def read_csv():
    for cand in (ROOT / 'config' / CSV_NAME, ROOT / CSV_NAME, CAP_DIR / CSV_NAME):
        if cand.exists():
            rows = []
            with open(cand, 'r', encoding='utf-8') as f:
                rdr = csv.reader(f)
                header = next(rdr, None)
                for row in rdr:
                    if len(row) < 6:
                        continue
                    name = row[0].strip()
                    ics = row[5].strip()
                    html = row[4].strip()
                    url = ics or html
                    if url:
                        rows.append({'name': name, 'url': url,
                                     'room': room_from_sala_name(name)})
            return cand, rows
    return None, []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check-room', default='40',
                    help='room label that must be present end-to-end (default: 40)')
    args = ap.parse_args()
    target_room = args.check_room
    problems = []

    print('═' * 64)
    print('CALENDAR PIPELINE AUDIT')
    print('═' * 64)

    # 1) CSV
    csv_path, csv_rows = read_csv()
    if not csv_path:
        print(f'✗ CSV {CSV_NAME} not found')
        return 1
    print(f'CSV: {csv_path}')
    print(f'  calendars defined : {len(csv_rows)}')
    csv_target = [r for r in csv_rows if r['room'] == target_room]
    print(f'  room "{target_room}" in CSV : {"YES — " + csv_target[0]["name"] if csv_target else "no"}')

    # 2) DB
    db_rows = []
    if DB_PATH.exists():
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        try:
            db_rows = [dict(r) for r in conn.execute(
                'SELECT url, name, room, building, enabled FROM calendars')]
        finally:
            conn.close()
        enabled = [r for r in db_rows if r['enabled']]
        print(f'DB: {DB_PATH}')
        print(f'  calendars total   : {len(db_rows)}')
        print(f'  calendars enabled : {len(enabled)}')
        db_urls = {r['url'] for r in db_rows}
        missing_in_db = [r for r in csv_rows if r['url'] not in db_urls]
        if missing_in_db:
            problems.append(f'{len(missing_in_db)} CSV calendars missing from DB')
            print(f'  ✗ MISSING from DB ({len(missing_in_db)}):')
            for r in missing_in_db[:10]:
                print(f'     - {r["name"]}')
        else:
            print('  ✓ every CSV calendar is in the DB')
        disabled = [r for r in db_rows if not r['enabled'] and r['url'] in {c['url'] for c in csv_rows}]
        if disabled:
            problems.append(f'{len(disabled)} CSV calendars disabled in DB')
            print(f'  ✗ DISABLED but in CSV ({len(disabled)}):')
            for r in disabled[:10]:
                print(f'     - {r["name"]}')
        if csv_target:
            tgt = next((r for r in db_rows if r['url'] == csv_target[0]['url']), None)
            if not tgt:
                problems.append(f'room {target_room} calendar not in DB')
                print(f'  ✗ room "{target_room}" calendar NOT in DB')
            elif not tgt['enabled']:
                problems.append(f'room {target_room} calendar disabled')
                print(f'  ✗ room "{target_room}" calendar DISABLED')
            else:
                print(f'  ✓ room "{target_room}" calendar enabled '
                      f'(room column: {tgt.get("room") or "EMPTY"})')
    else:
        print(f'DB not found at {DB_PATH} (run tools/init_db.py first)')

    # 3) events files
    ev_files = {p.name for p in CAP_DIR.glob('events_*.json')} if CAP_DIR.exists() else set()
    print(f'Events files: {len(ev_files)} in {CAP_DIR}')
    missing_files = []
    zero_event = []
    for r in csv_rows:
        fn = f'events_{sha8(r["url"])}.json'
        if fn not in ev_files:
            missing_files.append(r['name'])
        else:
            try:
                data = json.loads((CAP_DIR / fn).read_text(encoding='utf-8'))
                if not data:
                    zero_event.append(r['name'])
            except Exception:
                pass
    print(f'  calendars without events file : {len(missing_files)}')
    for n in missing_files[:10]:
        print(f'     - {n}')
    print(f'  calendars with 0 events       : {len(zero_event)}')
    if csv_target:
        fn = f'events_{sha8(csv_target[0]["url"])}.json'
        print(f'  room "{target_room}" events file       : '
              f'{"present" if fn in ev_files else "MISSING (not yet fetched)"} ({fn})')

    # 4) schedule
    sched_path = CAP_DIR / 'schedule_by_room.json'
    if sched_path.exists():
        try:
            sched = json.loads(sched_path.read_text(encoding='utf-8'))
            n_events = sum(len(evs) for days in sched.values() for evs in days.values())
            print(f'Schedule: {len(sched)} rooms, {n_events} events')
            print(f'  room "{target_room}" in schedule : '
                  f'{"YES" if target_room in sched else "no (no events in window)"}')
        except Exception as e:
            print(f'Schedule: failed to read ({e})')
    else:
        print('Schedule: schedule_by_room.json not built yet')

    print('─' * 64)
    if problems:
        print('AUDIT RESULT: ✗ PROBLEMS FOUND')
        for p in problems:
            print(f'  - {p}')
        return 1
    print('AUDIT RESULT: ✓ pipeline consistent')
    return 0


if __name__ == '__main__':
    sys.exit(main())
