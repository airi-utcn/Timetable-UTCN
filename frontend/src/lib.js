// Shared helpers for the UTCN Timetable frontend.
// Pure functions only — safe to import from any component or test.

export const CANONICAL_BUILDINGS = [
  'Rectorat', 'HUB Cluj', 'BT Electro Cluj', 'Daicoviciu Cluj',
  'Baritiu Electro Cluj', 'Baritiu Constructii Cluj', 'Dorobantilor DECIDFR CLUJ',
  'OBSERVATOR CONSTRUCTII CLUJ', 'OBSERVATOR ELECTRO CLUJ', '21 DECEMBRIE INSTALATII CLUJ',
  'MUNCII CLUJ', 'CUNBM VICTORIEI', 'CUNBM BABES', 'UTCN AIRI',
]

export const BUILDING_NAMES = {
  'CUNBM VICTORIEI': 'CUNBM VICTORIEI (Baia Mare)',
  'CUNBM BABES': 'CUNBM BABES (Baia Mare)',
}

export function buildingLabel(b) {
  return BUILDING_NAMES[b] || b
}

export function inferBuildingFromLocation(loc) {
  if (!loc) return ''
  const l = loc.toLowerCase()

  // BT as standalone token or prefix: BT101, BT-101, B.T. 12 …
  if (/(^|[^a-z0-9])b[\W_]*t(?=[^a-z]|$)/.test(l)) return 'BT Electro Cluj'
  if (/\bac\s*bar\b/.test(l) || /acbar/.test(l) || /\bie\s*bar\b/.test(l) || /iebar/.test(l) || /\bett?ti\s*bar\b/.test(l) || /etti?bar/.test(l)) return 'Baritiu Electro Cluj'
  if (/\bconstruct/i.test(l) || (/\bcons\b/.test(l) && (/\bbar\b/.test(l) || /\bbaritiu\b/.test(l)))) return 'Baritiu Constructii Cluj'
  if (l.indexOf('baritiu') !== -1 && !l.match(/electro|construct/i) && !l.match(/bt|ac|cons/i)) return ''

  const mapping = [
    { keys: ['rectorat'], val: 'Rectorat' },
    { keys: ['hub cluj', 'hub'], val: 'HUB Cluj' },
    { keys: ['bt electro cluj', 'bt electro'], val: 'BT Electro Cluj' },
    { keys: ['daicoviciu cluj', 'daicoviciu', 'daic'], val: 'Daicoviciu Cluj' },
    { keys: ['baritiu electro cluj', 'baritiu electro'], val: 'Baritiu Electro Cluj' },
    { keys: ['baritiu constructii cluj', 'baritiu constructii'], val: 'Baritiu Constructii Cluj' },
    { keys: ['dorobantilor decidfr cluj', 'decidfr', 'doroban'], val: 'Dorobantilor DECIDFR CLUJ' },
    { keys: ['observator constructii cluj', 'observator constructii'], val: 'OBSERVATOR CONSTRUCTII CLUJ' },
    { keys: ['observator electro cluj', 'observator electro', 'observator'], val: 'OBSERVATOR ELECTRO CLUJ' },
    { keys: ['21 decembrie instalatii cluj', '21 decembrie', 'decembrie instalatii'], val: '21 DECEMBRIE INSTALATII CLUJ' },
    { keys: ['muncii cluj', 'muncii'], val: 'MUNCII CLUJ' },
    { keys: ['cunbm victoriei', 'victoriei'], val: 'CUNBM VICTORIEI' },
    { keys: ['cunbm babes', 'babes'], val: 'CUNBM BABES' },
    { keys: ['utcn airi', 'airi'], val: 'UTCN AIRI' },
  ]
  for (const m of mapping) {
    for (const k of m.keys) {
      if (k && l.indexOf(k) !== -1) return m.val
    }
  }
  return ''
}

export function normalizeBuilding(raw, loc) {
  if (!raw && !loc) return ''
  const r = (raw || '').toString().trim()
  const rl = r.toLowerCase()
  const ll = (loc || '').toString().toLowerCase()

  if (/(^|[^a-z0-9])b[\W_]*t(?=[^a-z]|$)/.test(ll)) return 'BT Electro Cluj'
  for (const c of CANONICAL_BUILDINGS) {
    if (r && rl.indexOf(c.toLowerCase()) !== -1) return c
  }
  if (rl.indexOf('baritiu') !== -1) {
    if (/\bac\b/.test(ll) || /\bie\b/.test(ll) || /\bett?ti\b/.test(ll) || ll.indexOf('electro') !== -1) return 'Baritiu Electro Cluj'
    if (ll.indexOf('construct') !== -1 || (ll.indexOf('cons') !== -1 && ll.indexOf('bar') !== -1)) return 'Baritiu Constructii Cluj'
    return 'Baritiu Electro Cluj'
  }
  const inferred = inferBuildingFromLocation(loc || '')
  if (CANONICAL_BUILDINGS.includes(inferred)) return inferred
  return ''
}

