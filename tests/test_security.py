import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

import app
from tools.calendar_security import UnsafeCalendarURL, validate_calendar_url


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return app.app.test_client()


@pytest.fixture
def auth():
    value = base64.b64encode(f'{app.ADMIN_USERNAME}:{app.ADMIN_PASSWORD}'.encode()).decode()
    return {'Authorization': f'Basic {value}'}


@pytest.mark.parametrize('path,method', [
    ('/generate_events', 'post'), ('/generate_status', 'get'),
    ('/events/add', 'post'), ('/events/delete', 'post'),
    ('/download/.env', 'get'), ('/debug/pipeline', 'get'),
    ('/__last_response', 'get'), ('/__saved/last_response_x.txt', 'get'),
    ('/export_room?room=40', 'get'), ('/admin/logout', 'post'),
])
def test_sensitive_routes_require_authentication(client, path, method):
    assert getattr(client, method)(path).status_code == 401


def test_form_session_requires_csrf_and_rotates_token(client, monkeypatch):
    client.get('/admin/login')
    with client.session_transaction() as session:
        login_token = session['_admin_csrf']
    result = client.post('/admin/login', data={
        'username': app.ADMIN_USERNAME, 'password': app.ADMIN_PASSWORD,
        'csrf_token': login_token,
    })
    assert result.status_code == 302
    with client.session_transaction() as session:
        token = session['_admin_csrf']
    assert token != login_token
    assert client.post('/admin/extend_session').status_code == 400
    assert client.post('/admin/extend_session', headers={'X-CSRF-Token': token}).status_code == 200
    assert client.post('/admin/extend_session', headers={
        'X-CSRF-Token': token, 'Sec-Fetch-Site': 'cross-site',
    }).status_code == 400


def test_explicit_basic_api_still_works(client, auth):
    assert client.post('/admin/extend_session', headers=auth).status_code == 200


def test_basic_with_browser_origin_requires_csrf(client, auth):
    assert client.post('/admin/extend_session', headers={**auth, 'Origin': 'https://attacker.test'}).status_code == 400


def test_unicode_login_is_rejected_without_crashing(client):
    client.get('/admin/login')
    with client.session_transaction() as session:
        token = session['_admin_csrf']
    assert client.post('/admin/login', data={
        'username': 'șțî', 'password': 'äöü', 'csrf_token': token,
    }).status_code == 401


def test_failure_limit_is_shared_in_sqlite(client):
    for _ in range(app._FAILED_THRESHOLD):
        app._record_failed('203.0.113.8')
    assert app._is_ip_blocked('203.0.113.8')
    with app.get_db_connection() as conn:
        conn.execute('UPDATE admin_auth_failures SET window_start = ?', (time.time() - 301,))
    assert not app._is_ip_blocked('203.0.113.8')


@pytest.mark.parametrize('filename', ['.env', 'app.py', 'data/app.db', '../.env', 'config/calendar_config.json'])
def test_download_allowlist_hides_repository_files(client, auth, filename):
    Path('.env').write_text('secret')
    assert client.get('/download/' + filename, headers=auth).status_code == 404


def test_download_does_not_follow_export_symlink(client, auth):
    Path('playwright_captures').mkdir()
    Path('.env').write_text('secret')
    Path('playwright_captures/schedule_by_room.json').symlink_to(Path('.env').resolve())
    assert client.get('/download/schedule_by_room.json', headers=auth).status_code == 404


def test_download_export_attachment(client, auth):
    Path('playwright_captures').mkdir()
    Path('playwright_captures/schedule_by_room.json').write_text('{}')
    response = client.get('/download/schedule_by_room.json', headers=auth)
    assert response.status_code == 200
    assert 'attachment' in response.headers['Content-Disposition']
    response.close()


@pytest.mark.parametrize('url', [
    'http://outlook.office365.com/calendar.ics', 'file:///etc/passwd',
    'https://127.0.0.1/calendar.ics', 'https://169.254.169.254/',
    'https://outlook.office365.com.attacker.test/',
    'https://outlook.office365.com@attacker.test/',
    'https://user:pass@outlook.office365.com/',
    'https://outlook.office365.com:8443/', 'https://outlook.office365.com/\n',
])
def test_unsafe_calendar_urls_are_rejected(url):
    with pytest.raises(UnsafeCalendarURL):
        validate_calendar_url(url)


