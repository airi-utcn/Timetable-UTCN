import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  CANONICAL_BUILDINGS, buildingLabel, normalizeBuilding,
  formatHM, localDateStr, eventStatus, activityType, TYPE_LABELS,
  typeChipClass, groupDisplay, roomDisplay, displayCalendarName,
} from './lib'

const SLIDE_MS = 10000

// Module-scope row components: defining them inside Departures would create a
// new component type on every render, remounting (and re-animating) all rows
// each time state changes — the cause of the visible flicker.
const BoardRow = React.memo(function BoardRow({ ev, now, calendarsMap }) {
  const st = eventStatus(ev, now)
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
          {ev.calendar_name && <span className="meta">{displayCalendarName(ev.calendar_name)}</span>}
        </span>
      </div>
      <span className="evt-prof">{ev.professor || '—'}</span>
      <span className="evt-room">{roomDisplay(ev)}</span>
      <span className="evt-group">{groupDisplay(ev, calendarsMap) || '—'}</span>
      <span className={'evt-status status status-' + st.key}>{st.text}</span>
    </div>
  )
})

function Board({ evts, emptyMsg, now, calendarsMap }) {
  return (
    <div className="evt-table">
      <div className="evt-head" aria-hidden="true">
        <span>Time</span><span>Class</span><span>Professor</span>
        <span>Room</span><span>Year / Group</span><span style={{ textAlign: 'right' }}>Status</span>
      </div>
      {evts.length === 0 ? (
        <div className="state">
          <span className="icon" aria-hidden="true">📭</span>
          <p>{emptyMsg}</p>
        </div>
      ) : evts.map((ev, idx) => (
        <BoardRow key={(ev.start || '') + (ev.room || '') + idx}
          ev={ev} now={now} calendarsMap={calendarsMap} />
      ))}
    </div>
  )
}

export default function Departures() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedBuilding, setSelectedBuilding] = useState('')
  const [calendarsMap, setCalendarsMap] = useState({})
  const [lastUpdate, setLastUpdate] = useState(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [slideVisible, setSlideVisible] = useState(true)
  const [now, setNow] = useState(new Date())

  // refresh "now" every 30s so statuses stay accurate without re-fetching
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const fetchDepartures = useCallback(async () => {
    try {
      setLoading(true)
      let data
      try {
        const res = await fetch('/departures.json')
        if (res.ok) data = await res.json()
      } catch (e) {}

      if (!data || !data.events || data.events.length === 0) {
        const today = localDateStr(new Date())
        const tomorrow = localDateStr(new Date(Date.now() + 86400000))
        const res = await fetch('/events.json?from=' + today + '&to=' + tomorrow)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const evts = await res.json()
        data = { events: Array.isArray(evts) ? evts : [] }
      }

      const evts = data.events || data || []
      setEvents(Array.isArray(evts) ? evts : [])
      try {
        const cres = await fetch('/calendars.json')
        if (cres.ok) setCalendarsMap((await cres.json()) || {})
      } catch (e) {}
      setLastUpdate(new Date())
      setNow(new Date())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDepartures()
    const interval = setInterval(fetchDepartures, 300000)
    return () => clearInterval(interval)
  }, [fetchDepartures])

  // rotate NOW / UPCOMING slides with a fade
  useEffect(() => {
    const t = setInterval(() => {
      setSlideVisible(false)
      const inner = setTimeout(() => {
        setSlideIndex(prev => prev + 1)
        setSlideVisible(true)
      }, 400)
      return () => clearTimeout(inner)
    }, SLIDE_MS)
    return () => clearInterval(t)
  }, [])

  // refresh on midnight so Today / Tomorrow flip correctly
  useEffect(() => {
    const onMidnight = () => fetchDepartures()
    window.addEventListener('midnight', onMidnight)
    return () => window.removeEventListener('midnight', onMidnight)
  }, [fetchDepartures])

  const today = localDateStr(now)
  const tomorrow = localDateStr(new Date(now.getTime() + 86400000))

  const filteredEvents = useMemo(() => events.filter(ev => {
    if (!selectedBuilding) return true
    const combined = ((ev.location || '') + ' ' + (ev.room || '')).trim()
    return normalizeBuilding(ev.building, combined) === selectedBuilding
  }), [events, selectedBuilding])

  const todayEvents = useMemo(() => filteredEvents
    .filter(ev => ev.start && ev.start.startsWith(today))
    .filter(ev => !(ev.end && new Date(ev.end) < now))
    .sort((a, b) => (a.start || '').localeCompare(b.start || '')),
  [filteredEvents, today, now])

  const tomorrowEvents = useMemo(() => filteredEvents
    .filter(ev => ev.start && ev.start.startsWith(tomorrow))
    .sort((a, b) => (a.start || '').localeCompare(b.start || '')),
  [filteredEvents, tomorrow])

  const nowEvents = todayEvents.filter(ev => eventStatus(ev, now).key === 'ongoing')
  const upcomingEvents = todayEvents.filter(ev => new Date(ev.start) > now)

  const slides = [
    { label: 'Now in progress', events: nowEvents, live: true },
    { label: 'Upcoming today', events: upcomingEvents, live: false },
  ]
  const activeSlideIdx = slideIndex % slides.length
  const currentSlide = slides[activeSlideIdx]
  const displaySlide = currentSlide.events.length > 0
    ? currentSlide
    : slides.find(s => s.events.length > 0) || currentSlide

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <h2>Live Board</h2>
        </div>
        <div className="toolbar-right">
          <div className="field">
            <label htmlFor="building-select">Building</label>
            <select
              id="building-select"
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
            >
              <option value="">All buildings</option>
              {CANONICAL_BUILDINGS.map(b => (
                <option key={b} value={b}>{buildingLabel(b)}</option>
              ))}
            </select>
          </div>
          <button onClick={fetchDepartures} className="btn" disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error"><strong>Error:</strong> {error}</div>}

      {loading && events.length === 0 ? (
        <div>
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : (
        <>
          <section className="board-section panel" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            <div className="board-title" style={{ opacity: slideVisible ? 1 : 0, transition: 'opacity .4s' }}>
              {displaySlide.live && <span className="status status-ongoing" aria-hidden="true" />}
              {displaySlide.label}
              <span className="dots">
                {slides.map((s, i) => (
                  <span
                    key={i}
                    className={'dot' + (i === activeSlideIdx ? ' active' : '')}
                    onClick={() => setSlideIndex(i)}
                    title={s.label}
                  />
                ))}
              </span>
              <span className="count">{todayEvents.length} total today</span>
            </div>
            <div style={{ opacity: slideVisible ? 1 : 0, transition: 'opacity .4s' }}>
              <Board evts={displaySlide.events} emptyMsg="No classes in this slot."
                now={now} calendarsMap={calendarsMap} />
            </div>
          </section>

          <section className="board-section panel" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            <div className="board-title">
              Tomorrow
              <span className="count">{tomorrowEvents.length} classes</span>
            </div>
            <Board evts={tomorrowEvents.slice(0, 20)} emptyMsg="No classes scheduled for tomorrow."
              now={now} calendarsMap={calendarsMap} />
          </section>
        </>
      )}

      {lastUpdate && (
        <div className="status-bar">
          <span>Last update: {lastUpdate.toLocaleTimeString('en-GB')}</span>
          <span>•</span>
          <span>Auto-refresh every 5 minutes</span>
        </div>
      )}
    </div>
  )
}
