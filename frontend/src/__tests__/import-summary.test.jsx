import React from 'react'
import {render, screen, fireEvent} from '@testing-library/react'
import {describe, it, expect, vi} from 'vitest'
import ImportSummary, {CalendarImportStatus} from '../ImportSummary'

describe('Import results', () => {
  it('separates current results from stored snapshots and retries only by action', () => {
    const retry = vi.fn()
    render(<ImportSummary progress={{fs_events_count:828, import_progress:{total:828,succeeded:821,failed:7,zero_events:687}}}
      running={false} calendars={[{enabled:1,import_status:{status:'failed'}}]} retry={retry} />)
    expect(screen.getByText('Import finished with errors')).toBeTruthy()
    expect(screen.getByText(/Stored snapshots: 828/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {name:'Retry failed calendars (1)'}))
    expect(retry).toHaveBeenCalledOnce()
  })
  it('shows retained data and the last successful fetch on failure', () => {
    render(<CalendarImportStatus value={{status:'failed',error:'HTTP 500',checked_at:'2026-10-30T08:00:00Z',last_success:'2026-10-29T08:00:00Z'}} />)
    expect(screen.getByText('Failed · previous data retained')).toBeTruthy()
    expect(screen.getByText('HTTP 500')).toBeTruthy()
    expect(screen.getByText(/Last success:/)).toBeTruthy()
  })
})
