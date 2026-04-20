import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import LiveScreen from './features/live/pages/LiveScreen'
import HistoryScreen from './features/history/pages/HistoryScreen'
import DayDetailsScreen from './features/day-details/pages/DayDetailsScreen'

function AssistantStub() {
  return (
    <>
      <header className="topbar" role="banner"><span className="topbar-title">Assistant</span></header>
      <div className="screen-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>Coming soon</div>
    </>
  )
}

function SettingsStub() {
  return (
    <>
      <header className="topbar" role="banner"><span className="topbar-title">Settings</span></header>
      <div className="screen-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>Coming soon</div>
    </>
  )
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/live" replace />} />
        <Route path="/live" element={<LiveScreen />} />
        <Route path="/history" element={<HistoryScreen />} />
        <Route path="/history/:dayId" element={<DayDetailsScreen />} />
        <Route path="/assistant" element={<AssistantStub />} />
        <Route path="/settings" element={<SettingsStub />} />
        <Route path="*" element={<Navigate to="/live" replace />} />
      </Routes>
    </AppShell>
  )
}
