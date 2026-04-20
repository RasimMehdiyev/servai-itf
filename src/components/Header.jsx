import React from 'react'
import { NavLink } from 'react-router-dom'

export default function Header(){
  return (
    <div className="topbar" role="banner">
      <div className="header container" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button aria-label="Open navigation" style={{width:44,height:44,background:'var(--surface)',borderRadius:10,border:'none'}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M3 12h18" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"/>
              <path d="M3 6h18" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"/>
              <path d="M3 18h18" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>

          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{fontWeight:700}}>ROBI</div>
            <select aria-label="Select robot" defaultValue="ROBI">
              <option>ROBI</option>
              <option>ROBI-2</option>
            </select>
          </div>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:10,height:10,borderRadius:99,background:'#10b981'}} aria-hidden></div>
          <div style={{color:'var(--muted)'}}>Live</div>
        </div>
      </div>
    </div>
  )
}
