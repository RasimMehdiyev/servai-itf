import React from 'react'
import Card from '../../../components/ui/Card'

export default function FailureList({ failures, title, selectedDay, onClearDay }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div className="gap-row" style={{ margin: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--danger)" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"/></svg>
          <h2 style={{ fontSize: 'clamp(16px,2.2vw,19px)', fontWeight: 600, margin: 0 }}>{title || 'All Failures'}</h2>
        </div>
        {selectedDay && (
          <button
            onClick={onClearDay}
            style={{
              border: '1px solid var(--border)',
              borderStyle: 'solid',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--surface)',
              cursor: 'pointer',
            }}
          >
            ← Show all
          </button>
        )}
      </div>

      {failures.length === 0 ? (
        <p className="text-muted text-sm">No failures recorded for this day.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {failures.map(f => (
            <div key={f.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 'clamp(15px,2.0vw,17px)' }}>{f.title}</strong>
                <span className="chip chip--danger" style={{ fontSize: 12, padding: '2px 7px' }}>{f.count}×</span>
              </div>
              <p className="text-muted text-sm" style={{ marginTop: 4 }}>{f.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
