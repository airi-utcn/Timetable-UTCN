from concurrent.futures import ProcessPoolExecutor
from datetime import date, timedelta
import json
from pathlib import Path
from unittest.mock import Mock

import app
from tools.storage import atomic_write_json, update_json
from tools import worker_update_future as worker


def _merge_entry(args):
    path, index = args
    update_json(path, lambda current: {**current, str(index): index})


def test_concurrent_metadata_writers_preserve_every_entry(tmp_path):
    path = str(tmp_path / 'calendar_map.json')
    with ProcessPoolExecutor(max_workers=4) as pool:
        list(pool.map(_merge_entry, [(path, n) for n in range(24)]))
    assert json.loads(Path(path).read_text()) == {str(n): n for n in range(24)}


def test_cache_detects_atomic_replacement_and_deletion(tmp_path):
    path = tmp_path / 'schedule.json'
    atomic_write_json(path, {'a': 1})
    assert app._read_json_cached(str(path), ttl=0) == {'a': 1}
    atomic_write_json(path, {'b': 2})
    assert app._read_json_cached(str(path), ttl=0) == {'b': 2}
    path.unlink()
    assert app._read_json_cached(str(path), ttl=0) is None


def test_db_schema_not_reinitialized_per_request(monkeypatch):
    app.init_db()
    connect = Mock(wraps=app.get_db_connection)
    monkeypatch.setattr(app, 'get_db_connection', connect)
    app.init_db()
    app.init_db()
    connect.assert_not_called()


def test_event_normalization_cached_per_generation(monkeypatch):
    from tools import event_parser
    parse = Mock(wraps=event_parser.parse_event)
    monkeypatch.setattr(event_parser, 'parse_event', parse)
    schedule = {'40': {'2026-10-26': [{'title': 'A', 'start': '2026-10-26T09:00:00'}]}}
    calendar_map = {}
    first = app._normalized_schedule_events(schedule, calendar_map)
    second = app._normalized_schedule_events(schedule, calendar_map)
    assert first is second
    assert parse.call_count == 1


def test_cleanup_preserves_bookings_beyond_sixty_days(tmp_path):
    path = tmp_path / 'playwright_captures' / 'events_abcd1234.json'
    future = {'start': (date.today() + timedelta(days=180)).isoformat() + 'T09:00:00', 'title': 'Future'}
    atomic_write_json(path, [future])
    app.cleanup_old_events(base_dir=tmp_path)
    assert json.loads(path.read_text()) == [future]


def test_worker_missing_or_invalid_staging_preserves_future(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, 'OUT', tmp_path)
    url = 'https://outlook.office365.com/calendar.ics'
    h = worker.sha8(url)
    target = tmp_path / f'events_{h}.json'
    original = [{'title': 'Keep', 'start': (date.today() + timedelta(days=3)).isoformat()}]
    atomic_write_json(target, original)
    worker.merge_future_events(url)
    assert json.loads(target.read_text()) == original
    (tmp_path / f'events_{h}.tmp.json').write_text('invalid JSON')
    worker.merge_future_events(url)
    assert json.loads(target.read_text()) == original


def test_group_filter_and_manual_filters_are_consistent(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    schedule = tmp_path / 'schedule.json'
    atomic_write_json(schedule, {'40': {'2026-10-26': [
        {'title': 'Course', 'raw_title': 'Course', 'group': '30221', 'start': '2026-10-26T09:00:00'},
        {'title': 'Other', 'raw_title': 'Other', 'group': '30222', 'start': '2026-10-26T10:00:00'},
    ]}})
    monkeypatch.setattr(app, 'ensure_schedule', lambda *args: (schedule, None))
    app.init_db()
    app.add_manual_event_db({'title': 'Manual', 'start': '2026-10-26T12:00:00', 'location': '99'})
    client = app.app.test_client()
    result = client.get('/events.json?from=2026-10-26&to=2026-10-26&group=30221').get_json()
    assert [e['title'] for e in result] == ['Course']
    result = client.get('/events.json?from=2026-10-26&to=2026-10-26&room=99').get_json()
    assert [e['title'] for e in result] == ['Manual']


def test_schedule_does_not_resurrect_deleted_bookings(tmp_path):
    from tools.build_schedule_by_room import load_all_events
    atomic_write_json(tmp_path / 'events.json', [{'title': 'Deleted', 'start': '2026-10-26T09:00:00'}])
    atomic_write_json(tmp_path / 'events_abcdef01.json', [])
    assert load_all_events(str(tmp_path)) == []


def test_schedule_fingerprint_detects_older_input_change(tmp_path, monkeypatch):
    import os
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(app, '_FP_CACHE_TTL', 0)
    captures = tmp_path / 'playwright_captures'
    first = captures / 'events_a.json'
    second = captures / 'events_b.json'
    atomic_write_json(first, [])
    atomic_write_json(second, [])
    os.utime(second, (2000000000, 2000000000))
    before = app._events_files_fingerprint()
    atomic_write_json(first, [{'title': 'Updated older file'}])
    assert app._events_files_fingerprint() != before


def test_schedule_lock_contention_never_runs_competing_builder(tmp_path, monkeypatch):
    from tools.storage import file_lock
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(app, '_FP_CACHE_TTL', 0)
    run = Mock()
    monkeypatch.setattr(app.subprocess, 'run', run)
    with file_lock(tmp_path / 'playwright_captures/.schedule_rebuild.lock'):
        app.ensure_schedule(date.today(), date.today())
    run.assert_not_called()


def test_disabled_calendar_events_are_not_public(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    url = 'https://outlook.office365.com/calendar.ics'
    app.init_db()
    app.add_calendar_url(url)
    with app.get_db_connection() as conn:
        conn.execute('UPDATE calendars SET enabled = 0')
    source = worker.sha8(url)
    schedule = tmp_path / 'schedule.json'
    atomic_write_json(schedule, {'40': {'2026-10-26': [
        {'title': 'Private', 'raw_title': 'Private', 'source': source, 'start': '2026-10-26T09:00:00'},
    ]}})
    monkeypatch.setattr(app, 'ensure_schedule', lambda *args: (schedule, None))
    assert app.app.test_client().get('/events.json').get_json() == []


def test_ics_export_escapes_feed_text_and_keeps_correct_timezone(tmp_path):
    from datetime import datetime
    from icalendar import Calendar
    from tools.events_to_ics import build_ics
    target = tmp_path / 'export.ics'
    title = 'Course\nBEGIN:VEVENT\nSUMMARY:injected, text; escaped'
    build_ics([{'start': datetime(2026, 6, 11, 10), 'end': datetime(2026, 6, 11, 12),
                'title': title, 'location': 'Room 40', 'raw': {'secret': 'hidden'}}], target)
    events = Calendar.from_ical(target.read_bytes()).walk('VEVENT')
    assert len(events) == 1
    assert str(events[0]['SUMMARY']) == title
    assert events[0]['DTSTART'].dt.hour == 7
    assert b'hidden' not in target.read_bytes()
