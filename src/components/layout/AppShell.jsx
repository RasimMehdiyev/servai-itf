import React from 'react'
import BottomTabBar from './BottomTabBar'
import FloatingAssistant from '../../features/assistant/FloatingAssistant'

export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      {children}
      <BottomTabBar />
      <FloatingAssistant />
    </div>
  )
}
