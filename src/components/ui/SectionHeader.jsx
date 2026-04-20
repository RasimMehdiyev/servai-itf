import React from 'react'

export default function SectionHeader({ title, right }) {
  return (
    <div className="section-hdr">
      <h2>{title}</h2>
      {right && <div>{right}</div>}
    </div>
  )
}
