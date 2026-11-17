import ImportSummary, { CalendarImportStatus } from './ImportSummary'
import React from 'react'
    import ReactDOM from 'react-dom/client'

const COLORS = ['#003366', '#0066cc', '#28a745', '#dc3545', '#fd7e14', '#6f42c1', '#20c997', '#e83e8c']
const WARNING_THRESHOLD_SECONDS = 60 // show warning when remaining ≤ this (seconds)
const displayCalendarName = (name) => {
    if (!name) return ''
    const facultyMark = ['A', 'C'].join('')
    return String(name)
        .replace(new RegExp(`\\b${facultyMark}\\s+Bar\\b`, 'g'), 'Baritiu')
        .replace(new RegExp(`\\b${facultyMark}\\s+Daic\\b`, 'g'), 'Daicoviciu')
        .replace(new RegExp(`\\b${facultyMark}\\s+Dorobantilor\\b`, 'g'), 'Dorobantilor')
        .replace(new RegExp(`\\b${facultyMark}\\s+Observatorului\\b`, 'g'), 'Observatorului')
        .replace(new RegExp(`\\b${facultyMark}\\s+Observator\\b`, 'g'), 'Observator')
        .replace(new RegExp(`\\bUTCN\\s*-\\s*${facultyMark}\\b`, 'g'), 'UTCN')
        .replace(new RegExp(`\\b${facultyMark}\\s*-\\s*`, 'g'), 'UTCN - ')
        .replace(/utcn_room_[a-z_0-9-]+@campus\\.utcluj\\.ro/g, 'UTCN room calendar')
        .replace(/\\s{2,}/g, ' ')
        .trim()
}

    function Admin() {
        const [query, setQuery] = React.useState('')
        const [statusFilter, setStatusFilter] = React.useState('all')
        const [page, setPage] = React.useState(0)
        const [calendars, setCalendars] = React.useState([])
        const [loading, setLoading] = React.useState(true)
        const [importing, setImporting] = React.useState(false)
        const [extractorRunning, setExtractorRunning] = React.useState(false)
        const [extractorProgress, setExtractorProgress] = React.useState(null)
        const [message, setMessage] = React.useState(null)
        const [newCalendar, setNewCalendar] = React.useState({ url: '', name: '', color: '#003366' })
        const [editingCalendar, setEditingCalendar] = React.useState(null)
        const [stats, setStats] = React.useState({ events_count: 0, last_import: null })
        const [importLog, setImportLog] = React.useState([])
        const [plannedOrder, setPlannedOrder] = React.useState([])
        const [showFullPreview, setShowFullPreview] = React.useState(false)
        const [sessionRemaining, setSessionRemaining] = React.useState(null)
        const [warningInfo, setWarningInfo] = React.useState(null)

        const extendSession = async () => {
            try {
                const r = await fetch('/admin/extend_session', { method: 'POST' })
                if (r.ok) {
                    const j = await r.json()
                    setSessionRemaining(j.remaining_seconds || null)
                    setWarningInfo(null)
                    showMessage('Session extended', 'success')
                } else {
                    showMessage('Failed to extend session', 'error')
                }
            } catch (e) {
                showMessage('Error extending session', 'error')
            }
        }

        const fetchData = React.useCallback(async (showLoading = true) => {
            try {
                if (showLoading) setLoading(true)
                const res = await fetch('/admin/api/status')

                // If the API returns 401 (unauthenticated) or a login HTML page,
                // redirect the browser to the login page with expired flag so the
                // server shows the form and the UX is consistent.
                if (!res.ok) {
                    if (res.status === 401) {
                        // show a notification and wait for user to click to go to login
                        setMessage({ text: 'Session expired. Click to go to login.', type: 'expired' })
                        return
                    }
                    // other non-OK statuses: surface a message
                    console.error('Admin status fetch failed', res.status)
                    return
                }

                // Some servers may respond with HTML login form (content-type text/html)
                // even with a 200 status if the user is unauthenticated and the
                // request followed a redirect. Detect that and treat as expired.
                const ct = (res.headers.get('content-type') || '').toLowerCase()
                if (ct.includes('text/html')) {
                    // assume login form; show notification and wait for user click
                    setMessage({ text: 'Session expired. Click to go to login.', type: 'expired' })
                    return
                }

                const data = await res.json()
                // Sort calendars primarily by `name`. Calendars without a name are placed after named ones.
                const sorted = (data.calendars || []).slice().sort((a, b) => {
                    const an = (a && a.name) ? a.name.toString().toLowerCase() : ''
                    const bn = (b && b.name) ? b.name.toString().toLowerCase() : ''
                    // Put unnamed entries after named entries
                    if (!an && bn) return 1
                    if (an && !bn) return -1
                    return an.localeCompare(bn)
                })
                setCalendars(sorted)
                // manual events are intentionally excluded from this admin UI
                setStats({ events_count: data.events_count || 0, last_import: data.last_import })
                setExtractorRunning(data.extractor_running || false)
                setExtractorProgress(data.extractor_progress || null)
                setPlannedOrder(data.planned_order || [])
                // Prefer server-side extractor log entries for short live updates
                if (data.extractor_log && data.extractor_log.length) {
                    setImportLog(prev => {
                        const merged = [...prev]
                            const known = new Set(prev.map(entry => entry.msg))
                        data.extractor_log.forEach(l => {
                            if (!known.has(l)) {
                                    known.add(l)
                                merged.push({ time: new Date().toLocaleTimeString(), msg: l, type: 'info' })
                            }
                        })
                        return merged.slice(-500)
                    })
                }

                // Full extractor stdout is intentionally not exposed in the UI

                // Auto-add progress messages to log
                if (data.extractor_progress && data.extractor_progress.message) {
                    setImportLog(prev => {
                        const lastMsg = prev.length > 0 ? prev[prev.length - 1].msg : ''
                        if (lastMsg !== data.extractor_progress.message) {
                            return [...prev, {
                                time: new Date().toLocaleTimeString(),
                                msg: data.extractor_progress.message,
                                type: 'info'
                            }]
                        }
                        return prev
                    })
                }
            } catch (e) {
                console.error(e)
            } finally {
                if (showLoading) setLoading(false)
            }
        }, [])

        // Initial load
        React.useEffect(() => {
            fetchData()
            // expose a global helper so out-of-React controls (upload button)
            // can trigger an immediate refresh without reloading the page.
            try { window.fetchAdminStatus = (showLoading = false) => fetchData(showLoading) } catch (e) {}
        }, [fetchData])

        // Poll every 2 seconds when extractor is running
        React.useEffect(() => {
            const interval = setInterval(() => {
                fetchData(false)
            }, extractorRunning ? 2000 : 15000)
            return () => clearInterval(interval)
        }, [fetchData, extractorRunning])

        // Poll session remaining seconds every 5 seconds and maintain a local
        // second-by-second decrement for a smooth live countdown.
        React.useEffect(() => {
            let mounted = true
            let localTimer = null

            async function refresh() {
                try {
                    const r = await fetch('/admin/session_status')
                    if (!r.ok) {
                        if (r.status === 401) {
                            // mark expired and wait for user to click login
                            setMessage({ text: 'Session expired. Click to go to login.', type: 'expired' })
                            return
                        }
                        return
                    }
                    const j = await r.json()
                    if (!mounted) return
                    setSessionRemaining(j.remaining_seconds || 0)
                    // show warning when remaining is small but not expired
                    if (j.remaining_seconds && j.remaining_seconds > 0 && j.remaining_seconds <= WARNING_THRESHOLD_SECONDS) {
                        setWarningInfo({ secs: j.remaining_seconds })
                    } else {
                        setWarningInfo(null)
                    }
                    // start local decrement
                    if (localTimer) clearInterval(localTimer)
                    localTimer = setInterval(() => {
                        setSessionRemaining(prev => {
                            if (typeof prev !== 'number') return prev
                            if (prev <= 0) {
                                clearInterval(localTimer)
                                return 0
                            }
                            return prev - 1
                        })
                    }, 1000)
                } catch (e) {
                    // ignore
                }
            }

            // initial call + periodic refresh every 5s
            refresh()
            const perf = setInterval(refresh, 5000)
            return () => { mounted = false; clearInterval(perf); if (localTimer) clearInterval(localTimer) }
        }, [])

        const showMessage = (text, type) => {
            setMessage({ text, type })
            setTimeout(() => setMessage(null), 4000)
        }

        const addCalendar = async (e) => {
            e.preventDefault()
            if (!newCalendar.url) return showMessage('URL is required', 'error')

            try {
                setImportLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: 'Adding calendar...', type: 'info' }])
                const form = new FormData()
                form.append('calendar_url', newCalendar.url)
                form.append('calendar_name', newCalendar.name)
                form.append('calendar_color', newCalendar.color)

                const res = await fetch('/admin/set_calendar_url', { method: 'POST', body: form })
                if (res.ok) {
                    setImportLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: 'Calendar added! Starting import...', type: 'success' }])
                    showMessage('Calendar added - importing events...', 'success')
                    setNewCalendar({ url: '', name: '', color: '#003366' })
                    fetchData(false)
                }
            } catch (e) {
                setImportLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: 'Error: ' + e.message, type: 'error' }])
                showMessage('Error adding calendar', 'error')
            }
        }

        const importCalendar = async (failedOnly = false) => {
            setImporting(true)
            setImportLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: 'Starting import for all calendars...', type: 'info' }])
            try {
                const body = new FormData()
                if (failedOnly === true) body.set('failed_only', '1')
                const res = await fetch('/admin/import_calendar', { method: 'POST', body })
                const data = await res.json()
                setImportLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: data.message || 'Import started', type: res.ok ? 'success' : 'error' }])
                showMessage(data.message || 'Import started', res.ok ? 'success' : 'error')
                await fetchData(false)
            } catch (e) {
                setImportLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: 'Import error: ' + e.message, type: 'error' }])
                showMessage('Import error', 'error')
            } finally {
                setImporting(false)
            }
        }

        const deleteCalendar = async (id) => {
            if (!confirm('Are you sure you want to delete this calendar?')) return
            try {
                const form = new FormData()
                form.append('id', id)
                const res = await fetch('/admin/delete_calendar', { method: 'POST', body: form })
                if (res.ok) {
                    showMessage('Calendar deleted', 'success')
                    fetchData()
                }
            } catch (e) {
                showMessage('Error deleting', 'error')
            }
        }

        // Manual event creation/deletion handlers removed from this admin UI

        const updateCalendar = async (e) => {
            e.preventDefault()
            if (!editingCalendar) return
            try {
                const form = new FormData()
                form.append('id', editingCalendar.id)
                form.append('name', editingCalendar.name || '')
                form.append('color', editingCalendar.color || '#003366')
                form.append('enabled', editingCalendar.enabled ? '1' : '0')
                const res = await fetch('/admin/update_calendar', { method: 'POST', body: form })
                const data = await res.json()
                if (data.success) {
                    showMessage('Calendar updated', 'success')
                    setEditingCalendar(null)
                    fetchData()
                } else {
                    showMessage(data.message || 'Error updating', 'error')
                }
            } catch (e) {
                showMessage('Error updating calendar', 'error')
            }
        }

        const matching = calendars.filter(cal => {
            const text = [cal.name, cal.building, cal.room, cal.email_address].join(' ').toLowerCase()
            return text.includes(query.toLowerCase()) && (statusFilter === 'all' ||
                (statusFilter === 'unknown' ? !cal.import_status : cal.import_status?.status === statusFilter))
        })
        const pageCount = Math.max(1, Math.ceil(matching.length / 25))
        const currentPage = Math.min(page, pageCount - 1)
        const visibleCalendars = matching.slice(currentPage * 25, (currentPage + 1) * 25)

        if (loading) {
          return React.createElement(
            'div',
            { className: 'admin-loading' },
            React.createElement('div', { className: 'spinner' }),
            ' Loading...'
          )
        }

        return React.createElement(
          'div',
          { className: 'admin-container' },
          // Message
          message &&
            (message.type === 'expired'
              ? React.createElement(
                  'div',
                  {
                    className: 'admin-message expired'
                  },
                  React.createElement('span', null, message.text),
                  React.createElement(
                    'button',
                    {
                      onClick: () => {
                        window.location = '/admin?expired=1'
                      }
                    },
                    'Go to login'
                  )
                )
              : React.createElement(
                  'div',
                  {
                    className: `admin-message ${message.type}`
                  },
                  message.text
                )),

          // Warning banner when session is about to expire (shows before 'expired')
          warningInfo &&
            (!message || message.type !== 'expired') &&
            React.createElement(
              'div',
              {
                className: 'admin-message warning'
              },
              React.createElement(
                'span',
                null,
                `Session will expire in ${warningInfo.secs} seconds.`
              ),
              React.createElement(
                'div',
                null,
                React.createElement(
                  'button',
                  {
                    onClick: extendSession
                  },
                  'Extend session'
                ),
                React.createElement(
                  'button',
                  {
                    onClick: () => {
                      window.location = '/admin?expired=1'
                    }
                  },
                  'Go to login'
                )
              )
            ),

          // Session indicator (minutes remaining)
          React.createElement(
            'div',
            { className: 'admin-session' },
            sessionRemaining !== null
              ? React.createElement(
                  'span',
                  null,
                  `Session: ${Math.max(0, Math.ceil(sessionRemaining / 60))} min${sessionRemaining >= 120 ? 's' : ''} remaining`
                )
              : null
          ),

          React.createElement(
            'div',
            { className: 'admin-stats' },
            [
              ['Calendars', calendars.length],
              ['Events', stats.events_count],
              [
                'Last Import',
                stats.last_import
                  ? new Date(stats.last_import * 1000).toLocaleString()
                  : 'Never'
              ]
            ].map(([label, value]) =>
              React.createElement(
                'div',
                { key: label, className: 'admin-stat' },
                React.createElement('span', { className: 'admin-stat-label' }, label),
                React.createElement(
                  'strong',
                  {
                    className:
                      'admin-stat-value' +
                      (label === 'Last Import' ? ' admin-stat-date' : '')
                  },
                  value
                )
              )
            )
          ),

          React.createElement(ImportSummary, {
            progress: extractorProgress,
            running: extractorRunning,
            calendars,
            retry: () => importCalendar(true)
          }),
          // Add Calendar Form
          React.createElement(
            'section',
            { className: 'admin-section' },
            React.createElement('h2', {}, 'Add Calendar'),
            React.createElement(
              'form',
              { onSubmit: addCalendar, className: 'admin-add-form' },
              React.createElement('input', {
                type: 'url',
                placeholder: 'Published Calendar URL',
                'aria-label': 'Published Calendar URL',
                value: newCalendar.url,
                onChange: (e) =>
                  setNewCalendar({ ...newCalendar, url: e.target.value })
              }),
              React.createElement('input', {
                type: 'text',
                placeholder:
                  'e.g., UTCN - Year 3 - CTI English (or utcn_room_airi_obs_204@...)',
                'aria-label': 'Calendar name',
                value: newCalendar.name,
                onChange: (e) =>
                  setNewCalendar({ ...newCalendar, name: e.target.value })
              }),
              React.createElement('input', {
                type: 'color',
                'aria-label': 'Calendar color',
                value: newCalendar.color,
                onChange: (e) =>
                  setNewCalendar({ ...newCalendar, color: e.target.value })
              }),
              React.createElement(
                'button',
                { className: 'primary', type: 'submit' },
                'Add'
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: importCalendar,
                  disabled: importing || extractorRunning
                },
                importing ? 'Importing...' : 'Import All'
              )
            )
          ),
          // CSV Controls - always visible, placed before Configured Calendars as requested
          React.createElement(
            'section',
            { className: 'admin-inventory' },
            React.createElement(
              'a',
              {
                href: '/download/Rooms_PUBLISHER_HTML-ICS(in).csv',
                download: 'Rooms_PUBLISHER_HTML-ICS.csv',
                className: 'btn btn-secondary'
              },
              'Download CSV'
            ),
            React.createElement(
              'div',
              { className: 'admin-upload' },
              React.createElement('input', {
                'aria-label': 'Calendar inventory CSV',
                id: 'upload-csv-input-global',
                name: 'file',
                type: 'file',
                accept: '.csv'
              }),
              React.createElement(
                'button',
                { id: 'upload-csv-btn-global', type: 'button', onClick: null },
                'Upload CSV'
              )
            )
          ),

          // Calendars List
          React.createElement(
            'section',
            { className: 'admin-section admin-calendars' },
            React.createElement('h2', {}, 'Configured Calendars'),
            React.createElement(
              'div',
              { className: 'calendar-controls' },
              React.createElement('input', {
                'aria-label': 'Search calendars',
                placeholder: 'Search room, building or calendar…',
                value: query,
                onChange: (e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }
              }),
              React.createElement(
                'select',
                {
                  'aria-label': 'Filter import status',
                  value: statusFilter,
                  onChange: (e) => {
                    setStatusFilter(e.target.value)
                    setPage(0)
                  }
                },
                ['all', 'success', 'failed', 'unknown'].map((v) =>
                  React.createElement('option', { key: v, value: v }, v)
                )
              ),
              React.createElement(
                'span',
                null,
                `${matching.length} calendars · Page ${currentPage + 1}/${pageCount}`
              ),
              React.createElement(
                'button',
                {
                  disabled: currentPage === 0,
                  onClick: () => setPage(currentPage - 1)
                },
                'Previous'
              ),
              React.createElement(
                'button',
                {
                  disabled: currentPage + 1 >= pageCount,
                  onClick: () => setPage(currentPage + 1)
                },
                'Next'
              )
            ),
            matching.length === 0
              ? React.createElement('p', {}, 'No calendars configured yet.')
              : React.createElement(
                  'div',
                  { className: 'calendar-list' },
                  visibleCalendars.map((cal) =>
                    editingCalendar && editingCalendar.id === cal.id
                      ? // Edit mode
                        React.createElement(
                          'form',
                          {
                            key: cal.id,
                            onSubmit: updateCalendar,
                            className: 'calendar-entry calendar-edit',
                            style: {
                              '--calendar-color': cal.color || 'var(--accent)'
                            }
                          },
                          React.createElement('input', {
                            type: 'text',
                            placeholder: 'e.g., UTCN - Year 3 - CTI English',
                            'aria-label': 'Edit calendar name',
                            value: editingCalendar.name || '',
                            onChange: (e) =>
                              setEditingCalendar({
                                ...editingCalendar,
                                name: e.target.value
                              })
                          }),
                          React.createElement('input', {
                            type: 'color',
                            'aria-label': 'Edit calendar color',
                            value: editingCalendar.color || '#003366',
                            onChange: (e) =>
                              setEditingCalendar({
                                ...editingCalendar,
                                color: e.target.value
                              })
                          }),
                          React.createElement(
                            'label',
                            {},
                            React.createElement('input', {
                              type: 'checkbox',
                              checked: editingCalendar.enabled !== 0,
                              onChange: (e) =>
                                setEditingCalendar({
                                  ...editingCalendar,
                                  enabled: e.target.checked ? 1 : 0
                                })
                            }),
                            'Enabled'
                          ),
                          React.createElement(
                            'button',
                            { className: 'primary', type: 'submit' },
                            'Save'
                          ),
                          React.createElement(
                            'button',
                            {
                              type: 'button',
                              onClick: () => setEditingCalendar(null)
                            },
                            'Cancel'
                          )
                        )
                      : // View mode
                        React.createElement(
                          'div',
                          {
                            key: cal.id,
                            className:
                              'calendar-entry' +
                              (cal.enabled === 0 ? ' calendar-disabled-entry' : ''),
                            style: {
                              '--calendar-color': cal.color || 'var(--accent)'
                            }
                          },
                          React.createElement(
                            'div',
                            { className: 'calendar-entry-info' },
                            React.createElement(
                              'strong',
                              null,
                              cal.name || 'Unnamed'
                            ),
                            React.createElement(CalendarImportStatus, {
                              value: cal.import_status
                            }),
                            React.createElement(
                              'div',
                              { className: 'calendar-links' },
                              cal.html_url_link &&
                                React.createElement(
                                  'a',
                                  {
                                    href: cal.html_url_link,
                                    target: '_blank',
                                    rel: 'noopener noreferrer'
                                  },
                                  'Open HTML'
                                ),
                              cal.url_link &&
                                React.createElement(
                                  'a',
                                  {
                                    href: cal.url_link,
                                    target: '_blank',
                                    rel: 'noopener noreferrer'
                                  },
                                  'Open ICS'
                                )
                            )
                          ),
                          cal.enabled === 0 &&
                            React.createElement(
                              'span',
                              { className: 'calendar-disabled' },
                              'disabled'
                            ),
                          React.createElement(
                            'button',
                            {
                              onClick: () => setEditingCalendar({ ...cal })
                            },
                            'Edit'
                          ),
                          React.createElement(
                            'button',
                            {
                              className: 'danger',
                              onClick: () => deleteCalendar(cal.id)
                            },
                            'Delete'
                          )
                        )
                  )
                )
          )

          // Manual events UI removed from React admin per request
        )
    }

    ReactDOM.createRoot(document.getElementById('admin-root')).render(React.createElement(Admin))

    // Wire the upload button behaviour after the React tree is mounted.
    // We wait briefly for the element to exist then attach a click handler
    setTimeout(() => {
        // attach only to the permanent controls placed before Configured Calendars
        const pairs = [
            { btnId: 'upload-csv-btn-global', inputId: 'upload-csv-input-global' }
        ]
        pairs.forEach(p => {
            const uploadBtn = document.getElementById(p.btnId)
            const uploadInput = document.getElementById(p.inputId)
            if (!uploadBtn || !uploadInput) return
            // avoid double-attaching
            if (uploadBtn._attached) return
            uploadBtn._attached = true
            uploadBtn.addEventListener('click', () => {
                if (!uploadInput.files || uploadInput.files.length === 0) {
                    alert('Please choose a CSV file to upload')
                    return
                }
                const file = uploadInput.files[0]
                const fd = new FormData()
                fd.append('file', file, file.name)

                uploadBtn.disabled = true
                const previousText = uploadBtn.textContent
                uploadBtn.textContent = 'Uploading...'

                fetch('/admin/upload_rooms_publisher', { method: 'POST', body: fd })
                .then(r => r.json())
                .then(j => {
                    // trigger a full status refresh so planned_order appears
                    fetch('/admin/api/status').then(()=>{})
                    alert(j.message || 'Upload complete')
                    // If server scheduled the background import, trigger a
                    // dynamic admin refresh so the running import and
                    // planned order are shown automatically without a
                    // full page reload.
                    if (j && j.success) {
                        try { if (window.fetchAdminStatus) window.fetchAdminStatus(false) } catch (e) { console.warn('fetchAdminStatus failed', e) }
                    }
                })
                .catch(e => {
                    console.error('Upload failed', e)
                    alert('Upload failed')
                })
                .finally(() => {
                    uploadBtn.disabled = false
                    uploadBtn.textContent = previousText
                })
            })
        })
    }, 400)
