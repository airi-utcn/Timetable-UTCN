import React, {useEffect, useRef} from 'react'
import {roomDisplay, groupDisplay} from './lib'
import {freshness} from './schedule-preferences'

export default function EventDetails({event, calendars, onClose}) {
  const dialog = useRef(null)
  useEffect(() => {
    const node = dialog.current
    if (node.showModal) node.showModal()
    else node.setAttribute('open', '')
    return () => { if (node.open && node.close) node.close() }
  }, [])
  const calendar = calendars[event.source]
  const fields = [
    ['Time', `${new Date(event.start).toLocaleString()} — ${event.end ? new Date(event.end).toLocaleString() : 'Unknown end'}`],
    ['Professor', event.professor || 'Not provided'], ['Group', groupDisplay(event, calendars) || 'Not provided'],
    ['Room', roomDisplay(event)], ['Building', event.building || calendar?.building || 'Not provided'],
    ['Source', calendar?.name || event.calendar_name || 'Manual / unknown source'],
    ['Data status', freshness(calendar).text],
    ['Last successful import', calendar?.freshness?.last_success ? new Date(calendar.freshness.last_success).toLocaleString() : 'Unknown'],
  ]
  return <dialog className="event-dialog" ref={dialog} aria-labelledby="event-detail-title" onCancel={onClose} onClick={e => {if (e.target === dialog.current) onClose()}}>
    <button className="btn ghost dialog-close" onClick={onClose} autoFocus>Close</button>
    <h2 id="event-detail-title">{event.title || event.display_title || 'Event details'}</h2>
    <dl>{fields.map(([key,value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    {event.description && <p>{event.description}</p>}
  </dialog>
}
