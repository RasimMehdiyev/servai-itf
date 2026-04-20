import React from 'react'

export default function TopBar({ left, center, right }) {
  return (
    <header className="topbar" role="banner">
      <div className="topbar-left">{left}</div>
      {center && <div style={{ fontWeight: 600, fontSize: 'clamp(18px,2.4vw,21px)' }}>{center}</div>}
      <div className="topbar-right">{right}</div>
    </header>
  )
}
