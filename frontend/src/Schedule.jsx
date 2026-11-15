import Icon from './Icon'
import { MiniCalendar, DailyAgenda, WeekGrid } from './CalendarViews'
import EventDetails from './EventDetails'
import RoomAvailability from './RoomAvailability'
import {
  initialSchedule,
  scheduleLink,
  loadLocal,
  saveLocal,
  freshness
} from './schedule-preferences'
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  formatHM,
  localDateStr,
  addLocalDays,
  eventStatus,
  activityType,
  TYPE_LABELS,
  typeChipClass,
  groupDisplay,
  roomDisplay,
  progressPct,
  displayCalendarName
} from './lib'

const CALENDAR_COLORS = [
  '#5b8def',
  '#4cc3d9',
  '#56c596',
  '#e07a8b',
  '#d9a05b',
  '#a78bdb',
  '#52b8a8',
  '#c77fb0'
]

// Module-scope row component — defining it inside Schedule would remount
// (and re-animate) every row on each state change, causing visible flicker.
const ScheduleRow = React.memo(function ScheduleRow({
  ev,
  now,
  calendars,
  onDetails
}) {
  const st = eventStatus(ev, now)
  const statusText =
    st.text ||
    {
      ongoing: 'In progress',
      next: 'Starting soon',
      upcoming: 'Scheduled',
      finished: 'Finished'
    }[st.key] ||
    'Scheduled'
  const pct = progressPct(ev, now)
  const type = activityType(ev)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Details: ${ev.display_title || ev.title}`}
      onClick={() => onDetails(ev)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onDetails(ev)
        }
      }}
      className={
        'evt-row' +
        (st.key === 'ongoing' ? ' is-ongoing' : '') +
        (st.key === 'finished' ? ' is-finished' : '')
      }
      style={{ '--row-accent': ev.color || 'var(--accent)' }}
    >
      <div className="evt-time">
        <span className="start">{formatHM(ev.start)}</span>
        <span className="end">{ev.end ? formatHM(ev.end) : ''}</span>
      </div>
      <div className="evt-main">
        <span className="evt-title">{ev.display_title || ev.title}</span>
        <small
          className={'data-state ' + freshness(calendars[ev.source], now).key}
        >
          {freshness(calendars[ev.source], now).text}
        </small>
        <span className="evt-sub">
          {type && (
            <span className={typeChipClass(type)}>{TYPE_LABELS[type]}</span>
          )}
          {ev.subject && ev.subject !== (ev.display_title || ev.title) && (
            <span className="meta">{ev.subject}</span>
          )}
        </span>
      </div>
      <span className="evt-prof">{ev.professor || '—'}</span>
      <span className="evt-room">{roomDisplay(ev)}</span>
      <span className="evt-group">{groupDisplay(ev, calendars) || '—'}</span>
      <span className={'evt-status status status-' + st.key}>{statusText}</span>
      {pct !== null && (
        <span
          className="evt-progress"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  )
})

export default function Schedule() {
  const initialRef = useRef(null)
  if (!initialRef.current) {
    const parsed = initialSchedule()
    const url = new URL(window.location.href)
    const incoming =
      [
        'view',
        'date',
        'week',
        'q',
        'subject',
        'professor',
        'room',
        'group',
        'sources'
      ].some((key) => url.searchParams.has(key)) ||
      url.hash.includes('sources=')
    const saved = incoming ? null : loadLocal('utcn-schedule-context', null)
    initialRef.current = {
      ...parsed,
      ...(!incoming
        ? {
            view: ['day', 'week', 'calendar'].includes(saved?.view)
              ? saved.view
              : window.innerWidth <= 600
                ? 'day'
                : parsed.view,
            search: typeof saved?.search === 'string' ? saved.search : '',
            filters: Object.fromEntries(
              Object.keys(parsed.filters).map((key) => [
                key,
                typeof saved?.filters?.[key] === 'string'
                  ? saved.filters[key]
                  : ''
              ])
            )
          }
        : {})
    }
  }
  const initial = initialRef.current
  const [detailEvent, setDetailEvent] = useState(null)
  const [shareUrl, setShareUrl] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [selectedDay, setSelectedDay] = useState(
    initial.day || localDateStr(new Date())
  )
  const searchRef = useRef(null)
  const sidebarRef = useRef(null)
  const [compact, setCompact] = useState(() => window.innerWidth <= 900)
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 900px)')
    const resize = (e) => {
      setCompact(e.matches)
      setSidebarOpen(!e.matches)
    }
    media?.addEventListener('change', resize)
    return () => media?.removeEventListener('change', resize)
  }, [])
  useEffect(() => {
    if (!compact || !sidebarOpen) return
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebarRef.current?.querySelector('button')?.focus()
    const trap = (e) => {
      if (e.key !== 'Tab') return
      const controls = [
        ...sidebarRef.current.querySelectorAll('button:not(:disabled),input')
      ].filter((node) => node.getClientRects().length > 0)
      const first = controls[0],
        last = controls[controls.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', trap)
      previous?.focus?.()
    }
  }, [compact, sidebarOpen])
  useEffect(() => {
    const shortcut = (e) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === 'k' &&
        !searchRef.current?.closest('[hidden]')
      ) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false)
        setAdvancedOpen(false)
        if (window.innerWidth <= 900) setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  const [favorites, setFavorites] = useState(() => {
    const stored = loadLocal('utcn-favorite-calendars', [])
    return Array.isArray(stored)
      ? stored.filter((v) => typeof v === 'string')
      : []
  })
  const selectionLoaded = useRef(false)

  const [events, setEvents] = useState([])
  const [allEvents, setAllEvents] = useState([]) // 2-month window cache
  const [calendars, setCalendars] = useState({})
  const [enabledCalendars, setEnabledCalendars] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [calendarError, setCalendarError] = useState(false)
  const [filters, setFilters] = useState(initial.filters)
  const [searchQuery, setSearchQuery] = useState(initial.search)
  const [searchSuggestions, setSearchSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [calendarSearch, setCalendarSearch] = useState('')
  const [calendarsOpen, setCalendarsOpen] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [viewMode, setViewMode] = useState(initial.view)
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    saveLocal('utcn-schedule-context', {
      view: viewMode,
      filters,
      search: searchQuery
    })
  }, [viewMode, filters, searchQuery])
  const abortRef = useRef(null)
  const allEventsCacheRef = useRef(null)

  // refresh statuses every minute without refetching
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const getWeekStart = useCallback((date, offset = 0) => {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
    d.setDate(diff + offset * 7)
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  // One selected date drives both the agenda and its containing week.
  const weekOffset = Math.round(
    (getWeekStart(new Date(selectedDay + 'T12:00:00')) - getWeekStart(now)) /
      604800000
  )

  const getWeekLabel = useCallback(
    (offset) => {
      const weekStart = getWeekStart(new Date(), offset)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      const startStr = weekStart.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short'
      })
      const endStr = weekEnd.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
      if (offset === 0) return `This week · ${startStr} – ${endStr}`
      if (offset === 1) return `Next week · ${startStr} – ${endStr}`
      if (offset === -1) return `Last week · ${startStr} – ${endStr}`
      return `${startStr} – ${endStr}`
    },
    [getWeekStart]
  )

  const fetchCalendarList = useCallback(async () => {
    try {
      const res = await fetch('/calendars.json')
      if (!res.ok) throw new Error('Calendar list unavailable')
      if (res.ok) {
        setCalendarError(false)
        const data = await res.json()
        const calMap = {}
        const enabled = {}
        Object.entries(data).forEach(([hash, info]) => {
          calMap[hash] = {
            ...info,
            color:
              info.color ||
              CALENDAR_COLORS[
                Object.keys(calMap).length % CALENDAR_COLORS.length
              ],
            name: info.name || hash,
            room: info.room || ''
          }
          enabled[hash] = info.enabled !== 0
        })
        setCalendars(calMap)
        setEnabledCalendars((prev) => {
          const merged = { ...enabled }
          if (!selectionLoaded.current) {
            const saved = loadLocal('utcn-calendar-selection', {})
            Object.keys(merged).forEach((k) => {
              if (initial.selected !== null)
                merged[k] = initial.selected.includes(k)
              else if (saved && typeof saved[k] === 'boolean')
                merged[k] = saved[k]
            })
            selectionLoaded.current = true
          } else
            Object.keys(prev).forEach((k) => {
              if (k in merged) merged[k] = prev[k]
            })
          return merged
        })
      }
    } catch (e) {
      setCalendarError(true)
    }
  }, [])

  useEffect(() => {
    fetchCalendarList()
    const poll = setInterval(fetchCalendarList, 15 * 60000)
    return () => clearInterval(poll)
  }, [fetchCalendarList])
  useEffect(() => {
    if (selectionLoaded.current)
      saveLocal('utcn-calendar-selection', enabledCalendars)
  }, [enabledCalendars])
  useEffect(() => {
    saveLocal('utcn-favorite-calendars', favorites)
  }, [favorites])

  const findNearestDayWithEvents = useCallback((allEvts) => {
    if (!allEvts || allEvts.length === 0) return null
    const today = localDateStr(new Date())
    const dates = [
      ...new Set(
        allEvts
          .filter((ev) => ev.start && ev.start.split('T')[0] >= today)
          .map((ev) => ev.start.split('T')[0])
      )
    ].sort()
    return dates.length > 0 ? dates[0] : null
  }, [])

  const fetchEvents = useCallback(
    async (opts = {}) => {
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        setLoading(true)
        const today = new Date()
        const todayStr = localDateStr(today)
        const scope = opts.scope || null

        let fromDate, toDate
        if (scope === 'twoMonthsAll') {
          fromDate = todayStr
          toDate = localDateStr(addLocalDays(today, 60))
        } else if (
          scope === 'currentWeek' ||
          viewMode === 'calendar' ||
          viewMode === 'week'
        ) {
          const weekStart = getWeekStart(today, weekOffset)
          fromDate = localDateStr(weekStart)
          toDate = localDateStr(addLocalDays(weekStart, 6))
        } else {
          fromDate = selectedDay
          toDate = selectedDay
        }

        const force = opts && opts.force
        const fetchFrom = fromDate

        const twoMonthsEnd = localDateStr(addLocalDays(today, 60))

        const params = new URLSearchParams({ from: fetchFrom, to: toDate })
        if (filters.subject) params.set('subject', filters.subject)
        if (filters.professor) params.set('professor', filters.professor)
        if (filters.room) params.set('room', filters.room)
        if (filters.group) params.set('group', filters.group)

        const res = await fetch('/events.json?' + params.toString(), {
          signal: ctrl.signal
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        let evts = await res.json()
        if (!Array.isArray(evts)) evts = []

        // Reuse the unfiltered lookahead while typing filters or browsing weeks.
        const cached = allEventsCacheRef.current
        let allEvts =
          cached &&
          cached.day === todayStr &&
          cached.expires > Date.now() &&
          !force
            ? cached.events
            : null
        if (!allEvts) {
          const allParams = new URLSearchParams({
            from: todayStr,
            to: twoMonthsEnd
          })
          const allRes = await fetch('/events.json?' + allParams.toString(), {
            signal: ctrl.signal
          })
          if (allRes.ok) {
            const allData = await allRes.json()
            allEvts = Array.isArray(allData) ? allData : []
            if (!ctrl.signal.aborted)
              allEventsCacheRef.current = {
                day: todayStr,
                expires: Date.now() + 3600000,
                events: allEvts
              }
          } else allEvts = []
        }
        if (ctrl.signal.aborted) return
        setAllEvents(allEvts)

        // assign stable colors per source
        const colorBySource = {}
        let colorIdx = 0
        const colorFor = (src) => {
          if (!colorBySource[src]) {
            colorBySource[src] =
              (calendars[src] && calendars[src].color) ||
              CALENDAR_COLORS[colorIdx++ % CALENDAR_COLORS.length]
          }
          return colorBySource[src]
        }
        evts.forEach((ev) => {
          if (!ev.color) ev.color = colorFor(ev.source || 'default')
        })

        if (ctrl.signal.aborted) return
        setEvents(evts)
        setLastUpdate(new Date())
        setNow(new Date())
        setError(null)
      } catch (err) {
        if (err && err.name === 'AbortError') return
        setError(err.message)
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    },
    [filters, viewMode, weekOffset, getWeekStart, calendars, selectedDay]
  )

  useEffect(() => {
    const debounce = setTimeout(() => fetchEvents(), 250)
    const interval = setInterval(() => fetchEvents(), 3600000)
    return () => {
      clearTimeout(debounce)
      clearInterval(interval)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchEvents])

  useEffect(() => {
    const onMidnight = () => {
      const current = new Date()
      setSelectedDay((day) =>
        day === localDateStr(now) ? localDateStr(current) : day
      )
      setNow(current)
      fetchEvents({ force: true })
    }
    window.addEventListener('midnight', onMidnight)
    return () => window.removeEventListener('midnight', onMidnight)
  }, [fetchEvents, now])

  // ── search suggestions ──
  const updateSearchSuggestions = useCallback(
    (query) => {
      const lowerQuery = (query || '').toLowerCase()
      const titleSet = new Set()
      allEvents.forEach((ev) => {
        const title = ev.display_title || ev.title || ''
        if (!lowerQuery || title.toLowerCase().includes(lowerQuery))
          titleSet.add(title)
        const calName = ev.calendar_name || calendars[ev.source]?.name || ''
        const displayName = displayCalendarName(calName)
        if (
          displayName &&
          (!lowerQuery ||
            `${displayName} ${calName}`.toLowerCase().includes(lowerQuery))
        )
          titleSet.add(displayName)
      })
      setSearchSuggestions([...titleSet].sort().slice(0, 10))
    },
    [allEvents, calendars]
  )

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value)
    updateSearchSuggestions(e.target.value)
    setShowSuggestions(true)
  }

  const toggleCalendar = (source) => {
    setEnabledCalendars((prev) => ({ ...prev, [source]: !prev[source] }))
  }
  const toggleAllCalendars = (enabled) => {
    const next = {}
    Object.keys(calendars).forEach((k) => {
      next[k] = enabled
    })
    setEnabledCalendars(next)
  }

  const filteredEvents = useMemo(() => {
    const from =
      viewMode === 'day'
        ? selectedDay
        : localDateStr(getWeekStart(new Date(), weekOffset))
    const to =
      viewMode === 'day'
        ? selectedDay
        : localDateStr(addLocalDays(getWeekStart(new Date(), weekOffset), 6))
    return events.filter((ev) => {
      const start = ev.start?.split('T')[0]
      if (!start || start < from || start > to) return false
      const source = ev.source || 'default'
      if (enabledCalendars[source] === false) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const hay = [
          ev.display_title || ev.title || '',
          ev.subject || '',
          ev.room || ev.location || '',
          ev.professor || '',
          ev.group || '',
          ev.year || '',
          groupDisplay(ev, calendars),
          displayCalendarName(ev.calendar_name || calendars[source]?.name || '')
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [
    events,
    enabledCalendars,
    searchQuery,
    calendars,
    viewMode,
    selectedDay,
    weekOffset,
    getWeekStart
  ])

  const groupedByDate = useMemo(() => {
    const acc = {}
    filteredEvents.forEach((ev) => {
      const date = ev.start ? ev.start.split('T')[0] : 'Unknown'
      if (!acc[date]) acc[date] = []
      acc[date].push(ev)
    })
    Object.values(acc).forEach((list) =>
      list.sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    )
    return acc
  }, [filteredEvents])

  const sortedDates = Object.keys(groupedByDate).sort()
  const todayLocal = localDateStr(now)
  const tomorrowLocal = localDateStr(addLocalDays(now, 1))

  const formatDateHeader = (dateStr) => {
    try {
      const d = new Date(dateStr + 'T12:00:00')
      return d.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      })
    } catch (e) {
      return dateStr
    }
  }

  const clearFilters = () => {
    setFilters({ subject: '', professor: '', room: '', group: '' })
    setSearchQuery('')
    setSearchSuggestions([])
    toggleAllCalendars(true)
  }

  const someCalendarsDisabled = Object.values(enabledCalendars).some(
    (v) => v === false
  )
  const hasActiveFilters =
    filters.subject ||
    filters.professor ||
    filters.room ||
    filters.group ||
    searchQuery ||
    someCalendarsDisabled

  const selectedCount = Object.values(enabledCalendars).filter(Boolean).length
  const missingTimetable =
    !calendarError &&
    Object.keys(calendars).length === 0 &&
    events.length === 0 &&
    allEvents.length === 0
  const weekStart = getWeekStart(now, weekOffset)
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    localDateStr(addLocalDays(weekStart, i))
  )
  const selectDay = (date) => {
    setSelectedDay(date)
    setViewMode('day')
    if (window.innerWidth <= 900) setSidebarOpen(false)
  }
  const navigate = (direction) => {
    if (viewMode === 'day')
      selectDay(
        localDateStr(
          addLocalDays(new Date(selectedDay + 'T12:00:00'), direction)
        )
      )
    else {
      setSelectedDay((date) =>
        localDateStr(addLocalDays(new Date(date + 'T12:00:00'), direction * 7))
      )
    }
  }
  const nextClass = filteredEvents
    .filter((ev) => ev.end && new Date(ev.end) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0]
  const activeCount = Object.values(filters).filter(Boolean).length
  const matchingCalendars = Object.entries(calendars).filter(
    ([, cal]) =>
      !calendarSearch ||
      `${displayCalendarName(cal.name)} ${cal.room} ${cal.building}`
        .toLowerCase()
        .includes(calendarSearch.toLowerCase())
  )
  const share = async () => {
    const url = scheduleLink({
      filters,
      search: searchQuery,
      view: viewMode,
      offset: weekOffset,
      day: selectedDay,
      selected: Object.keys(enabledCalendars).filter((k) => enabledCalendars[k])
    })
    setShareUrl(url)
    try {
      await navigator.clipboard.writeText(url)
      setShareMessage('Link copied to clipboard')
    } catch {
      setShareMessage('Select and copy your timetable link')
    }
  }
  const firstUpcoming = useMemo(
    () =>
      findNearestDayWithEvents(
        allEvents.filter(
          (ev) =>
            enabledCalendars[ev.source] !== false &&
            (!searchQuery ||
              [
                ev.title,
                ev.display_title,
                ev.professor,
                ev.room,
                ev.group,
                calendars[ev.source]?.name
              ]
                .join(' ')
                .toLowerCase()
                .includes(searchQuery.toLowerCase())) &&
            Object.entries(filters).every(
              ([key, value]) =>
                !value ||
                String(ev[key] || '')
                  .toLowerCase()
                  .includes(value.toLowerCase())
            )
        )
      ),
    [
      allEvents,
      enabledCalendars,
      searchQuery,
      calendars,
      filters,
      findNearestDayWithEvents
    ]
  )

  return (
    <div
      className={
        'schedule-app ' + (sidebarOpen ? 'sidebar-open' : 'sidebar-closed')
      }
    >
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close timetable sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className="schedule-sidebar"
        role={compact ? 'dialog' : undefined}
        aria-modal={compact && sidebarOpen ? true : undefined}
        aria-label="Timetable navigation"
        inert={!sidebarOpen ? '' : undefined}
      >
        <div className="sidebar-top">
          <span>
            <Icon name="calendar" size={17} /> Your timetable
          </span>
          <button
            className="icon-control"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <Icon name="sidebar" />
          </button>
        </div>
        <MiniCalendar
          selected={selectedDay}
          today={todayLocal}
          onSelect={selectDay}
        />
        <div className="sidebar-section calendars-section">
          <div className="section-label">
            <button
              className="calendar-collapse"
              aria-expanded={calendarsOpen}
              aria-controls="calendar-selection"
              onClick={() => setCalendarsOpen((value) => !value)}
            >
              <h3>Calendars</h3>
              <span>
                {selectedCount} / {Object.keys(calendars).length}
              </span>
              <Icon name="chevron" size={14} />
            </button>
          </div>
          <div
            id="calendar-selection"
            hidden={!calendarsOpen}
            className="calendar-selection-content"
          >
            <div className="calendar-search">
              <Icon name="search" size={15} />
              <input
                aria-label="Search calendars"
                placeholder="Find a room or calendar"
                value={calendarSearch}
                onChange={(e) => setCalendarSearch(e.target.value)}
              />
            </div>
            <div className="selection-actions">
              <button onClick={() => toggleAllCalendars(true)}>
                Select all
              </button>
              <button onClick={() => toggleAllCalendars(false)}>
                Clear all
              </button>
            </div>
            <div className="calendar-options">
              {matchingCalendars.map(([source, cal]) => (
                <div className="calendar-choice" key={source}>
                  <label title={displayCalendarName(cal.name)}>
                    <input
                      type="checkbox"
                      checked={enabledCalendars[source] !== false}
                      onChange={() => toggleCalendar(source)}
                      style={{ accentColor: cal.color }}
                    />
                    <span className="calendar-name">
                      {displayCalendarName(cal.name)}
                    </span>
                  </label>
                  <button
                    className="favorite-star"
                    aria-pressed={favorites.includes(source)}
                    aria-label={`Favorite ${cal.name}`}
                    onClick={() =>
                      setFavorites((prev) =>
                        prev.includes(source)
                          ? prev.filter((k) => k !== source)
                          : [...prev, source]
                      )
                    }
                  >
                    <Icon name="star" size={15} />
                  </button>
                </div>
              ))}
              {!matchingCalendars.length && (
                <p className="sidebar-hint">
                  {Object.keys(calendars).length
                    ? 'No matching calendars.'
                    : 'Calendar list unavailable. Refresh to try again.'}
                </p>
              )}
            </div>
            <button
              className="favorite-filter"
              disabled={!favorites.length}
              onClick={() =>
                setEnabledCalendars(
                  Object.fromEntries(
                    Object.keys(calendars).map((k) => [
                      k,
                      favorites.includes(k)
                    ])
                  )
                )
              }
            >
              <Icon name="star" size={16} /> Favorite rooms{' '}
              <span>{favorites.length}</span>
            </button>
          </div>
        </div>
        <div className="sidebar-note">
          <Icon name="info" size={16} />
          <p>
            Published schedules can change. Check class details for source
            verification.
          </p>
        </div>
      </aside>

      <div className="schedule-workspace">
        <div className="workspace-topbar">
          <button
            className="icon-control sidebar-toggle"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Icon name="sidebar" />
          </button>
          <div className="global-search">
            <Icon name="search" />
            <input
              id="schedule-search"
              ref={searchRef}
              type="search"
              autoComplete="off"
              aria-label="Search classes, professors, rooms, groups"
              placeholder="Search courses, professors, rooms or groups"
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => {
                updateSearchSuggestions(searchQuery)
                setShowSuggestions(true)
              }}
              onBlur={(e) => {
                if (!e.currentTarget.parentElement.contains(e.relatedTarget))
                  setShowSuggestions(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  document.querySelector('.suggestion-item')?.focus()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setShowSuggestions(false)
                }
              }}
            />
            <kbd>⌘ K</kbd>
            {showSuggestions && searchQuery && searchSuggestions.length > 0 && (
              <div
                className="search-suggestions"
                aria-label="Search suggestions"
              >
                {searchSuggestions.map((item, i) => (
                  <button
                    key={item}
                    className="suggestion-item"
                    onClick={() => {
                      setSearchQuery(item)
                      searchRef.current?.focus()
                      setShowSuggestions(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        e.currentTarget.nextElementSibling?.focus()
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        if (i === 0) searchRef.current?.focus()
                        else e.currentTarget.previousElementSibling?.focus()
                      }
                      if (e.key === 'Escape') {
                        setShowSuggestions(false)
                        searchRef.current?.focus()
                      }
                    }}
                  >
                    <Icon name="search" size={14} />
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={'btn filter-toggle ' + (advancedOpen ? 'selected' : '')}
            aria-expanded={advancedOpen}
            aria-controls="advanced-filters"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <Icon name="filter" />
            <span>Filters</span>
            {activeCount > 0 && (
              <span className="control-count">{activeCount}</span>
            )}
          </button>
          <button className="btn share-button" onClick={share}>
            <Icon name="share" />
            <span>Share</span>
          </button>
        </div>

        {advancedOpen && (
          <section
            className="advanced-filters"
            id="advanced-filters"
            aria-label="Advanced schedule filters"
          >
            <div className="filter-title">
              <strong>Refine your schedule</strong>
              <button
                className="icon-control"
                aria-label="Close filters"
                onClick={() => setAdvancedOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="filter-fields">
              {['subject', 'professor', 'room', 'group'].map((key) => (
                <div className="field" key={key}>
                  <label htmlFor={'filter-' + key}>
                    {key[0].toUpperCase() + key.slice(1)}
                  </label>
                  <input
                    id={'filter-' + key}
                    value={filters[key]}
                    placeholder={
                      {
                        subject: 'Course name',
                        professor: 'Professor name',
                        room: 'Room number',
                        group: 'e.g. 30221'
                      }[key]
                    }
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <button className="text-button" onClick={clearFilters}>
              Reset filters and calendar selection
            </button>
          </section>
        )}

        {shareUrl && (
          <div className="share-feedback" role="status">
            <Icon name="check" size={16} />
            <label>
              {shareMessage}
              <input
                aria-label="Share timetable link"
                value={shareUrl}
                readOnly
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button
              className="icon-control"
              aria-label="Dismiss share link"
              onClick={() => setShareUrl('')}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        <div className="workspace-content">
          <div className="schedule-titlebar">
            <div>
              <p className="eyebrow">Your academic week, at a glance</p>
              <h2>
                {viewMode === 'day'
                  ? new Date(selectedDay + 'T12:00:00').toLocaleDateString(
                      'en-GB',
                      { month: 'long', day: 'numeric', year: 'numeric' }
                    )
                  : weekStart.toLocaleDateString('en-GB', {
                      month: 'long',
                      year: 'numeric'
                    })}
              </h2>
            </div>
            <div
              className="seg"
              role="group"
              aria-label="Timetable view"
              style={{
                '--segment': { day: 0, week: 1, calendar: 2 }[viewMode]
              }}
            >
              {[
                ['day', 'Day'],
                ['week', 'Week'],
                ['calendar', 'Browse']
              ].map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={viewMode === key}
                  className={viewMode === key ? 'active' : ''}
                  onClick={() => setViewMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="schedule-navigation">
            <div className="date-controls">
              <button
                className="btn today-button"
                onClick={() => {
                  setSelectedDay(todayLocal)
                }}
              >
                Today
              </button>
              <div className="date-arrows">
                <button
                  className="icon-control"
                  aria-label={
                    viewMode === 'day' ? 'Previous day' : 'Previous week'
                  }
                  onClick={() => navigate(-1)}
                >
                  <Icon name="chevron" className="flip" size={17} />
                </button>
                <button
                  className="icon-control"
                  aria-label={viewMode === 'day' ? 'Next day' : 'Next week'}
                  onClick={() => navigate(1)}
                >
                  <Icon name="chevron" size={17} />
                </button>
              </div>
              <span className="date-range">
                {viewMode === 'day'
                  ? formatDateHeader(selectedDay)
                  : getWeekLabel(weekOffset)}
              </span>
            </div>
            <button
              onClick={() => {
                fetchEvents({ force: true })
                fetchCalendarList()
              }}
              className="icon-control refresh-control"
              disabled={loading}
              aria-label="Refresh timetable"
              title="Refresh timetable"
            >
              <Icon name="refresh" className={loading ? 'refreshing' : ''} />
            </button>
          </div>

          {hasActiveFilters && (
            <div className="active-filters">
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}>
                  Search: {searchQuery}
                  <Icon name="close" size={12} />
                </button>
              )}
              {Object.entries(filters)
                .filter(([, v]) => v)
                .map(([key, value]) => (
                  <button
                    key={key}
                    onClick={() => setFilters((f) => ({ ...f, [key]: '' }))}
                  >
                    {key}: {value}
                    <Icon name="close" size={12} />
                  </button>
                ))}
              {someCalendarsDisabled && (
                <button onClick={() => setSidebarOpen(true)}>
                  {selectedCount} calendars selected
                  <Icon name="filter" size={12} />
                </button>
              )}
              <button className="reset-chip" onClick={clearFilters}>
                Reset all
              </button>
            </div>
          )}
          {Object.keys(calendars).length > 20 && !hasActiveFilters && (
            <div className="discovery-note">
              <Icon name="info" size={17} />
              <span>
                Make it yours. Search for your group or choose calendars to
                focus your timetable.
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setSidebarOpen(true)
                  setCalendarsOpen(true)
                  setTimeout(
                    () =>
                      document.querySelector('.calendar-search input')?.focus(),
                    0
                  )
                }}
              >
                Choose calendars
              </button>
            </div>
          )}
          {calendarError && (
            <div className="alert alert-error" role="alert">
              Calendar metadata could not be refreshed. Source verification may
              be outdated.{' '}
              <button className="text-button" onClick={fetchCalendarList}>
                Retry calendars
              </button>
            </div>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              <strong>Unable to refresh the timetable.</strong> {error}.{' '}
              {events.length > 0
                ? 'Previously loaded classes remain below.'
                : ''}{' '}
              <button
                className="text-button"
                onClick={() => fetchEvents({ force: true })}
              >
                Try again
              </button>
            </div>
          )}
          {nextClass && viewMode === 'day' && !loading && (
            <button
              className="next-class"
              onClick={() => setDetailEvent(nextClass)}
            >
              <span className="next-icon">
                <Icon name="clock" size={19} />
              </span>
              <span>
                <small>
                  {eventStatus(nextClass, now).key === 'ongoing'
                    ? 'Happening now'
                    : 'Next in this schedule'}
                </small>
                <strong>{nextClass.display_title || nextClass.title}</strong>
              </span>
              <span className="next-meta">
                {formatHM(nextClass.start)} · {roomDisplay(nextClass)}
              </span>
              <Icon name="chevron" size={16} />
            </button>
          )}

          <div className="schedule-results" aria-busy={loading}>
            {loading && filteredEvents.length === 0 && (
              <div
                className="schedule-skeleton"
                role="status"
                aria-label="Loading timetable"
              >
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="skeleton-row" />
                ))}
              </div>
            )}
            {!loading && !error && filteredEvents.length === 0 && (
              <div className="state empty-schedule">
                <span className="empty-icon">
                  <Icon name="calendar" size={30} />
                </span>
                <h3>
                  {missingTimetable
                    ? 'No timetable data loaded yet'
                    : selectedCount === 0 && Object.keys(calendars).length
                      ? 'Choose your calendars'
                      : searchQuery || activeCount
                        ? 'No matching classes'
                        : 'A little room in your day'}
                </h3>
                <p>
                  {missingTimetable
                    ? 'This server has no calendars or classes loaded. An administrator needs to configure calendars and import the timetable.'
                    : selectedCount === 0 && Object.keys(calendars).length
                      ? 'Select a room or calendar in the sidebar to see its classes.'
                      : hasActiveFilters
                        ? 'Try a different search or reset your filters.'
                        : 'No classes are published for this period. You can explore another date.'}
                </p>
                <div className="empty-actions">
                  {missingTimetable && (
                    <a className="btn" href="/admin">
                      Open timetable administration
                    </a>
                  )}
                  {firstUpcoming && firstUpcoming !== selectedDay && (
                    <button
                      className="btn primary"
                      onClick={() => selectDay(firstUpcoming)}
                    >
                      {hasActiveFilters
                        ? 'Go to next matching day'
                        : 'Go to next scheduled day'}
                    </button>
                  )}
                  {hasActiveFilters && (
                    <button className="btn" onClick={clearFilters}>
                      Reset filters
                    </button>
                  )}
                </div>
              </div>
            )}
            {viewMode === 'week' && filteredEvents.length > 0 && (
              <WeekGrid
                days={weekDays}
                grouped={groupedByDate}
                calendars={calendars}
                now={now}
                onDetails={setDetailEvent}
                onDay={selectDay}
              />
            )}
            {viewMode !== 'week' &&
              sortedDates.map((date) => (
                <section
                  key={date}
                  className={
                    'day-section ' +
                    (viewMode === 'day' ? 'agenda-section' : 'browse-section')
                  }
                >
                  <div className="day-header">
                    <h3>{formatDateHeader(date)}</h3>
                    {date === todayLocal && (
                      <span className="today-tag">Today</span>
                    )}
                    {date === tomorrowLocal && (
                      <span className="today-tag tomorrow-tag">Tomorrow</span>
                    )}
                    <span className="count">
                      {groupedByDate[date].length} classes
                    </span>
                  </div>
                  {viewMode === 'day' ? (
                    <DailyAgenda
                      events={groupedByDate[date]}
                      date={date}
                      calendars={calendars}
                      now={now}
                      onDetails={setDetailEvent}
                    />
                  ) : (
                    <div className="evt-table">
                      <div className="evt-head" aria-hidden="true">
                        <span>Time</span>
                        <span>Class</span>
                        <span>Professor</span>
                        <span>Room</span>
                        <span>Year / Group</span>
                        <span>Status</span>
                      </div>
                      {groupedByDate[date].map((ev, i) => (
                        <ScheduleRow
                          key={ev.start + i}
                          ev={ev}
                          now={now}
                          calendars={calendars}
                          onDetails={setDetailEvent}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
          </div>
          <RoomAvailability favorites={favorites} />
          {lastUpdate && (
            <div className="status-bar">
              <span>
                <span className="quiet-dot" />
                View refreshed{' '}
                {lastUpdate.toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span>{filteredEvents.length} classes · Local time</span>
              <span>Source verification in class details</span>
            </div>
          )}
        </div>
      </div>
      {detailEvent && (
        <EventDetails
          event={detailEvent}
          calendars={calendars}
          onClose={() => setDetailEvent(null)}
        />
      )}
    </div>
  )
}
