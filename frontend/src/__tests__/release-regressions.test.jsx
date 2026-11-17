import React from 'react'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Schedule from '../Schedule'
import { initialSchedule } from '../schedule-preferences'

const now = new Date('2026-11-16T12:00:00')
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.setSystemTime(now)
  global.fetch = vi.fn((url) =>
    Promise.resolve({
      ok: true,
      json: async () => (String(url).includes('/calendars.json') ? {} : [])
    })
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('Release date regressions', () => {
  it('keeps the selected day inside a legacy shared week', () => {
    const result = initialSchedule(
      'https://example.org/?view=week&week=2026-11-23',
      now
    )
    expect(result.day).toBe('2026-11-23')
    expect(result.offset).toBe(1)
  })
  it('derives the week from a date-only link', () => {
    const result = initialSchedule('https://example.org/?date=2026-11-24', now)
    expect(result.day).toBe('2026-11-24')
    expect(result.offset).toBe(1)
  })
  it('rejects impossible calendar dates instead of silently rolling into March', () => {
    expect(
      initialSchedule('https://example.org/?date=2026-02-31', now).day
    ).toBe('2026-11-16')
  })
  it('keeps Day on the shared week when switching from Week', async () => {
    window.history.replaceState({}, '', '/?view=week&week=2026-11-23')
    render(<Schedule />)
    fireEvent.click(screen.getByRole('button', { name: 'Day', exact: true }))
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([url]) =>
          String(url).includes('from=2026-11-23&to=2026-11-23')
        )
      ).toBe(true)
    )
  })
  it('advances a current daily agenda at midnight without moving a historical selection', async () => {
    window.history.replaceState({}, '', '/?view=day')
    render(<Schedule />)
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([url]) =>
          String(url).includes('from=2026-11-16&to=2026-11-16')
        )
      ).toBe(true)
    )
    vi.setSystemTime(new Date('2026-11-17T00:00:01'))
    await act(async () => {
      fireEvent(window, new Event('midnight'))
    })
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([url]) =>
          String(url).includes('from=2026-11-17&to=2026-11-17')
        )
      ).toBe(true)
    )
    cleanup()
    window.history.replaceState({}, '', '/?view=day&date=2026-11-01')
    render(<Schedule />)
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([url]) =>
          String(url).includes('from=2026-11-01&to=2026-11-01')
        )
      ).toBe(true)
    )
    vi.setSystemTime(new Date('2026-11-18T00:00:01'))
    await act(async () => {
      fireEvent(window, new Event('midnight'))
    })
    expect(
      screen.getByRole('heading', { name: '1 November 2026' })
    ).toBeTruthy()
  })
})
