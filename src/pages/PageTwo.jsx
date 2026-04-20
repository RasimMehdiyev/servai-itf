import React from 'react'
import Card from '../components/Card'
import Button from '../components/Button'

// Performance overview with simple CSS bars (replace with chart lib later)
const sample = [
  {date:'16-03', success:60, fail:40},
  {date:'17-03', success:35, fail:65},
  {date:'18-03', success:80, fail:20},
  {date:'19-03', success:78, fail:22},
  {date:'20-03', success:82, fail:18},
  {date:'21-03', success:55, fail:45},
  {date:'22-03', success:80, fail:20}
]

export default function PageTwo(){
  const successRate = Math.round((sample.reduce((s,i)=> s + i.success,0) / (sample.length*100)) * 100)

  return (
    <div>
      <h2>Performance</h2>

      <div style={{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between'}}>
        <div className="tabs">
          <div className="tab active">7d</div>
          <div className="tab">14d</div>
          <div className="tab">30d</div>
        </div>
        <div style={{color:'var(--muted)'}}>Live</div>
      </div>

      <div style={{marginTop:12}}>
        <Card className="chart">
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:700}}>{successRate}%</div>
            <div style={{color:'var(--muted)'}}>Success rate</div>
          </div>

          <div className="bars" style={{marginTop:12}}>
            {sample.map((s,idx)=> (
              <div key={idx} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                <div style={{height: Math.max(10, s.success)+ 'px'}} className="bar" title={`${s.success}% successful`}></div>
                <div style={{fontSize:12,color:'var(--muted)'}}>{s.date}</div>
              </div>
            ))}
          </div>

          <div className="chart-legend">
            <div>51 successful</div>
            <div style={{color:'#ff6b6b'}}>16 failed</div>
          </div>
        </Card>
      </div>

      <div style={{marginTop:12}}>
        <Card title="Top Failures">
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div>
              <div><strong>Dropped item</strong> <span style={{background:'#fee2e2',padding:'2px 6px',borderRadius:6,fontSize:12,color:'#b91c1c'}}>8x</span></div>
              <div className="meta">My grip was not stable enough to hold onto the item</div>
            </div>

            <div>
              <div><strong>Customer not found</strong> <span style={{background:'#eef2ff',padding:'2px 6px',borderRadius:6,fontSize:12,color:'#0b66ff'}}>8x</span></div>
              <div className="meta">I could not detect the customer</div>
            </div>
          </div>
        </Card>
      </div>

    </div>
  )
}
