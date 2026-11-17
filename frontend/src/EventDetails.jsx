import React, { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import {
  roomDisplay,
  groupDisplay,
  formatHM,
  eventStatus,
  activityType,
  TYPE_LABELS,
  displayCalendarName
} from './lib'
import { freshness } from './schedule-preferences'

export default function EventDetails({ event, calendars, onClose }) {
  const dialog = useRef(null)
  const dismissTimer = useRef(null)
  const [closing, setClosing] = useState(false)
  const dismiss = () => {
    if (closing) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    setClosing(true)
    dismissTimer.current = setTimeout(onClose, 180)
  }
  useEffect(() => {
    const node = dialog.current,
      previous = document.activeElement
    if (node.showModal) node.showModal()
    else node.setAttribute('open', '')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(dismissTimer.current)
      if (node.open && node.close) node.close()
      document.body.style.overflow = previousOverflow
      previous?.focus?.()
    }
  }, [])
  const calendar = calendars[event.source],
    trust = freshness(calendar),
    status = eventStatus(event),
    type = activityType(event)
  const fields = [
    ['Professor', event.professor || 'Not provided'],
    ['Year / group', groupDisplay(event, calendars) || 'Not provided'],
    ['Room', roomDisplay(event)],
    ['Building', event.building || calendar?.building || 'Not provided']
  ]
  return (
    <dialog
      className={'event-dialog' + (closing ? ' is-closing' : '')}
      ref={dialog}
      aria-labelledby="event-detail-title"
      onCancel={(e) => {
        e.preventDefault()
        dismiss()
      }}
      onClick={(e) => {
        if (e.target === dialog.current) dismiss()
      }}
    >
      <div className="detail-top">
        <span className="eyebrow">Class details</span>
        <button
          className="icon-control dialog-close"
          onClick={dismiss}
          autoFocus
          aria-label="Close class details"
        >
          <Icon name="close" />
        </button>
      </div>
      {type && <span className="detail-type">{TYPE_LABELS[type]}</span>}
      <h2 id="event-detail-title">
        {event.display_title || event.title || 'Event details'}
      </h2>
      <div className="detail-time">
        <Icon name="calendar" size={21} />
        <div>
          <strong>
            {new Date(event.start).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            })}
          </strong>
          <p>
            <time dateTime={event.start}>{formatHM(event.start)}</time> —{' '}
            {event.end ? (
              <time dateTime={event.end}>
                {new Date(event.end).toDateString() !==
                new Date(event.start).toDateString()
                  ? new Date(event.end).toLocaleDateString('en-GB') + ' '
                  : ''}
                {formatHM(event.end)}
              </time>
            ) : (
              'Unknown end'
            )}
          </p>
        </div>
      </div>
      <span className={'status status-' + status.key}>
        {status.text || 'Scheduled'}
      </span>
      <dl className="detail-metadata">
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {event.description && (
        <section className="detail-description">
          <h3>About this class</h3>
          <p>{event.description}</p>
        </section>
      )}
      <section className={'source-card ' + trust.key}>
        <h3>
          <Icon name="info" size={17} /> Source & verification
        </h3>
        <p className={'data-state ' + trust.key}>{trust.text}</p>
        <dl>
          <dt>Calendar</dt>
          <dd>
            {displayCalendarName(calendar?.name || event.calendar_name) ||
              'Manual / unknown source'}
          </dd>
          <dt>Last successful import</dt>
          <dd>
            {calendar?.freshness?.last_success
              ? new Date(calendar.freshness.last_success).toLocaleString(
                  'en-GB'
                )
              : 'Unknown'}
          </dd>
        </dl>
        {trust.key !== 'fresh' && (
          <p className="source-warning">
            This schedule has not been recently verified. Confirm changes with
            your faculty.
          </p>
        )}
      </section>
    </dialog>
  )
}
