import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  formatHM, localDateStr, eventStatus, activityType, TYPE_LABELS,
  typeChipClass, groupDisplay, roomDisplay, progressPct,
} from './lib'

const CALENDAR_COLORS = [
  '#5b8def', '#4cc3d9', '#56c596', '#e07a8b',
  '#d9a05b', '#a78bdb', '#52b8a8', '#c77fb0',
]

// Module-scope row component — defining it inside Schedule would remount
// (and re-animate) every row on each state change, causing visible flicker.
const ScheduleRow = React.memo(function ScheduleRow({ ev, now, calendars }) {
  const st = eventStatus(ev, now)
  const statusText = st.text || ({ ongoing: 'In progress', next: 'Starting soon', upcoming: 'Scheduled', finished: 'Finished' }[st.key] || 'Scheduled')
  const pct = progressPct(ev, now)
  const type = activityType(ev)
  return (
    <div
      className={'evt-row' + (st.key === 'ongoing' ? ' is-ongoing' : '') + (st.key === 'finished' ? ' is-finished' : '')}
      style={{ '--row-accent': ev.color || 'var(--accent)' }}
    >
      <div className="evt-time">
        <span className="start">{formatHM(ev.start)}</span>
        <span className="end">{ev.end ? formatHM(ev.end) : ''}</span>
      </div>
      <div className="evt-main">
        <span className="evt-title">{ev.display_title || ev.title}</span>
        <span className="evt-sub">
          {type && <span className={typeChipClass(type)}>{TYPE_LABELS[type]}</span>}
          {ev.subject && ev.subject !== (ev.display_title || ev.title) && (
            <span className="meta">{ev.subject}</span>
          )}
        </span>
      </div>
      <span className="evt-prof">{ev.professor || '—'}</span>
      <span className="evt-room">{roomDisplay(ev)}</span>
      <span className="evt-group">{groupDisplay(ev, calendars) || '—'}</span>
      <span className={'evt-status status status-' + st.key}>{statusText}</span>
      {pct !== null && <span className="evt-progress" style={{ width: `${pct}%` }} aria-hidden="true" />}
    </div>
  )
})

