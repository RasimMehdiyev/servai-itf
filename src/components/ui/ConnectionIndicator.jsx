import React from 'react'
import { useDataSource } from '../../context/DataSourceContext'

const STATUS = {
  connected:    { label: 'Live',           color: 'var(--success, #10b981)',  dotCls: 'animate-pulse-ring' },
  connecting:   { label: 'Connecting…',    color: 'var(--warning, #ca8a04)',  dotCls: 'animate-blink' },
  disconnected: { label: 'Disconnected',   color: 'var(--danger, #f43f5e)',   dotCls: '' },
  mock:         { label: 'Mock',           color: 'var(--live-dot, #10b981)', dotCls: '' },
}

export default function ConnectionIndicator() {
  const { mode, connectionStatus, sourceMode } = useDataSource()

  const key = mode === 'mock' ? 'mock' : connectionStatus
  const { label: baseLabel, color, dotCls } = STATUS[key] || STATUS.disconnected

  const label = key === 'connected' && sourceMode === 'static' ? 'Static' : baseLabel

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
