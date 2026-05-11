import React from 'react'
import { useDataSource } from '../../context/DataSourceContext'

const STATUS = {
  connected:    { label: 'Live',           color: 'var(--success, #22c55e)',  dotCls: 'animate-pulse-ring' },
  connecting:   { label: 'Connecting…',    color: 'var(--warning, #f59e0b)',  dotCls: 'animate-blink' },
  disconnected: { label: 'Disconnected',   color: 'var(--danger, #ef4444)',   dotCls: '' },
  mock:         { label: 'Mock',           color: 'var(--live-dot, #22c55e)', dotCls: '' },
}

export default function ConnectionIndicator() {
  const { mode, connectionStatus } = useDataSource()

  const key = mode === 'mock' ? 'mock' : connectionStatus
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