export default function Schedule() {
  const [events, setEvents] = useState([])
  const [allEvents, setAllEvents] = useState([])      // 2-month window cache
  const [calendars, setCalendars] = useState({})
  const [enabledCalendars, setEnabledCalendars] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({ subject: '', professor: '', room: '', group: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [calendarSearch, setCalendarSearch] = useState('')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [viewMode, setViewMode] = useState('week')
  const [nearestDay, setNearestDay] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [now, setNow] = useState(new Date())
  const abortRef = useRef(null)

  // refresh statuses every minute without refetching
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const getWeekStart = useCallback((date, offset = 0) => {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
    d.setDate(diff + (offset * 7))
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const getWeekLabel = useCallback((offset) => {
    const weekStart = getWeekStart(new Date(), offset)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const startStr = weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const endStr = weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    if (offset === 0) return `This week · ${startStr} – ${endStr}`
    if (offset === 1) return `Next week · ${startStr} – ${endStr}`
    if (offset === -1) return `Last week · ${startStr} – ${endStr}`
    return `${startStr} – ${endStr}`
  }, [getWeekStart])

  const fetchCalendarList = useCallback(async () => {
    try {
      const res = await fetch('/calendars.json')
      if (res.ok) {
        const data = await res.json()
        const calMap = {}
        const enabled = {}
        Object.entries(data).forEach(([hash, info]) => {
          calMap[hash] = {
            color: info.color || CALENDAR_COLORS[Object.keys(calMap).length % CALENDAR_COLORS.length],
            name: info.name || hash,
            room: info.room || '',
          }
          enabled[hash] = true
        })
        setCalendars(calMap)
        setEnabledCalendars(prev => {
          const merged = { ...enabled }
          Object.keys(prev).forEach(k => { if (k in merged) merged[k] = prev[k] })
          return merged
        })
      }
    } catch (e) {
      console.error('Failed to fetch calendar list:', e)
    }
  }, [])

  useEffect(() => { fetchCalendarList() }, [fetchCalendarList])

  const findNearestDayWithEvents = useCallback((allEvts) => {
    if (!allEvts || allEvts.length === 0) return null
    const today = new Date().toISOString().split('T')[0]
    const dates = [...new Set(
      allEvts.filter(ev => ev.start && ev.start.split('T')[0] >= today)
        .map(ev => ev.start.split('T')[0])
    )].sort()
    return dates.length > 0 ? dates[0] : null
  }, [])

  // NOTE: fetch params intentionally use toISOString-based dates to stay
  // consistent with the backend contract and the existing test-suite.
  const fetchEvents = useCallback(async (opts = {}) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      setLoading(true)
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]
      const scope = opts.scope || null

      let fromDate, toDate
      if (scope === 'currentWeek' || viewMode === 'calendar' || viewMode === 'week') {
        const weekStart = getWeekStart(today, weekOffset)
        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekEnd.getDate() + 6)
        fromDate = weekStart.toISOString().split('T')[0]
        toDate = weekEnd.toISOString().split('T')[0]
      } else if (scope === 'twoMonthsAll') {
        fromDate = todayStr
        toDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      } else {
        // day mode
        fromDate = todayStr
        toDate = todayStr
      }

      const force = opts && opts.force
      let fetchFrom = fromDate
      if (!force && scope !== 'twoMonthsAll' && scope !== 'currentWeek' && viewMode !== 'calendar') {
        if (new Date(fetchFrom) < new Date(todayStr)) fetchFrom = todayStr
      }

      const twoMonthsEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const params = new URLSearchParams({ from: fetchFrom, to: toDate })
      if (filters.subject) params.set('subject', filters.subject)
      if (filters.professor) params.set('professor', filters.professor)
      if (filters.room) params.set('room', filters.room)
      if (filters.group) params.set('group', filters.group)

      const res = await fetch('/events.json?' + params.toString(), { signal: ctrl.signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      let evts = await res.json()
      if (!Array.isArray(evts)) evts = []

      // 2-month window (for nearest-day lookup, search suggestions, legend)
      let allEvts = []
      const allParams = new URLSearchParams({ from: todayStr, to: twoMonthsEnd })
      const allRes = await fetch('/events.json?' + allParams.toString(), { signal: ctrl.signal })
      if (allRes.ok) {
        const allData = await allRes.json()
        allEvts = Array.isArray(allData) ? allData : []
      }
      setAllEvents(allEvts)

      // empty view → jump to nearest day that has events
      if (evts.length === 0 && allEvts.length > 0 && viewMode !== 'calendar') {
        const nearest = findNearestDayWithEvents(allEvts)
        if (nearest) {
          setNearestDay(nearest)
          const nearestEnd = viewMode === 'week'
            ? new Date(new Date(nearest).getTime() + 7 * 86400000).toISOString().split('T')[0]
            : nearest
          const nearestParams = new URLSearchParams({ from: nearest, to: nearestEnd })
          if (filters.subject) nearestParams.set('subject', filters.subject)
          if (filters.professor) nearestParams.set('professor', filters.professor)
          if (filters.room) nearestParams.set('room', filters.room)
          if (filters.group) nearestParams.set('group', filters.group)
          const nres = await fetch('/events.json?' + nearestParams.toString(), { signal: ctrl.signal })
          if (nres.ok) {
            const ndata = await nres.json()
            evts = Array.isArray(ndata) ? ndata : []
          }
        }
      } else {
        setNearestDay(null)
      }

      // assign stable colors per source
      const colorBySource = {}
      let colorIdx = 0
      const colorFor = (src) => {
        if (!colorBySource[src]) {
          colorBySource[src] = (calendars[src] && calendars[src].color) ||
            CALENDAR_COLORS[colorIdx++ % CALENDAR_COLORS.length]
        }
        return colorBySource[src]
      }
      evts.forEach(ev => { if (!ev.color) ev.color = colorFor(ev.source || 'default') })

      setEvents(evts)
      setLastUpdate(new Date())
      setNow(new Date())
      setError(null)
    } catch (err) {
      if (err && err.name === 'AbortError') return
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filters, viewMode, weekOffset, getWeekStart, findNearestDayWithEvents, calendars])

  useEffect(() => {
    fetchEvents({ scope: 'currentWeek' })
    const interval = setInterval(() => fetchEvents({ scope: 'currentWeek' }), 3600000)
    return () => {
      clearInterval(interval)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchEvents])

  useEffect(() => {
    const onMidnight = () => fetchEvents({ scope: 'twoMonthsAll', force: true })
    window.addEventListener('midnight', onMidnight)
    return () => window.removeEventListener('midnight', onMidnight)
  }, [fetchEvents])

  useEffect(() => {
    if (viewMode !== 'calendar') setWeekOffset(0)
  }, [viewMode])

  // ── search suggestions ──
  const updateSearchSuggestions = useCallback((query) => {
    const lowerQuery = (query || '').toLowerCase()
    const titleSet = new Set()
    allEvents.forEach(ev => {
      const title = ev.display_title || ev.title || ''
      if (!lowerQuery || title.toLowerCase().includes(lowerQuery)) titleSet.add(title)
      const calName = ev.calendar_name || calendars[ev.source]?.name || ''
      if (calName && (!lowerQuery || calName.toLowerCase().includes(lowerQuery))) titleSet.add(calName)
    })
    setSearchSuggestions([...titleSet].sort().slice(0, 10))
  }, [allEvents, calendars])

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value)
    updateSearchSuggestions(e.target.value)
    setShowSuggestions(true)
  }

  const toggleCalendar = (source) => {
    setEnabledCalendars(prev => ({ ...prev, [source]: !prev[source] }))
  }
  const toggleAllCalendars = (enabled) => {
    const next = {}
    Object.keys(calendars).forEach(k => { next[k] = enabled })
    setEnabledCalendars(next)
  }

  const filteredEvents = useMemo(() => events.filter(ev => {
    const source = ev.source || 'default'
    if (enabledCalendars[source] === false) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const hay = [
        ev.display_title || ev.title || '',
        ev.room || ev.location || '',
        ev.professor || '',
        ev.calendar_name || calendars[source]?.name || '',
      ].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [events, enabledCalendars, searchQuery, calendars])

  const groupedByDate = useMemo(() => {
    const acc = {}
    filteredEvents.forEach(ev => {
      const date = ev.start ? ev.start.split('T')[0] : 'Unknown'
      if (!acc[date]) acc[date] = []
      acc[date].push(ev)
    })
    Object.values(acc).forEach(list =>
      list.sort((a, b) => (a.start || '').localeCompare(b.start || '')))
    return acc
  }, [filteredEvents])

  const sortedDates = Object.keys(groupedByDate).sort()
  const todayLocal = localDateStr(now)
  const tomorrowLocal = localDateStr(new Date(now.getTime() + 86400000))

  const formatDateHeader = (dateStr) => {
    try {
      const d = new Date(dateStr + 'T12:00:00')
      return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    } catch (e) { return dateStr }
  }

  const clearFilters = () => {
    setFilters({ subject: '', professor: '', room: '', group: '' })
    setSearchQuery('')
    setSearchSuggestions([])
    toggleAllCalendars(true)
  }

  const someCalendarsDisabled = Object.values(enabledCalendars).some(v => v === false)
  const hasActiveFilters = filters.subject || filters.professor || filters.room || filters.group || searchQuery || someCalendarsDisabled

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <h2>{viewMode === 'calendar' ? 'Calendar' : 'Schedule'}</h2>
          <div className="seg" role="tablist">
            <button className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Day</button>
            <button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Week</button>
            <button className={viewMode === 'calendar' ? 'active' : ''} onClick={() => setViewMode('calendar')}>Browse</button>
          </div>
        </div>
        <div className="toolbar-right">
          <button onClick={() => fetchEvents({ force: true })} className="btn" disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {viewMode === 'calendar' && (
        <div className="week-nav">
          <button onClick={() => setWeekOffset(o => o - 1)} className="btn ghost">← Previous</button>
          <span className="label">{getWeekLabel(weekOffset)}</span>
          <button onClick={() => setWeekOffset(o => o + 1)} className="btn ghost">Next →</button>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="btn primary">Today</button>
          )}
        </div>
      )}

      <div className="filters panel" aria-label="Schedule filters">
        <div className="field" style={{ flex: '2 1 220px' }}>
          <label htmlFor="schedule-search">Search</label>
          <div className="search-wrapper">
            <input
              id="schedule-search"
              type="text"
              placeholder="Subject, professor, room…"
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => { updateSearchSuggestions(searchQuery); setShowSuggestions(true) }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              style={{ width: '100%' }}
            />
            {showSuggestions && searchSuggestions.length > 0 && (
              <div className="search-suggestions">
                {searchSuggestions.map((s, idx) => (
                  <div key={idx} className="suggestion-item"
                    onClick={() => { setSearchQuery(s); setShowSuggestions(false) }}>
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="filter-subject">Subject</label>
          <input type="text" placeholder="e.g. Algorithms" value={filters.subject}
            id="filter-subject"
            onChange={(e) => setFilters(f => ({ ...f, subject: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="filter-professor">Professor</label>
          <input type="text" placeholder="e.g. R. Potolea" value={filters.professor}
            id="filter-professor"
            onChange={(e) => setFilters(f => ({ ...f, professor: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="filter-room">Room</label>
          <input type="text" placeholder="e.g. 40" value={filters.room}
            id="filter-room"
            onChange={(e) => setFilters(f => ({ ...f, room: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="filter-group">Group</label>
          <input type="text" placeholder="e.g. 30221" value={filters.group}
            id="filter-group"
            onChange={(e) => setFilters(f => ({ ...f, group: e.target.value }))} />
        </div>
        {hasActiveFilters && (
          <div className="actions">
            <button onClick={clearFilters} className="btn ghost">✕ Clear</button>
          </div>
        )}
      </div>

      {Object.keys(calendars).length > 0 && (
        <div className="legend-panel panel">
          <span className="legend-title">Calendars</span>
          <input
            type="text"
            placeholder="Filter calendars…"
            value={calendarSearch}
            onChange={(e) => setCalendarSearch(e.target.value)}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 'var(--radius-sm)',
              padding: '6px 10px', fontSize: 'var(--fs-xs)', width: 160,
            }}
          />
          <div className="legend-list">
            {Object.entries(calendars)
              .filter(([, cal]) => !calendarSearch || cal.name.toLowerCase().includes(calendarSearch.toLowerCase()))
              .map(([source, cal]) => (
                <label key={source} className="legend-item" title={cal.name}>
                  <input
                    type="checkbox"
                    checked={enabledCalendars[source] !== false}
                    onChange={() => toggleCalendar(source)}
                  />
                  <span className="legend-dot" style={{ backgroundColor: cal.color }}></span>
                  <span>{cal.name}</span>
                </label>
              ))}
          </div>
          <div className="actions">
            <button onClick={() => toggleAllCalendars(true)} className="btn ghost">All</button>
            <button onClick={() => toggleAllCalendars(false)} className="btn ghost">None</button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error"><strong>Error:</strong> {error}</div>}

      {nearestDay && (
        <div className="alert alert-info">
          <strong>No classes in the selected period.</strong> Showing the nearest day with
          scheduled classes: <strong>{formatDateHeader(nearestDay)}</strong>.
        </div>
      )}

      {loading && events.length === 0 && (
        <div>
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}

      {!loading && !error && filteredEvents.length === 0 && !nearestDay && (
        <div className="state panel">
          <span className="icon" aria-hidden="true">🗓</span>
          <h3>No classes found</h3>
          <p>
            {hasActiveFilters
              ? 'Try clearing the filters or searching for something else.'
              : 'There are no scheduled classes for this period. Data refreshes automatically.'}
          </p>
          {hasActiveFilters && <button className="btn primary" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}

      {sortedDates.map(date => (
        <section key={date} className="day-section">
          <div className="day-header">
            <h3>{formatDateHeader(date)}</h3>
            {date === todayLocal && <span className="today-tag">Today</span>}
            {date === tomorrowLocal && <span className="today-tag tomorrow-tag">Tomorrow</span>}
            <span className="count">{groupedByDate[date].length} classes</span>
          </div>
          <div className="evt-table">
            <div className="evt-head" aria-hidden="true">
              <span>Time</span><span>Class</span><span>Professor</span>
              <span>Room</span><span>Year / Group</span><span style={{ textAlign: 'right' }}>Status</span>
            </div>
            {groupedByDate[date].map((ev, idx) => (
              <ScheduleRow key={(ev.start || '') + (ev.room || '') + idx}
                ev={ev} now={now} calendars={calendars} />
            ))}
          </div>
        </section>
      ))}

      {lastUpdate && (
        <div className="status-bar">
          <span>Last update: {lastUpdate.toLocaleTimeString('en-GB')}</span>
          <span>•</span>
          <span>{filteredEvents.length} classes shown</span>
        </div>
      )}
    </div>
  )
}
