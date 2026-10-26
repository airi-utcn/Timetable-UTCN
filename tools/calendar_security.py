"""Calendar network policy shared by HTTP fetches and browser extraction.

Only HTTPS and explicitly trusted providers are allowed. Custom providers must
be listed by exact hostname in CALENDAR_ALLOWED_HOSTS (comma separated).
"""
import ipaddress
import os
import socket
import threading
import time
from urllib.parse import urlsplit, urlunsplit

DEFAULT_HOSTS = {'outlook.office365.com', 'outlook.office.com', 'outlook.live.com'}
_BROWSER_SUFFIXES = ('office.net', 'office365.com', 'microsoft.com',
                     'microsoftonline.com', 'outlook.com', 'live.com',
                     'sharepointonline.com')
_dns_cache = {}
_dns_lock = threading.Lock()


class UnsafeCalendarURL(ValueError):
    pass


def validate_calendar_url(url, *, browser_resource=False, resolve=False):
    if not isinstance(url, str) or not url or len(url) > 4096:
        raise UnsafeCalendarURL('A calendar HTTPS URL is required.')
    if any(ord(c) <= 32 or ord(c) == 127 for c in url) or '\\' in url:
        raise UnsafeCalendarURL('Invalid calendar URL.')
    try:
        parts = urlsplit(url)
        host = (parts.hostname or '').lower()
        port = parts.port
    except ValueError as exc:
        raise UnsafeCalendarURL('Invalid calendar URL.') from exc
    allowed = DEFAULT_HOSTS | {h.strip().lower() for h in
                              os.environ.get('CALENDAR_ALLOWED_HOSTS', '').split(',') if h.strip()}
    trusted = host in allowed
    if browser_resource:
        trusted = trusted or any(host == s or host.endswith('.' + s) for s in _BROWSER_SUFFIXES)
    if (parts.scheme != 'https' or not trusted or port not in (None, 443)
            or parts.username is not None or parts.password is not None or parts.fragment):
        raise UnsafeCalendarURL('Calendar URLs must use HTTPS on an allowed calendar host.')
    if resolve:
        now = time.monotonic()
        with _dns_lock:
            checked = _dns_cache.get(host, 0)
        if now - checked >= 30:
            try:
                addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
                if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                    raise UnsafeCalendarURL('Calendar host must resolve to public addresses.')
            except OSError as exc:
                raise UnsafeCalendarURL('Calendar host could not be resolved.') from exc
            with _dns_lock:
                if len(_dns_cache) >= 128:
                    _dns_cache.clear()
                _dns_cache[host] = now
    return urlunsplit(parts)


def restrict_browser_requests(context):
    """Check redirects and subresources as well as the initial navigation."""
    def route_request(route):
        try:
            validate_calendar_url(route.request.url, browser_resource=True, resolve=True)
        except UnsafeCalendarURL:
            route.abort()
        else:
            route.continue_()
    context.route('**/*', route_request)
