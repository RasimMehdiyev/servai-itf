import React from 'react'

const variantMap = {
  warning: 'chip--warning',
  danger: 'chip--danger',
  success: 'chip--success',
  info: 'chip--info',
}

export default function StatusChip({ label, variant = 'warning', icon }) {
  return (
    <span className={`chip ${variantMap[variant] || ''}`} role="status">
      {icon && <span aria-hidden>{icon}</span>}
      {label}
    </span>
  )
}
