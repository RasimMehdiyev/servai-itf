import React from 'react'
import Header from './Header'

export default function Layout({children}){
  return (
    <div>
      <Header />
      <main className="container" role="main">
        {children}
        <div className="footer">Made accessible for color-blind users · Reusable components</div>
      </main>
    </div>
  )
}
