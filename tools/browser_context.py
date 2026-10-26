"""Isolated public-calendar browsing, with optional serialized login profiles."""
from contextlib import contextmanager
import os
from pathlib import Path
import tempfile

try:
    from .calendar_security import restrict_browser_requests
    from .storage import file_lock
except ImportError:
    from calendar_security import restrict_browser_requests
    from storage import file_lock


@contextmanager
def calendar_browser(playwright, *, headless=True):
    profile = os.environ.get('PLAYWRIGHT_USER_DATA_DIR')
    # Public calendars do not need shared persistent state. A configured login
    # profile is locked for the entire browser lifetime (Chromium requires it).
    with tempfile.TemporaryDirectory(prefix='calendar_profile_') as temporary:
        directory = Path(profile or temporary)
        directory.mkdir(parents=True, exist_ok=True)
        with file_lock(directory / '.calendar_profile.lock'):
            context = playwright.chromium.launch_persistent_context(
                str(directory), headless=headless, service_workers='block')
            try:
                restrict_browser_requests(context)
                context.route_web_socket('**/*', lambda ws: ws.close())
                yield context
            finally:
                context.close()
