import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import Card from '../../../components/ui/Card'
import StepList from '../../../components/ui/StepList'
import { useDataSource } from '../../../context/DataSourceContext'
import { deriveOrderSteps, orderHeadline } from '../../../lib/orderSteps'
import { contextSentence } from '../../../lib/orderStats'
import { orderCriticView } from '../../../lib/critic'
import { orderCounterfactual } from '../../../lib/counterfactual'
import { CardHeader, Tiles, ShelfMap, MapLegend } from '../../../components/ui/CounterfactualView'
import SmartJudgeBox from '../../../components/ui/SmartJudge'
import { barContextSentence } from '../../../robots/bar/view'
import { useRobot } from '../../../robots/RobotContext'

const EMERALD_500 = '#10b981'
const AMBER_500 = '#ca8a04'
const ROSE_500 = '#f43f5e'
const GRAY_200 = '#e5e7eb'
const GRAY_400 = '#9ca3af'
const GRAY_500 = '#6b7280'
const GRAY_900 = 'var(--text-primary)' // was '#111827' — a near-duplicate of --text-primary (#0f172a); aligned so History headings match Live
const TEAL_200 = '#99f6e4'

import { getApiBase, getRagBase } from '../../../lib/urls'

// the relay of the robot that is selected right now
const dataBase = () => getApiBase()
const PAGE_SIZE = 5

// Item | Order | Time | Took | Photos | Status | chevron (no Photos column for a robot without cameras)
const colsFor = (showPhotos) => (showPhotos
  ? 'minmax(0, 1.7fr) 64px 72px 56px 56px 132px 16px'
  : 'minmax(0, 1.7fr) 64px 72px 56px 132px 16px')

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(dateStr) {
  const today = todayStr()
  const d = new Date(dateStr + 'T12:00:00')
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (dateStr === today) return `Today · ${label}`
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === yesterday.toISOString().slice(0, 10)) return `Yesterday · ${label}`
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' })
  return `${weekday} · ${label}`
}

const REASON_SHORT = {
  search_exhausted: 'Not found',
  reachability_failed: 'Path blocked',
  no_valid_depth: 'Depth failed',
  handover_failed: 'Handover blocked',
  user_cancelled: 'Cancelled',
  gripper_failed: 'Grip failed',
  e_stopped: 'E-stop',
  timeout: 'Timeout',
  operator_abort: 'Operator aborted',
  bridge_fault: 'Hardware fault',
}

const STATUS_DOT = { success: EMERALD_500, ok: EMERALD_500, warning: AMBER_500, failed: ROSE_500 }

function StatusPill({ status, failure, profile }) {
  // daisyUI badges — outline variants keep the soft look; colours map to the
  // servai theme (success=emerald, warning=amber, error=rose).
  if (status === 'success' || status === 'ok') {
    return <span className="badge badge-sm badge-success badge-outline">{profile.labels.delivered}</span>
  }
  const reasonLabel = failure?.reason ? (profile.reasons[failure.reason] || REASON_SHORT[failure.reason]) : null
  if (status === 'warning') {
    return <span className="badge badge-sm badge-warning badge-outline">{reasonLabel || 'Warning'}</span>
  }
  if (status === 'failed') {
    return <span className="badge badge-sm badge-error badge-outline">{reasonLabel || 'Failed'}</span>
  }
  return <span className="badge badge-sm badge-ghost">Unknown</span>
}

function CameraIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function collectOrderImages(order) {
  const images = []
  for (const phase of (order.phases || [])) {
    if (phase.images) {
      for (const img of phase.images) images.push({ ...img, phase: phase.friendly_name || phase.phase })
    }
  }
  return images
}

function hasImages(order) {
  return (order.phases || []).some(p => p.images && p.images.length > 0)
}

function imageCount(order) {
  let n = 0
  for (const phase of (order.phases || [])) {
    if (phase.images) n += phase.images.length
  }
  return n
}

