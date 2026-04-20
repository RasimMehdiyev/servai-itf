import React from 'react'
import {NavLink} from 'react-router-dom'

export default function BottomNav(){
  return (
    <nav className="bottom-nav" aria-label="Bottom navigation">
      <div style={{maxWidth:'var(--max-width)',width:'100%',display:'flex',justifyContent:'space-around',background:'transparent'}}>
        <NavLink to="/live" className={({isActive})=> isActive? 'active':''}>Live</NavLink>
        <NavLink to="/history" className={({isActive})=> isActive? 'active':''}>History</NavLink>
        <NavLink to="/assistant" className={({isActive})=> isActive? 'active':''}>Assistant</NavLink>
        <NavLink to="/settings" className={({isActive})=> isActive? 'active':''}>Settings</NavLink>
      </div>
    </nav>
  )
}
