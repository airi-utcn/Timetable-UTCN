import React from 'react'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminWorkspace from '../AdminWorkspace'
const cal = {
  id: 1,
  name: 'Room 40',
  enabled: 1,
  url_link: 'https://example.org/calendar.ics',
  import_status: {
    status: 'failed',
    checked_at: '2026-11-17T08:00:00Z',
    last_success: '2026-11-16T08:00:00Z',
    error: 'HTTP 503'
  }
}
function props(extra = {}) {
  return {
    calendars: [cal],
    stats: { events_count: 12, last_import: null },
    query: '',
    setQuery: vi.fn(),
    statusFilter: 'all',
    setStatusFilter: vi.fn(),
    matching: [cal],
    currentPage: 0,
    pageCount: 1,
    setPage: vi.fn(),
    visibleCalendars: [cal],
    newCalendar: {
      url: 'https://example.org/calendar.ics',
      name: 'Room 40',
      color: '#a9261e'
    },
    setNewCalendar: vi.fn(),
    editingCalendar: null,
    setEditingCalendar: vi.fn(),
    message: null,
    warningInfo: null,
    sessionRemaining: 1000,
    extractorProgress: null,
    extractorRunning: false,
    importing: false,
    addCalendar: vi.fn(async () => true),
    importCalendar: vi.fn(),
    updateCalendar: vi.fn(),
    deleteCalendar: vi.fn(),
    uploadCSV: vi.fn(async () => true),
    extendSession: vi.fn(),
    ...extra
  }
}
afterEach(cleanup)
describe('Admin management workflows', () => {
  it('keeps failures visible and discloses secondary diagnostics and destructive actions', () => {
    render(<AdminWorkspace {...props()} />)
    expect(
      screen.getByText('Import failed · previous data retained')
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete calendar' })).toBeNull()
    const more = screen.getByRole('button', {
      name: 'More options for Room 40'
    })
    fireEvent.click(more)
    expect(screen.getByText('HTTP 503')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open ICS source' })).toBeTruthy()
    fireEvent.keyDown(screen.getByText('HTTP 503'), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Delete calendar' })).toBeNull()
    expect(document.activeElement).toBe(more)
  })
  it('keeps a rejected add form open and restores focus after cancellation', async () => {
    const p = props({ addCalendar: vi.fn(async () => false) })
    render(<AdminWorkspace {...p} />)
    const trigger = screen.getByRole('button', {
      name: 'Add calendar',
      exact: true
    })
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(
      screen.getByLabelText('Published Calendar URL')
    )
    fireEvent.submit(
      screen.getByRole('region', { name: 'Add calendar' }).querySelector('form')
    )
    await waitFor(() => expect(p.addCalendar).toHaveBeenCalledOnce())
    expect(screen.getByRole('region', { name: 'Add calendar' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region', { name: 'Add calendar' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('uses the selected CSV file and remains available after reopening', async () => {
    const p = props()
    render(<AdminWorkspace {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'CSV', exact: true }))
    const file = new File(
      ['name,url\nroom,https://example.org/calendar.ics'],
      'rooms.csv',
      { type: 'text/csv' }
    )
    fireEvent.change(screen.getByLabelText('Calendar inventory CSV'), {
      target: { files: [file] }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload CSV' }))
    await waitFor(() => expect(p.uploadCSV).toHaveBeenCalledWith(file))
    fireEvent.click(screen.getByRole('button', { name: 'Close CSV tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'CSV', exact: true }))
    expect(screen.getByRole('button', { name: 'Upload CSV' }).disabled).toBe(
      false
    )
  })
  it('distinguishes no configured calendars from no search matches and resets filtering', () => {
    const p = props({ matching: [], visibleCalendars: [], query: 'missing' })
    render(<AdminWorkspace {...p} />)
    expect(screen.getByText('No calendars match your search.')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset search and filter' })
    )
    expect(p.setQuery).toHaveBeenCalledWith('')
    expect(p.setStatusFilter).toHaveBeenCalledWith('all')
  })
})