function groupImagesByEvent(images) {
  const groups = []
  const seen = new Set()
  for (const img of images) {
    const key = img.imageId.replace(/_(?:d415|zed)$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    const pair = images.filter(i => i.imageId.replace(/_(?:d415|zed)$/, '') === key)
    const wrist = pair.find(i => i.camera === 'd415')
    const external = pair.find(i => i.camera === 'zed')
    // Per-image log-caption / captured-at carry through from the WS server.
    // Pair members share the same moment, so either copy works.
    const logCaption = wrist?.log_caption || external?.log_caption || ''
    const capturedAt = wrist?.captured_at || external?.captured_at || null
    groups.push({ key, wrist, external, phase: img.phase, logCaption, capturedAt })
  }
  return groups
}

// Render a small UTC-safe HH:MM:SS from an ISO string (local time)
function localHHMMSS(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

const RAG_BASE = getRagBase()

function CameraLabel({ camera }) {
  const isZed = camera === 'zed'
  return (
    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-block"
      style={{ background: isZed ? 'rgba(56,189,248,0.15)' : 'rgba(251,113,133,0.15)', color: isZed ? '#7dd3fc' : '#fda4af' }}>
      {isZed ? 'External (ZED)' : 'Wrist (D415)'}
    </span>
  )
}

function CameraImage({ src, alt }) {
  return (
    <div className="mt-1.5 rounded-lg overflow-hidden" style={{ background: '#1a1a2e' }}>
      <img
        src={src}
        alt={alt}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
    </div>
  )
}

function VisionCaption({ imageIds, failureContext }) {
  const [caption, setCaption] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const idsKey = imageIds?.join(',') || ''

  // Silent cache check — no loading state, just pop in if found
  useEffect(() => {
    if (!imageIds || imageIds.length === 0) return
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    fetch(`${RAG_BASE}/api/rag/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_ids: imageIds, cache_only: true }),
      signal: controller.signal,
    })
      .then(r => { clearTimeout(timeout); return r.ok ? r.json() : null })
      .then(d => { if (!cancelled && d?.text) setCaption(d.text) })
      .catch(() => { clearTimeout(timeout) })
    return () => { cancelled = true; clearTimeout(timeout); controller.abort() }
  }, [idsKey])

  const generate = useCallback(() => {
    if (!imageIds || imageIds.length === 0) return
    setLoading(true)
    setError(null)
    fetch(`${RAG_BASE}/api/rag/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_ids: imageIds, failure_context: failureContext || '' }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.text) { setCaption(d.text); setError(null) }
        else setError('No result')
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [idsKey, failureContext])

  if (!imageIds || imageIds.length === 0) return null

  // Has a cached caption
  if (caption) {
    return (
      <div className="px-3 py-2.5 rounded-lg mt-3" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={AMBER_500} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: AMBER_500 }}>AI Analysis</span>
          {loading && (
            <svg className="animate-spin ml-auto" width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ color: AMBER_500, opacity: 0.6 }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="50 100" />
            </svg>
          )}
        </div>
        <p className="text-[12px] leading-relaxed m-0" style={{ color: 'rgba(255,255,255,0.8)', opacity: loading ? 0.5 : 1, transition: 'opacity 0.3s' }}>{caption}</p>
        {!loading && (
          <button
            onClick={generate}
            className="mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded border border-solid cursor-pointer hover:opacity-80"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.4)', background: 'transparent' }}
          >
            Refresh
          </button>
        )}
      </div>
    )
  }

  // Generating from scratch
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg mt-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: AMBER_500 }} />
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Analyzing with vision AI…</span>
      </div>
    )
  }

  // No caption — show generate button
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg mt-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
      {error ? (
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Analysis failed — AI may be offline.</span>
      ) : (
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Vision analysis available.</span>
      )}
      <button
        onClick={generate}
        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border-0 cursor-pointer hover:opacity-90"
        style={{ background: AMBER_500, color: 'white' }}
      >
        {error ? 'Try again' : 'Analyze'}
      </button>
    </div>
  )
}

