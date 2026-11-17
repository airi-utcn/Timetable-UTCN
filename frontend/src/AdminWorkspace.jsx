import React, { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import ImportSummary, { CalendarImportStatus } from './ImportSummary'

export default function AdminWorkspace({
  calendars,
  stats,
  query,
  setQuery,
  statusFilter,
  setStatusFilter,
  matching,
  currentPage,
  pageCount,
  setPage,
  visibleCalendars,
  newCalendar,
  setNewCalendar,
  editingCalendar,
  setEditingCalendar,
  message,
  warningInfo,
  sessionRemaining,
  extractorProgress,
  extractorRunning,
  importing,
  addCalendar,
  importCalendar,
  updateCalendar,
  deleteCalendar,
  uploadCSV,
  extendSession
}) {
  const [panel, setPanel] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [pending, setPending] = useState(null)
  const [file, setFile] = useState(null)
  const search = useRef(null),
    addTrigger = useRef(null),
    csvTrigger = useRef(null),
    urlInput = useRef(null)
  const lastEdited = useRef(null)
  useEffect(() => {
    if (editingCalendar) lastEdited.current = editingCalendar.id
    else if (lastEdited.current !== null) {
      document.getElementById(`edit-calendar-${lastEdited.current}`)?.focus()
      lastEdited.current = null
    }
  }, [editingCalendar])
  const failed = calendars.filter(
    (c) => c.enabled !== 0 && c.import_status?.status === 'failed'
  ).length
  useEffect(() => {
    if (panel === 'add') urlInput.current?.focus()
  }, [panel])
  const run = async (action, fn) => {
    if (pending) return false
    setPending(action)
    try {
      return await fn()
    } finally {
      setPending(null)
    }
  }
  const closePanel = () => {
    const previous = panel
    setPanel(null)
    ;(previous === 'add' ? addTrigger : csvTrigger).current?.focus()
  }
  const date = (value) =>
    value
      ? new Date(value * 1000).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'Not imported'
  const noMatches =
    message?.kind === 'load'
      ? 'Unable to load calendars.'
      : query.trim()
        ? 'No calendars match your search.'
        : statusFilter !== 'all'
          ? 'No calendars have this import status.'
          : 'No calendars configured yet.'
  return (
    <div className="admin-container">
      <div className="admin-intro">
        <div>
          <h1>Administration</h1>
          <p>Manage calendars, imports, and timetable data.</p>
        </div>
      </div>
      {message && (
        <div
          className={'admin-message ' + message.type}
          role={
            ['error', 'expired'].includes(message.type) ? 'alert' : 'status'
          }
        >
          {message.text}
          {message.type === 'expired' && (
            <a className="btn" href="/admin?expired=1">
              Sign in again
            </a>
          )}
        </div>
      )}
      {warningInfo && message?.type !== 'expired' && (
        <div className="admin-message warning" role="status">
          <span>Your session expires in {warningInfo.secs} seconds.</span>
          <button onClick={extendSession}>Extend session</button>
          <a href="/admin?expired=1">Sign in again</a>
        </div>
      )}
      <dl className="admin-overview">
        {[
          ['Total calendars', calendars.length],
          ['Total events', stats.events_count],
          ['Last import', date(stats.last_import)],
          ['Need attention', failed]
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd
              className={
                label === 'Need attention' && failed ? 'attention-value' : ''
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <ImportSummary
        compact
        progress={extractorProgress}
        running={extractorRunning}
        calendars={calendars}
        retry={() => importCalendar(true)}
      />
      <section className="admin-workspace" aria-labelledby="calendars-heading">
        <div className="workspace-heading">
          <h2 id="calendars-heading">Calendars</h2>
          <p>Manage sources, settings, and imported events.</p>
        </div>
        <div className="admin-toolbar">
          <div className="admin-search">
            <Icon name="search" size={17} />
            <input
              ref={search}
              type="search"
              aria-label="Search calendars"
              placeholder="Search name, room or building"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
            />
          </div>
          <select
            aria-label="Filter import status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(0)
            }}
          >
            {[
              ['all', 'All statuses'],
              ['success', 'Imported'],
              ['failed', 'Import failed'],
              ['unknown', 'Not checked']
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="toolbar-actions">
            <button
              ref={addTrigger}
              className="primary"
              aria-expanded={panel === 'add'}
              aria-controls="add-calendar-panel"
              onClick={() => (panel === 'add' ? closePanel() : setPanel('add'))}
            >
              Add calendar
            </button>
            <button
              disabled={importing || extractorRunning}
              onClick={() => importCalendar()}
            >
              <Icon
                name="refresh"
                size={15}
                className={importing || extractorRunning ? 'refreshing' : ''}
              />
              {importing || extractorRunning ? 'Importing…' : 'Import all'}
            </button>
            <button
              ref={csvTrigger}
              aria-expanded={panel === 'csv'}
              aria-controls="csv-panel"
              onClick={() => (panel === 'csv' ? closePanel() : setPanel('csv'))}
            >
              CSV
            </button>
          </div>
        </div>
        <section
          id="add-calendar-panel"
          className="admin-inline-panel"
          hidden={panel !== 'add'}
          aria-label="Add calendar"
          onKeyDown={(e) => {
            if (e.key === 'Escape') closePanel()
          }}
        >
          <div className="panel-heading">
            <h3>Add a calendar</h3>
            <button
              className="close-panel"
              aria-label="Close add calendar"
              onClick={closePanel}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <p>Use the published calendar link from Outlook.</p>
          <form
            className="admin-add-form"
            onSubmit={(e) => {
              e.preventDefault()
              run('add', () => addCalendar(e)).then((ok) => {
                if (ok) closePanel()
              })
            }}
          >
            <label>
              Published calendar URL
              <input
                ref={urlInput}
                type="url"
                required
                aria-label="Published Calendar URL"
                value={newCalendar.url}
                placeholder="https://outlook.office365.com/…"
                onChange={(e) =>
                  setNewCalendar({ ...newCalendar, url: e.target.value })
                }
              />
            </label>
            <label>
              Calendar name
              <input
                aria-label="Calendar name"
                value={newCalendar.name}
                placeholder="e.g. Barițiu · Room 40"
                onChange={(e) =>
                  setNewCalendar({ ...newCalendar, name: e.target.value })
                }
              />
            </label>
            <label className="color-field">
              Color
              <input
                type="color"
                aria-label="Calendar color"
                value={newCalendar.color}
                onChange={(e) =>
                  setNewCalendar({ ...newCalendar, color: e.target.value })
                }
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="primary" disabled={!!pending}>
                {pending === 'add' ? 'Adding…' : 'Add calendar'}
              </button>
              <button type="button" onClick={closePanel}>
                Cancel
              </button>
            </div>
          </form>
        </section>
        <section
          id="csv-panel"
          className="admin-inline-panel"
          hidden={panel !== 'csv'}
          aria-label="CSV import and export"
          onKeyDown={(e) => {
            if (e.key === 'Escape') closePanel()
          }}
        >
          <div className="panel-heading">
            <h3>CSV import & export</h3>
            <button
              className="close-panel"
              aria-label="Close CSV tools"
              onClick={closePanel}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <p>Upload your calendar inventory or download the current CSV.</p>
          <div className="admin-csv-controls">
            <label>
              Calendar inventory
              <input
                id="upload-csv-input-global"
                type="file"
                accept=".csv"
                aria-label="Calendar inventory CSV"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              id="upload-csv-btn-global"
              disabled={!file || !!pending}
              onClick={() => run('upload', () => uploadCSV(file))}
            >
              {pending === 'upload' ? 'Uploading…' : 'Upload CSV'}
            </button>
            <a
              className="btn"
              href="/download/Rooms_PUBLISHER_HTML-ICS(in).csv"
              download="Rooms_PUBLISHER_HTML-ICS.csv"
            >
              Download CSV
            </a>
          </div>
        </section>
        <div className="calendar-list" aria-label="Configured calendars">
          {!matching.length && (
            <div className="admin-empty">
              <h3>{noMatches}</h3>
              <p>
                {message?.kind === 'load'
                  ? 'Refresh this page to try again.'
                  : !calendars.length
                    ? 'Add a calendar or import a CSV inventory to get started.'
                    : query
                      ? 'Try another name, room or building.'
                      : 'Choose another status to see more calendars.'}
              </p>
              {!!calendars.length && (
                <button
                  onClick={() => {
                    setQuery('')
                    setStatusFilter('all')
                    setPage(0)
                    search.current?.focus()
                  }}
                >
                  Reset search and filter
                </button>
              )}
            </div>
          )}
          {visibleCalendars.map((cal) => (
            <article
              className={
                'calendar-row' + (cal.enabled === 0 ? ' is-disabled' : '')
              }
              key={cal.id}
            >
              {editingCalendar?.id === cal.id ? (
                <form
                  className="calendar-edit"
                  aria-label={`Edit ${cal.name || 'calendar'}`}
                  onSubmit={(e) => {
                    e.preventDefault()
                    run('save', () => updateCalendar(e))
                  }}
                >
                  <label>
                    Calendar name
                    <input
                      autoFocus
                      aria-label="Edit calendar name"
                      value={editingCalendar.name || ''}
                      onChange={(e) =>
                        setEditingCalendar({
                          ...editingCalendar,
                          name: e.target.value
                        })
                      }
                    />
                  </label>
                  <label className="color-field">
                    Color
                    <input
                      type="color"
                      aria-label="Edit calendar color"
                      value={editingCalendar.color || '#003366'}
                      onChange={(e) =>
                        setEditingCalendar({
                          ...editingCalendar,
                          color: e.target.value
                        })
                      }
                    />
                  </label>
                  <label className="enabled-field">
                    <input
                      type="checkbox"
                      checked={editingCalendar.enabled !== 0}
                      onChange={(e) =>
                        setEditingCalendar({
                          ...editingCalendar,
                          enabled: e.target.checked ? 1 : 0
                        })
                      }
                    />
                    Enabled
                  </label>
                  <div className="form-actions">
                    <button className="primary" disabled={!!pending}>
                      {pending === 'save' ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCalendar(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="calendar-row-main">
                    <div className="calendar-row-info">
                      <h3>
                        {cal.name || 'Unnamed calendar'}
                        {cal.enabled === 0 && (
                          <span className="disabled-label">Disabled</span>
                        )}
                      </h3>
                      <span
                        className={
                          'calendar-status-label ' +
                          (cal.import_status?.status || 'unknown')
                        }
                      >
                        {!cal.import_status
                          ? 'Not checked yet'
                          : cal.import_status.status === 'failed'
                            ? 'Import failed · previous data retained'
                            : cal.import_status.event_count === 0
                              ? 'Imported · no events'
                              : `Imported${cal.import_status.event_count != null ? ' · ' + cal.import_status.event_count + ' events' : ''}`}
                      </span>
                    </div>
                    <div className="calendar-row-actions">
                      <button
                        className="text-action"
                        id={`edit-calendar-${cal.id}`}
                        onClick={() => {
                          setExpanded(null)
                          setEditingCalendar({ ...cal })
                        }}
                        aria-label={`Edit ${cal.name || 'calendar'}`}
                      >
                        Edit
                      </button>
                      <button
                        className="more-action"
                        aria-label={`More options for ${cal.name || 'calendar'}`}
                        aria-expanded={expanded === cal.id}
                        aria-controls={'calendar-options-' + cal.id}
                        onClick={() =>
                          setExpanded(expanded === cal.id ? null : cal.id)
                        }
                      >
                        <span aria-hidden="true">•••</span>
                      </button>
                    </div>
                  </div>
                  {expanded === cal.id && (
                    <div
                      className="calendar-diagnostics"
                      id={'calendar-options-' + cal.id}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setExpanded(null)
                          e.currentTarget
                            .closest('article')
                            .querySelector('.more-action')
                            ?.focus()
                        }
                      }}
                    >
                      <h4>Import details</h4>
                      <CalendarImportStatus value={cal.import_status} />
                      <div className="diagnostic-actions">
                        {cal.html_url_link && (
                          <a
                            href={cal.html_url_link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open HTML source
                          </a>
                        )}
                        {cal.url_link && (
                          <a
                            href={cal.url_link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open ICS source
                          </a>
                        )}
                        <button
                          className="danger"
                          disabled={!!pending}
                          onClick={() =>
                            run('delete', () => deleteCalendar(cal.id)).then(
                              (ok) => {
                                if (ok) search.current?.focus()
                              }
                            )
                          }
                        >
                          {pending === 'delete'
                            ? 'Deleting…'
                            : 'Delete calendar'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
        <div className="calendar-pagination">
          <span>
            {matching.length} calendars · Page {currentPage + 1} of {pageCount}
          </span>
          <div>
            <button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <button
              disabled={currentPage + 1 >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {sessionRemaining !== null && (
        <p className="admin-session">
          Session: {Math.max(0, Math.ceil(sessionRemaining / 60))} minutes
          remaining
        </p>
      )}
    </div>
  )
}
