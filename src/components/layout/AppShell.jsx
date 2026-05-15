import React from 'react'
import BottomTabBar from './BottomTabBar'

export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      {children}
      <BottomTabBar />
    </div>
  )
}
