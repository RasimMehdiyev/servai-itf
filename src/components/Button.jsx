import React from 'react'

export default function Button({children,variant='primary',...rest}){
  const cls = `btn ${variant}`
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}
