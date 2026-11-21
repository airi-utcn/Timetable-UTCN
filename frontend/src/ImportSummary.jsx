import React from 'react'

export default function ImportSummary({
  progress,
  running,
  calendars,
  retry,
  compact = false
}) {
  const p = progress?.import_progress
  const failed = calendars.filter(
    (c) => c.enabled !== 0 && c.import_status?.status === 'failed'
  ).length
  const latestAttempt = calendars.reduce((latest, calendar) => {
    const checked = calendar.import_status?.checked_at
    return checked &&
      Number.isFinite(+new Date(checked)) &&
      (!latest || new Date(checked) > new Date(latest))
      ? checked
      : latest
  }, null)
  if (!p && !failed) return null
  const processed = (p?.succeeded || 0) + (p?.failed || 0)
  const percent = p?.total
    ? Math.min(100, Math.round((processed / p.total) * 100))
    : 0
  if (compact)
    return (
      <section
        className={
          'import-summary import-summary-compact' +
          (!failed && !running ? ' is-neutral' : '')
        }
        aria-label="Import results"
        aria-live="polite"
      >
        <div className="import-overview">
          <div>
            <strong>
              {running
                ? 'Import in progress'
                : failed
                  ? `${failed} calendars need attention`
                  : 'Latest import'}
            </strong>
            <span>
              {p
                ? `${p.succeeded || 0} imported · ${p.failed || 0} failed · ${p.zero_events || 0} empty`
                : `Failed imports · ${latestAttempt ? 'Last attempt: ' + new Date(latestAttempt).toLocaleString('en-GB') : 'Previous data retained.'}`}
            </span>
          </div>
          <button type="button" disabled={running || !failed} onClick={retry}>
            Retry failed calendars ({failed})
          </button>
        </div>
        {running && (
          <progress
            max="100"
            value={percent}
            aria-label="Calendars processed"
          />
        )}
        <details className="import-detail">
          <summary>Import details</summary>
          <p>
            {p
              ? `${processed}/${p.total} calendars processed${running ? ` · ${p.stage || 'processing'}` : ''}`
              : 'No progress report available.'}
          </p>
          {p?.last && <p>Last processed: {p.last}</p>}
          {p?.finished_at && (
            <p>Finished: {new Date(p.finished_at).toLocaleString()}</p>
          )}
          <p>
            Stored snapshots: {progress?.fs_events_count || 0}. These include
            data from previous imports.
          </p>
        </details>
      </section>
    )
  return (
    <section
      className="import-summary"
      aria-label="Import results"
      aria-live="polite"
    >
      <h2>
        {running
          ? 'Import in progress'
          : p?.failed
            ? 'Import finished with errors'
            : 'Latest import'}
      </h2>
      {p && (
        <>
          <p>
            <strong>{p.succeeded || 0} succeeded</strong> · {p.failed || 0}{' '}
            failed · {p.zero_events || 0} empty calendars
          </p>
          <progress
            max="100"
            value={percent}
            aria-label="Calendars processed"
          />
          <p>
            {processed}/{p.total} calendars processed{' '}
            {running ? `· ${p.stage || 'processing'}` : ''}
          </p>
          {running && p.last && <p>Last processed: {p.last}</p>}
          {p.finished_at && (
            <p>Finished: {new Date(p.finished_at).toLocaleString()}</p>
          )}
        </>
      )}
      <p>
        Stored snapshots: {progress?.fs_events_count || 0}. These include data
        from previous imports.
      </p>
      <button type="button" disabled={running || !failed} onClick={retry}>
        Retry failed calendars ({failed})
      </button>
    </section>
  )
}

export function CalendarImportStatus({ value, compact = false }) {
  if (!value) return <span className="calendar-result">Not checked yet</span>
  if (compact)
    return (
      <details className={'calendar-status ' + value.status}>
        <summary>
          <span>
            {value.status === 'failed'
              ? 'Import failed · previous data retained'
              : value.event_count === 0
                ? 'Imported · no events'
                : `Imported${value.event_count != null ? ` · ${value.event_count} events` : ''}`}
          </span>
          <span className="status-detail-label">Details</span>
        </summary>
        <div className="calendar-result">
          <span>Checked: {new Date(value.checked_at).toLocaleString()}</span>
          {value.last_success && (
            <span>
              Last success: {new Date(value.last_success).toLocaleString()}
            </span>
          )}
          {value.error && <span>{value.error}</span>}
        </div>
      </details>
    )
  return (
    <div className={'calendar-result ' + value.status}>
      <strong>
        {value.status === 'failed'
          ? 'Failed · previous data retained'
          : value.event_count === 0
            ? 'Success · no events in import window'
            : `Success · ${value.event_count} events`}
      </strong>
      <span>Checked: {new Date(value.checked_at).toLocaleString()}</span>
      {value.last_success && (
        <span>
          Last success: {new Date(value.last_success).toLocaleString()}
        </span>
      )}
      {value.error && <span>{value.error}</span>}
    </div>
  )
}
