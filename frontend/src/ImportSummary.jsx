import React from 'react'

export default function ImportSummary({ progress, running, calendars, retry }) {
  const p = progress?.import_progress
  const failed = calendars.filter(c => c.enabled !== 0 && c.import_status?.status === 'failed').length
  if (!p && !failed) return null
  const processed = (p?.succeeded || 0) + (p?.failed || 0)
  const percent = p?.total ? Math.min(100, Math.round(processed / p.total * 100)) : 0
  return <section className="import-summary" aria-label="Import results" aria-live="polite">
    <h2>{running ? 'Import in progress' : p?.failed ? 'Import finished with errors' : 'Latest import'}</h2>
    {p && <>
      <p><strong>{p.succeeded || 0} succeeded</strong> · {p.failed || 0} failed · {p.zero_events || 0} empty calendars</p>
      <progress max="100" value={percent} aria-label="Calendars processed" />
      <p>{processed}/{p.total} calendars processed {running ? `· ${p.stage || 'processing'}` : ''}</p>
      {running && p.last && <p>Last processed: {p.last}</p>}
      {p.finished_at && <p>Finished: {new Date(p.finished_at).toLocaleString()}</p>}
    </>}
    <p>Stored snapshots: {progress?.fs_events_count || 0}. These include data from previous imports.</p>
    <button type="button" disabled={running || !failed} onClick={retry}>Retry failed calendars ({failed})</button>
  </section>
}

export function CalendarImportStatus({ value }) {
  if (!value) return <span className="calendar-result">Not checked yet</span>
  return <div className={'calendar-result ' + value.status}>
    <strong>{value.status === 'failed' ? 'Failed · previous data retained' : value.event_count === 0 ? 'Success · no events in import window' : `Success · ${value.event_count} events`}</strong>
    <span>Checked: {new Date(value.checked_at).toLocaleString()}</span>
    {value.last_success && <span>Last success: {new Date(value.last_success).toLocaleString()}</span>}
    {value.error && <span>{value.error}</span>}
  </div>
}
