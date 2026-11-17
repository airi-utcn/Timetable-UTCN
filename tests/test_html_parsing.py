"""Exercise the Beautiful Soup/Soup Sieve HTML fallback after security upgrades."""
from datetime import datetime

from timetable import parse_microformat_vevents


def test_html_fallback_preserves_class_metadata_and_timezone():
    html = '''<section><article class="vevent">
      <h2 class="summary">Programare <em>avansată</em></h2>
      <time class="dtstart" datetime="2026-11-16T08:00:00+02:00"></time>
      <abbr class="dtend" title="2026-11-16T10:00:00+02:00"></abbr>
      <span class="location">Sala 40</span>
      <p class="description">Laborator pentru grupa 30221</p>
    </article></section>'''
    events = parse_microformat_vevents(html)
    assert len(events) == 1
    event = events[0]
    assert 'avansată' in event.title
    assert event.start == datetime.fromisoformat('2026-11-16T08:00:00+02:00')
    assert event.end == datetime.fromisoformat('2026-11-16T10:00:00+02:00')
    assert event.location == 'Sala 40'
    assert event.description == 'Laborator pentru grupa 30221'


def test_html_fallback_skips_invalid_dates_and_tolerates_missing_metadata():
    html = '''<div class="vevent"><b class="summary">Missing time</b></div>
      <div class="vevent"><time class="dtstart">not a date</time></div>
      <div class="vevent" data-start="2026-11-17T12:00:00">
        <span class="fn">Valid class</span>
      </div>'''
    events = parse_microformat_vevents(html)
    assert len(events) == 1
    assert events[0].title == 'Valid class'
    assert events[0].end is None
    assert events[0].location == ''
