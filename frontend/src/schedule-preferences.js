import {localDateStr} from './lib'

export function loadLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
export function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Private browsing can disable storage. */ }
}
export function initialSchedule(url = window.location.href, now = new Date()) {
  const p = new URL(url).searchParams
  const selection = new URLSearchParams(new URL(url).hash.slice(1))
  const week = p.get('week')
  const monday = new Date(now)
  monday.setDate(now.getDate() - (now.getDay() + 6) % 7)
  monday.setHours(12,0,0,0)
  const target = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(week + 'T12:00:00') : monday
  const offset = Math.round((target - monday) / 604800000)
  const sourceParams = selection.has('sources') ? selection : p
  const selected = sourceParams.has('sources') ? sourceParams.get('sources').split(/[.,]/).filter(Boolean) : null
  return {
    filters: Object.fromEntries(['subject','professor','room','group'].map(k => [k, p.get(k) || ''])),
    search: p.get('q') || '',
    view: ['day','week','calendar'].includes(p.get('view')) ? p.get('view') : 'week',
    offset: Number.isFinite(offset) && Math.abs(offset) <= 520 ? offset : 0,
    selected,
  }
}
export function scheduleLink({filters, search, view, offset, selected}, base = window.location.href, now = new Date()) {
  const url = new URL(base)
  for (const key of ['subject','professor','room','group','q','view','week','sources']) url.searchParams.delete(key)
  for (const [key, value] of Object.entries(filters)) if (value) url.searchParams.set(key, value)
  if (search) url.searchParams.set('q', search)
  url.searchParams.set('view', view)
  const monday = new Date(now)
  monday.setDate(now.getDate() - (now.getDay() + 6) % 7 + offset * 7)
  url.searchParams.set('week', localDateStr(monday))
  // Calendar selections can exceed a server's request-line limit at 828 sources.
  // Keep them in the fragment: browsers restore it locally, never send it to Flask.
  url.hash = new URLSearchParams({sources:selected.join('.')}).toString()
  return url.toString()
}
export function freshness(info, now = new Date()) {
  const value = info?.freshness
  if (!value?.last_success) return {key:'unknown', text:'Not checked yet'}
  if (value.status === 'failed') return {key:'stale', text:'Previous data · last import failed'}
  const age = now - new Date(value.last_success)
  if (!Number.isFinite(age) || age < 0 || age > 2 * 3600000) return {key:'stale',text:'Data may be outdated'}
  return {key:'fresh',text:'Recently verified'}
}
export function roomAvailability(calendars, events, start, end, now = new Date()) {
  const from = new Date(start), to = new Date(end)
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || to <= from) return []
  const rooms = new Map()
  Object.entries(calendars).forEach(([source, cal]) => {
    if (cal.enabled === 0 || !cal.room || !cal.building) return
    const key = `${cal.building}\u0000${cal.room}`
    if (!rooms.has(key)) rooms.set(key, {key, building:cal.building, room:cal.room, sources:[], known:true})
    const item = rooms.get(key)
    item.sources.push(source)
    const window = cal.freshness?.window
    const covered = window?.from <= localDateStr(from) && window?.to >= localDateStr(to)
    item.known = item.known && covered && freshness(cal, now).key === 'fresh'
  })
  return [...rooms.values()].map(room => {
    const occupied = events.some(ev => {
      const sameRoom = itemRoom(ev, room)
      if (!sameRoom) return false
      const s = new Date(ev.start), e = new Date(ev.end)
      // Incomplete event times cannot safely establish a free room.
      return !Number.isFinite(+s) || !Number.isFinite(+e) || (s < to && e > from)
    })
    return {...room, status: !room.known ? 'unknown' : occupied ? 'busy' : 'free'}
  }).sort((a,b) => a.building.localeCompare(b.building) || a.room.localeCompare(b.room, undefined, {numeric:true}))
}
function itemRoom(ev, room) {
  return room.sources.includes(ev.source) || (String(ev.room || '').toLowerCase() === String(room.room).toLowerCase() && (!ev.building || ev.building === room.building))
}
