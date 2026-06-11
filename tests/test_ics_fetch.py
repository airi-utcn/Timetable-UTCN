"""Tests for tools/ics_fetch.py: recurrence expansion, timezone conversion,
date-window filtering and malformed-input tolerance."""

import pathlib
import sys
from datetime import date

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))

from ics_fetch import parse_ics_text, FetchError  # noqa: E402


def _wrap(vevents: str) -> str:
    return (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//Test//EN\r\n"
        + vevents +
        "END:VCALENDAR\r\n"
    )


def test_simple_event_parsed():
    ics = _wrap(
        "BEGIN:VEVENT\r\n"
        "UID:1\r\n"
        "DTSTART:20260611T080000\r\n"
        "DTEND:20260611T100000\r\n"
        "SUMMARY:Algorithms (laboratory) 2nd year/30221 R. Potolea\r\n"
        "LOCATION:UTCN - Baritiu - Sala 40\r\n"
        "END:VEVENT\r\n"
    )
    evs = parse_ics_text(ics, date(2026, 6, 1), date(2026, 6, 30))
    assert len(evs) == 1
    assert evs[0]['title'].startswith('Algorithms')
    assert evs[0]['start'] == '2026-06-11T08:00:00'
    assert evs[0]['location'] == 'UTCN - Baritiu - Sala 40'


def test_recurring_weekly_event_expanded():
    """The historical bug: weekly RRULE classes appeared only once."""
    ics = _wrap(
        "BEGIN:VEVENT\r\n"
        "UID:2\r\n"
        "DTSTART:20260601T100000\r\n"
        "DTEND:20260601T120000\r\n"
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10\r\n"
        "SUMMARY:Operating Systems (lecture) 2nd year A. Suciu\r\n"
        "END:VEVENT\r\n"
    )
    evs = parse_ics_text(ics, date(2026, 6, 1), date(2026, 6, 30))
    # Mondays in June 2026: 1, 8, 15, 22, 29 → 5 occurrences inside window
    assert len(evs) == 5
    starts = sorted(e['start'] for e in evs)
    assert starts[0] == '2026-06-01T10:00:00'
    assert starts[-1] == '2026-06-29T10:00:00'


def test_utc_times_converted_to_bucharest():
    # 07:00Z in June = 10:00 Europe/Bucharest (UTC+3, DST)
    ics = _wrap(
        "BEGIN:VEVENT\r\n"
        "UID:3\r\n"
        "DTSTART:20260611T070000Z\r\n"
        "DTEND:20260611T090000Z\r\n"
        "SUMMARY:Lecture in UTC\r\n"
        "END:VEVENT\r\n"
    )
    evs = parse_ics_text(ics, date(2026, 6, 1), date(2026, 6, 30))
    assert len(evs) == 1
    assert evs[0]['start'] == '2026-06-11T10:00:00'
    assert evs[0]['end'] == '2026-06-11T12:00:00'


def test_events_outside_window_excluded():
    ics = _wrap(
        "BEGIN:VEVENT\r\n"
        "UID:4\r\n"
        "DTSTART:20250101T100000\r\n"
        "DTEND:20250101T120000\r\n"
        "SUMMARY:Old event\r\n"
        "END:VEVENT\r\n"
    )
    evs = parse_ics_text(ics, date(2026, 6, 1), date(2026, 6, 30))
    assert evs == []


def test_empty_calendar_returns_empty_list():
    evs = parse_ics_text(_wrap(""), date(2026, 6, 1), date(2026, 6, 30))
    assert evs == []


def test_non_ics_raises_fetch_error():
    with pytest.raises(FetchError):
        parse_ics_text("<html>Sign in to Outlook</html>",
                       date(2026, 6, 1), date(2026, 6, 30))


def test_all_day_event_handled():
    ics = _wrap(
        "BEGIN:VEVENT\r\n"
        "UID:5\r\n"
        "DTSTART;VALUE=DATE:20260611\r\n"
        "DTEND;VALUE=DATE:20260612\r\n"
        "SUMMARY:Open day\r\n"
        "END:VEVENT\r\n"
    )
    evs = parse_ics_text(ics, date(2026, 6, 1), date(2026, 6, 30))
    assert len(evs) == 1
    assert evs[0]['start'].startswith('2026-06-11T00:00')
