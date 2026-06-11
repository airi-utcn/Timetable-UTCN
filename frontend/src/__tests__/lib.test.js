import { describe, it, expect } from 'vitest'
import {
  eventStatus, activityType, groupDisplay, roomDisplay,
  normalizeBuilding, formatHM, localDateStr, progressPct, displayCalendarName,
} from '../lib'

describe('eventStatus', () => {
  const now = new Date('2026-06-11T10:00:00')

  it('ongoing when between start and end', () => {
    const st = eventStatus({ start: '2026-06-11T09:00:00', end: '2026-06-11T11:00:00' }, now)
    expect(st.key).toBe('ongoing')
  })

  it('next when starting within 30 minutes', () => {
    const st = eventStatus({ start: '2026-06-11T10:20:00', end: '2026-06-11T12:00:00' }, now)
    expect(st.key).toBe('next')
  })

  it('upcoming when starting later', () => {
    const st = eventStatus({ start: '2026-06-11T14:00:00', end: '2026-06-11T16:00:00' }, now)
    expect(st.key).toBe('upcoming')
  })

  it('finished when ended', () => {
    const st = eventStatus({ start: '2026-06-11T07:00:00', end: '2026-06-11T09:00:00' }, now)
    expect(st.key).toBe('finished')
  })

  it('handles missing data without crashing', () => {
    expect(eventStatus(null, now).key).toBe('upcoming')
    expect(eventStatus({}, now).key).toBe('upcoming')
    expect(eventStatus({ start: 'garbage' }, now)).toBeTruthy()
  })
})

describe('progressPct', () => {
  it('returns elapsed percentage only while an event is ongoing', () => {
    const ev = { start: '2026-06-11T09:00:00', end: '2026-06-11T11:00:00' }
    expect(progressPct(ev, new Date('2026-06-11T10:00:00'))).toBe(50)
    expect(progressPct(ev, new Date('2026-06-11T08:59:00'))).toBe(null)
    expect(progressPct(ev, new Date('2026-06-11T11:01:00'))).toBe(null)
  })
})

describe('activityType', () => {
  it('uses structured field first', () => {
    expect(activityType({ activity_type: 'laboratory' })).toBe('laboratory')
  })
  it('normalizes Romanian synonyms', () => {
    expect(activityType({ activity_type: 'laborator' })).toBe('laboratory')
    expect(activityType({ activity_type: 'examen' })).toBe('exam')
  })
  it('falls back to title parsing', () => {
    expect(activityType({ title: 'Algorithms (laboratory) 2nd year' })).toBe('laboratory')
    expect(activityType({ title: 'AI (curs) an 3' })).toBe('lecture')
  })
  it('returns empty for unknown', () => {
    expect(activityType({ title: 'Random meeting' })).toBe('')
    expect(activityType(null)).toBe('')
  })
})

describe('displayCalendarName', () => {
  it('removes faculty-specific shorthand from user-facing names', () => {
    const mark = ['A', 'C'].join('')
    expect(displayCalendarName(`UTCN - ${mark} Bar - Sala 40`)).toBe('UTCN - Baritiu - Sala 40')
    expect(displayCalendarName(`${mark} - Year 3 - CTI English`)).toBe('UTCN - Year 3 - CTI English')
  })
})

describe('groupDisplay / roomDisplay', () => {
  it('prefers structured year+group', () => {
    expect(groupDisplay({ year: '2', group: '30221' })).toBe('Year 2 • 30221')
    expect(groupDisplay({ year: '3' })).toBe('Year 3')
  })
  it('falls back to calendar name parsing', () => {
    const out = groupDisplay({ source: 'h1', title: 'x' }, { h1: { name: 'UTCN year 3 grupa B' } })
    expect(out).toContain('3')
  })
  it('roomDisplay uses room, then location, then dash', () => {
    expect(roomDisplay({ room: '40' })).toBe('40')
    expect(roomDisplay({ location: 'UTCN - Baritiu - Sala 26B' })).toBe('26B')
    expect(roomDisplay({})).toBe('—')
  })
})

describe('normalizeBuilding', () => {
  it('detects BT from room hints', () => {
    expect(normalizeBuilding('Baritiu', 'BT101')).toBe('BT Electro Cluj')
  })
  it('maps Baritiu Electro location text', () => {
    expect(normalizeBuilding('', 'UTCN - Baritiu Electro - Sala 40')).toBe('Baritiu Electro Cluj')
  })
  it('returns empty for unknown', () => {
    expect(normalizeBuilding('', '')).toBe('')
  })
})

describe('time formatting', () => {
  it('formatHM formats and tolerates bad input', () => {
    expect(formatHM('2026-06-11T08:05:00')).toBe('08:05')
    expect(formatHM(null)).toBe('--:--')
  })
  it('localDateStr uses local calendar date', () => {
    expect(localDateStr(new Date(2026, 5, 11, 0, 30))).toBe('2026-06-11')
  })
})
