import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  CANONICAL_BUILDINGS, buildingLabel, normalizeBuilding,
  formatHM, localDateStr, eventStatus, activityType, TYPE_LABELS,
  typeChipClass, groupDisplay, roomDisplay, progressPct,
} from './lib'

const REFRESH_MS = 5 * 60 * 1000   // data refresh
const PAGE_MS = 12 * 1000          // rotate long lists

function cardsPerTvPage() {
  if (typeof window === 'undefined') return 5
  const { innerWidth: w, innerHeight: h } = window
  const stacked = w / Math.max(h, 1) < 4 / 3
  if (stacked) return h < 1000 ? 2 : 3
  if (h < 760) return 4
  return 5
}

function readBuildingParam() {
  try {
    return new URLSearchParams(window.location.search).get('building') || ''
  } catch (e) { return '' }
}

// Module-scope components: defining these inside TvBoard would create a new
// component type on every render (the clock re-renders each second), forcing
// React to unmount/remount every card — which made the whole board flicker.
const TvCard = React.memo(function TvCard({ ev, now, calendars }) {
  const st = eventStatus(ev, now)
  const statusText = st.text || ({ ongoing: 'In progress', next: 'Starting soon', upcoming: 'Scheduled', finished: 'Finished' }[st.key] || 'Scheduled')
  const pct = progressPct(ev, now)
  const type = activityType(ev)
  const grp = groupDisplay(ev, calendars)
  return (
    <div
      className={'tv-card' + (st.key === 'ongoing' ? ' is-ongoing' : '')}
      style={{ '--row-accent': ev.color || 'var(--accent)' }}
    >
      <div className="tv-card-time">
        <div className="start">{formatHM(ev.start)}</div>
        <div className="end">{ev.end ? formatHM(ev.end) : ''}</div>
      </div>
      <div className="tv-card-main">
        <div className="tv-card-title">{ev.display_title || ev.title}</div>
        <div className="tv-card-meta">
          {type && <span className={typeChipClass(type)}>{TYPE_LABELS[type]}</span>}
          {grp && <span>{grp}</span>}
          {ev.professor && <span>{ev.professor}</span>}
          <span className={'status status-' + st.key}>{statusText}</span>
        </div>
      </div>
      <div className="tv-card-room">
        <div className="label">ROOM</div>
        <div className="room">{roomDisplay(ev)}</div>
      </div>
      {pct !== null && <span className="evt-progress" style={{ width: `${pct}%` }} aria-hidden="true" />}
    </div>
  )
})

function TvEmptyCol({ msg }) {
  return (
    <div className="tv-empty">
      <span className="icon" aria-hidden="true">✓</span>
      <span>{msg}</span>
    </div>
  )
}

