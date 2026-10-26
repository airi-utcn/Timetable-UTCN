#!/usr/bin/env python3
"""Robust ICS fetching and parsing for Outlook published room calendars.

This module is the single fetch path used by app.py, run_full_extraction.py
and timetable.py. It fixes the historical problems of the old path:

  * no HTTP timeout (a hung Outlook connection froze the whole import)
  * no retries on transient errors
  * recurring events (RRULE) were never expanded, so weekly classes
    appeared only once — the main reason rooms looked "empty"
  * timezone was stripped as-UTC instead of converted to Europe/Bucharest

Public API:
    fetch_ics_events(url, from_date, to_date) -> list[dict]
        Each dict: {start, end, title, location, description}
        with naive ISO datetimes in Europe/Bucharest local time.
    FetchError — raised when the URL cannot be fetched/parsed after retries.
"""

from __future__ import annotations

import logging
import time
from urllib.parse import urljoin

try:
    from .calendar_security import validate_calendar_url, UnsafeCalendarURL
except ImportError:
    from calendar_security import validate_calendar_url, UnsafeCalendarURL
from datetime import date, datetime, timedelta
from typing import List, Optional

import requests

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - py<3.9 not supported in prod
    ZoneInfo = None

log = logging.getLogger("ics_fetch")

LOCAL_TZ_NAME = "Europe/Bucharest"
LOCAL_TZ = ZoneInfo(LOCAL_TZ_NAME) if ZoneInfo else None

# HTTP settings
CONNECT_TIMEOUT = 10          # seconds to establish a connection
READ_TIMEOUT = 45             # seconds to read the response
MAX_RETRIES = 3               # total attempts per URL
BACKOFF_BASE = 1.5            # seconds; doubles per attempt

_HEADERS = {
    "Accept": "text/calendar, text/plain, */*;q=0.1",
    "User-Agent": "UTCN-Timetable/2.0 (+https://timetable.utcluj.ro)",
}


class FetchError(RuntimeError):
    """Raised when an ICS URL cannot be fetched or parsed after retries."""


MAX_RESPONSE_BYTES = 10 * 1024 * 1024
MAX_FETCH_SECONDS = 60


def fetch_text(url: str, session: Optional[requests.Session] = None) -> str:
    """Bounded HTTPS fetch; validate every redirect and close every response.

    Only retry transient HTTP/network failures. A successful empty calendar is
    distinct from a failed fetch, so callers can safely retain previous data.
    """
    try:
        url = validate_calendar_url(url)
    except UnsafeCalendarURL as exc:
        raise FetchError(str(exc)) from exc
    owned_session = session is None
    sess = session or requests.Session()
    if owned_session:
        # Do not allow ambient proxy/.netrc credentials to bypass the URL policy.
        sess.trust_env = False
    try:
        for attempt in range(MAX_RETRIES):
            started = time.monotonic()
            current_url = url
            try:
                for redirect_count in range(6):
                    remaining = MAX_FETCH_SECONDS - (time.monotonic() - started)
                    if remaining <= 0:
                        raise FetchError('Calendar request exceeded its time limit.')
                    validate_calendar_url(current_url, resolve=True)
                    resp = sess.get(current_url, headers=_HEADERS,
                                    timeout=(min(CONNECT_TIMEOUT, remaining), min(READ_TIMEOUT, remaining)),
                                    allow_redirects=False, stream=True)
                    try:
                        if resp.status_code in (301, 302, 303, 307, 308):
                            if redirect_count == 5 or not resp.headers.get('Location'):
                                raise FetchError('Invalid or excessive calendar redirects.')
                            current_url = urljoin(current_url, resp.headers['Location'])
                            continue
                        if resp.status_code in (429, 500, 502, 503, 504):
                            raise requests.exceptions.ConnectionError(f'HTTP {resp.status_code}')
                        if resp.status_code >= 400:
                            raise FetchError(f'Calendar server returned HTTP {resp.status_code}.')
                        length = resp.headers.get('Content-Length')
                        if length and int(length) > MAX_RESPONSE_BYTES:
                            raise FetchError('Calendar response exceeds the size limit.')
                        chunks = []
                        size = 0
                        for chunk in resp.iter_content(chunk_size=65536):
                            size += len(chunk)
                            if size > MAX_RESPONSE_BYTES or time.monotonic() - started > MAX_FETCH_SECONDS:
                                raise FetchError('Calendar response exceeds the size or time limit.')
                            chunks.append(chunk)
                        return b''.join(chunks).decode(resp.encoding or 'utf-8', errors='replace')
                    finally:
                        resp.close()
            except UnsafeCalendarURL as exc:
                raise FetchError(str(exc)) from exc
            except requests.exceptions.RequestException as exc:
                if attempt == MAX_RETRIES - 1:
                    raise FetchError(f'Calendar fetch failed after {MAX_RETRIES} attempts.') from exc
                time.sleep(BACKOFF_BASE * (2 ** attempt))
    finally:
        if owned_session:
            sess.close()


