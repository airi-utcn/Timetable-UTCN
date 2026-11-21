import AdminWorkspace from './AdminWorkspace'
import React from 'react'
import ReactDOM from 'react-dom/client'

const COLORS = [
  '#003366',
  '#0066cc',
  '#28a745',
  '#dc3545',
  '#fd7e14',
  '#6f42c1',
  '#20c997',
  '#e83e8c'
]
const WARNING_THRESHOLD_SECONDS = 60 // show warning when remaining ≤ this (seconds)
const displayCalendarName = (name) => {
  if (!name) return ''
  const facultyMark = ['A', 'C'].join('')
  return String(name)
    .replace(new RegExp(`\\b${facultyMark}\\s+Bar\\b`, 'g'), 'Baritiu')
    .replace(new RegExp(`\\b${facultyMark}\\s+Daic\\b`, 'g'), 'Daicoviciu')
    .replace(
      new RegExp(`\\b${facultyMark}\\s+Dorobantilor\\b`, 'g'),
      'Dorobantilor'
    )
    .replace(
      new RegExp(`\\b${facultyMark}\\s+Observatorului\\b`, 'g'),
      'Observatorului'
    )
    .replace(
      new RegExp(`\\b${facultyMark}\\s+Observator\\b`, 'g'),
      'Observator'
    )
    .replace(new RegExp(`\\bUTCN\\s*-\\s*${facultyMark}\\b`, 'g'), 'UTCN')
    .replace(new RegExp(`\\b${facultyMark}\\s*-\\s*`, 'g'), 'UTCN - ')
    .replace(
      /utcn_room_[a-z_0-9-]+@campus\\.utcluj\\.ro/g,
      'UTCN room calendar'
    )
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
  const [newCalendar, setNewCalendar] = React.useState({
    url: '',
    name: '',
    color: '#003366'
  })
  const [editingCalendar, setEditingCalendar] = React.useState(null)
  const [stats, setStats] = React.useState({
    events_count: 0,
    last_import: null
  })
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
          setMessage({
            text: 'Session expired. Click to go to login.',
            type: 'expired'
          })
          return
        }
        // other non-OK statuses: surface a message
        setMessage({
          type: 'error',
          kind: 'load',
          text: 'Unable to load calendars. Refresh the page to try again.'
        })
        console.error('Admin status fetch failed', res.status)
        return
      }

      // Some servers may respond with HTML login form (content-type text/html)
      // even with a 200 status if the user is unauthenticated and the
      // request followed a redirect. Detect that and treat as expired.
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (ct.includes('text/html')) {
        // assume login form; show notification and wait for user click
        setMessage({
          text: 'Session expired. Click to go to login.',
          type: 'expired'
        })
        return
      }

      const data = await res.json()
      setMessage((previous) => (previous?.kind === 'load' ? null : previous))
      // Sort calendars primarily by `name`. Calendars without a name are placed after named ones.
      const sorted = (data.calendars || []).slice().sort((a, b) => {
        const an = a && a.name ? a.name.toString().toLowerCase() : ''
        const bn = b && b.name ? b.name.toString().toLowerCase() : ''
        // Put unnamed entries after named entries
        if (!an && bn) return 1
        if (an && !bn) return -1
        return an.localeCompare(bn)
      })
      setCalendars(sorted)
      // manual events are intentionally excluded from this admin UI
      setStats({
        events_count: data.events_count || 0,
        last_import: data.last_import
      })
      setExtractorRunning(data.extractor_running || false)
      setExtractorProgress(data.extractor_progress || null)
      setPlannedOrder(data.planned_order || [])
      // Prefer server-side extractor log entries for short live updates
      if (data.extractor_log && data.extractor_log.length) {
        setImportLog((prev) => {
          const merged = [...prev]
          const known = new Set(prev.map((entry) => entry.msg))
          data.extractor_log.forEach((l) => {
            if (!known.has(l)) {
              known.add(l)
              merged.push({
                time: new Date().toLocaleTimeString(),
                msg: l,
                type: 'info'
              })
            }
          })
          return merged.slice(-500)
        })
      }

      // Full extractor stdout is intentionally not exposed in the UI

      // Auto-add progress messages to log
      if (data.extractor_progress && data.extractor_progress.message) {
        setImportLog((prev) => {
          const lastMsg = prev.length > 0 ? prev[prev.length - 1].msg : ''
          if (lastMsg !== data.extractor_progress.message) {
            return [
              ...prev,
              {
                time: new Date().toLocaleTimeString(),
                msg: data.extractor_progress.message,
                type: 'info'
              }
            ]
          }
          return prev
        })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        kind: 'load',
        text: 'Unable to load calendars. Refresh the page to try again.'
      })
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
    try {
      window.fetchAdminStatus = (showLoading = false) => fetchData(showLoading)
    } catch (e) {}
  }, [fetchData])

  // Poll every 2 seconds when extractor is running
  React.useEffect(() => {
    const interval = setInterval(
      () => {
        fetchData(false)
      },
      extractorRunning ? 2000 : 15000
    )
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
            setMessage({
              text: 'Session expired. Click to go to login.',
              type: 'expired'
            })
            return
          }
          return
        }
        const j = await r.json()
        if (!mounted) return
        setSessionRemaining(j.remaining_seconds || 0)
        // show warning when remaining is small but not expired
        if (
          j.remaining_seconds &&
          j.remaining_seconds > 0 &&
          j.remaining_seconds <= WARNING_THRESHOLD_SECONDS
        ) {
          setWarningInfo({ secs: j.remaining_seconds })
        } else {
          setWarningInfo(null)
        }
        // start local decrement
        if (localTimer) clearInterval(localTimer)
        localTimer = setInterval(() => {
          setSessionRemaining((prev) => {
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
    return () => {
      mounted = false
      clearInterval(perf)
      if (localTimer) clearInterval(localTimer)
    }
  }, [])

  const showMessage = (text, type) => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  const addCalendar = async (e) => {
    e.preventDefault()
    if (!newCalendar.url) return showMessage('URL is required', 'error')

    try {
      setImportLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          msg: 'Adding calendar...',
          type: 'info'
        }
      ])
      const form = new FormData()
      form.append('calendar_url', newCalendar.url)
      form.append('calendar_name', newCalendar.name)
      form.append('calendar_color', newCalendar.color)

      const res = await fetch('/admin/set_calendar_url', {
        method: 'POST',
        body: form
      })
      if (res.ok) {
        setImportLog((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            msg: 'Calendar added! Starting import...',
            type: 'success'
          }
        ])
        showMessage('Calendar added - importing events...', 'success')
        setNewCalendar({ url: '', name: '', color: '#003366' })
        await fetchData(false)
        return true
      } else {
        const data = await res.json()
        showMessage(data.message || 'Could not add calendar.', 'error')
      }
    } catch (e) {
      setImportLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          msg: 'Error: ' + e.message,
          type: 'error'
        }
      ])
      showMessage('Error adding calendar', 'error')
    }
  }

  const importCalendar = async (failedOnly = false) => {
    setImporting(true)
    setImportLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        msg: 'Starting import for all calendars...',
        type: 'info'
      }
    ])
    try {
      const body = new FormData()
      if (failedOnly === true) body.set('failed_only', '1')
      const res = await fetch('/admin/import_calendar', {
        method: 'POST',
        body
      })
      const data = await res.json()
      setImportLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          msg: data.message || 'Import started',
          type: res.ok ? 'success' : 'error'
        }
      ])
      showMessage(
        data.message || 'Import started',
        res.ok ? 'success' : 'error'
      )
      await fetchData(false)
    } catch (e) {
      setImportLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          msg: 'Import error: ' + e.message,
          type: 'error'
        }
      ])
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
      const res = await fetch('/admin/delete_calendar', {
        method: 'POST',
        body: form
      })
      if (res.ok) {
        showMessage('Calendar deleted', 'success')
        await fetchData(false)
        return true
      } else {
        showMessage('Could not delete calendar.', 'error')
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
      const res = await fetch('/admin/update_calendar', {
        method: 'POST',
        body: form
      })
      const data = await res.json()
      if (data.success) {
        showMessage('Calendar updated', 'success')
        setEditingCalendar(null)
        await fetchData(false)
      } else {
        showMessage(data.message || 'Error updating', 'error')
      }
    } catch (e) {
      showMessage('Error updating calendar', 'error')
    }
  }

  const uploadCSV = async (file) => {
    if (!file) return false
    try {
      const body = new FormData()
      body.append('file', file, file.name)
      const response = await fetch('/admin/upload_rooms_publisher', {
        method: 'POST',
        body
      })
      const data = await response.json()
      showMessage(
        data.message || (response.ok ? 'CSV uploaded.' : 'CSV upload failed.'),
        response.ok ? 'success' : 'error'
      )
      await fetchData(false)
      return response.ok
    } catch {
      showMessage('CSV upload failed. Please try again.', 'error')
      return false
    }
  }

  const matching = calendars.filter((cal) => {
    const text = [cal.name, cal.building, cal.room, cal.email_address]
      .join(' ')
      .toLowerCase()
    return (
      text.includes(query.toLowerCase()) &&
      (statusFilter === 'all' ||
        (statusFilter === 'unknown'
          ? !cal.import_status
          : cal.import_status?.status === statusFilter))
    )
  })
  const pageCount = Math.max(1, Math.ceil(matching.length / 25))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleCalendars = matching.slice(
    currentPage * 25,
    (currentPage + 1) * 25
  )

  if (loading)
    return React.createElement(
      'div',
      { className: 'admin-loading', role: 'status' },
      React.createElement('div', { className: 'spinner' }),
      'Loading calendars…'
    )
  return React.createElement(AdminWorkspace, {
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
  })
}

ReactDOM.createRoot(document.getElementById('admin-root')).render(
  React.createElement(Admin)
)
