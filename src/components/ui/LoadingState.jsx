import React from 'react'

export default function LoadingState({ message = 'Loading…' }) {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>{message}</div>
}
