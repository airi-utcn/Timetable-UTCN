"""Room-40 / all-calendar inclusion tests.

Verifies the publisher CSV is read completely (no rooms silently dropped:
numeric names, casing, whitespace) and that room 40 specifically survives
every transformation that previously lost it.
"""

import csv
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT))

from room_csv import room_from_sala_name  # noqa: E402

CSV_PATH = ROOT / 'config' / 'Rooms_PUBLISHER_HTML-ICS(in).csv'


def _read_rows():
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        rdr = csv.reader(f)
        next(rdr)  # header
        return [r for r in rdr if len(r) >= 6]


def test_csv_exists_and_nonempty():
    assert CSV_PATH.exists()
    assert len(_read_rows()) > 100


def test_every_row_has_a_url():
    for row in _read_rows():
        ics = (row[5] or '').strip()
        html = (row[4] or '').strip()
        assert ics or html, f'row without URL: {row[0]}'


def test_room_40_in_csv():
    rows = _read_rows()
    target = [r for r in rows if room_from_sala_name(r[0]) == '40']
    assert target, 'room 40 missing from publisher CSV'
    ics = target[0][5].strip()
    assert ics.endswith('calendar.ics')


def test_numeric_rooms_preserved():
    rows = _read_rows()
    numeric = [room_from_sala_name(r[0]) for r in rows
               if room_from_sala_name(r[0]) and room_from_sala_name(r[0]).isdigit()]
    assert len(numeric) > 10  # plenty of purely numeric rooms must survive


def test_app_reader_includes_room_40():
    """app.read_rooms_publisher_csv must include every CSV row (195) incl. 40."""
    import app as app_module
    entries = app_module.read_rooms_publisher_csv()
    assert len(entries) == len(_read_rows())
    names = [e[1] for e in entries]
    assert any(n.strip().endswith(' 40') for n in names), \
        'room 40 missing from read_rooms_publisher_csv output'


def test_no_duplicate_urls_in_csv():
    rows = _read_rows()
    urls = [(r[5] or r[4]).strip() for r in rows]
    assert len(urls) == len(set(urls)), 'duplicate calendar URLs in CSV'
