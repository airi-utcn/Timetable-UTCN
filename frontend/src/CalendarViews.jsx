import React, { useMemo, useState } from 'react'
import Icon from './Icon'
import {
  localDateStr,
  addLocalDays,
  formatHM,
  roomDisplay,
  groupDisplay,
  activityType,
  TYPE_LABELS,
  eventStatus
} from './lib'
import { freshness } from './schedule-preferences'

export function MiniCalendar({ selected, onSelect, today }) {
  const [month, setMonth] = useState(() => selected.slice(0, 7))
  // Follow external date navigation, but allow independent month browsing.
  React.useEffect(() => setMonth(selected.slice(0, 7)), [selected])
  const first = new Date(month + '-01T12:00:00')
  const start = addLocalDays(first, -(first.getDay() + 6) % 7)
  const move = (n) => {
    const d = new Date(first)
    d.setMonth(d.getMonth() + n)
    setMonth(localDateStr(d).slice(0, 7))
  }
  return (
    <section className="mini-calendar" aria-label="Choose a date">
      <div className="mini-title">
        <strong>
          {first.toLocaleDateString('en-GB', {
            month: 'long',
            year: 'numeric'
          })}
        </strong>
        <div>
          <button
            className="icon-control"
            aria-label="Previous month"
            onClick={() => move(-1)}
          >
            <Icon name="chevron" className="flip" size={14} />
          </button>
          <button
            className="icon-control"
            aria-label="Next month"
            onClick={() => move(1)}
          >
            <Icon name="chevron" size={14} />
          </button>
        </div>
      </div>
      <div className="mini-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span className="mini-weekday" key={i}>
            {d}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addLocalDays(start, i),
            key = localDateStr(d)
          return (
            <button
              key={key}
              aria-label={d.toLocaleDateString('en-GB', { dateStyle: 'full' })}
              aria-pressed={key === selected}
              aria-current={key === today ? 'date' : undefined}
              className={
                (key === selected ? 'selected ' : '') +
                (key === today ? 'today ' : '') +
                (d.getMonth() !== first.getMonth() ? 'outside' : '')
              }
              onClick={() => onSelect(key)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export const AgendaCard = React.memo(function AgendaCard({
  event: ev,
  calendars,
  now,
  onDetails
}) {
  const status = eventStatus(ev, now),
    type = activityType(ev),
    trust = freshness(calendars[ev.source], now)
  return (
    <button
      className={
        'agenda-card ' +
        (status.key === 'ongoing' ? 'current ' : '') +
        (status.key === 'finished' ? 'past' : '')
      }
      onClick={() => onDetails(ev)}
      style={{ '--event-color': ev.color || 'var(--accent)' }}
    >
      <span className="agenda-time">
        <time dateTime={ev.start}>{formatHM(ev.start)}</time>
        <span>{ev.end ? formatHM(ev.end) : 'End unknown'}</span>
      </span>
      <span className="agenda-content">
        <span className="agenda-heading">
          {ev.display_title || ev.title || 'Untitled class'}
        </span>
        <span className="agenda-meta">
          {ev.professor && (
            <span>
              <Icon name="person" size={14} />
              {ev.professor}
            </span>
          )}
          <span className="agenda-room">
            <Icon name="room" size={14} />
            {roomDisplay(ev)}
          </span>
          {groupDisplay(ev, calendars) && (
            <span>{groupDisplay(ev, calendars)}</span>
          )}
        </span>
        <span className="agenda-tags">
          {type && <span>{TYPE_LABELS[type]}</span>}
          <span className={'data-state ' + trust.key}>{trust.text}</span>
        </span>
      </span>
      <span className="agenda-end">
        <span className={'status status-' + status.key}>
          {status.text || 'Scheduled'}
        </span>
        <Icon name="chevron" size={16} />
      </span>
    </button>
  )
})

// Partition overlapping intervals into independent clusters and assign lanes.
// Dense clusters use a stacked list; small clusters retain exact time positioning.
export function eventLanes(events) {
  const sorted = events
    .map((ev) => {
      const d = new Date(ev.start)
      const start = d.getHours() * 60 + d.getMinutes()
      const endDate = new Date(ev.end)
      const end = Number.isFinite(+endDate)
        ? (+endDate - +d) / 60000 + start
        : start + 30
      return { ev, start, end: Math.max(start + 20, Math.min(1440, end)) }
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const clusters = []
  for (const item of sorted) {
    let group = clusters[clusters.length - 1]
    if (!group || item.start >= group.end) {
      group = { items: [], end: item.end }
      clusters.push(group)
    }
    group.items.push(item)
    group.end = Math.max(group.end, item.end)
  }
  return clusters.map((group) => {
    const ends = []
    for (const item of group.items) {
      let lane = ends.findIndex((end) => end <= item.start)
      if (lane < 0) lane = ends.length
      ends[lane] = item.end
      item.lane = lane
    }
    group.items.forEach((item) => {
      item.lanes = ends.length
    })
    return { ...group, lanes: ends.length }
  })
}

export function WeekGrid({ days, grouped, calendars, now, onDetails, onDay }) {
  const layouts = useMemo(
    () => days.map((day) => eventLanes(grouped[day] || [])),
    [days, grouped]
  )
  const dense = layouts.some((groups) =>
    groups.some((g) => g.lanes > 3 || g.items.some((x) => x.end - x.start < 45))
  )
  const items = layouts.flatMap((g) => g.flatMap((c) => c.items))
  const startHour = Math.min(8, ...items.map((x) => Math.floor(x.start / 60)))
  const endHour = Math.max(19, ...items.map((x) => Math.ceil(x.end / 60)))
  const hours = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i
  )
  const today = localDateStr(now),
    minute = now.getHours() * 60 + now.getMinutes()
  return (
    <div className={'week-workspace ' + (dense ? 'dense-week' : '')}>
      {dense && (
        <p className="density-note">
          <Icon name="info" size={15} />
          Overlapping classes are grouped in time order. Select a class for full
          details.
        </p>
      )}
      <div
        className="week-scroll"
        tabIndex={0}
        aria-label="Weekly timetable, scroll horizontally for more days"
      >
        <div
          className="week-grid"
          style={{ '--grid-height': `${(endHour - startHour) * 72}px` }}
        >
          <div className="week-corner">Local time</div>
          {days.map((day) => (
            <button
              key={day}
              className={'week-heading ' + (day === today ? 'is-today' : '')}
              onClick={() => onDay(day)}
            >
              <span>
                {new Date(day + 'T12:00:00').toLocaleDateString('en-GB', {
                  weekday: 'short'
                })}
              </span>
              <strong>{new Date(day + 'T12:00:00').getDate()}</strong>
              <small>{(grouped[day] || []).length} classes</small>
            </button>
          ))}
          {!dense && (
            <div className="time-gutter">
              {hours.map((h) => (
                <span key={h} style={{ top: (h - startHour) * 72 }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              ))}
            </div>
          )}
          {dense && (
            <div className="time-gutter dense-label">
              <Icon name="clock" size={16} />
            </div>
          )}
          {days.map((day, i) => (
            <div
              key={day}
              className={'week-column ' + (day === today ? 'is-today' : '')}
            >
              {!dense &&
                hours.map((h) => (
                  <div
                    key={h}
                    className="hour-rule"
                    style={{ top: (h - startHour) * 72 }}
                  />
                ))}
              {layouts[i]
                .flatMap((group) => group.items)
                .slice(0, dense ? 8 : undefined)
                .map((item, j) => {
                  const { ev } = item,
                    type = activityType(ev),
                    trust = freshness(calendars[ev.source], now)
                  return (
                    <button
                      key={ev.start + j}
                      className={
                        'week-event ' +
                        (eventStatus(ev, now).key === 'ongoing'
                          ? 'current'
                          : '')
                      }
                      title={`${ev.display_title || ev.title} · ${formatHM(ev.start)}–${formatHM(ev.end)} · ${ev.professor || ''} · ${roomDisplay(ev)} · ${trust.text}`}
                      style={{
                        '--event-color': ev.color || 'var(--accent)',
                        ...(!dense
                          ? {
                              top: (item.start - startHour * 60) * 1.2,
                              height: Math.max(
                                42,
                                (item.end - item.start) * 1.2 - 4
                              ),
                              left: `calc(${(item.lane / item.lanes) * 100}% + 4px)`,
                              width: `calc(${100 / item.lanes}% - 8px)`
                            }
                          : {})
                      }}
                      onClick={() => onDetails(ev)}
                    >
                      <time dateTime={ev.start}>
                        {formatHM(ev.start)}–{formatHM(ev.end)}
                      </time>
                      <strong>
                        {ev.display_title || ev.title || 'Untitled class'}
                      </strong>
                      <span>
                        {roomDisplay(ev)}
                        {type ? ' · ' + TYPE_LABELS[type] : ''}
                      </span>
                      {ev.professor && <span>{ev.professor}</span>}
                      <small className={'data-state ' + trust.key}>
                        {trust.key === 'fresh' ? 'Verified' : trust.text}
                      </small>
                    </button>
                  )
                })}
              {dense && (grouped[day] || []).length > 8 && (
                <button className="more-classes" onClick={() => onDay(day)}>
                  +{grouped[day].length - 8} more classes
                  <Icon name="chevron" size={13} />
                </button>
              )}
              {!layouts[i].length && (
                <span className="week-empty">No classes</span>
              )}
              {!dense &&
                day === today &&
                minute >= startHour * 60 &&
                minute < endHour * 60 && (
                  <div
                    className="now-line"
                    style={{ top: (minute - startHour * 60) * 1.2 }}
                  >
                    <span className="sr-only">
                      Current time {formatHM(now)}
                    </span>
                  </div>
                )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Gaps describe only this filtered schedule; they never imply room availability.
export function agendaGaps(events) {
  let coveredUntil = null
  let incomplete = false
  return events.map((ev) => {
    const start = +new Date(ev.start)
    const end = ev.end ? +new Date(ev.end) : NaN
    const gap =
      !incomplete && coveredUntil !== null && start > coveredUntil
        ? Math.round((start - coveredUntil) / 60000)
        : 0
    if (!Number.isFinite(end) || end <= start) incomplete = true
    else coveredUntil = Math.max(coveredUntil ?? end, end)
    return gap
  })
}

export function DailyAgenda({ events, calendars, now, onDetails, date }) {
  const gaps = useMemo(() => agendaGaps(events), [events])
  const isToday = date === localDateStr(now)
  const nowIndex = events.findIndex((ev) => new Date(ev.end || ev.start) > now)
  const marker = (
    <div className="agenda-now">
      <time dateTime={now.toISOString()}>Now · {formatHM(now)}</time>
    </div>
  )
  return (
    <div className="agenda-list">
      {events.map((ev, i) => (
        <React.Fragment key={ev.start + i}>
          {gaps[i] >= 15 && (
            <div className="agenda-gap">
              <Icon name="clock" size={14} />
              <span>
                Gap in this schedule ·{' '}
                {gaps[i] >= 60
                  ? `${Math.floor(gaps[i] / 60)}h${gaps[i] % 60 ? ` ${gaps[i] % 60}m` : ''}`
                  : `${gaps[i]} min`}
              </span>
            </div>
          )}
          {isToday && i === nowIndex && marker}
          <AgendaCard
            event={ev}
            calendars={calendars}
            now={now}
            onDetails={onDetails}
          />
        </React.Fragment>
      ))}
      {isToday && nowIndex === -1 && marker}
    </div>
  )
}
