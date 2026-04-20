import React from 'react'

export default function ErrorState({ message = 'Something went wrong.' }) {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--danger)' }}>{message}</div>
}
