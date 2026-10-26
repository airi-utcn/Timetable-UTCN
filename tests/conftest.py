"""Keep tests independent of local credentials and production data."""
import os

os.environ['DISABLE_BACKGROUND_TASKS'] = '1'
os.environ['ADMIN_USERNAME'] = 'test-admin'
os.environ['ADMIN_PASSWORD'] = 'test-password-only-92!'
os.environ['FLASK_SECRET'] = 'test-session-secret-only-0123456789abcdef'

import pytest


@pytest.fixture(autouse=True)
def isolated_application(monkeypatch, tmp_path):
    import app
    monkeypatch.setenv('DISABLE_BACKGROUND_TASKS', '1')
    monkeypatch.setattr(app, 'DB_PATH', tmp_path / 'app.db')
    monkeypatch.setattr(app, '_db_initialized', None)
    monkeypatch.setattr(app, '_normalized_events_cache', None)
    monkeypatch.setattr(app, '_file_cache', {})
