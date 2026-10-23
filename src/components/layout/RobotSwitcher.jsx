import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useRobot } from '../../robots/RobotContext'

// The robot picker in the top bar. The choice re-points Live and History at that robot's relay,
// orders file and vocabulary (see DataSourceContext and the robot profiles).

function RobotGlyph({ id }) {
  // simple pictograms: a basket for the grocery robot, a glass for the bartender
  return id === 'bar' ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 22h8M12 15v7M5 3h14l-1.5 6.5a5.5 5.5 0 0 1-11 0L5 3z" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}

export default function RobotSwitcher() {
  const { robot, robots, robotId, setRobotId } = useRobot()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  // the header clips nothing, but a portal keeps the menu above every screen and card
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 268)) })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    place()
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  const choose = (id) => {
    setRobotId(id)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Robot: ${robot.name}. Change robot`}
        onClick={() => setOpen(v => !v)}
        className="btn btn-sm btn-ghost gap-2 px-2 normal-case"
      >
        <span className="text-[var(--text-secondary)]"><RobotGlyph id={robotId} /></span>
        <span className="topbar-title">{robot.name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && ReactDOM.createPortal(
        <ul
          ref={menuRef}
          role="listbox"
          aria-label="Choose a robot"
          className="fixed w-[260px] m-0 p-1.5 list-none rounded-xl bg-white border border-solid"
          style={{ top: pos.top, left: pos.left, zIndex: 9000, borderColor: 'var(--border)', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)' }}
        >
          {robots.map(r => {
            const active = r.id === robotId
            return (
              <li key={r.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => choose(r.id)}
                  className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-lg border-0 bg-transparent cursor-pointer hover:bg-[var(--bg)]"
                >
                  <span className="text-[var(--text-secondary)]"><RobotGlyph id={r.id} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold text-[var(--text-primary)]">{r.name}</span>
                    <span className="block text-[12px] text-[var(--text-secondary)]">{r.subtitle}</span>
                  </span>
                  {active && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 12l5 5 11-11" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>,
        document.body,
      )}
    </>
  )
}
