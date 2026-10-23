import React, { useEffect, useState } from 'react'
import Card from '../../../components/ui/Card'
import { useDataSource } from '../../../context/DataSourceContext'
import { useRobot } from '../../../robots/RobotContext'
import { getApiBase } from '../../../lib/urls'
import { clock } from '../../../lib/logTranslate'
import { stepTitleForComponent } from '../../../services/messageMapper'

// "What I saw": the pictures the robot took when something went wrong in the current order.
// With nothing to show it says so, in a friendly way. (Live video, if the robot ever streams it, is a later decision.)

const CAMERA_NAME = { d415: 'Close-up', zed: 'Wide' }

function captionOf(img) {
  if (img.caption) return img.caption
  const step = stepTitleForComponent(img.component)
  return step ? `While ${step.toLowerCase()}` : (img.description || 'Taken when something went wrong')
}

// round arrow buttons on the sides of the picture (the picture itself is the click target for enlarging)
function Arrow({ side, label, onClick }) {
  return (
    <button
      type="button" aria-label={label} onClick={onClick}
      className="absolute w-9 h-9 rounded-full border-0 flex items-center justify-center cursor-pointer text-white text-[20px] leading-none"
      style={{ [side]: 8, top: 104, background: 'rgba(15,23,42,0.6)' }}
    >{side === 'left' ? '‹' : '›'}</button>
  )
}

function AllClear() {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 px-4 py-6 rounded-[10px] bg-[var(--success-bg)]" style={{ flex: 1 }} role="status">
      <svg width="132" height="96" viewBox="0 0 132 96" fill="none" aria-hidden>
        {/* a tidy shelf with a friendly robot head and a check mark */}
        <rect x="6" y="80" width="120" height="6" rx="3" fill="#a7d9c4" />
        <rect x="14" y="58" width="16" height="22" rx="4" fill="#cdeee0" />
        <rect x="102" y="64" width="16" height="16" rx="8" fill="#cdeee0" />
        <rect x="40" y="22" width="52" height="46" rx="14" fill="#fff" stroke="#10b981" strokeWidth="3" />
        <circle cx="56" cy="42" r="4" fill="#047857" />
        <circle cx="76" cy="42" r="4" fill="#047857" />
        <path d="M54 54c4 5 20 5 24 0" stroke="#047857" strokeWidth="3" strokeLinecap="round" />
        <path d="M66 22v-9" stroke="#10b981" strokeWidth="3" strokeLinecap="round" />
        <circle cx="66" cy="11" r="4" fill="#10b981" />
        <circle cx="106" cy="26" r="14" fill="#10b981" />
        <path d="M99 26l5 5 9-10" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-[clamp(15px,1.9vw,17px)] font-semibold text-[var(--success-text)]">All clear. Nothing to show.</div>
      <div className="text-[12.5px] text-[var(--text-secondary)] max-w-[260px] leading-snug">
        If something goes wrong, the pictures I take will appear here.
      </div>
    </div>
  )
}

export default function FailurePicturesCard({ style }) {
  const { liveData } = useDataSource()
  const { robotId } = useRobot()
  const base = `${getApiBase(robotId)}/api/images`
  const [broken, setBroken] = useState({})
  const [picked, setPicked] = useState(0)
  const [zoom, setZoom] = useState(false)

  const images = (liveData?._failureImages || []).filter(i => !broken[i.imageId])
  const idx = Math.min(picked, Math.max(0, images.length - 1))
  const current = images[idx]

  // a new order starts with nothing selected
  useEffect(() => { setPicked(0); setZoom(false) }, [liveData?._cycleNum])
  useEffect(() => {
    if (!zoom) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setZoom(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  return (
    <Card style={style}>
      <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Pictures</div>
      <h2 className="text-[clamp(18px,2.2vw,22px)] font-bold text-[var(--text-primary)] m-0">What I saw</h2>
      <p className="m-0 mt-0.5 mb-3 text-[13px] text-[var(--text-secondary)]">Pictures from the moment it went wrong</p>

      {/* one fixed height with or without pictures, so the page does not jump when they arrive */}
      <div style={{ height: 300, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {!current ? <AllClear /> : (
        <>
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="relative block w-full p-0 border-0 rounded-[10px] overflow-hidden cursor-zoom-in bg-[#1a1a2e]"
            style={{ flex: 'none', height: 244 }}
            aria-label="Enlarge this picture"
          >
            <img
              src={`${base}/${current.imageId}`} alt={captionOf(current)}
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => setBroken(b => ({ ...b, [current.imageId]: true }))}
            />
            <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[rgba(15,23,42,0.78)] text-white">
              {CAMERA_NAME[current.camera] || current.camera} · {clock(current.ts)}
            </span>
            {images.length > 1 && (
              <span className="absolute right-2 bottom-2 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[rgba(15,23,42,0.78)] text-white tabular-nums">
                {idx + 1} / {images.length}
              </span>
            )}
          </button>
          {images.length > 1 && (
            <>
              <Arrow side="left" label="Previous picture" onClick={() => setPicked((idx - 1 + images.length) % images.length)} />
              <Arrow side="right" label="Next picture" onClick={() => setPicked((idx + 1) % images.length)} />
            </>
          )}

          <p className="m-0 mt-2.5 text-[clamp(13px,1.6vw,14px)] leading-snug text-[var(--text-primary)]" style={{ flex: 'none', minHeight: 40, overflow: 'hidden' }}>{captionOf(current)}</p>

        </>
      )}
      </div>

      {zoom && current && (
        <div
          className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 p-4"
          style={{ background: 'rgba(15,23,42,0.88)' }}
          onClick={() => setZoom(false)} role="dialog" aria-label="Picture"
        >
          <img src={`${base}/${current.imageId}`} alt={captionOf(current)} className="max-w-full max-h-[80vh] rounded-lg" />
          <div className="text-white text-[14px] text-center">{captionOf(current)} · {CAMERA_NAME[current.camera] || current.camera} · {clock(current.ts)}</div>
        </div>
      )}
    </Card>
  )
}
