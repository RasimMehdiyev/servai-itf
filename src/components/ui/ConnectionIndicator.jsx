import React from 'react'
import { useDataSource } from '../../context/DataSourceContext'

const STATUS = {
  connected:    { label: 'Live',                color: 'var(--success, #10b981)',  dotCls: 'animate-pulse-ring' },
  connecting:   { label: 'Connecting…',         color: 'var(--warning, #ca8a04)',  dotCls: 'animate-blink' },
  disconnected: { label: 'Disconnected',        color: 'var(--danger, #f43f5e)',   dotCls: '' },
  waiting:      { label: 'Waiting for robot…',  color: 'var(--warning, #ca8a04)',  dotCls: 'animate-blink' },
  mock:         { label: 'Mock',                color: 'var(--live-dot, #10b981)', dotCls: '' },
}

export default function ConnectionIndicator() {
  const { mode, connectionStatus, sourceMode } = useDataSource()

  // If the WS server is reachable but the robot link isn't up yet,
  // surface that as "Waiting for robot…" instead of a plain "Live".
  let key = mode === 'mock' ? 'mock' : connectionStatus
  if (key === 'connected' && sourceMode === 'waiting') key = 'waiting'

  const { label, color, dotCls } = STATUS[key] || STATUS.disconnected

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotCls}`}
        style={{ background: color, color: color }}
      />
      <span style={{ color, fontWeight: 600, fontSize: 'clamp(16px,2.0vw,17px)' }}>
        {label}
      </span>
    </div>
  )
}
