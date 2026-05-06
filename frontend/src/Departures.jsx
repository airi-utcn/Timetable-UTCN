import React, { useState, useEffect, useCallback, useRef } from 'react'

export default function Departures() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedBuilding, setSelectedBuilding] = useState('')
  const [buildings, setBuildings] = useState([])
  const [calendarsMap, setCalendarsMap] = useState({})
  const [lastUpdate, setLastUpdate] = useState(null)

  // Airport rotating board: index into the computed slides array
  const [slideIndex, setSlideIndex] = useState(0)
  // Trigger CSS fade-in on each slide change
  const [slideVisible, setSlideVisible] = useState(true)
  const slideIndexRef = useRef(0)

  // UTCN Buildings
  const BUILDING_NAMES = {
    'Rectorat': 'Rectorat',
    'HUB Cluj': 'HUB Cluj',
    'BT Electro Cluj': 'BT Electro Cluj',
    'Daicoviciu Cluj': 'Daicoviciu Cluj',
    'Baritiu Electro Cluj': 'Baritiu Electro Cluj',
    'Baritiu Constructii Cluj': 'Baritiu Constructii Cluj',
    'Dorobantilor DECIDFR CLUJ': 'Dorobantilor DECIDFR CLUJ',
    'OBSERVATOR CONSTRUCTII CLUJ': 'OBSERVATOR CONSTRUCTII CLUJ',
    'OBSERVATOR ELECTRO CLUJ': 'OBSERVATOR ELECTRO CLUJ',
    '21 DECEMBRIE INSTALATII CLUJ': '21 DECEMBRIE INSTALATII CLUJ',
    'MUNCII CLUJ': 'MUNCII CLUJ',
    'CUNBM VICTORIEI': 'CUNBM VICTORIEI (Baia Mare)',
    'CUNBM BABES': 'CUNBM BABES (Baia Mare)',
    'UTCN AIRI': 'UTCN AIRI',
  }

  const CANONICAL_BUILDINGS = [
    'Rectorat', 'HUB Cluj', 'BT Electro Cluj', 'Daicoviciu Cluj',
    'Baritiu Electro Cluj', 'Baritiu Constructii Cluj', 'Dorobantilor DECIDFR CLUJ',
    'OBSERVATOR CONSTRUCTII CLUJ', 'OBSERVATOR ELECTRO CLUJ', '21 DECEMBRIE INSTALATII CLUJ',
    'MUNCII CLUJ', 'CUNBM VICTORIEI', 'CUNBM BABES', 'UTCN AIRI'
  ]

  // Helpers to extract room/building from free-form location strings when parser
  // didn't provide structured values from the backend.
  const parseRoomFromLocation = (loc) => {
    if (!loc) return ''
    try {
      // common Romanian form: "Sala 40" or "Sala 40 (Cluj...)"
      const sala = /Sala\s*([A-Za-z0-9\-]+)/i.exec(loc)
      if (sala && sala[1]) return sala[1]
      // fallback: last numeric token in the string
      const nums = loc.match(/(\d+)/g)
      if (nums && nums.length) return nums[nums.length - 1]
    } catch (e) {}
    return ''
  }

  const parseGroupFromString = (s) => {
    if (!s) return ''
    try {
      const txt = s.toString()
      const l = txt.toLowerCase()
      // Look for Romanian keywords as well: 'seria', 'serie', 'an', 'anul'
      let year = null
      let grp = null

      // year patterns: 'an 3', 'anul 3', 'year 3', or trailing digit
      let m = l.match(/\ban(?:ul)?\s*(?:[:\-]?\s*)?(\d)\b/) || l.match(/\byear\s*(\d)\b/)
      if (m) year = m[1]
      if (!year) {
        m = l.match(/(\b[1-4]\b)(?!.*\d)/)
        if (m) year = m[1]
      }

      // group/series patterns: 'seria B', 'serie B', 'grupa A', 'group A'
      m = l.match(/\bseri[ae]\s*([A-Za-z0-9]+)\b/) || l.match(/\bgrup[ai]\s*([A-Za-z0-9]+)\b/) || l.match(/\bgroup\s*([A-Za-z0-9]+)\b/)
      if (m) grp = m[1].toUpperCase()

      // Patterns like '3A' or '3 A' where first token is year and letter is group
      if (!year || !grp) {
        m = l.match(/\b([1-4])\s*([A-Za-z])\b/) || l.match(/\b([1-4])([A-Za-z])\b/)
        if (m) {
          if (!year) year = m[1]
          if (!grp) grp = (m[2] || '').toUpperCase()
        }
      }

      if (year && grp) return 'Year ' + year + ' • Group ' + grp
      if (year) return 'Year ' + year
      if (grp) return 'Group ' + grp
    } catch (e) {}
    return ''
  }

  const inferBuildingFromLocation = (loc) => {
    if (!loc) return ''
    const l = loc.toLowerCase()

  // Priority-based Baritiu parsing using token/word matches
  // Match BT as a standalone token or as a prefix like 'BT123', 'BT-101', 'BT_101',
  // or dotted forms like 'B.T.'. Allow non-letter separators between B and T.
  // This catches variants like 'BT101', 'BT-101', 'B.T.101', 'b_t101', 'Sala B.T. 12'.
  if (/(^|[^a-z0-9])b[\W_]*t(?=[^a-z]|$)/.test(l)) return 'BT Electro Cluj'
  // Match variations that should map to Baritiu Electro: AC Bar, ACBar, IE Bar, IEBar, ETTI Bar, etc.
  // Examples: 'UTCN - AC Bar - Sala S42', 'IE BAr', 'ETTI Bar'
  if (/\bac\s*bar\b/.test(l) || /acbar/.test(l) || /\bie\s*bar\b/.test(l) || /iebar/.test(l) || /\bett?ti\s*bar\b/.test(l) || /etti?bar/.test(l)) return 'Baritiu Electro Cluj'
  // Match variations for construction building -> detect explicit 'construct' or 'constructii',
  // or patterns like 'cons' together with 'bar'/'baritiu' (e.g. 'Cons Bar', 'ConsBar', 'Cons Baritiu')
  if (/\bconstruct/i.test(l) || /\bconstructii\b/.test(l) || (/\bcons\b/.test(l) && (/\bbar\b/.test(l) || /\bbaritiu\b/.test(l)))) return 'Baritiu Constructii Cluj'

    // If string mentions plain 'baritiu' but no qualifier, treat as unknown (avoid general 'Baritiu')
    if (l.indexOf('baritiu') !== -1 && !l.match(/electro|construct/i) && !l.match(/bt|ac|cons/i)) {
      return ''
    }

    // Comprehensive building mapping
    const mapping = [
      { keys: ['rectorat'], val: 'Rectorat' },
      { keys: ['hub cluj', 'hub'], val: 'HUB Cluj' },
      { keys: ['bt electro cluj', 'bt electro'], val: 'BT Electro Cluj' },
      { keys: ['daicoviciu cluj', 'daicoviciu'], val: 'Daicoviciu Cluj' },
      { keys: ['baritiu electro cluj', 'baritiu electro'], val: 'Baritiu Electro Cluj' },
      { keys: ['baritiu constructii cluj', 'baritiu constructii'], val: 'Baritiu Constructii Cluj' },
      { keys: ['dorobantilor decidfr cluj', 'decidfr', 'dorobantilor decidfr'], val: 'Dorobantilor DECIDFR CLUJ' },
      { keys: ['observator constructii cluj', 'observator constructii'], val: 'OBSERVATOR CONSTRUCTII CLUJ' },
      { keys: ['observator electro cluj', 'observator electro'], val: 'OBSERVATOR ELECTRO CLUJ' },
      { keys: ['21 decembrie instalatii cluj', '21 decembrie', 'decembrie instalatii'], val: '21 DECEMBRIE INSTALATII CLUJ' },
      { keys: ['muncII cluj', 'muncII'], val: 'MUNCII CLUJ' },
      { keys: ['cunbm victoriei', 'victoriei'], val: 'CUNBM VICTORIEI' },
      { keys: ['cunbm babes', 'babes'], val: 'CUNBM BABES' },
      { keys: ['utcn airi', 'airi'], val: 'UTCN AIRI' },
      // Fallbacks for existing mappings
      { keys: ['daic'], val: 'DAIC' },
      { keys: ['doroban', 'dorobantilor'], val: 'Dorobantilor' },
      { keys: ['memorandum'], val: 'Memorandumului' },
    ]
    for (const m of mapping) {
      for (const k of m.keys) {
        if (k && l.indexOf(k) !== -1) return m.val
      }
    }
    return ''
  }

  // Normalize a raw building string (from backend) into one of the canonical building names
  // We try (in order): direct canonical substring match, disambiguation for ambiguous
  // 'Baritiu' values by inspecting location/room, then falling back to inference.
  const normalizeBuilding = (raw, loc) => {
    if (!raw && !loc) return ''
    const r = (raw || '').toString().trim()
    const rl = r.toLowerCase()
    const ll = (loc || '').toString().toLowerCase()

    // 1) If the location/room clearly indicates BT, prefer BT (even if raw
    //    mentions 'Baritiu'). This fixes cases where ev.building is 'Baritiu'
    //    but the room name is 'BT101' and should be classified as BT.
    if (/(^|[^a-z0-9])b[\W_]*t(?=[^a-z]|$)/.test(ll)) return 'BT Electro Cluj'

    // 2) Direct canonical substring match
    for (const c of CANONICAL_BUILDINGS) {
      if (r && rl.indexOf(c.toLowerCase()) !== -1) return c
    }

    // 3) If raw mentions 'baritiu' but lacks qualifier, attempt to disambiguate
    if (rl.indexOf('baritiu') !== -1) {
      // If location/room hints at Electro (AC/IE/ETTI/IE/AC/ELECTRO)
      if (/\bac\b/.test(ll) || /\bie\b/.test(ll) || /\bett?ti\b/.test(ll) || ll.indexOf('electro') !== -1) {
        return 'Baritiu Electro Cluj'
      }
      // If location/room hints at Constructii
      if (ll.indexOf('construct') !== -1 || ll.indexOf('constructii') !== -1 || (ll.indexOf('cons') !== -1 && (ll.indexOf('bar') !== -1 || ll.indexOf('baritiu') !== -1))) {
        return 'Baritiu Constructii Cluj'
      }
      // Default pragmatic mapping for bare 'Baritiu' -> Baritiu Electro
      return 'Baritiu Electro Cluj'
    }

    // 3) Fallback to infer from location/room
    const inferred = inferBuildingFromLocation(loc || '')
    if (CANONICAL_BUILDINGS.includes(inferred)) return inferred
    return ''
  }

  const fetchDepartures = useCallback(async () => {
    try {
      setLoading(true)
      let data
      try {
        const res = await fetch('/departures.json')
        if (res.ok) data = await res.json()
      } catch (e) {}

      if (!data || !data.events || data.events.length === 0) {
        const today = new Date().toISOString().split('T')[0]
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
        const res = await fetch('/events.json?from=' + today + '&to=' + tomorrow)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const evts = await res.json()
        data = { events: Array.isArray(evts) ? evts : [], buildings: {} }
      }

      const evts = data.events || data || []
      setEvents(Array.isArray(evts) ? evts : [])
      // also fetch calendar map to resolve calendar names by source
      try {
        const cres = await fetch('/calendars.json')
        if (cres.ok) {
          const cmap = await cres.json()
          setCalendarsMap(cmap || {})
        }
      } catch (e) {}
      
      // Extract unique buildings from API data (use inferred building if backend
      // didn't provide one). This powers the Building select dropdown.
      const buildingSet = new Set()
      evts.forEach(ev => {
        // Combine location and room so clues in either field are considered
        const combinedLoc = ((ev.location || '') + ' ' + (ev.room || '')).trim()
        const b = normalizeBuilding(ev.building, combinedLoc)
        if (b) buildingSet.add(b)
      })
      // Ensure the dropdown shows all canonical buildings even if there are
      // no events for them today so the user can always select any building.
      CANONICAL_BUILDINGS.forEach(b => buildingSet.add(b))
      setBuildings(Array.from(buildingSet).sort())
      setLastUpdate(new Date())
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

  // Airport board: advance to next slide every 10 seconds with a fade transition
  useEffect(() => {
    const t = setInterval(() => {
      setSlideVisible(false)
      setTimeout(() => {
        setSlideIndex(prev => {
          const next = prev + 1
          slideIndexRef.current = next
          return next
        })
        setSlideVisible(true)
      }, 400)
    }, 10000)
    return () => clearInterval(t)
  }, [])

  // Refresh live board on midnight so 'Today' / 'Tomorrow' sections update
  useEffect(() => {
    const onMidnight = () => {
      fetchDepartures()
    }
    window.addEventListener('midnight', onMidnight)
    return () => window.removeEventListener('midnight', onMidnight)
  }, [fetchDepartures])

  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  const filteredEvents = events.filter(ev => {
    if (selectedBuilding) {
      const combinedLoc = ((ev.location || '') + ' ' + (ev.room || '')).trim()
      const evBuilding = normalizeBuilding(ev.building, combinedLoc)
      if (evBuilding !== selectedBuilding) return false
    }
    return true
  })

  const todayEvents = filteredEvents.filter(ev => {
    if (!ev.start || !ev.start.startsWith(today)) return false
    if (ev.end) {
      const endTime = new Date(ev.end)
      if (endTime < now) return false
    }
    return true
  })

  // ── Compute airport slides ──────────────────────────────────────────────
  // Group today's events (not yet ended) by start-time slot (HH:MM).
  // Slides order: running-now slots first, then upcoming slots in time order.
  const buildSlides = (evts) => {
    const groups = {}
    evts.forEach(ev => {
      const key = ev.start ? ev.start.slice(0, 16) : 'unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(ev)
    })
    const nowTs = new Date()
    const entries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
    const nowSlides = []
    const upcomingSlides = []
    entries.forEach(([key, slotEvts]) => {
      const slotStart = new Date(key)
      const isNow = slotEvts.some(ev => {
        const s = new Date(ev.start)
        const e = ev.end ? new Date(ev.end) : null
        return s <= nowTs && (!e || e > nowTs)
      })
      const slide = { key, evts: slotEvts, isNow, slotStart }
      if (isNow) nowSlides.push(slide)
      else if (slotStart > nowTs) upcomingSlides.push(slide)
    })
    return [...nowSlides, ...upcomingSlides]
  }

  const slides = buildSlides(todayEvents)
  const totalSlides = slides.length
  const currentSlide = totalSlides > 0 ? slides[slideIndex % totalSlides] : null

  const formatTime = (isoString) => {
    if (!isoString) return '--:--'
    try {
      return new Date(isoString).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    } catch (e) {
      return '--:--'
    }
  }

  const getStatusText = (ev) => {
    if (!ev.start) return ''
    try {
      const n = new Date()
      const s = new Date(ev.start)
      const e = ev.end ? new Date(ev.end) : null
      if (s <= n && (!e || e > n)) return 'NOW'
      const diff = s - n
      const mins = Math.floor(diff / 60000)
      if (mins < 60) return 'in ' + mins + 'm'
      return 'in ' + Math.floor(mins / 60) + 'h' + (mins % 60 ? ' ' + (mins % 60) + 'm' : '')
    } catch { return '' }
  }

  // Slide label shown in the header strip
  const slideLabel = currentSlide
    ? (currentSlide.isNow
        ? '▶ NOW IN PROGRESS'
        : '⏱ NEXT: ' + formatTime(currentSlide.key + ':00'))
    : null

  return (
    <div className="departures-container">
      <div className="toolbar">
        <div className="toolbar-left"><h2>Live Board</h2></div>
        <div className="toolbar-right">
          <div className="filter-group">
            <label>Building:</label>
            <select value={selectedBuilding} onChange={(e) => setSelectedBuilding(e.target.value)}>
              <option value="" style={{ fontWeight: 'bold' }}>{'All Buildings'.toUpperCase()}</option>
              {buildings.map(b => (
                <option key={b} value={b} style={{ fontWeight: 'bold' }}>{(BUILDING_NAMES[b] || b).toUpperCase()}</option>
              ))}
            </select>
          </div>
          <button onClick={fetchDepartures} className="btn-refresh" disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error"><strong>Error:</strong> {error}</div>}
      {loading && <div className="loading-state"><div className="spinner"></div><p>Loading...</p></div>}

      {!loading && !error && (
        <div className="airport-board-wrap">
          {/* Slide header strip */}
          {totalSlides > 0 && (
            <div className="airport-slide-header">
              <span className={'airport-slide-label' + (currentSlide && currentSlide.isNow ? ' label-now' : ' label-next')}>
                {slideLabel}
              </span>
              <div className="airport-slide-dots">
                {slides.map((s, i) => (
                  <span
                    key={i}
                    className={'airport-dot' + (i === slideIndex % totalSlides ? ' active' : '') + (s.isNow ? ' dot-now' : '')}
                    onClick={() => { setSlideIndex(i); slideIndexRef.current = i }}
                    title={s.isNow ? 'Now' : formatTime(s.key + ':00')}
                  />
                ))}
              </div>
              <span className="airport-slide-counter">{(slideIndex % totalSlides) + 1} / {totalSlides}</span>
            </div>
          )}

          {/* Main airport board */}
          <div className={'airport-board' + (slideVisible ? ' slide-visible' : ' slide-hidden')}>
            {totalSlides === 0 ? (
              <div className="no-events" style={{ padding: '60px 20px', textAlign: 'center' }}>
                <p>No classes scheduled for today.</p>
              </div>
            ) : (
              <>
                <div className="airport-board-header">
                  <span className="ap-col-time">TIME</span>
                  <span className="ap-col-room">ROOM</span>
                  <span className="ap-col-subject">SUBJECT</span>
                  <span className="ap-col-prof">PROFESSOR</span>
                  <span className="ap-col-group">YEAR / GROUP</span>
                  <span className="ap-col-status">STATUS</span>
                </div>
                {(currentSlide ? currentSlide.evts : [])
                  .slice()
                  .sort((a, b) => (a.room || '').localeCompare(b.room || ''))
                  .map((ev, idx) => {
                    const statusText = getStatusText(ev)
                    const isNowRow = statusText === 'NOW'
                    return (
                      <div key={idx} className={'airport-board-row' + (isNowRow ? ' row-now' : '')}
                        style={{ borderLeftColor: ev.color || '#0066cc' }}>
                        <span className="ap-col-time">
                          {formatTime(ev.start)}
                          {ev.end && <small>–{formatTime(ev.end)}</small>}
                        </span>
                        <span className="ap-col-room">{ev.room || parseRoomFromLocation(ev.location) || '–'}</span>
                        <span className="ap-col-subject">{ev.display_title || ev.title || '–'}</span>
                        <span className="ap-col-prof">{ev.professor || '–'}</span>
                        <span className="ap-col-group">
                          {ev.group_display ||
                            parseGroupFromString(
                              (calendarsMap[ev.source] && calendarsMap[ev.source].name) ||
                              ev.calendar_name || ev.subject || ev.title
                            ) || '–'}
                        </span>
                        <span className={'ap-col-status' + (isNowRow ? ' status-now' : '')}>{statusText}</span>
                      </div>
                    )
                  })}
              </>
            )}
          </div>

          {/* Tomorrow strip — compact, non-rotating */}
          {filteredEvents.filter(ev => ev.start && ev.start.startsWith(tomorrow)).length > 0 && (
            <details className="tomorrow-strip">
              <summary>Tomorrow ({tomorrow}) — {filteredEvents.filter(ev => ev.start && ev.start.startsWith(tomorrow)).length} events</summary>
              <div className="airport-board" style={{ marginTop: 0 }}>
                <div className="airport-board-header">
                  <span className="ap-col-time">TIME</span>
                  <span className="ap-col-room">ROOM</span>
                  <span className="ap-col-subject">SUBJECT</span>
                  <span className="ap-col-prof">PROFESSOR</span>
                  <span className="ap-col-group">YEAR / GROUP</span>
                  <span className="ap-col-status"></span>
                </div>
                {filteredEvents
                  .filter(ev => ev.start && ev.start.startsWith(tomorrow))
                  .slice()
                  .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
                  .slice(0, 30)
                  .map((ev, idx) => (
                    <div key={idx} className="airport-board-row"
                      style={{ borderLeftColor: ev.color || '#0066cc' }}>
                      <span className="ap-col-time">{formatTime(ev.start)}{ev.end && <small>–{formatTime(ev.end)}</small>}</span>
                      <span className="ap-col-room">{ev.room || parseRoomFromLocation(ev.location) || '–'}</span>
                      <span className="ap-col-subject">{ev.display_title || ev.title || '–'}</span>
                      <span className="ap-col-prof">{ev.professor || '–'}</span>
                      <span className="ap-col-group">
                        {ev.group_display ||
                          parseGroupFromString(
                            (calendarsMap[ev.source] && calendarsMap[ev.source].name) ||
                            ev.calendar_name || ev.subject || ev.title
                          ) || '–'}
                      </span>
                      <span className="ap-col-status"></span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
      )}

      {lastUpdate && (
        <div className="status-bar">
          <span>Last update: {lastUpdate.toLocaleTimeString('en-GB')}</span>
        </div>
      )}
    </div>
  )
}
