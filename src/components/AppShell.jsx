import React from 'react'
import Header from './Header'
import BottomNav from './BottomNav'

export default function AppShell({children}){
  return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column'}}>
      <Header />
      <div style={{flex:1, overflow:'auto', paddingTop:12, paddingBottom:80}}>
        {children}
      </div>
      <BottomNav />
    </div>
  )
}
