import React, { useState, useEffect } from 'react'
import Schedule from './Schedule'
import Departures from './Departures'
import TvBoard from './TvBoard'

function readTvParam() {
  try {
    const qs = new URLSearchParams(window.location.search)
    return qs.get('tv') === '1' || window.location.hash === '#tv'
  } catch (e) { return false }
}

export default function App() {
  const [tab, setTab] = useState('schedule')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [tvMode, setTvMode] = useState(readTvParam)

  useEffect(() => {
    // Regular clock tick (updates every second)
    const tick = () => setCurrentTime(new Date())
    const timer = setInterval(tick, 1000)

    // Schedule a precise update at the next local midnight (00:00)
    // and dispatch a `midnight` event so child components can refresh.
    let midnightTimer = null
    function scheduleMidnight() {
      const now = new Date()
      const nextMidnight = new Date(now)
      nextMidnight.setHours(24, 0, 0, 0)
      const msUntilMidnight = nextMidnight - now
      const safeMs = msUntilMidnight > 0 && msUntilMidnight < 8.64e7 ? msUntilMidnight : 60000

      midnightTimer = setTimeout(() => {
        tick()
        try { window.dispatchEvent(new Event('midnight')) } catch (e) {}
        scheduleMidnight()
      }, safeMs)
    }
    scheduleMidnight()

    return () => {
      clearInterval(timer)
      if (midnightTimer) clearTimeout(midnightTimer)
    }
  }, [])

  // keep TV mode in sync with the URL (back/forward navigation)
  useEffect(() => {
    const onPop = () => setTvMode(readTvParam())
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [])

  const enterTv = () => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tv', '1')
      window.history.pushState({}, '', url)
    } catch (e) {}
    setTvMode(true)
    try {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {})
    } catch (e) {}
  }

  const exitTv = () => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('tv')
      window.history.pushState({}, '', url)
    } catch (e) {}
    setTvMode(false)
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) } catch (e) {}
  }

  if (tvMode) {
    return <TvBoard onExit={exitTv} />
  }

  const formatDate = (date) => date.toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const formatTime = (date) => date.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">AC</div>
            <div className="brand-text">
              <h1>UTCN Timetable</h1>
              <span className="sub">Technical University of Cluj-Napoca</span>
            </div>
          </div>
          <nav className="nav" aria-label="Main navigation">
            <button
              onClick={() => setTab('schedule')}
              className={'nav-btn ' + (tab === 'schedule' ? 'active' : '')}
            >
              Schedule
            </button>
            <button
              onClick={() => setTab('departures')}
              className={'nav-btn ' + (tab === 'departures' ? 'active' : '')}
            >
              Live
            </button>
            <button onClick={enterTv} className="nav-btn" title="Full-screen campus display mode">
              ⤢ Display
            </button>
          </nav>
          <div className="header-clock" aria-hidden="true">
            <span className="time">{formatTime(currentTime)}</span>
            <span className="date">{formatDate(currentTime)}</span>
          </div>
        </div>
      </header>

      <main className="main">
        {tab === 'schedule' && <Schedule />}
        {tab === 'departures' && <Departures />}
      </main>

      <footer className="footer">
        <p>© {currentTime.getFullYear()} Technical University of Cluj-Napoca</p>
        <p>Faculty of Automation and Computer Science • Auto-refresh enabled</p>
        <p>
          <a
            href="https://didatec-my.sharepoint.com/:b:/g/personal/norina_herki_campus_utcluj_ro/IQDRjcNWter3T5KD0Zd1XehiASHSf3nUyD4tArZ-O5VmfpE?e=KeJetN"
            target="_blank"
            rel="noopener noreferrer"
            title="User guide for the Timetable application"
          >
            User Guide
          </a>
        </p>
      </footer>
    </div>
  )
}