def test_allowed_calendar_url():
    url = 'https://outlook.office365.com/owa/calendar/token/calendar.ics'
    assert validate_calendar_url(url) == url


def test_custom_host_cannot_resolve_to_private_ip(monkeypatch):
    monkeypatch.setenv('CALENDAR_ALLOWED_HOSTS', 'calendar.example.org')
    monkeypatch.setattr('socket.getaddrinfo', lambda *a, **k: [(2, 1, 6, '', ('10.0.0.1', 443))])
    with pytest.raises(UnsafeCalendarURL):
        validate_calendar_url('https://calendar.example.org/', resolve=True)


def test_invalid_csv_does_not_replace_existing_data(client, auth):
    from io import BytesIO
    response = client.post('/admin/upload_rooms_publisher', headers=auth, data={
        'file': (BytesIO(b'Nume_Sala,a,b,c,d,e\nroom,email,b,1,http://127.0.0.1/x,\n'), 'rooms.csv'),
    })
    assert response.status_code == 400
    assert not Path('config').exists()


def test_calendar_mutation_rejects_ssrf_before_starting_job(client, auth):
    assert client.post('/admin/set_calendar_url', headers=auth,
                       data={'calendar_url': 'http://127.0.0.1/'}).status_code == 400


def test_public_metadata_does_not_expose_feed_tokens(client):
    app.init_db()
    app.add_calendar_url('https://outlook.office365.com/private-token/calendar.ics', 'Room 40')
    response = client.get('/calendars.json')
    assert response.status_code == 200
    assert b'private-token' not in response.data


def test_cookie_flags_and_private_cache_policy(client):
    response = client.get('/admin/login')
    assert 'HttpOnly' in response.headers['Set-Cookie']
    assert 'SameSite=Lax' in response.headers['Set-Cookie']
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.headers['X-Content-Type-Options'] == 'nosniff'


def test_production_rejects_placeholder_secret():
    root = Path(app.__file__).parent
    env = {**os.environ, 'FLASK_ENV': 'production', 'FLASK_SECRET': 'dev-secret'}
    result = subprocess.run([sys.executable, '-c', 'import app'], cwd=root,
                            env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'Set FLASK_SECRET' in result.stderr


def test_valid_inventory_upload_preserves_manual_events(client, auth, tmp_path, monkeypatch):
    from io import BytesIO
    from unittest.mock import Mock
    app.init_db()
    app.add_manual_event_db({'title': 'Keep manual', 'start': '2026-10-26T09:00:00'})
    app.add_extracurricular_db({'title': 'Keep extra', 'date': '2026-10-26'})
    monkeypatch.setattr(app, '__file__', str(tmp_path / 'app.py'))
    launch = Mock()
    monkeypatch.setattr(app, '_launch_full_extraction', launch)
    content = ('Nume_Sala,Email_Sala,Cladire,Optiune_Delegat,PublishedCalendarUrl,PublishedICalUrl\n'
               'UTCN - Baritiu - Sala 40,room@example.org,Building,TRUE,,https://outlook.office365.com/calendar.ics\n')
    response = client.post('/admin/upload_rooms_publisher', headers=auth,
                           data={'file': (BytesIO(content.encode()), 'rooms.csv')})
    assert response.status_code == 202
    assert [e['title'] for e in app.list_manual_events_db()] == ['Keep manual']
    assert [e['title'] for e in app.list_extracurricular_db()] == ['Keep extra']
    assert app.list_calendar_urls()[0]['room'] == '40'
    launch.assert_called_once()


def test_csv_upload_does_not_interrupt_running_import(client, auth, tmp_path, monkeypatch):
    from io import BytesIO
    from tools.storage import file_lock
    monkeypatch.setattr(app, '__file__', str(tmp_path / 'app.py'))
    content = ('Nume_Sala,a,b,c,d,e\nRoom,email,Building,TRUE,,https://outlook.office365.com/calendar.ics\n')
    with file_lock(tmp_path / 'playwright_captures/.full_extraction.lock'):
        result = client.post('/admin/upload_rooms_publisher', headers=auth,
                             data={'file': (BytesIO(content.encode()), 'rooms.csv')})
    assert result.status_code == 409
    assert not (tmp_path / 'config').exists()
