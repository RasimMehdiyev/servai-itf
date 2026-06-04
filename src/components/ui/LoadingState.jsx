import React from 'react'

export default function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center gap-3" style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
      <span className="loading loading-ring loading-lg" style={{ color: 'var(--primary)' }} />
      <span>{message}</span>
    </div>
  )
}
