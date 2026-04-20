import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useDayDetails from '../hooks/useDayDetails'
import Card from '../components/Card'

export default function DayDetails(){
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, loading, error } = useDayDetails(id)

  if(loading) return <div className="container">Loading…</div>
  if(error) return <div className="container">Error loading data</div>

  return (
    <div className="container">
      <button onClick={()=> navigate(-1)} aria-label="Back">← Back</button>
      <h2>Day Details</h2>
      <div style={{marginTop:8}}>
        <Card>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:13,color:'var(--muted)'}}>{data.dateLabel}</div>
              <div className="badge">{data.attentionLabel}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:20,fontWeight:700}}>{data.ordersNotMet}</div>
              <div className="meta">Orders received</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:20,fontWeight:700,color:'var(--danger)'}}>{data.failureCount}</div>
              <div className="meta">Failure</div>
            </div>
          </div>
        </Card>
      </div>

      <div style={{marginTop:12}}>
        <h3>Individual Orders</h3>
        <div className="order-list">
          {data.orders.map(o=> (
            <div key={o.id} className="order-item" role="button" tabIndex={0}>
              <div>
                <div><strong>Order #{o.orderNumber}</strong></div>
                <div className="meta">{o.rating ? '★'.repeat(o.rating) : ''}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div className="meta">{o.timestamp}</div>
                <div style={{marginTop:6}}>{o.status === 'ok' ? <span style={{color:'var(--success)'}}>✓</span> : <span style={{color:'var(--danger)'}}>!</span>}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
