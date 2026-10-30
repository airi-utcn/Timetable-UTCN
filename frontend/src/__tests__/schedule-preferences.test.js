import {describe, it, expect} from 'vitest'
import {initialSchedule,scheduleLink,roomAvailability,freshness} from '../schedule-preferences'
const now = new Date('2026-10-30T10:00:00')
const cal = (room, status='success') => ({room,building:'Observator',enabled:1,freshness:{status,last_success:now.toISOString(),window:{from:'2026-10-01',to:'2027-06-01'}}})

describe('Shareable timetable', () => {
  it('restores filters, exact week and explicitly empty calendar selection', () => {
    const url = scheduleLink({filters:{subject:'A&B',professor:'',room:'301',group:''},search:'math',view:'calendar',offset:2,selected:[]}, 'https://example.org/', now)
    const restored = initialSchedule(url, now)
    expect(restored.filters.subject).toBe('A&B')
    expect(restored.offset).toBe(2)
    expect(restored.selected).toEqual([])
    expect(restored.search).toBe('math')
    expect(restored.view).toBe('calendar')
    expect(initialSchedule(url, new Date('2026-11-06T10:00:00')).offset).toBe(1)
  })
})
describe('Room availability', () => {
  const from='2026-10-30T10:00:00', to='2026-10-30T11:00:00'
  it('never declares failed, stale, unchecked or uncovered calendars free', () => {
    const stale = cal('2'); stale.freshness.last_success = '2026-10-29T10:00:00Z'
    const uncovered = cal('4'); uncovered.freshness.window.to = '2026-10-29'
    const rooms = roomAvailability({a:cal('1','failed'),b:stale,c:{room:'3',building:'Observator'},d:uncovered},[],from,to,now)
    expect(rooms.map(r=>r.status)).toEqual(['unknown','unknown','unknown','unknown'])
  })
  it('merges calendar sources of the same room and detects interval overlap', () => {
    const events = [{source:'second', start:'2026-10-30T10:30:00',end:'2026-10-30T12:00:00'}]
    const result = roomAvailability({first:cal('1'),second:cal('1'),other:cal('2')},events,from,to,now)
    expect(result.map(r=>r.status)).toEqual(['busy','free'])
  })
  it('requires all sources of a room to have current data', () => {
    expect(roomAvailability({a:cal('1'),b:cal('1','failed')},[],from,to,now)[0].status).toBe('unknown')
  })
  it('treats events ending at the start as non-overlapping', () => {
    expect(roomAvailability({a:cal('1')},[{source:'a',start:'2026-10-30T09:00:00',end:from}],from,to,now)[0].status).toBe('free')
  })
  it('treats malformed event times as busy and invalid intervals as invalid', () => {
    expect(roomAvailability({a:cal('1')},[{source:'a',start:from}],from,to,now)[0].status).toBe('busy')
    expect(roomAvailability({a:cal('1')},[],to,from,now)).toEqual([])
  })
  it('marks timestamps in the future as unverified', () => {
    const c = cal('1'); c.freshness.last_success = '2099-01-01T00:00:00Z'
    expect(freshness(c,now).key).toBe('stale')
  })
})
