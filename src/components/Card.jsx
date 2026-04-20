import React from 'react'

export default function Card({title,children}){
  return (
    <div className="card" role="group" aria-labelledby={title? 'card-'+title : undefined}>
      {title && <h3 id={'card-'+title}>{title}</h3>}
      <div>{children}</div>
    </div>
  )
}
