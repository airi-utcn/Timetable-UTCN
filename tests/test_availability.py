"""Availability must stay complete and fail closed when imports are uncertain."""
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

import app
from tools.import_status import record_result, source_key
from tools.storage import file_lock


ENDPOINT = '/availability-data.json?from=2026-11-17&to=2026-11-17'


@pytest.fixture
def availability_client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    captures = Path('playwright_captures')
    captures.mkdir()
    calendar = {
        'url': 'https://outlook.office365.com/qa-availability/calendar.ics',
        'name': 'Room 40', 'room': '40', 'building': 'Baritiu', 'enabled': 1,
    }
    source = source_key(calendar['url'])
    record_result(captures, calendar, True, count=1,
                  window={'from': '2026-11-01', 'to': '2027-06-01'})
    monkeypatch.setattr(app, 'list_calendar_urls', lambda: [calendar])
    path = captures / 'schedule_by_room.json'
    event = {
        'title': 'QA occupied room', 'raw_title': 'QA occupied room',
        'start': '2026-11-17T10:00:00', 'end': '2026-11-17T12:00:00',
        'source': source, 'room': '40', 'building': 'Baritiu',
        'subject': 'QA', 'professor': 'Teacher', 'group': '30221',
    }
    path.write_text(json.dumps({'40': {'2026-11-17': [event]}}))
    (captures / 'calendar_map.json').write_text(json.dumps({source: calendar}))
    monkeypatch.setattr(app, 'ensure_schedule', lambda *args: (path, None))
    return app.app.test_client(), path, source, calendar


def test_availability_contains_occupancy_and_verification_metadata(availability_client):
    client, _, source, _ = availability_client
    response = client.get(ENDPOINT)
    assert response.status_code == 200
    data = response.get_json()
    assert len(data['events']) == 1
    assert data['events'][0]['source'] == source
    assert data['calendars'][source]['room'] == '40'
    assert data['calendars'][source]['freshness']['status'] == 'success'
    assert 'https://' not in response.text


@pytest.mark.parametrize('extra', [
    'subject=missing', 'professor=missing', 'room=999', 'group=999',
])
def test_timetable_filters_never_hide_bookings_from_availability(availability_client, extra):
    client, *_ = availability_client
    # A scoped timetable must not produce a misleading availability snapshot.
    response = client.get(ENDPOINT + '&' + extra)
    assert response.status_code == 200
    assert len(response.get_json()['events']) == 1
    # The ordinary schedule endpoint retains its established filtering behavior.
    schedule_url = '/events.json?from=2026-11-17&to=2026-11-17&' + extra
    assert client.get(schedule_url).get_json() == []


@pytest.mark.parametrize('query', [
    '', 'from=bad&to=2026-11-17', 'from=2026-11-17&to=bad',
    'from=2026-11-18&to=2026-11-17', 'from=2026-11-17&to=2026-11-25',
])
def test_invalid_interval_is_rejected_before_loading_schedule(
    availability_client, monkeypatch, query,
):
    client, *_ = availability_client
    loader = Mock(side_effect=AssertionError('Invalid dates must not load a schedule'))
    monkeypatch.setattr(app, 'ensure_schedule', loader)
    assert client.get('/availability-data.json?' + query).status_code == 400
    loader.assert_not_called()


@pytest.mark.parametrize('content', ['invalid json', '[]', 'null'])
def test_unreadable_schedule_is_never_successful_availability(availability_client, content):
    client, path, *_ = availability_client
    path.write_text(content)
    response = client.get(ENDPOINT)
    assert response.status_code == 503
    assert 'unknown' in response.get_json()['error'].lower()


def test_running_import_prevents_publishing_availability(availability_client):
    client, *_ = availability_client
    with file_lock('playwright_captures/.full_extraction.lock'):
        assert client.get(ENDPOINT).status_code == 503


def test_failed_import_retains_bookings_but_exposes_failure_status(availability_client):
    client, _, source, calendar = availability_client
    record_result('playwright_captures', calendar, False, error='QA failure')
    data = client.get(ENDPOINT).get_json()
    assert len(data['events']) == 1
    assert data['calendars'][source]['freshness']['status'] == 'failed'
    assert data['calendars'][source]['freshness']['last_success']


def test_availability_reuses_its_validated_snapshot_without_a_second_load(
    availability_client, monkeypatch,
):
    client, path, *_ = availability_client
    loader = Mock(side_effect=[(path, None), RuntimeError('QA second schedule load failed')])
    monkeypatch.setattr(app, 'ensure_schedule', loader)
    response = client.get(ENDPOINT)
    assert response.status_code == 200
    assert len(response.get_json()['events']) == 1
    loader.assert_called_once()


def test_schedule_load_failure_is_not_misreported_as_no_bookings(
    availability_client, monkeypatch,
):
    client, *_ = availability_client
    monkeypatch.setattr(app, 'ensure_schedule', Mock(side_effect=RuntimeError('QA load failed')))
    assert client.get(ENDPOINT).status_code == 503


@pytest.mark.parametrize('manual', [False, True])
def test_availability_keeps_bookings_started_before_the_requested_day(
    availability_client, manual,
):
    client, path, source, _ = availability_client
    event = {
        'title': 'QA overnight', 'raw_title': 'QA overnight',
        'start': '2026-11-16T23:30:00', 'end': '2026-11-17T01:00:00',
        'source': source, 'location': '40', 'building': 'Baritiu',
    }
    if manual:
        app.init_db()
        app.add_manual_event_db(event)
        path.write_text('{}')
    else:
        path.write_text(json.dumps({'40': {'2026-11-16': [event]}}))
    response = client.get(ENDPOINT)
    assert response.status_code == 200
    assert any(ev['title'] == 'QA overnight' for ev in response.get_json()['events'])


@pytest.mark.parametrize('loader', ['list_manual_events_db', 'list_extracurricular_db'])
def test_unreadable_local_bookings_make_availability_unavailable(
    availability_client, monkeypatch, loader,
):
    client, *_ = availability_client
    monkeypatch.setattr(app, loader, Mock(side_effect=RuntimeError('QA database unavailable')))
    assert client.get(ENDPOINT).status_code == 503
