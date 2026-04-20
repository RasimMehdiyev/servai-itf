import React from 'react'
import Card from '../components/Card'
import Button from '../components/Button'
import useAuth from '../hooks/useAuth'

const orders = [
  {id:'1234', time:'12:36', status:'ok'},
  {id:'1234', time:'12:36', status:'ok'},
  {id:'1234', time:'12:36', status:'ok'},
  {id:'1237', time:'12:36', status:'fail'}
]

export default function PageThree(){
  const {user,login,logout} = useAuth()

  return (
    <div>
      <h2>Day Details</h2>

      <div style={{marginTop:8}}>
        <Card>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{display:'flex',gap:12,alignItems:'center'}}>
              <div className="badge">Needs Attention</div>
              <div>
                <div style={{fontSize:18,fontWeight:700}}>4</div>
                <div className="meta">Orders received</div>
              </div>
            </div>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:'#ff6b6b'}}>1</div>
              <div className="meta">Failure</div>
            </div>
          </div>
        </Card>
      </div>

      <div style={{marginTop:12}}>
        <h3>Individual Orders</h3>
        <div className="order-list">
          {orders.map(o=> (
            <div key={o.id+o.time} className="order-item">
              <div>
                <div><strong>Order #{o.id}</strong></div>
                <div className="meta">★★★★★</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div className="meta">{o.time}</div>
                <div style={{marginTop:6}}>{o.status === 'ok' ? <span style={{color:'var(--success)'}}>✓</span> : <span style={{color:'var(--danger)'}}>!</span>}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
