import React from 'react'
import Card from '../../../components/ui/Card'

export default function PerformanceCard({ successRate, successCount, failureCount, bars }) {
  const maxTotal = Math.max(...bars.map(b => b.success + b.failure), 1)

  return (
    <Card>
      <div className="gap-row" style={{ marginBottom: 12 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/><path d="M7 12h2v5H7zm4-3h2v8h-2zm4-3h2v11h-2z"/></svg>
        <h2 style={{ fontSize: 'clamp(18px,2.4vw,21px)', fontWeight: 600 }}>Performance</h2>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 'clamp(34px,4.8vw,48px)', fontWeight: 700, color: 'var(--success)' }}>{successRate}%</div>
        <div className="text-muted text-sm">Success rate</div>
      </div>

      {/* Stacked bar chart (pure CSS) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'clamp(4px,1vw,10px)', height: 'clamp(100px,16vw,160px)' }} role="img" aria-label={`Bar chart: ${successCount} successful, ${failureCount} failed`}>
        {bars.map((bar, i) => {
          const total = bar.success + bar.failure
          const height = (total / maxTotal) * 100
          const successPct = (bar.success / total) * 100
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
              <div
                style={{
                  width: '100%',
                  maxWidth: 32,
                  height: `${height}%`,
                  borderRadius: '6px 6px 0 0',
                  background: `linear-gradient(to top, var(--success) 0%, var(--success) ${successPct}%, var(--danger) ${successPct}%, var(--danger) 100%)`,
                  minHeight: 4,
                }}
                title={`${bar.label}: ${bar.success} ok, ${bar.failure} failed`}
              />
              <div className="text-sm" style={{ marginTop: 4, color: 'var(--text-tertiary)', fontSize: 'clamp(12px,1.5vw,14px)' }}>{bar.label}</div>
            </div>
          )
        })}
      </div>

      <div className="chart-legend" style={{ justifyContent: 'center', marginTop: 12 }}>
        <div className="chart-legend__item"><div className="chart-legend__dot" style={{ background: 'var(--success)' }} />{successCount} successful</div>
        <div className="chart-legend__item"><div className="chart-legend__dot" style={{ background: 'var(--danger)' }} />{failureCount} failed</div>
      </div>
    </Card>
  )
}
