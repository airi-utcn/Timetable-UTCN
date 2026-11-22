import React from 'react'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act
} from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import RoomAvailability from '../RoomAvailability'
import { roomAvailability } from '../schedule-preferences'
const now = new Date('2026-11-17T10:00:00')
const from = '2026-11-17T10:00',
  until = '2026-11-17T11:00'
const calendar = (room = '40', extra = {}) => ({
  room,
  building: 'Baritiu',
  enabled: 1,
  freshness: {
    status: 'success',
    last_success: now.toISOString(),
    window: { from: '2026-11-01', to: '2027-06-01' }
  },
  ...extra
})
const event = (start, end, extra = {}) => ({
  source: 'a',
  start,
  end,
  ...extra
})
const data = () => ({
  calendars: {
    a: calendar('40'),
    b: calendar('41'),
    c: calendar('42', {
      freshness: {
        status: 'failed',
        last_success: now.toISOString(),
        window: { from: '2026-11-01', to: '2027-06-01' }
      }
    }),
    d: calendar('43', { building: 'Observator' }),
    e: calendar('44', { freshness: {} })
  },
  events: [event('2026-11-17T10:30:00', '2026-11-17T12:00:00')]
})
const response = (body) => ({ ok: true, json: async () => body })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => (resolve = done))
  return { promise, resolve }
}
function open(favorites = []) {
  const view = render(<RoomAvailability favorites={favorites} />)
  view.container.querySelector('details').open = true
  return view
}
const check = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'Check rooms', exact: true })
  )
const ready = () =>
  waitFor(() => expect(document.querySelector('.room-results')).not.toBeNull())
const resultText = () =>
  document.querySelector('.room-results')?.textContent || ''
