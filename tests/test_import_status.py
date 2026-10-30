from types import SimpleNamespace
import json
from tools.import_status import record_result, read_status, source_key, error_summary


def test_failure_retains_last_success_and_event_count(tmp_path):
    cal = {'url': 'https://outlook.office365.com/test.ics'}
    record_result(tmp_path, cal, True, 12)
    previous = read_status(tmp_path)[source_key(cal['url'])]
    record_result(tmp_path, cal, False, error='HTTP 500')
    result = read_status(tmp_path)[source_key(cal['url'])]
    assert result['last_success'] == previous['last_success']
    assert result['event_count'] == 12
    assert result['status'] == 'failed'
    assert result['error'] == 'HTTP 500'


def test_error_diagnostics_hide_calendar_tokens():
    try:
        try:
            raise ConnectionError('HTTP 500')
        except ConnectionError as cause:
            raise RuntimeError('Failed https://outlook.office365.com/secret-token') from cause
    except RuntimeError as error:
        result = error_summary(error)
    assert 'secret-token' not in result
    assert 'HTTP 500' in result


def test_retry_import_only_touches_failed_calendars(tmp_path, monkeypatch):
    from tools import run_full_extraction as runner
    monkeypatch.chdir(tmp_path)
    out = tmp_path / 'captures'
    out.mkdir()
    good = {'url': 'https://outlook.office365.com/good.ics', 'name': 'good'}
    bad = {'url': 'https://outlook.office365.com/bad.ics', 'name': 'bad'}
    record_result(out, good, True, 5)
    record_result(out, bad, False, error='HTTP 500')
    monkeypatch.setattr(runner, 'OUT_DIR', out)
    monkeypatch.setattr(runner, 'get_enabled_calendars', lambda _: [good, bad])
    called = []
    monkeypatch.setattr(runner, 'fetch_ics_events', lambda url, *args: called.append(url) or [])
    monkeypatch.setattr(runner.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0))
    assert runner._main(failed_only=True) == 0
    assert called == [bad['url']]
    results = read_status(out)
    assert results[source_key(good['url'])]['event_count'] == 5
    assert results[source_key(bad['url'])]['status'] == 'success'
    progress = json.loads((out / 'import_progress.json').read_text())
    assert progress['total'] == 1
    assert progress['succeeded'] == 1
    assert progress['zero_events'] == 1
    assert progress['finished'] is True
