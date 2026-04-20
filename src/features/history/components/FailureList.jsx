import React from 'react'
import Card from '../../../components/ui/Card'

export default function FailureList({ failures }) {
  return (
    <Card>
      <div className="gap-row" style={{ marginBottom: 12 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--danger)" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"/></svg>
        <h2 style={{ fontSize: 'clamp(18px,2.4vw,21px)', fontWeight: 600 }}>Top Failures</h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {failures.map(f => (
          <div key={f.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 'clamp(16px,2.0vw,18px)' }}>{f.title}</strong>
              <span className="chip chip--danger" style={{ fontSize: 12, padding: '2px 7px' }}>{f.count}×</span>
              <span style={{ marginLeft: 'auto' }}>
                <TrendBadge percent={f.trendPercent} direction={f.trendDirection} />
              </span>
            </div>
            <p className="text-muted text-sm" style={{ marginTop: 4 }}>{f.description}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function TrendBadge({ percent, direction }) {
  const isUp = direction === 'up'
  return (
    <span className={`trend-badge ${isUp ? 'trend-badge--up' : 'trend-badge--down'}`}>
      {isUp ? '↑' : '↓'} {percent}%
      <span className="text-sm" style={{ fontWeight: 400, marginLeft: 4 }}>vs prev. week</span>
    </span>
  )
}