// ── Time / status helpers ────────────────────────────────────────────

export function formatHM(iso) {
  if (!iso) return '--:--'
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch (e) { return '--:--' }
}

export function localDateStr(d) {
  // YYYY-MM-DD in LOCAL time (toISOString would shift across midnight in UTC+2/3)
  const x = d instanceof Date ? d : new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Event status relative to `now`:
 *  ongoing  – started, not ended
 *  next     – starts within 30 minutes
 *  upcoming – starts later today/future
 *  finished – already ended
 */
export function eventStatus(ev, now = new Date()) {
  if (!ev || !ev.start) return { key: 'upcoming', text: '' }
  try {
    const s = new Date(ev.start)
    const e = ev.end ? new Date(ev.end) : null
    if (e && now > e) return { key: 'finished', text: 'Finished' }
    if (now >= s) return { key: 'ongoing', text: 'In progress' }
    const mins = Math.floor((s - now) / 60000)
    if (mins <= 30) return { key: 'next', text: mins <= 1 ? 'Starting now' : `in ${mins} min` }
    if (mins < 60) return { key: 'upcoming', text: `in ${mins} min` }
    const h = Math.floor(mins / 60)
    if (h < 24) return { key: 'upcoming', text: `in ${h}h ${mins % 60}m` }
    return { key: 'upcoming', text: '' }
  } catch (e) {
    return { key: 'upcoming', text: '' }
  }
}

// ── Activity type ────────────────────────────────────────────────────

const TYPE_SYNONYMS = {
  exam: 'exam', examen: 'exam', colocviu: 'exam', midterm: 'exam',
  lecture: 'lecture', curs: 'lecture', course: 'lecture',
  laboratory: 'laboratory', lab: 'laboratory', laborator: 'laboratory', practice: 'laboratory',
  seminar: 'seminar',
  project: 'project', proiect: 'project',
}

export function activityType(ev) {
  if (!ev) return ''
  if (ev.activity_type && TYPE_SYNONYMS[ev.activity_type]) return TYPE_SYNONYMS[ev.activity_type]
  const t = ((ev.display_title || ev.title || '') + '').toLowerCase()
  const m = t.match(/\((exam|examen|colocviu|lecture|curs|course|laboratory|lab|laborator|seminar|project|proiect|practice)\)/)
  if (m) return TYPE_SYNONYMS[m[1]] || ''
  return ''
}

export const TYPE_LABELS = {
  exam: 'Exam', lecture: 'Lecture', laboratory: 'Laboratory',
  seminar: 'Seminar', project: 'Project',
}

export function typeChipClass(type) {
  return type && TYPE_LABELS[type] ? `chip chip-${type}` : 'chip chip-other'
}

// ── Legacy text fallbacks (older data without structured fields) ─────

export function parseRoomFromLocation(loc) {
  if (!loc) return ''
  try {
    const sala = /Sala\s*([A-Za-z0-9\-\. ]+?)(?:\s*[;(]|$)/i.exec(loc)
    if (sala && sala[1]) return sala[1].trim()
    const nums = loc.match(/(\d+)/g)
    if (nums && nums.length) return nums[nums.length - 1]
  } catch (e) {}
  return ''
}

export function parseGroupFromString(s) {
  if (!s) return ''
  try {
    const l = s.toString().toLowerCase()
    let year = null
    let grp = null
    let m = l.match(/\ban(?:ul)?\s*(?:[:\-]?\s*)?(\d)\b/) || l.match(/\byear\s*(\d)\b/) || l.match(/\b(\d)(?:st|nd|rd|th)\s+year\b/)
    if (m) year = m[1]
    m = l.match(/\bseri[ae]\s*([a-z0-9]+)\b/) || l.match(/\bgrup[ai]\s*([a-z0-9]+)\b/) || l.match(/\bgroup\s*([a-z0-9]+)\b/)
    if (m) grp = m[1].toUpperCase()
    if (!grp) {
      m = l.match(/\byear\s*\/\s*(\d{4,6})\b/) || l.match(/[\s/](\d{5})\b/)
      if (m) grp = m[1]
    }
    if (year && grp) return `Year ${year} • ${grp}`
    if (year) return `Year ${year}`
    if (grp) return `Group ${grp}`
  } catch (e) {}
  return ''
}

export function groupDisplay(ev, calendars = {}) {
  if (ev.year && ev.group) return `Year ${ev.year} • ${ev.group}`
  if (ev.year) return `Year ${ev.year}`
  if (ev.group) return `Group ${ev.group}`
  if (ev.group_display) return ev.group_display
  const calName = (calendars[ev.source] && calendars[ev.source].name) || ev.calendar_name || ''
  return parseGroupFromString(calName || ev.subject || ev.title) || ''
}

export function roomDisplay(ev) {
  return ev.room || parseRoomFromLocation(ev.location) || '—'
}
