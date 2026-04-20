import React from 'react'

export default function FilterPills({ options, value, onChange }) {
  return (
    <div className="filter-pills" role="group" aria-label="Date range filter">
      {options.map(opt => (
        <button
          key={opt}
          className={`filter-pill ${value === opt ? 'active' : ''}`}
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
