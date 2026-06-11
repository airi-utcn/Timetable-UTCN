"""Tests for room resolution: room must come from the source room calendar
(calendar_map / publisher CSV), never from numbers in event titles."""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))

from room_csv import room_from_sala_name, site_from_sala_name  # noqa: E402
from build_schedule_by_room import resolve_room, build_schedule  # noqa: E402
from datetime import datetime  # noqa: E402


# ── room_from_sala_name (publisher CSV Nume_Sala column) ──────────────

def test_numeric_room_40():
    assert room_from_sala_name("UTCN - Baritiu - Sala 40") == "40"


def test_alphanumeric_rooms():
    assert room_from_sala_name("UTCN - Baritiu - Sala BT 503") == "BT 503"
    assert room_from_sala_name("UTCN - Baritiu - Sala P03") == "P03"
    assert room_from_sala_name("UTCN - Baritiu - Sala 26B") == "26B"


def test_special_rooms():
    assert room_from_sala_name("UTCN - Aula Domsa") == "Aula Domsa"
    assert room_from_sala_name("UTCN - Dorobantilor 71-73 - DECIDFR") == "DECIDFR"


def test_empty_and_none():
    assert room_from_sala_name("") is None
    assert room_from_sala_name(None) is None


def test_site_extraction():
    assert site_from_sala_name("UTCN - Baritiu - Sala 40") == "Baritiu"


# ── resolve_room priority ──────────────────────────────────────────────

CAL_MAP = {
    'abc12345': {'name': 'UTCN - Baritiu - Sala 40', 'room': '40',
                 'building': 'UTCN BARITIU ELECTRO CLUJ'},
    'def67890': {'name': 'UTCN - Daicoviciu - Sala 479', 'room': None,
                 'building': None},
}


def test_room_from_calendar_map_room_field():
    room, building = resolve_room('abc12345', 'some location text', CAL_MAP)
    assert room == '40'
    assert building == 'UTCN BARITIU ELECTRO CLUJ'


def test_room_derived_from_calendar_name():
    room, _ = resolve_room('def67890', None, CAL_MAP)
    assert room == '479'


def test_room_falls_back_to_location():
    room, _ = resolve_room('unknown', 'UTCN - Baritiu - Sala 26B', CAL_MAP)
    assert room == '26B'


def test_unknown_source_no_location():
    room, building = resolve_room(None, None, CAL_MAP)
    assert room is None
    assert building is None


# ── build_schedule: title numbers must NOT become the room ─────────────

def _mk_event(title, source=None, location=None):
    return {
        'title': title,
        'location': location,
        'source': source,
        'start': datetime(2026, 6, 11, 10, 0),
        'end': datetime(2026, 6, 11, 12, 0),
        'professor': None,
        'color': None,
        'raw': None,
    }


def test_group_number_not_used_as_room():
    # "30221" is a group; the event's room must come from its calendar (40)
    ev = _mk_event("Algorithms (laboratory) 2nd year/30221 R. Potolea",
                   source='abc12345')
    sched = build_schedule([ev], calendar_map=CAL_MAP)
    assert list(sched.keys()) == ['40']
    stored = sched['40']['2026-06-11'][0]
    assert stored['group'] == '30221'
    assert stored['activity_type'] == 'laboratory'
    assert stored['professor'] == 'R. Potolea'


def test_unparsed_event_kept_with_warnings():
    ev = _mk_event("Mystery event with no structure", source='abc12345')
    sched = build_schedule([ev], calendar_map=CAL_MAP)
    stored = sched['40']['2026-06-11'][0]
    assert stored['parse_warnings']          # kept, not dropped
    assert stored['raw_title'] == "Mystery event with no structure"
