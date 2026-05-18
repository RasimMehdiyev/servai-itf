import React, { useState, useEffect, useMemo, useCallback } from 'react'
import ReactDOM from 'react-dom'
import Card from '../../../components/ui/Card'
import AiCaption from './AiCaption'
import useRagCaption from '../../../hooks/useRagCaption'

const EMERALD_50 = '#ecfdf5'
const EMERALD_100 = '#d1fae5'
const EMERALD_500 = '#10b981'
const EMERALD_700 = '#047857'
const ROSE_50 = '#fff1f2'
const ROSE_100 = '#ffe4e6'
const ROSE_500 = '#f43f5e'
const ROSE_700 = '#be123c'
const AMBER_50 = '#fefce8'
const AMBER_100 = '#fef9c3'
const AMBER_500 = '#ca8a04'
const AMBER_700 = '#854d0e'
const GRAY_50 = '#f9fafb'
const GRAY_100 = '#f3f4f6'
const GRAY_200 = '#e5e7eb'
const GRAY_400 = '#9ca3af'
const GRAY_500 = '#6b7280'
const GRAY_700 = '#374151'
const GRAY_900 = '#111827'
const TEAL_200 = '#99f6e4'

import { getApiBase, getRagBase } from '../../../lib/urls'

const DATA_BASE = getApiBase()
const PAGE_SIZE = 5

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

function StatusIcon({ status }) {
  if (status === 'success' || status === 'ok') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: EMERALD_50, borderColor: EMERALD_100 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={EMERALD_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    )
  }
  if (status === 'warning') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: AMBER_50, borderColor: AMBER_100 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={AMBER_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: ROSE_50, borderColor: ROSE_100 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ROSE_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: GRAY_50, borderColor: GRAY_200 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </div>
  )
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
}

function StatusPill({ status, failure }) {
  if (status === 'success' || status === 'ok') {
    return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: EMERALD_50, color: EMERALD_700, border: `1px solid ${EMERALD_100}` }}>Delivered</span>
  }
  const reasonLabel = failure?.reason ? REASON_SHORT[failure.reason] : null
  if (status === 'warning') {
    return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: AMBER_50, color: AMBER_700, border: `1px solid ${AMBER_100}` }}>{reasonLabel || 'Warning'}</span>
  }
  if (status === 'failed') {
    return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: ROSE_50, color: ROSE_700, border: `1px solid ${ROSE_100}` }}>{reasonLabel || 'Failed'}</span>
  }
  return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: GRAY_50, color: GRAY_500, border: `1px solid ${GRAY_200}` }}>Unknown</span>
}

function formatMeta(phase) {
  const meta = phase.meta || {}
  if (!meta || Object.keys(meta).length === 0 || (Object.keys(meta).length === 1 && meta.raw_event_count != null)) return null
  const parts = []
  if (meta.candidates != null) parts.push(`${meta.candidates} candidates`)
  if (meta.chosen_score != null) parts.push(`score ${meta.chosen_score}`)
  if (meta.chosen_distance_cm != null) parts.push(`${meta.chosen_distance_cm}cm away`)
  if (meta.molmo_points != null) parts.push(`${meta.molmo_points} grasp points`)
  if (meta.grasp_width_mm != null) parts.push(`${meta.grasp_width_mm}mm grip`)
  if (meta.depth_offset_mm != null) parts.push(`${meta.depth_offset_mm}mm depth offset`)
  if (meta.gripper_opening != null) parts.push(`gripper ${meta.gripper_opening}`)
  if (meta.success === true) parts.push('grip OK')
  if (meta.success === false) parts.push('grip failed')
  if (meta.target_waypoint) parts.push(`→ ${meta.target_waypoint}`)
  return parts.length > 0 ? parts.join(', ') : null
}

function StepIcon({ status }) {
  if (status === 'failed') {
    return (
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: ROSE_50, border: `1px solid ${ROSE_100}` }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ROSE_500} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
    )
  }
  if (status === 'warning') {
    return (
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: AMBER_50, border: `1px solid ${AMBER_100}` }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={AMBER_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: EMERALD_50, border: `1px solid ${EMERALD_100}` }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={EMERALD_500} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
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
    groups.push({ key, wrist, external, phase: img.phase })
  }
  return groups
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
  const imageBase = `${DATA_BASE}/api/images`

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
        <div className="flex gap-2 p-3" style={{ overflow: 'auto', maxHeight: 'calc(85vh - 140px)' }}>
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

