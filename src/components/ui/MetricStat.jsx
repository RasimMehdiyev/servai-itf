import React from 'react'

export default function MetricStat({ value, label, color }) {
  return (
    <div className="metric-stat">
      <div className="metric-stat__value" style={color ? { color } : undefined}>{value}</div>
      <div className="metric-stat__label">{label}</div>
    </div>
  )
}