def _to_local_naive(value) -> Optional[datetime]:
    """Convert an ICS DTSTART/DTEND value to a naive Europe/Bucharest datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None and LOCAL_TZ is not None:
            value = value.astimezone(LOCAL_TZ)
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        # all-day event
        return datetime(value.year, value.month, value.day)
    return None


def _parse_with_icalendar(text: str, window_start: datetime,
                          window_end: datetime) -> List[dict]:
    """Parse ICS text with icalendar + recurring_ical_events.

    Expands RRULE/RDATE/EXDATE recurrences inside the window and applies
    RECURRENCE-ID overrides — this is what the old `ics`-library path could
    not do.
    """
    import icalendar
    import recurring_ical_events

    cal = icalendar.Calendar.from_ical(text)

    # Bound expansion before the recurrence library materializes its result list.
    estimate = 0
    for event in cal.walk('VEVENT'):
        rules = event.get('RRULE') or []
        if rules and not isinstance(rules, list):
            rules = [rules]
        if not rules:
            estimate += 1
        for rule in rules:
            frequency = str(rule.get('FREQ', [''])[0]).upper()
            if frequency not in {'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'}:
                raise FetchError('Subdaily recurrence rules are not supported for timetable feeds.')
            multiplier = 1
            for key in ('BYHOUR', 'BYMINUTE', 'BYSECOND'):
                multiplier *= max(1, len(rule.get(key, [])))
            estimate += ((window_end - window_start).days + 1) * multiplier
        if estimate > 100000:
            raise FetchError('Calendar recurrence expansion exceeds the event limit.')

    # recurring_ical_events expects tz-aware bounds when events are tz-aware;
    # using local tz keeps the window aligned with Romanian wall-clock days.
    start_b = window_start.replace(tzinfo=LOCAL_TZ) if LOCAL_TZ else window_start
    end_b = window_end.replace(tzinfo=LOCAL_TZ) if LOCAL_TZ else window_end

    occurrences = recurring_ical_events.of(cal).between(start_b, end_b)

    out: List[dict] = []
    for ev in occurrences:
        try:
            dtstart = ev.get("DTSTART")
            dtend = ev.get("DTEND")
            start = _to_local_naive(dtstart.dt if dtstart is not None else None)
            end = _to_local_naive(dtend.dt if dtend is not None else None)
            if start is None:
                continue
            out.append({
                "start": start.isoformat(),
                "end": end.isoformat() if end else None,
                "title": str(ev.get("SUMMARY", "") or ""),
                "location": str(ev.get("LOCATION", "") or ""),
                "description": str(ev.get("DESCRIPTION", "") or ""),
            })
        except Exception as e:  # one malformed VEVENT must not kill the feed
            log.warning("skipping malformed VEVENT: %s", e)
    return out


def _parse_with_ics_lib(text: str, window_start: datetime,
                        window_end: datetime) -> List[dict]:
    """Legacy fallback parser (no recurrence expansion)."""
    from ics import Calendar

    cal = Calendar(text)
    out: List[dict] = []
    for e in cal.events:
        try:
            begin = getattr(e, "begin", None)
            end = getattr(e, "end", None)
            start_dt = _to_local_naive(begin.datetime) if begin else None
            end_dt = _to_local_naive(end.datetime) if end else None
            if start_dt is None or not (window_start <= start_dt < window_end):
                continue
            out.append({
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat() if end_dt else None,
                "title": e.name or "",
                "location": e.location or "",
                "description": e.description or "",
            })
        except Exception as exc:
            log.warning("skipping malformed event (ics lib): %s", exc)
    return out


def parse_ics_text(text: str, from_date: date, to_date: date) -> List[dict]:
    """Parse ICS text into event dicts within [from_date, to_date]."""
    if to_date < from_date or (to_date - from_date).days > 366:
        raise FetchError('Calendar date window must be ordered and at most 366 days.')
    if len((text or '').encode('utf-8')) > MAX_RESPONSE_BYTES:
        raise FetchError('Calendar exceeds the size limit.')
    body = (text or "").lstrip()
    if not body.upper().startswith("BEGIN:VCALENDAR"):
        raise FetchError("response is not an iCalendar (missing BEGIN:VCALENDAR)")

    window_start = datetime(from_date.year, from_date.month, from_date.day)
    window_end = datetime(to_date.year, to_date.month, to_date.day) + timedelta(days=1)

    try:
        return _parse_with_icalendar(text, window_start, window_end)
    except FetchError:
        raise
    except ImportError:
        log.warning("icalendar/recurring_ical_events not installed — "
                    "falling back to legacy parser (NO recurrence expansion)")
    except Exception as e:
        log.warning("icalendar parse failed (%s) — trying legacy parser", e)
    return _parse_with_ics_lib(text, window_start, window_end)


def fetch_ics_events(url: str, from_date: date, to_date: date,
                     session: Optional[requests.Session] = None) -> List[dict]:
    """Fetch and parse an ICS URL, returning events in the date window.

    Raises FetchError on network/parse failure (so callers can distinguish
    "fetch failed, keep old data" from "fetched OK, room has zero events").
    """
    text = fetch_text(url, session=session)
    return parse_ics_text(text, from_date, to_date)