function ImageOverlay({ images, order, onClose }) {
  const groups = useMemo(() => groupImagesByEvent(images), [images])
  const [eventIdx, setEventIdx] = useState(0)
  const imageBase = `${dataBase()}/api/images`

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowLeft') setEventIdx(i => (i - 1 + groups.length) % groups.length)
    if (e.key === 'ArrowRight') setEventIdx(i => (i + 1) % groups.length)
  }, [groups.length, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  if (groups.length === 0) return null
  const group = groups[eventIdx]
  const failCtx = order?.failure ? `${order.failure.reason}: ${order.failure.detail}` : ''
  const allIds = [group.wrist?.imageId, group.external?.imageId].filter(Boolean)

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', zIndex: 9999, backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-xl overflow-hidden"
        style={{ width: '70%', maxWidth: 1000, maxHeight: '85vh', background: GRAY_900 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ROSE_500} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-[13px] font-semibold" style={{ color: 'white' }}>Failure Camera Feed</span>
            <span className="text-[11px]" style={{ color: GRAY_400 }}>— {group.phase}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center border-0 cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 16 }}>
            ×
          </button>
        </div>

        {/* Side-by-side camera feeds */}
        <div className="flex gap-2 p-3" style={{ overflow: 'auto', maxHeight: 'calc(85vh - 200px)' }}>
          {group.wrist && (
            <div className="flex-1 min-w-0">
              <CameraLabel camera="d415" />
              <CameraImage src={`${imageBase}/${group.wrist.imageId}`} alt={group.wrist.description} />
            </div>
          )}
          {group.external && (
            <div className="flex-1 min-w-0">
              <CameraLabel camera="zed" />
              <CameraImage src={`${imageBase}/${group.external.imageId}`} alt={group.external.description} />
            </div>
          )}
          {!group.wrist && !group.external && (
            <div className="flex-1 text-center py-8" style={{ color: GRAY_400 }}>No images available</div>
          )}
        </div>

        {/* Log-derived caption: what was happening when the image was taken */}
        {group.logCaption && (
          <div
            className="mx-3 mb-3 px-3 py-2 rounded-lg text-[12px]"
            style={{
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span style={{ color: GRAY_400, fontWeight: 600, marginRight: 6 }}>
              {group.capturedAt ? localHHMMSS(group.capturedAt) : ''}
            </span>
            {group.logCaption}
          </div>
        )}

        {/* Vision AI caption */}
        <div className="px-3 pb-3">
          <VisionCaption imageIds={allIds} failureContext={failCtx} />
        </div>

        {/* Navigation arrows (between failure events) */}
        {groups.length > 1 && (
          <>
            <button
              onClick={() => setEventIdx(i => (i - 1 + groups.length) % groups.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center border-0 cursor-pointer"
              style={{ background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 18 }}
            >
              ‹
            </button>
            <button
              onClick={() => setEventIdx(i => (i + 1) % groups.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center border-0 cursor-pointer"
              style={{ background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 18 }}
            >
              ›
            </button>
            <div className="absolute top-3 right-14 text-[11px] font-medium px-2 py-1 rounded"
              style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)' }}>
              {eventIdx + 1} / {groups.length}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

function ExpandedDetail({ order, history, onAskRobi }) {
  const allImages = useMemo(() => collectOrderImages(order), [order])
  const [showOverlay, setShowOverlay] = useState(false)
  const [overrides, setOverrides] = useState({})
  const { robotId, profile } = useRobot()
  const imageBase = `${dataBase()}/api/images`

  // Same rows as the Live pipeline: time against typical, the numbers, Why, grasp tries, raw log
  // the list endpoint says which robot an order belongs to; fall back to the selected one
  const robotOrder = useMemo(() => (order.robot ? order : { ...order, robot: robotId }), [order, robotId])
  const rows = useMemo(() => deriveOrderSteps(robotOrder, history), [robotOrder, history])
  const headline = orderHeadline(robotOrder)
  const judgeView = useMemo(() => orderCriticView(robotOrder), [robotOrder])
  const cf = useMemo(() => orderCounterfactual(robotOrder, history), [robotOrder, history])
  const context = useMemo(
    () => (profile.id === 'bar' ? barContextSentence(history) : contextSentence(history, order.item, order.retries || 0)),
    [history, order.item, order.retries, profile.id],
  )
  const isOpen = (r) => (overrides[r.key] === undefined ? !!r.openDefault : overrides[r.key])
  const toggle = (r) => setOverrides(o => ({ ...o, [r.key]: !(o[r.key] === undefined ? !!r.openDefault : o[r.key]) }))
  const bad = order.status === 'failed'

  return (
    <div className="px-4 py-4 border-t border-solid" style={{ borderColor: TEAL_200, background: 'white' }}>
      {/* What happened, in a sentence, and how this kind of order usually goes */}
      {(headline || context) && (
        <div className="mb-4 flex flex-col gap-1.5 text-[13px] leading-snug">
          {headline && (
            <div className={`px-3 py-2.5 rounded-[10px] font-semibold ${bad ? 'bg-[var(--danger-bg)] text-[var(--danger-text)]' : 'bg-[var(--warning-bg)] text-[var(--warning-text)]'}`}>
              {headline}
            </div>
          )}
          {context && (
            <div className="flex items-start gap-2 px-1 text-[var(--text-secondary)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[2px]" aria-hidden>
                <path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-6" />
              </svg>
              <span>{context}</span>
            </div>
          )}
        </div>
      )}

      {/* What could have changed this, and where the item was */}
      {cf && (
        <div className="mb-4 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <section aria-label="What could have changed this" className="rounded-xl border border-solid border-[var(--border)] p-4 bg-[#fcfcfd]" style={{ gridColumn: 'span 2' }}>
            <CardHeader card={{ title: 'What could have changed this?' }} />
            <p className="m-0 mt-2.5 text-[15px] leading-[1.45] font-medium">{cf.sentence}</p>
            {cf.tiles && <Tiles tiles={cf.tiles} />}
            <p className="m-0 mt-2.5 text-[12px] leading-[1.4] text-[var(--text-secondary)]">{cf.caption}</p>
          </section>
          <section aria-label="Where it was" className="rounded-xl border border-solid border-[var(--border)] p-4 bg-[#fcfcfd]">
            <h3 className="m-0 text-[15px] font-bold">Where it was</h3>
            <div className="mt-2"><ShelfMap map={cf.map} /></div>
            <div className="mt-2 text-[14px] font-semibold">{cf.where.charAt(0).toUpperCase() + cf.where.slice(1)}</div>
            <div className="mt-2"><MapLegend /></div>
          </section>
        </div>
      )}

      {/* What the AI Judge (independent camera + AI model) said about this order */}
      <SmartJudgeBox view={judgeView} compact />

      {/* Failure camera feed thumbnail — click to open overlay */}
      {allImages.length > 0 && (
        <div
          className="mb-4 rounded-lg overflow-hidden cursor-pointer relative"
          style={{ background: '#1a1a2e' }}
          onClick={() => setShowOverlay(true)}
        >
          <div className="flex gap-1" style={{ height: 140 }}>
            {allImages.slice(0, 2).map((img, i) => (
              <img key={i}
                src={`${imageBase}/${img.imageId}`}
                alt={img.description}
                loading="eager"
                style={{ flex: 1, objectFit: 'cover', display: 'block', minWidth: 0, height: '100%' }}
              />
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }}>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}>
              <CameraIcon />
              <span className="text-[12px] font-semibold">View camera feed ({allImages.length})</span>
            </div>
          </div>
        </div>
      )}
      {showOverlay && (
        <ImageOverlay images={allImages} order={order} onClose={() => setShowOverlay(false)} />
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-semibold" style={{ color: GRAY_900 }}>Step-by-step</div>
        <span className="text-[12px]" style={{ color: GRAY_500 }}>Tap a step to see why</span>
      </div>
      <StepList rows={rows} isOpen={isOpen} onToggle={toggle} />

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-solid" style={{ borderColor: GRAY_200 }}>
        <button onClick={() => onAskRobi?.(order)} className="btn btn-sm btn-accent">
          {order.status === 'failed'
            ? (profile.id === 'bar' ? 'Why did this fail?' : 'Why did you fail?')
            : (profile.id === 'bar' ? 'Why this drink? Ask the Barista' : 'Why so long? Ask ROBI')}
        </button>
      </div>
    </div>
  )
}

// ── Item filter: a multi-select dropdown (replaces one chip per item) ───────────

function ItemDropdown({ options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  // The card clips its children, so the menu is drawn in a portal, positioned under the button.
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const width = 260
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    place()
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  // keep a selected item listed even when the status filter leaves it with no orders
  const names = useMemo(() => {
    const base = options.map(([n]) => n)
    for (const s of selected) if (!base.includes(s)) base.push(s)
    return base
  }, [options, selected])
  const countOf = (n) => (options.find(([k]) => k === n) || [n, 0])[1]

  const label = selected.length === 0 ? 'Item' : selected.length === 1 ? selected[0] : `${selected.length} items`
  const toggle = (n) => onChange(selected.includes(n) ? selected.filter(x => x !== n) : [...selected, n])

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={`btn btn-sm rounded-full gap-1.5 ${selected.length ? 'btn-neutral' : 'btn-outline'}`}
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && ReactDOM.createPortal(
        <div
          ref={menuRef}
          role="group"
          aria-label="Filter by item"
          className="fixed w-[260px] rounded-xl overflow-hidden bg-white border border-solid"
          style={{ top: pos.top, left: pos.left, zIndex: 9000, borderColor: GRAY_200, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)' }}
        >
          <div className="px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: GRAY_500 }}>Filter by item</div>
          <div className="flex flex-col pb-1 max-h-[280px] overflow-auto">
            {names.map(n => (
              <label key={n} className="flex items-center gap-2.5 px-4 py-[7px] cursor-pointer hover:bg-[#f9fafb]">
                <input
                  type="checkbox"
                  checked={selected.includes(n)}
                  onChange={() => toggle(n)}
                  className="checkbox checkbox-sm checkbox-accent"
                />
                <span className="flex-1 min-w-0 text-[14px]" style={{ color: GRAY_900 }}>{n}</span>
                <span className="text-[12px] shrink-0" style={{ color: GRAY_500 }}>{countOf(n)}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-solid" style={{ borderColor: GRAY_200 }}>
            <button type="button" onClick={() => onChange([])} className="btn btn-xs btn-ghost" style={{ color: GRAY_500 }}>Clear</button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-xs btn-neutral">Done</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default function OrdersList({ dateFrom, dateTo, onCitationClick, onAskRobi }) {
  const { history } = useDataSource()
  const { robotId, profile } = useRobot()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [items, setItems] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [expandedGroups, setExpandedGroups] = useState({})

  const from = dateFrom || todayStr()
  const to = dateTo || todayStr()
  const itemParam = items.length ? items.join(',') : 'all'

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ from, to, status: statusFilter, item: itemParam })
    fetch(`${dataBase()}/api/orders/list?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [from, to, statusFilter, itemParam, robotId])

  // Reset filters when date range changes
  useEffect(() => {
    setStatusFilter('all')
    setItems([])
    setExpandedId(null)
    setExpandedGroups({})
  }, [from, to, robotId])

  const counts = data?.counts || { all: 0, delivered: 0, warning: 0, failed: 0, by_item: {} }
  const orders = data?.orders || []
  const hasFilters = statusFilter !== 'all' || items.length > 0
  const clearAll = () => { setStatusFilter('all'); setItems([]) }

  // Group orders by date
  const grouped = useMemo(() => {
    const groups = {}
    for (const o of orders) {
      const date = (o.completed_at || o.started_at || '').slice(0, 10)
      if (!groups[date]) groups[date] = []
      groups[date].push(o)
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
  }, [orders])

  const itemOptions = useMemo(() => Object.entries(counts.by_item || {}).sort((a, b) => b[1] - a[1]), [counts.by_item])

  const showPhotos = !profile.noImages || orders.some(o => imageCount(o) > 0)
  const COLS = colsFor(showPhotos)
  const totalInRange = counts.all
  const rangeDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)
  const rangeLabel = rangeDays <= 1 ? 'today' : `the last ${rangeDays} days`

  if (loading && !data) {
    return (
      <Card>
        <div className="flex flex-col gap-3">
          <div className="skeleton h-6 w-48 rounded" />
          <div className="flex gap-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-8 w-20 rounded-full" />)}</div>
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
        </div>
      </Card>
    )
  }

  const chip = (key, text, count, dim) => (
    <button
      key={key}
      onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
      aria-pressed={statusFilter === key}
      className={`btn btn-sm rounded-full ${statusFilter === key ? 'btn-neutral' : 'btn-outline'}`}
      style={dim ? { opacity: 0.6 } : undefined}
    >
      {text} <span className="opacity-60">{count}</span>
    </button>
  )

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-[clamp(16px,2.2vw,19px)] font-semibold" style={{ color: GRAY_900, margin: 0 }}>{profile.nouns.Orders}</h2>
          <div className="text-[12px]" style={{ color: GRAY_500 }}>{totalInRange} in {rangeLabel}</div>
        </div>
      </div>

      {/* Filters — status chips plus a multi-select item dropdown, combined with AND.
          Clicking an active status chip clears it; "All" resets everything. */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button
          onClick={clearAll}
          aria-pressed={!hasFilters}
          className={`btn btn-sm rounded-full ${!hasFilters ? 'btn-neutral' : 'btn-outline'}`}
        >
          All <span className="opacity-60">{counts.all}</span>
        </button>
        {chip('delivered', profile.labels.chipDelivered, counts.delivered, false)}
        {chip('warning', profile.labels.chipWarning, counts.warning, counts.warning === 0)}
        {chip('failed', profile.labels.chipFailed, counts.failed, counts.failed === 0)}

        {/* Filtering by item only makes sense when there is more than one item (the bar only has bottles) */}
        {profile.hasItemFilter && (itemOptions.length > 0 || items.length > 0) && (
          <>
            <div style={{ width: 1, height: 16, background: GRAY_200, margin: '0 4px' }} />
            <ItemDropdown options={itemOptions} selected={items} onChange={setItems} />
          </>
        )}

        {hasFilters && (
          <button
            onClick={clearAll}
            className="btn btn-xs btn-ghost rounded-full ml-auto tooltip tooltip-left"
            data-tip="Clear all filters"
          >
            Clear filters ×
          </button>
        )}
      </div>

      {/* Orders grouped by date, as a table: Item | Order | Time | Took | Photos | Status */}
      <div className="mt-4 flex flex-col gap-4">
        {orders.length === 0 ? (
          <div className="text-center py-8">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="1.5" className="mx-auto mb-2">
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <path d="M8 7h8M8 11h5" />
            </svg>
            <div className="text-[13px]" style={{ color: GRAY_500 }}>
              {hasFilters
                ? 'No orders match these filters.'
                : from === to ? 'No orders in this range.' : "ROBI hasn't completed any orders yet. Once it does, they'll show up here."}
            </div>
            {hasFilters && (
              <button onClick={clearAll} className="btn btn-ghost btn-sm mt-2" style={{ color: 'var(--teal, #0d9488)' }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          grouped.map(([date, dateOrders]) => {
            const isExpanded = expandedGroups[date]
            const visibleOrders = isExpanded ? dateOrders : dateOrders.slice(0, PAGE_SIZE)
            const remaining = dateOrders.length - PAGE_SIZE

            return (
              <div key={date}>
                {/* Date divider */}
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: GRAY_500 }}>
                    {formatDateLabel(date)}
                  </span>
                  <div className="flex-1 border-t border-solid" style={{ borderColor: GRAY_200 }} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: GRAY_500 }}>
                    {dateOrders.length} {dateOrders.length !== 1 ? profile.nouns.orders : profile.nouns.order}
                  </span>
                </div>

                {/* Column headings */}
                <div
                  className="grid items-center gap-3 px-2 pb-2 border-b border-solid text-[11px] font-bold uppercase tracking-[0.06em]"
                  style={{ gridTemplateColumns: COLS, borderColor: GRAY_200, color: GRAY_500 }}
                >
                  <span>{profile.itemLabel}</span>
                  <span>Order</span>
                  <span>Time</span>
                  <span>Took</span>
                  {showPhotos && <span title="Photos taken" className="flex items-center"><CameraIcon /><span className="sr-only">Photos</span></span>}
                  <span>Status</span>
                  <span />
                </div>

                <div className="flex flex-col">
                  {visibleOrders.map(order => {
                    const isOpen = expandedId === order.id
                    const photos = imageCount(order)
                    return (
                      <div
                        key={order.id}
                        id={`order-${order.id}`}
                        className="rounded-lg"
                        style={isOpen ? { background: 'white', boxShadow: `inset 0 0 0 1px ${TEAL_200}` } : undefined}
                      >
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setExpandedId(isOpen ? null : order.id)}
                          className="grid items-center gap-3 w-full text-left border-0 bg-transparent px-2 py-[9px] rounded-lg cursor-pointer hover:bg-[#f5f6f8]"
                          style={{ gridTemplateColumns: COLS }}
                        >
                          <span className="flex items-center gap-2 min-w-0 text-[13px] font-semibold" style={{ color: GRAY_900 }}>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_DOT[order.status] || GRAY_400 }} />
                            <span className="truncate">{profile.itemText(order)}</span>
                          </span>
                          <span className="text-[12px] font-mono" style={{ color: GRAY_500 }}>#{order.order_number || order.id}</span>
                          <span className="text-[12px] font-mono whitespace-nowrap" style={{ color: GRAY_500 }}>{formatTime(order.completed_at || order.started_at)}</span>
                          <span className="text-[12px] font-mono" style={{ color: GRAY_500 }}>{order.robot_seconds}s</span>
                          {showPhotos && <span className="flex items-center">
                            {photos > 0 && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(244,63,94,0.08)', color: ROSE_500 }}
                                title={`${photos} photo${photos === 1 ? '' : 's'} taken`}
                              >
                                <CameraIcon />
                                <span className="text-[11px] font-semibold">{photos}</span>
                              </span>
                            )}
                          </span>}
                          <span><StatusPill status={order.status} failure={order.failure} profile={profile} /></span>
                          <svg
                            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="2"
                            style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} aria-hidden
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                        {isOpen && <ExpandedDetail order={order} history={history} onAskRobi={onAskRobi} />}
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {!isExpanded && remaining > 0 && (
                  <button
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [date]: true }))}
                    className="btn btn-ghost btn-sm w-full mt-2"
                    style={{ color: 'var(--teal, #0d9488)' }}
                  >
                    Show {remaining} more from {formatDateLabel(date).split(' · ')[0].toLowerCase()} →
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
