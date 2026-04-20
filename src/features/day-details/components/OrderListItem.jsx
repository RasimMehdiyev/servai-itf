import React from 'react'
import StarRating from '../../../components/ui/StarRating'

const StatusIcon = ({ status }) => {
  if (status === 'ok') {
    return (
      <span title="Completed" aria-label="Completed">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--success)" aria-hidden><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </span>
    )
  }
  return (
    <span title="Failed" aria-label="Failed">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--danger)" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"/></svg>
    </span>
  )
}

export default function OrderListItem({ order }) {
  return (
    <div className="order-item" role="button" tabIndex={0} aria-label={`Order #${order.orderNumber}, ${order.status === 'ok' ? 'completed' : 'failed'}`}>
      <div className="order-item__left">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-tertiary)" aria-hidden><path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2h2V8h4v2h2V8h2v12z"/></svg>
        <div>
          <div className="order-item__title">Order #{order.orderNumber}</div>
          {order.rating != null && <StarRating value={order.rating} />}
        </div>
      </div>
      <div className="order-item__right">
        <span className="order-item__meta">{order.timestamp}</span>
        <StatusIcon status={order.status} />
      </div>
    </div>
  )
}
