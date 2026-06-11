import React from 'react'
import { render, waitFor, screen } from '@testing-library/react'
import TvBoard from '../TvBoard'
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'

const okJson = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) })

const todayAt = (h, m = 0) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}:00`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TvBoard empty state', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/events.json')) return okJson([])
      if (String(url).includes('/calendars.json')) return okJson({})
      return okJson({})
    })
  })

  it('renders Now/Next empty states without crashing', async () => {
    render(<TvBoard onExit={() => {}} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getByText(/No classes in progress/i)).toBeTruthy()
      expect(screen.getByText(/No more classes today/i)).toBeTruthy()
    })
  })
})

describe('TvBoard with data', () => {
  beforeEach(() => {
    const events = [
      {
        title: 'Algorithms (laboratory) 2nd year/30221 R. Potolea',
        display_title: 'Algorithms (Laboratory)',
        activity_type: 'laboratory',
        year: '2', group: '30221',
        professor: 'R. Potolea',
        room: '40',
        start: todayAt(0, 1),
        end: todayAt(23, 58),
        source: 'h1',
      },
      {
        title: 'AI (lecture) 3rd year A. Groza',
        display_title: 'Artificial Intelligence (Lecture)',
        activity_type: 'lecture',
        professor: 'A. Groza',
        room: 'P03',
        start: todayAt(23, 59),
        end: todayAt(23, 59),
        source: 'h2',
      },
    ]
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/events.json')) return okJson(events)
      if (String(url).includes('/calendars.json')) {
        return okJson({
          h1: { name: 'UTCN - AC Bar - Sala 40', room: '40' },
          h2: { name: 'UTCN - AC Bar - Sala P03', room: 'P03' },
        })
      }
      return okJson({})
    })
  })

  it('shows ongoing event in NOW with its room', async () => {
    render(<TvBoard onExit={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Algorithms (Laboratory)')).toBeTruthy()
      expect(screen.getByText('40')).toBeTruthy()
    })
  })

  it('handles partial events (missing professor/room) without crashing', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/events.json')) {
        return okJson([{ title: 'Mystery', start: todayAt(0, 1), end: todayAt(23, 58) }])
      }
      return okJson({})
    })
    render(<TvBoard onExit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Mystery')).toBeTruthy())
  })
})
