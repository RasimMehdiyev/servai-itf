import React from 'react'

export default function StarRating({ value = 0, max = 5 }) {
  return (
    <div className="stars" aria-label={`${value} out of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ opacity: i < value ? 1 : 0.25 }}>★</span>
      ))}
    </div>
  )
}