beforeEach(() => {
  vi.setSystemTime(now)
  global.fetch = vi.fn(async () => response(data()))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Availability interval logic', () => {
  it.each([
    [
      'ends at interval start',
      '2026-11-17T09:00:00',
      '2026-11-17T10:00:00',
      'free'
    ],
    [
      'starts at interval end',
      '2026-11-17T11:00:00',
      '2026-11-17T12:00:00',
      'free'
    ],
    [
      'overlaps interval start',
      '2026-11-17T09:30:00',
      '2026-11-17T10:30:00',
      'busy'
    ],
    [
      'overlaps interval end',
      '2026-11-17T10:30:00',
      '2026-11-17T12:00:00',
      'busy'
    ],
    ['contains interval', '2026-11-17T09:00:00', '2026-11-17T12:00:00', 'busy'],
    [
      'is inside interval',
      '2026-11-17T10:15:00',
      '2026-11-17T10:45:00',
      'busy'
    ],
    ['matches interval', '2026-11-17T10:00:00', '2026-11-17T11:00:00', 'busy'],
    [
      'is entirely earlier',
      '2026-11-17T08:00:00',
      '2026-11-17T09:00:00',
      'free'
    ],
    ['is entirely later', '2026-11-17T12:00:00', '2026-11-17T13:00:00', 'free']
  ])('%s', (_, start, end, status) =>
    expect(
      roomAvailability(
        { a: calendar() },
        [event(start, end)],
        from,
        until,
        now
      )[0].status
    ).toBe(status)
  )
  it.each([
    ['null end', from, null],
    ['null times', null, null],
    ['missing end', from, undefined],
    ['reversed times', '2026-11-17T12:00', '2026-11-17T09:00'],
    ['zero duration', '2026-11-17T09:00', '2026-11-17T09:00'],
    ['invalid start', 'bad', until]
  ])('never declares a room free with %s', (_, start, end) =>
    expect(
      roomAvailability(
        { a: calendar() },
        [event(start, end)],
        from,
        until,
        now
      )[0].status
    ).not.toBe('free')
  )
  it.each(['failed', 'unchecked', 'stale', 'uncovered', 'future'])(
    'does not verify availability for a %s import',
    (kind) => {
      const c = calendar()
      if (kind === 'failed') c.freshness.status = 'failed'
      if (kind === 'unchecked') c.freshness = {}
      if (kind === 'stale')
        c.freshness.last_success = new Date(+now - 7200001).toISOString()
      if (kind === 'future')
        c.freshness.last_success = new Date(+now + 60000).toISOString()
      if (kind === 'uncovered') c.freshness.window.to = '2026-11-16'
      expect(roomAvailability({ a: c }, [], from, until, now)[0].status).toBe(
        'unknown'
      )
    }
  )
  it('excludes disabled calendars and incomplete room metadata', () =>
    expect(
      roomAvailability(
        {
          a: calendar('40', { enabled: 0 }),
          b: calendar('', {}),
          c: calendar('42', { building: '' })
        },
        [],
        from,
        until,
        now
      )
    ).toEqual([]))
  it('merges sources of the same room and requires all sources to be verified', () => {
    expect(
      roomAvailability(
        { a: calendar(), b: calendar() },
        [event(from, until, { source: 'b' })],
        from,
        until,
        now
      )
    ).toHaveLength(1)
    expect(
      roomAvailability(
        { a: calendar(), b: calendar('40', { freshness: {} }) },
        [],
        from,
        until,
        now
      )[0].status
    ).toBe('unknown')
  })
  it('keeps identical room numbers in different buildings separate and respects metadata matching', () => {
    const result = roomAvailability(
      { a: calendar(), b: calendar('40', { building: 'Observator' }) },
      [
        event(from, until, {
          source: 'manual',
          room: '40',
          building: 'Observator'
        })
      ],
      from,
      until,
      now
    )
    expect(result.map((r) => [r.building, r.status])).toEqual([
      ['Baritiu', 'free'],
      ['Observator', 'busy']
    ])
  })
  it('includes an overlapping event crossing midnight', () =>
    expect(
      roomAvailability(
        { a: calendar() },
        [event('2026-11-16T23:30', '2026-11-17T00:30')],
        '2026-11-17T00:00',
        '2026-11-17T01:00',
        now
      )[0].status
    ).toBe('busy'))
  it('compares explicit UTC timestamps against Romanian local time', () =>
    expect(
      roomAvailability(
        { a: calendar() },
        [event('2026-11-17T08:30:00Z', '2026-11-17T09:30:00Z')],
        '2026-11-17T10:00:00+02:00',
        '2026-11-17T11:00:00+02:00',
        now
      )[0].status
    ).toBe('busy'))
  it('covers the Romanian daylight-saving transition without losing calendar dates', () => {
    const c = calendar()
    c.freshness.last_success = '2026-10-25T00:00:00Z'
    c.freshness.window.from = '2026-10-01'
    expect(
      roomAvailability(
        { a: c },
        [event('2026-10-25T02:30:00+03:00', '2026-10-25T04:00:00+02:00')],
        '2026-10-25T03:15:00+03:00',
        '2026-10-25T03:45:00+03:00',
        new Date('2026-10-25T00:30:00Z')
      )[0].status
    ).toBe('busy')
  })
  it('sorts room numbers naturally', () =>
    expect(
      roomAvailability(
        { a: calendar('10'), b: calendar('2'), c: calendar('1') },
        [],
        from,
        until,
        now
      ).map((r) => r.room)
    ).toEqual(['1', '2', '10']))
})

