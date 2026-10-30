import React, {useState, useEffect, useRef} from 'react'
import {roomAvailability} from './schedule-preferences'

const localTime = date => {
  const d = new Date(date - date.getTimezoneOffset() * 60000)
  return d.toISOString().slice(0,16)
}
export default function RoomAvailability() {
  const [start,setStart] = useState(() => localTime(new Date()))
  const [end,setEnd] = useState(() => localTime(new Date(Date.now() + 3600000)))
  const [results,setResults] = useState(null)
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(false)
  const [building,setBuilding] = useState('')
  const [status,setStatus] = useState('free')
  const request = useRef(null)
  useEffect(() => () => request.current?.abort(), [])
  const check = async (from = start, to = end) => {
    request.current?.abort()
    setResults(null)
    setError('')
    const a = new Date(from), b = new Date(to)
    if (!Number.isFinite(+a) || !Number.isFinite(+b) || b <= a || b - a > 7 * 86400000) {
      setLoading(false); setError('Choose an end after the start, within seven days.'); return
    }
    const ctrl = new AbortController()
    request.current = ctrl
    setLoading(true)
    try {
      const params = new URLSearchParams({from:from.slice(0,10),to:to.slice(0,10)})
      const res = await fetch('/availability-data.json?' + params, {signal:ctrl.signal})
      if (!res.ok) throw new Error('Availability unavailable. Please try again later.')
      const data = await res.json()
      if (!Array.isArray(data.events) || !data.calendars || typeof data.calendars !== 'object') throw new Error('Incomplete availability data.')
      if (!ctrl.signal.aborted) setResults(roomAvailability(data.calendars, data.events, from, to))
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e.message)
    } finally { if (!ctrl.signal.aborted) setLoading(false) }
  }
  const change = setter => e => {
    request.current?.abort(); setLoading(false); setResults(null); setter(e.target.value)
  }
  const buildings = [...new Set((results || []).map(r => r.building))]
  const visible = (results || []).filter(r => (!building || r.building === building) && (!status || r.status === status))
  return <details className="panel availability-panel">
    <summary>Find available rooms</summary>
    <p>Based on published calendars. Failed, unchecked or older-than-two-hours imports have unknown availability. This does not reserve a room.</p>
    <form className="availability-controls" onSubmit={e => {e.preventDefault(); check()}}>
      <label>From<input type="datetime-local" required value={start} onChange={change(setStart)} /></label>
      <label>Until<input type="datetime-local" required value={end} onChange={change(setEnd)} /></label>
      <button className="btn primary" disabled={loading}>Check rooms</button>
      <button type="button" className="btn ghost" disabled={loading} onClick={() => {
        const a = localTime(new Date()), b = localTime(new Date(Date.now()+3600000))
        setStart(a); setEnd(b); check(a,b)
      }}>Now · next hour</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Checking room availability…</p>}
    {results && <>
      <div className="availability-controls">
        <label>Building<select value={building} onChange={e => setBuilding(e.target.value)}><option value="">All buildings</option>{buildings.map(b => <option key={b}>{b}</option>)}</select></label>
        <label>Availability<select value={status} onChange={e => setStatus(e.target.value)}><option value="free">Free</option><option value="busy">Busy</option><option value="unknown">Unknown</option><option value="">All</option></select></label>
        <span>{results.filter(r => r.status === 'free').length} free · {results.filter(r => r.status === 'unknown').length} unknown</span>
      </div>
      <ul className="room-results">{visible.map(r => <li key={r.key}><strong>{r.room}</strong> · {r.building} <span className={'data-state '+r.status}>{r.status}</span></li>)}</ul>
      {!visible.length && <p>No matching rooms. Calendars without building/room metadata cannot be assessed.</p>}
    </>}
  </details>
}
