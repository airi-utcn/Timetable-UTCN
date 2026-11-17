import React from 'react'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup
} from '@testing-library/react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import App from '../App'
import Schedule from '../Schedule'
import RoomAvailability from '../RoomAvailability'
import { eventLanes, WeekGrid, agendaGaps } from '../CalendarViews'
import { eventStatus } from '../lib'
import { initialSchedule, scheduleLink } from '../schedule-preferences'

const event = (start, end, title = 'Algorithms', extra = {}) => ({
  start: `2026-11-16T${start}:00`,
  end: `2026-11-16T${end}:00`,
  title,
  source: 'a',
  room: '40',
  group: '30221',
  professor: 'A. Pop',
  ...extra
})
const events = [
  event('08:00', '10:00'),
  event('10:00', '12:00', 'Physics', { group: '30222' })
]
const calendars = {
  a: {
    name: 'Room 40',
    room: '40',
    building: 'Baritiu',
    enabled: 1,
    freshness: {
      last_success: '2026-11-16T07:30:00',
      status: 'success',
      window: { from: '2026-11-01', to: '2027-01-01' }
    }
  }
}
const json = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/?view=day&date=2026-11-16')
  vi.setSystemTime(new Date('2026-11-16T08:30:00'))
  global.fetch = vi.fn((url) =>
    String(url).includes('/calendars.json')
      ? json(calendars)
      : String(url).includes('/availability-data.json')
        ? json({ calendars, events })
        : json(events)
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.history.replaceState({}, '', '/')
})

describe('Timetable redesign workflows', () => {
  it('searches structured groups, preserves the date on refresh and opens full details', async () => {
    render(<Schedule />)
    await screen.findByRole('button', { name: /08:00.*Algorithms/ })
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '30221' }
    })
    expect(screen.queryByRole('button', { name: /10:00.*Physics/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /08:00.*Algorithms/ }))
    expect(screen.getByRole('dialog').textContent).toContain('A. Pop')
    expect(screen.getByRole('dialog').textContent).toContain(
      'Last successful import'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close class details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh timetable' }))
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.filter(([url]) =>
          String(url).includes('from=2026-11-16&to=2026-11-16')
        ).length
      ).toBeGreaterThan(1)
    )
  })
  it('keeps explicit empty dates and calendar selections without jumping', async () => {
    render(<Schedule />)
    await screen.findByRole('button', { name: /08:00.*Algorithms/ })
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([url]) =>
          String(url).includes('from=2026-11-17&to=2026-11-17')
        )
      ).toBe(true)
    )
    await screen.findByText('A little room in your day')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByText('Choose your calendars')).toBeTruthy()
  })
  it('retains timetable context when moving to Live and back', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /08:00.*Algorithms/ })
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '30221' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Live', exact: true }))
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Schedule', exact: true })
    )
    expect(screen.getByRole('searchbox').value).toBe('30221')
    expect(screen.queryByRole('button', { name: /10:00.*Physics/ })).toBeNull()
  })
  it('restores saved preferences but gives incoming links precedence', async () => {
    localStorage.setItem(
      'utcn-schedule-context',
      JSON.stringify({
        view: 'calendar',
        search: 'Algorithms',
        filters: { group: '30221' }
      })
    )
    window.history.replaceState({}, '', '/')
    const { unmount } = render(<Schedule />)
    expect(screen.getByRole('searchbox').value).toBe('Algorithms')
    expect(
      screen
        .getByRole('button', { name: 'Browse', exact: true })
        .getAttribute('aria-pressed')
    ).toBe('true')
    unmount()
    window.history.replaceState({}, '', '/?view=day&date=2026-11-16&q=Physics')
    render(<Schedule />)
    expect(screen.getByRole('searchbox').value).toBe('Physics')
    await screen.findByRole('button', { name: /10:00.*Physics/ })
  })
  it('distinguishes a server with no imported data from an empty date', async () => {
    global.fetch = vi.fn((url) =>
      String(url).includes('/calendars.json') ? json({}) : json([])
    )
    render(<Schedule />)
    await screen.findByText('No timetable data loaded yet')
    expect(screen.queryByText('A little room in your day')).toBeNull()
    expect(
      screen
        .getByRole('link', { name: 'Open timetable administration' })
        .getAttribute('href')
    ).toBe('/admin')
  })
  it('round-trips shared dates, searches, filters and empty calendar selections', () => {
    const now = new Date('2026-11-16T12:00:00')
    const url = scheduleLink(
      {
        filters: { subject: 'A&B' },
        search: '30221',
        view: 'day',
        offset: 1,
        day: '2026-11-24',
        selected: []
      },
      'https://example.com/',
      now
    )
    expect(initialSchedule(url, now)).toMatchObject({
      day: '2026-11-24',
      view: 'day',
      search: '30221',
      selected: [],
      offset: 1,
      filters: { subject: 'A&B' }
    })
  })
  it('distinguishes unknown availability from verified free rooms', async () => {
    global.fetch = vi.fn(() =>
      json({
        calendars: {
          ...calendars,
          b: { room: '42', building: 'Baritiu', enabled: 1 }
        },
        events: []
      })
    )
    render(<RoomAvailability favorites={['a']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check rooms' }))
    await screen.findByText('Verified free')
    fireEvent.change(screen.getByLabelText('Availability'), {
      target: { value: 'unknown' }
    })
    expect(screen.getByText('Availability unknown')).toBeTruthy()
    expect(screen.queryByText('Verified free')).toBeNull()
    expect(screen.getByText(/This does not reserve a room/)).toBeTruthy()
  })
})
describe('Weekly layout and time accuracy', () => {
  it('shows gaps only after fully known, non-overlapping classes', () => {
    expect(
      agendaGaps([
        event('08:00', '10:00'),
        event('09:00', '11:00'),
        event('12:00', '14:00')
      ])
    ).toEqual([0, 0, 60])
    expect(
      agendaGaps([
        event('08:00', '10:00', 'Unknown', { end: null }),
        event('12:00', '14:00')
      ])
    ).toEqual([0, 0])
  })
  it('assigns overlap lanes and resets separate clusters', () => {
    const groups = eventLanes([
      event('08:00', '10:00'),
      event('09:00', '11:00'),
      event('11:00', '12:00')
    ])
    expect(groups.map((g) => g.lanes)).toEqual([2, 1])
    expect(groups[0].items.map((i) => i.lane)).toEqual([0, 1])
  })
  it('discloses dense days without rendering hundreds of event blocks', () => {
    const onDay = vi.fn(),
      day = '2026-11-16',
      crowded = Array.from({ length: 100 }, (_, i) =>
        event('08:00', '10:00', 'Class ' + i)
      )
    const { container } = render(
      <WeekGrid
        days={[day]}
        grouped={{ [day]: crowded }}
        calendars={calendars}
        now={new Date()}
        onDay={onDay}
        onDetails={() => {}}
      />
    )
    expect(container.querySelectorAll('.week-event')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: /92 more classes/ }))
    expect(onDay).toHaveBeenCalledWith(day)
  })
  it('does not claim a class is live with an unknown end', () => {
    expect(
      eventStatus(
        { start: '2026-11-16T08:00:00' },
        new Date('2026-11-16T12:00:00')
      )
    ).toEqual({ key: 'upcoming', text: 'End time unknown' })
  })
})