function ExpandedDetail({ order, onAskRobi }) {
  const phases = order.phases || []
  const allImages = useMemo(() => collectOrderImages(order), [order])
  const [showOverlay, setShowOverlay] = useState(false)
  const imageBase = `${DATA_BASE}/api/images`

  return (
    <div className="px-4 py-4 border-t border-solid" style={{ borderColor: TEAL_200, background: 'white' }}>
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
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.6)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span className="text-[12px] font-semibold" style={{ color: 'white' }}>View camera feed ({allImages.length})</span>
            </div>
          </div>
        </div>
      )}
      {showOverlay && (
        <ImageOverlay images={allImages} order={order} onClose={() => setShowOverlay(false)} />
      )}

      <div className="text-[13px] font-semibold mb-3" style={{ color: GRAY_900 }}>Step-by-step</div>
      <div className="flex flex-col gap-2.5">
        {phases.map((phase, i) => {
          const metaText = formatMeta(phase)
          const failPhase = order.failure?.at_phase
          const stepStatus = phase.status || (failPhase === phase.phase ? (order.status === 'warning' ? 'warning' : 'failed') : 'ok')
          const nameColor = stepStatus === 'failed' ? ROSE_700 : stepStatus === 'warning' ? AMBER_700 : GRAY_900
          return (
            <div key={i} className="flex items-start gap-3">
              <StepIcon status={stepStatus} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px]" style={{ color: nameColor }}>
                  {phase.friendly_name || phase.phase}
                </div>
                {phase.failure_detail && (
                  <div className="text-[11px] mt-0.5" style={{ color: stepStatus === 'failed' ? ROSE_500 : AMBER_500 }}>{phase.failure_detail}</div>
                )}
                {metaText && (
                  <div className="text-[11px] mt-0.5" style={{ color: GRAY_400 }}>{metaText}</div>
                )}
              </div>
              <div className="text-[12px] font-mono shrink-0" style={{ color: GRAY_500 }}>
                {phase.duration_seconds}s
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-solid" style={{ borderColor: GRAY_200 }}>
        <button
          onClick={() => onAskRobi?.(order)}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold border-0 cursor-pointer hover:opacity-90"
          style={{ background: 'var(--teal, #0d9488)', color: 'white' }}
        >
          {order.status === 'failed' ? 'Why did you fail?' : 'Why so long? Ask ROBI'}
        </button>
        <span className="text-[12px] cursor-pointer hover:underline" style={{ color: GRAY_400 }}>
          View full log →
        </span>
      </div>
    </div>
  )
}

export default function OrdersList({ dateFrom, dateTo, onCitationClick, onAskRobi }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [itemFilter, setItemFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [expandedGroups, setExpandedGroups] = useState({})

  const from = dateFrom || todayStr()
  const to = dateTo || todayStr()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ from, to, status: statusFilter, item: itemFilter })
    fetch(`${DATA_BASE}/api/orders/list?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [from, to, statusFilter, itemFilter])

  // Reset filters when date range changes
  useEffect(() => {
    setStatusFilter('all')
    setItemFilter('all')
    setExpandedId(null)
    setExpandedGroups({})
  }, [from, to])

  const counts = data?.counts || { all: 0, delivered: 0, warning: 0, failed: 0, by_item: {} }
  const orders = data?.orders || []

  // Build stats from loaded data so the LLM uses the same numbers the UI shows
  const captionStats = useMemo(() => {
    if (!data) return null
    return {
      total: counts.all,
      delivered: counts.delivered,
      warning: counts.warning,
      failed: counts.failed,
      filtered_count: orders.length,
    }
  }, [data, counts.all, counts.delivered, counts.warning, counts.failed, orders.length])

  const {
    caption, loading: captionLoading, error: captionError,
    stale: captionStale,
    generate: generateCaption, refresh: refreshCaption,
  } = useRagCaption('orders_list', { from, to, status: statusFilter }, captionStats, data?.cached_caption)

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

  const itemChips = useMemo(() => {
    return Object.entries(counts.by_item || {}).sort((a, b) => b[1] - a[1])
  }, [counts.by_item])

  function chipStyle(active) {
    return active
      ? { background: GRAY_900, color: 'white', borderColor: GRAY_900 }
      : { background: 'white', color: GRAY_700, borderColor: GRAY_200 }
  }

  const totalInRange = counts.all
  const rangeDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)
  const rangeLabel = rangeDays <= 1 ? 'today' : rangeDays <= 7 ? `the last ${rangeDays} days` : `the last ${rangeDays} days`

  if (loading && !data) {
    return (
      <Card>
        <div className="animate-pulse flex flex-col gap-3">
          <div className="h-6 w-48 rounded" style={{ background: GRAY_100 }} />
          <div className="flex gap-2">{[1, 2, 3].map(i => <div key={i} className="h-8 w-20 rounded-full" style={{ background: GRAY_100 }} />)}</div>
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg" style={{ background: GRAY_50 }} />)}
        </div>
      </Card>
    )
  }

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-[clamp(16px,2.2vw,19px)] font-semibold" style={{ color: GRAY_900, margin: 0 }}>Orders</h2>
          <div className="text-[12px]" style={{ color: GRAY_500 }}>{totalInRange} in {rangeLabel}</div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button
          onClick={() => { setStatusFilter('all'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={chipStyle(statusFilter === 'all' && itemFilter === 'all')}
        >
          All <span style={{ color: statusFilter === 'all' && itemFilter === 'all' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.all}</span>
        </button>
        <button
          onClick={() => { setStatusFilter('delivered'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={chipStyle(statusFilter === 'delivered')}
        >
          ✓ Delivered <span style={{ color: statusFilter === 'delivered' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.delivered}</span>
        </button>
        <button
          onClick={() => { setStatusFilter('warning'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={{ ...chipStyle(statusFilter === 'warning'), opacity: counts.warning === 0 ? 0.6 : 1 }}
        >
          ⚠ Warnings <span style={{ color: statusFilter === 'warning' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.warning}</span>
        </button>
        <button
          onClick={() => { setStatusFilter('failed'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={{ ...chipStyle(statusFilter === 'failed'), opacity: counts.failed === 0 ? 0.6 : 1 }}
        >
          ✕ Failed <span style={{ color: statusFilter === 'failed' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.failed}</span>
        </button>

        {itemChips.length > 0 && (
          <>
            <div style={{ width: 1, height: 16, background: GRAY_200, margin: '0 4px' }} />
            {itemChips.map(([name, count]) => (
              <button
                key={name}
                onClick={() => { setItemFilter(itemFilter === name ? 'all' : name); setStatusFilter('all') }}
                className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
                style={chipStyle(itemFilter === name)}
              >
                {name} <span style={{ color: itemFilter === name ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{count}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* AI caption */}
      <AiCaption
        caption={caption}
        loading={captionLoading}
        error={captionError}
        stale={captionStale}
        onCitationClick={onCitationClick}
        onGenerate={generateCaption}
        onRefresh={refreshCaption}
      />

      {/* Orders grouped by date */}
      <div className="mt-4 flex flex-col gap-4">
        {orders.length === 0 ? (
          <div className="text-center py-8">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="1.5" className="mx-auto mb-2">
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <path d="M8 7h8M8 11h5" />
            </svg>
            <div className="text-[13px]" style={{ color: GRAY_500 }}>
              {statusFilter !== 'all' || itemFilter !== 'all'
                ? 'No orders match these filters.'
                : from === to ? 'No orders in this range.' : "ROBI hasn't completed any orders yet. Once it does, they'll show up here."}
            </div>
            {(statusFilter !== 'all' || itemFilter !== 'all') && (
              <button
                onClick={() => { setStatusFilter('all'); setItemFilter('all') }}
                className="mt-2 text-[12px] font-medium cursor-pointer border-0 bg-transparent"
                style={{ color: 'var(--teal, #0d9488)' }}
              >
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
                <div className="flex items-center gap-3 mb-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: GRAY_500 }}>
                    {formatDateLabel(date)}
                  </span>
                  <div className="flex-1 border-t border-solid" style={{ borderColor: GRAY_200 }} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: GRAY_500 }}>
                    {dateOrders.length} order{dateOrders.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Order rows */}
                <div className="flex flex-col gap-1.5">
                  {visibleOrders.map(order => {
                    const isOpen = expandedId === order.id
                    return (
                      <div key={order.id} id={`order-${order.id}`}>
                        <div
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-solid cursor-pointer transition-all"
                          style={{
                            background: isOpen ? 'white' : GRAY_50,
                            borderColor: isOpen ? TEAL_200 : GRAY_100,
                            boxShadow: isOpen ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                          }}
                          onClick={() => setExpandedId(isOpen ? null : order.id)}
                        >
                          <StatusIcon status={order.status} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold" style={{ color: GRAY_900 }}>
                              {order.item}
                            </div>
                            <div className="text-[11px]" style={{ color: GRAY_400 }}>
                              Order #{order.order_number || order.id}
                            </div>
                            <div className="text-[11px] mt-0.5" style={{ color: GRAY_500 }}>
                              Took {order.robot_seconds}s · {order.status === 'success' || order.status === 'ok' ? 'handed over' : 'ended'} at {formatTime(order.completed_at || order.started_at)}
                            </div>
                          </div>
                          <StatusPill status={order.status} failure={order.failure} />
                          {hasImages(order) && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.08)' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ROSE_500} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                                <circle cx="12" cy="13" r="4" />
                              </svg>
                              <span className="text-[10px] font-semibold" style={{ color: ROSE_500 }}>{imageCount(order)}</span>
                            </span>
                          )}
                          <svg
                            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="2"
                            style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', shrinkFlexGrow: 0 }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </div>
                        {isOpen && <ExpandedDetail order={order} onAskRobi={onAskRobi} />}
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {!isExpanded && remaining > 0 && (
                  <button
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [date]: true }))}
                    className="mt-2 text-[12px] font-medium cursor-pointer border-0 bg-transparent w-full text-center py-1.5"
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
