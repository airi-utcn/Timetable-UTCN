"""Persistent per-calendar import results, shared by web workers and the importer."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from tools.storage import update_json


def source_key(url):
    return hashlib.sha1(url.encode('utf-8')).hexdigest()[:8]


def read_status(directory='playwright_captures'):
    try:
        data = json.loads((Path(directory) / 'calendar_status.json').read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def error_summary(error):
    """Keep useful HTTP/network diagnostics without publishing calendar tokens."""
    parts = []
    while error and len(parts) < 3:
        message = re.sub(r'https?://\S+', '[calendar URL]', str(error))
        parts.append(message[:250])
        error = error.__cause__
    return ' — '.join(parts)


def record_result(directory, calendar, success, count=None, error=None, window=None):
    now = datetime.now(timezone.utc).isoformat()
    key = source_key(calendar['url'])
    def update(current):
        previous = current.get(key, {})
        current[key] = {
            'status': 'success' if success else 'failed',
            'checked_at': now,
            'last_success': now if success else previous.get('last_success'),
            'event_count': count if success else previous.get('event_count'),
            'window': window if success else previous.get('window'),
            'error': None if success else error or 'Import failed; previous data retained.',
        }
        return current
    update_json(Path(directory) / 'calendar_status.json', update)
