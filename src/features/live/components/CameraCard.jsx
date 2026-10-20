import React, { useMemo, useState } from 'react'
import Card from '../../../components/ui/Card'
import { useDataSource } from '../../../context/DataSourceContext'
import { clock } from '../../../lib/logTranslate'
import { deriveLog } from '../../../lib/liveView'

// The robot does not stream video to the dashboard yet. Until it does, the card
// keeps its final layout (frame, camera chips, detections toggle, caption,
// legend) and a translucent overlay says so. The frame shows the most recent
// capture the robot sent (failure captures arrive as `image` events), if any.

const CAMERAS = [
  { id: 'd415', label: 'Close-up (D415)' },
  { id: 'zed', label: 'Wide (ZED)' },
]

const LEGEND = [
  { key: 'box', text: 'Detection (score)', swatch: <span className="inline-block w-3.5 h-2.5 rounded-sm border-2 border-solid border-[var(--primary)]" /> },
  { key: 'grip', text: 'Grip point', swatch: <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--teal)]" /> },
  { key: 'miss', text: 'Blocked try', swatch: <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--danger)]" /> },
  { key: 'try', text: 'Current try', swatch: <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--primary)]" /> },
]

function imageSrc(img) {
  if (!img?.base64) return null
  if (img.base64.startsWith('data:')) return img.base64
  const mime = img.base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${img.base64}`
}

function CameraOffIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 1l22 22" />
      <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    </svg>
  )
}

export default function CameraCard({ style }) {
  const { liveData } = useDataSource()
  const [camera, setCamera] = useState('d415')
  const [detections, setDetections] = useState(true)

  const images = liveData?._images || []
  const last = useMemo(
    () => [...images].reverse().find(i => i.camera === camera) || null,
    [images, camera],
  )
  const src = imageSrc(last)
  const lastLog = deriveLog(liveData, 1)[0]
  const caption = lastLog ? lastLog.plain : 'Waiting for the next order.'
  const captionTime = lastLog ? clock(lastLog.ts) : ''
  const tag = last ? `Last capture · ${clock(last.ts)} · ${camera.toUpperCase()}` : 'No live frame'

  return (
    <Card style={style}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Camera</div>
          <h2 className="text-[clamp(18px,2.2vw,22px)] font-bold text-[var(--text-primary)] m-0">What I am looking at</h2>
        </div>
        <button
          type="button"
          aria-pressed={detections}
          onClick={() => setDetections(v => !v)}
          className={`btn btn-sm rounded-full shrink-0 ${detections ? 'btn-neutral' : 'btn-outline'}`}
        >
          {detections ? 'Detections on' : 'Detections off'}
        </button>
      </div>

      <div className="flex gap-2 mt-3" role="group" aria-label="Camera">
        {CAMERAS.map(c => (
          <button
            key={c.id}
            type="button"
            aria-pressed={camera === c.id}
            onClick={() => setCamera(c.id)}
            className={`btn btn-xs rounded-full ${camera === c.id ? 'btn-neutral' : 'btn-outline'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Frame */}
      <div
        className="relative w-full mt-3 rounded-[10px] overflow-hidden bg-[var(--bg)]"
        style={{ aspectRatio: '492 / 252' }}
      >
        {src ? (
          <img src={src} alt={`Last ${camera.toUpperCase()} capture`} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          // No capture yet: a neutral shelf sketch so the frame keeps its shape
          <div className="absolute inset-0" aria-hidden>
            <div className="absolute left-0 right-0 top-[44%] h-2 bg-[#cbd2dc]" />
            <div className="absolute left-0 right-0 top-[92%] h-2 bg-[#cbd2dc]" />
            <div className="absolute left-[10%] top-[24%] w-[9%] h-[20%] rounded-md bg-[#e2e6ec]" />
            <div className="absolute left-[40%] top-[20%] w-[10%] h-[24%] rounded-full bg-[#e2e6ec]" />
            <div className="absolute left-[68%] top-[36%] w-[22%] h-[7%] rounded-full bg-[#e2e6ec]" />
          </div>
        )}

        <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[rgba(15,23,42,0.78)] text-white">
          {tag}
        </span>

        {/* Unavailable overlay — semi-translucent so the frame stays visible underneath */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center text-white"
          style={{ background: 'rgba(15, 23, 42, 0.58)' }}
          role="status"
        >
          <CameraOffIcon />
          <div className="text-[clamp(14px,1.8vw,16px)] font-semibold">Live camera unavailable</div>
          <div className="text-[12px] opacity-90 max-w-[300px] leading-snug">
            The robot is not streaming video to this dashboard yet. Detections and the grasp tries will appear here once it is.
          </div>
        </div>
      </div>

      {/* Log-line caption: what is happening right now, in plain words */}
      <div className="flex items-start gap-2 mt-3 text-[clamp(13px,1.6vw,14px)] leading-snug text-[var(--text-primary)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[3px]" aria-hidden>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>
          {captionTime && <span className="font-mono text-[12px] text-[var(--text-secondary)] mr-1.5 tabular-nums">{captionTime}</span>}
          {caption}
        </span>
      </div>

      {detections && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 opacity-60" aria-label="Legend (available when the camera is live)">
          {LEGEND.map(l => (
            <span key={l.key} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              {l.swatch}
              {l.text}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