export default function TvBoard({ onExit }) {
  const [events, setEvents] = useState([])
  const [calendars, setCalendars] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [now, setNow] = useState(new Date())
  const [page, setPage] = useState(0)
  const [building, setBuilding] = useState(readBuildingParam)
  const [cardsPerPage, setCardsPerPage] = useState(cardsPerTvPage)
  const abortRef = useRef(null)

  // 1-second clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onResize = () => setCardsPerPage(cardsPerTvPage())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const today = localDateStr(new Date())
      const tomorrow = localDateStr(new Date(Date.now() + 86400000))
      const [evRes, calRes] = await Promise.allSettled([
        fetch(`/events.json?from=${today}&to=${tomorrow}`, { signal: ctrl.signal }),
        fetch('/calendars.json', { signal: ctrl.signal }),
      ])
      if (evRes.status === 'fulfilled' && evRes.value.ok) {
        const data = await evRes.value.json()
        setEvents(Array.isArray(data) ? data : [])
        setError(null)
        setLastUpdate(new Date())
      } else if (evRes.status === 'rejected' && evRes.reason?.name === 'AbortError') {
        return
      } else {
        setError('Could not load events')
      }
      if (calRes.status === 'fulfilled' && calRes.value.ok) {
        const cmap = await calRes.value.json()
        setCalendars(cmap || {})
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, REFRESH_MS)
    const onMidnight = () => fetchData()
    window.addEventListener('midnight', onMidnight)
    return () => {
      clearInterval(t)
      window.removeEventListener('midnight', onMidnight)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchData])

  // page rotation for long lists
  useEffect(() => {
    const t = setInterval(() => setPage(p => p + 1), PAGE_MS)
    return () => clearInterval(t)
  }, [])

  const todayStr = localDateStr(now)

  // Minute-resolution timestamp for status computations: keeps the per-second
  // clock from re-rendering (and re-animating) every card in the lists.
  const minuteKey = Math.floor(now.getTime() / 60000)
  const statusNow = useMemo(() => new Date(minuteKey * 60000), [minuteKey])

  const filtered = useMemo(() => {
    let evs = events.filter(ev => ev.start && ev.start.startsWith(todayStr))
    if (building) {
      evs = evs.filter(ev => {
        const combined = ((ev.location || '') + ' ' + (ev.room || '') + ' ' + (ev.calendar_name || '')).trim()
        return normalizeBuilding(ev.building, combined) === building
      })
    }
    return evs.sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  }, [events, building, todayStr])

  const nowEvents = useMemo(
    () => filtered.filter(ev => eventStatus(ev, statusNow).key === 'ongoing'),
    [filtered, statusNow]
  )
  const nextEvents = useMemo(
    () => filtered.filter(ev => {
      const k = eventStatus(ev, statusNow).key
      return k === 'next' || k === 'upcoming'
    }),
    [filtered, statusNow]
  )

  // room availability: rooms known from calendars (in selected building)
  // that have no ongoing class right now
  const freeRooms = useMemo(() => {
    const allRooms = new Set()
    Object.values(calendars).forEach(c => {
      if (!c || !c.room) return
      if (building) {
        const b = normalizeBuilding(c.building, c.name || '')
        if (b !== building) return
      }
      allRooms.add(String(c.room))
    })
    if (allRooms.size === 0) return null   // metadata not available
    nowEvents.forEach(ev => allRooms.delete(String(ev.room || '')))
    return Array.from(allRooms).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }))
  }, [calendars, nowEvents, building])

  const paginate = (list) => {
    if (list.length <= cardsPerPage) return { items: list, pages: 1, current: 0 }
    const pages = Math.ceil(list.length / cardsPerPage)
    const current = page % pages
    return { items: list.slice(current * cardsPerPage, (current + 1) * cardsPerPage), pages, current }
  }

  const nowPage = paginate(nowEvents)
  const nextPage = paginate(nextEvents)

  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const secStr = String(now.getSeconds()).padStart(2, '0')
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="tv">
      <button className="btn ghost tv-exit" onClick={onExit} title="Exit display mode">✕ Exit</button>

      <header className="tv-header">
        <div className="tv-brand">
          <div className="brand-mark" aria-hidden="true">UT</div>
          <div>
            <h1>UTCN Timetable</h1>
            <div className="sub">Technical University of Cluj-Napoca</div>
          </div>
        </div>
        {building && <div className="tv-building">{buildingLabel(building)}</div>}
        {!building && (
          <div className="field">
            <select
              value={building}
              onChange={e => setBuilding(e.target.value)}
              aria-label="Select building"
            >
              <option value="">All buildings</option>
              {CANONICAL_BUILDINGS.map(b => (
                <option key={b} value={b}>{buildingLabel(b)}</option>
              ))}
            </select>
          </div>
        )}
        <div className="tv-clock">
          <div className="time">{timeStr}<span className="sec">:{secStr}</span></div>
          <div className="date">{dateStr}</div>
        </div>
      </header>

      {error && <div className="alert alert-error"><strong>Connection issue:</strong> {error} — showing last known data.</div>}

      {loading ? (
        <div className="state" style={{ flex: 1 }}>
          <div className="spinner" />
          <h3>Loading timetable…</h3>
        </div>
      ) : (
        <div className="tv-body">
          <section className="tv-col" aria-label="Classes in progress">
            <div className="tv-section-title now-title">
              <span className="live-dot" aria-hidden="true" />
              <span className="section-kicker">NOW</span>
              <span>In progress</span>
              <span className="count">
                {nowEvents.length}{nowPage.pages > 1 ? ` • ${nowPage.current + 1}/${nowPage.pages}` : ''}
              </span>
            </div>
            <div className="tv-list">
              {nowEvents.length === 0
                ? <TvEmptyCol msg="No classes in progress" />
                : nowPage.items.map((ev, i) => (
                    <TvCard key={(ev.start || '') + (ev.room || '') + i}
                      ev={ev} now={statusNow} calendars={calendars} />
                  ))}
            </div>
          </section>

          <section className="tv-col" aria-label="Upcoming classes">
            <div className="tv-section-title next-title">
              <span className="live-dot" aria-hidden="true" />
              <span className="section-kicker">NEXT</span>
              <span>Coming up today</span>
              <span className="count">
                {nextEvents.length}{nextPage.pages > 1 ? ` • ${nextPage.current + 1}/${nextPage.pages}` : ''}
              </span>
            </div>
            <div className="tv-list">
              {nextEvents.length === 0
                ? <TvEmptyCol msg="No more classes today" />
                : nextPage.items.map((ev, i) => (
                    <TvCard key={(ev.start || '') + (ev.room || '') + i}
                      ev={ev} now={statusNow} calendars={calendars} />
                  ))}
            </div>
          </section>
        </div>
      )}

      <footer className="tv-footer">
        {freeRooms && freeRooms.length > 0 && (
          <div className="free-rooms">
            <span className="free-rooms-label">FREE ROOMS NOW ({freeRooms.length})</span>
            {freeRooms.slice(0, 14).map(r => (
              <span key={r} className="free-room-pill">{r}</span>
            ))}
            {freeRooms.length > 14 && <span>+{freeRooms.length - 14} more</span>}
          </div>
        )}
        <span className="updated">
          {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString('en-GB')}` : ''} • timetable.utcluj.ro
        </span>
      </footer>
    </div>
  )
}