describe('Available rooms UI', () => {
  it('fetches the requested local dates and separates free, occupied and unknown results', async () => {
    open()
    check()
    await ready()
    expect(global.fetch.mock.calls[0][0]).toBe(
      '/availability-data.json?from=2026-11-17&to=2026-11-17'
    )
    expect(resultText()).toContain('41')
    expect(resultText()).not.toContain('40')
    fireEvent.change(screen.getByRole('combobox', { name: /Availability/ }), {
      target: { value: 'busy' }
    })
    expect(resultText()).toContain('40')
    expect(resultText()).toContain('Occupied')
    fireEvent.change(screen.getByRole('combobox', { name: /Availability/ }), {
      target: { value: 'unknown' }
    })
    expect(resultText()).toContain('42')
    expect(resultText()).toContain('44')
    expect(resultText()).not.toContain('Verified free')
    expect(screen.getByText(/This does not reserve a room/)).toBeTruthy()
  })
  it('combines building, status and favorite filters without refetching', async () => {
    open(['b'])
    check()
    await screen.findByText('2 free · 2 unknown')
    fireEvent.click(screen.getByLabelText('Favorite rooms only'))
    expect(resultText()).toContain('41')
    expect(resultText()).not.toContain('43')
    fireEvent.change(screen.getByRole('combobox', { name: /Building/ }), {
      target: { value: 'Observator' }
    })
    expect(screen.getByText(/No matching rooms/)).toBeTruthy()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
  it('shows a clear empty result when no room can be assessed', async () => {
    global.fetch = vi.fn(async () => response({ events: [], calendars: {} }))
    open()
    check()
    await screen.findByText(/No matching rooms/)
    expect(screen.queryByText('Verified free')).toBeNull()
  })
  it.each([
    ['end before start', '2026-11-17T09:00'],
    ['equal times', from],
    ['more than seven days', '2026-11-25T11:00']
  ])('rejects %s without a request', async (_, end) => {
    open()
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: end } })
    check()
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Choose an end after the start, within seven days.'
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('queries both dates for a time interval crossing midnight', async () => {
    open()
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-11-17T23:30' }
    })
    fireEvent.change(screen.getByLabelText('Until'), {
      target: { value: '2026-11-18T00:30' }
    })
    check()
    await ready()
    expect(global.fetch.mock.calls[0][0]).toContain(
      'from=2026-11-17&to=2026-11-18'
    )
  })
  it('Now next hour resets both inputs and checks exactly once', async () => {
    open()
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-11-16T08:00' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Now · next hour' }))
    await ready()
    expect(screen.getByLabelText('From').value).toBe(from)
    expect(screen.getByLabelText('Until').value).toBe(until)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['HTTP 503', () => Promise.resolve({ ok: false, status: 503 })],
    ['network failure', () => Promise.reject(new Error('Network unavailable'))],
    [
      'invalid JSON',
      () =>
        Promise.resolve({
          ok: true,
          json: async () => {
            throw new Error('Invalid JSON')
          }
        })
    ]
  ])('shows %s without claiming rooms are free', async (_, fetch) => {
    global.fetch = vi.fn(fetch)
    open()
    check()
    await screen.findByRole('alert')
    expect(screen.queryByText('Verified free')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check rooms' }).disabled).toBe(
      false
    )
  })
  it.each([
    null,
    { events: [], calendars: [] },
    { events: null, calendars: {} },
    { events: [], calendars: null },
    { events: [], calendars: { a: null } },
    { events: [], calendars: { a: [] } },
    { events: [[]], calendars: { a: calendar() } },
    { events: [null], calendars: { a: calendar() } }
  ])('rejects malformed availability payload %#', async (body) => {
    global.fetch = vi.fn(async () => response(body))
    open()
    check()
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Incomplete availability data.'
    )
    expect(screen.queryByText('Verified free')).toBeNull()
  })
  it('clears previous results while retrying and recovers after a failed request', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response(data()))
    open()
    check()
    await screen.findByRole('alert')
    check()
    await ready()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('aborts superseded requests and ignores a late response after the interval changes', async () => {
    const old = deferred()
    global.fetch = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce(response(data()))
    open()
    check()
    const signal = global.fetch.mock.calls[0][1].signal
    fireEvent.change(screen.getByLabelText('Until'), {
      target: { value: '2026-11-17T11:30' }
    })
    expect(signal.aborted).toBe(true)
    check()
    await ready()
    await act(async () =>
      old.resolve(
        response({ calendars: { x: calendar('STALE-ROOM') }, events: [] })
      )
    )
    expect(resultText()).not.toContain('STALE-ROOM')
  })
  it('aborts a pending request when unmounted', () => {
    const pending = deferred()
    global.fetch = vi.fn(() => pending.promise)
    const view = open()
    check()
    const signal = global.fetch.mock.calls[0][1].signal
    view.unmount()
    expect(signal.aborted).toBe(true)
  })
  it('invalidates results immediately when the selected interval changes', async () => {
    open()
    check()
    await ready()
    fireEvent.change(screen.getByLabelText('Until'), {
      target: { value: '2026-11-17T12:00' }
    })
    expect(document.querySelector('.room-results')).toBeNull()
  })
})
