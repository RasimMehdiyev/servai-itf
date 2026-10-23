import React from 'react'
import Card from '../../../components/ui/Card'
import { useDataSource } from '../../../context/DataSourceContext'
import useNow from '../../../hooks/useNow'
import { deriveNowServing } from '../../../lib/liveView'
import { clock } from '../../../lib/logTranslate'
import { criticView } from '../../../lib/critic'
import SmartJudgeBox from '../../../components/ui/SmartJudge'
import { useRobot } from '../../../robots/RobotContext'

const PILL = {
  green:   { text: 'On track',          cls: 'bg-[var(--success-bg)] text-[var(--success-text)]' },
  orange:  { text: 'Working through it', cls: 'bg-[var(--warning-bg)] text-[var(--warning-text)]' },
  red:     { text: 'Needs help',        cls: 'bg-[var(--danger-bg)] text-[var(--danger-text)]' },
  waiting: { text: 'Robot offline',     cls: 'bg-[var(--warning-bg)] text-[var(--warning-text)]' },
}

export function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

export function formatSeconds(sec) {
  if (!sec || sec <= 0) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

// ── Step bar ─────────────────────────────────────────────────────────────────
// One segment per pipeline step, so a step that is amber or red stays amber or
// red — a single percentage bar can't say that.

const SEG_COLOR = {
  done: 'var(--success)',
  warn: 'var(--warning)',
  active: 'var(--primary)',
  activeWarn: 'var(--warning)',
  fail: 'var(--danger)',
  pending: 'var(--border)',
}

function StepBar({ seg, label }) {
  if (!seg.length) return null
  return (
    <div className="mt-4">
      <div className="flex gap-[3px] h-2.5" role="img" aria-label={label || 'Progress through the pipeline steps'}>
        {seg.map((s, i) => (
          <span
            key={i}
            className="flex-1 rounded-[5px] transition-colors duration-300"
            style={{ background: SEG_COLOR[s] || SEG_COLOR.pending }}
          />
        ))}
      </div>
      {label && (
        <div className="mt-1.5 text-[clamp(12px,1.5vw,13px)] font-medium text-[var(--text-secondary)]">{label}</div>
      )}
    </div>
  )
}

// ── What happened, and why ───────────────────────────────────────────────────

const TONE = {
  green:   { bg: 'bg-[var(--success-bg)]', text: 'text-[var(--success-text)]', dot: 'bg-[var(--success)]' },
  orange:  { bg: 'bg-[var(--warning-bg)]', text: 'text-[var(--warning-text)]', dot: 'bg-[var(--warning)]' },
  red:     { bg: 'bg-[var(--danger-bg)]',  text: 'text-[var(--danger-text)]',  dot: 'bg-[var(--danger)]'  },
}

function Headline({ cardState, text, evidence }) {
  const t = TONE[cardState] || TONE.green
  return (
    <div className={`mt-4 px-3 py-3 rounded-[10px] ${t.bg}`}>
      <div className="flex items-start gap-2.5">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-[7px] ${t.dot} ${cardState === 'red' ? 'step-halo step-halo-red' : ''}`} />
        <span className={`text-[clamp(14px,1.8vw,16px)] font-semibold leading-snug ${t.text}`}>{text}</span>
      </div>
      {evidence.length > 0 && (
        <dl className="m-0 mt-2.5 ml-5 flex flex-col gap-1.5">
          {evidence.map(e => (
            <div key={e.label} className="grid grid-cols-[minmax(0,132px)_auto_minmax(0,1fr)] gap-x-2.5 items-baseline text-[clamp(12px,1.5vw,13px)]">
              <dt className="text-[var(--text-secondary)]">{e.label}</dt>
              <dd className="m-0 font-bold tabular-nums text-[var(--text-primary)]">{e.value}</dd>
              <dd className="m-0 text-[var(--text-secondary)]">{e.note}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function InfoRow({ icon, children, strong }) {
  return (
    <div className="flex items-start gap-2.5">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[3px]" aria-hidden>
        {icon}
      </svg>
      <span className={strong ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>{children}</span>
    </div>
  )
}

const ICON_NEXT = <path d="M5 12h14M13 6l6 6-6 6" />
const ICON_INFO = <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>
const ICON_TREND = <><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-6" /></>

function NextSteps({ next, ifWrong, context }) {
  if (!next && !ifWrong && !context) return null
  return (
    <div className="mt-3 flex flex-col gap-1.5 text-[clamp(12px,1.5vw,13px)] leading-snug">
      {next && <InfoRow icon={ICON_NEXT} strong>{next}</InfoRow>}
      {ifWrong && <InfoRow icon={ICON_INFO}>{ifWrong}</InfoRow>}
      {context && <InfoRow icon={ICON_TREND}>{context}</InfoRow>}
    </div>
  )
}

// ── Actions (unchanged behaviour) ────────────────────────────────────────────

// Pick an action-button set that actually matches the problem the robot is
// stuck on, instead of always offering "I'll restock the shelf".
function orangeActionContext({ retryCount, explanationText }) {
  const t = (explanationText || '').toLowerCase()

  // Grasp-side trouble: multiple retries, "path blocked", reachability, collision
  if (retryCount >= 2 || /path blocked|reach|collision|grasp/.test(t)) {
    return {
      primary: { id: 'reposition', label: 'I\'ll reposition the item' },
      secondaries: [
        { id: 'out_of_stock', label: 'Tell customer we\'re out' },
        { id: 'cancel', label: 'Cancel this order', danger: true },
      ],
    }
  }

  // Bridge / hardware fault while not yet auto-recovered
  if (/fault|hardware|bridge|recover/.test(t)) {
    return {
      primary: { id: 'on_my_way', label: 'I\'m on my way' },
      secondaries: [
        { id: 'cancel', label: 'Cancel this order', danger: true },
      ],
    }
  }

  // Default: search failure (couldn't find the item on any shelf)
  return {
    primary: { id: 'restock', label: 'I\'ll restock the shelf' },
    secondaries: [
      { id: 'out_of_stock', label: 'Tell customer we\'re out' },
      { id: 'cancel', label: 'Cancel this order', danger: true },
    ],
  }
}

function Actions({ cardState, onIntervene, retryCount, explanationText, showActions, custom, noun = 'order' }) {
  // the robot's own set of buttons (the bar's "I've refilled the rack")
  if (custom && (cardState === 'red' || cardState === 'orange')) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <button onClick={() => onIntervene?.(custom.primary.id)} className="btn btn-primary w-full">
          {custom.primary.label}
        </button>
        {custom.secondaries?.length > 0 && (
          <div className="flex gap-2">
            {custom.secondaries.map(b => (
              <button key={b.id} onClick={() => onIntervene?.(b.id)} className={`btn btn-sm btn-outline flex-1 ${b.danger ? 'btn-error' : 'btn-primary'}`}>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (cardState === 'red') {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <button onClick={() => onIntervene?.('on_my_way')} className="btn btn-primary w-full">
          I'm on my way
        </button>
        <div className="flex gap-2">
          <button onClick={() => onIntervene?.('delayed')} className="btn btn-sm btn-outline btn-primary flex-1">
            Tell customer it's delayed
          </button>
          <button onClick={() => onIntervene?.('cancel')} className="btn btn-sm btn-outline btn-error flex-1">
            Cancel this {noun}
          </button>
        </div>
      </div>
    )
  }
  if (cardState === 'orange' && showActions) {
    const ctx = orangeActionContext({ retryCount, explanationText })
    return (
      <div className="mt-4 flex flex-col gap-2">
        <button onClick={() => onIntervene?.(ctx.primary.id)} className="btn btn-primary w-full">
          {ctx.primary.label}
        </button>
        <div className="flex gap-2">
          {ctx.secondaries.map(b => (
            <button
              key={b.id}
              onClick={() => onIntervene?.(b.id)}
              className={`btn btn-sm btn-outline flex-1 ${b.danger ? 'btn-error' : 'btn-primary'}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return null
}

function IdleBanner({ cardState, text }) {
  if (cardState === 'waiting') {
    return (
      <div className="mt-4 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--warning-bg)]">
        <span className="w-2.5 h-2.5 rounded-full shrink-0 animate-blink" style={{ background: 'var(--warning)' }} />
        <span className="text-[clamp(13px,1.5vw,15px)] font-medium text-[var(--warning-text)]">
          {text || 'Waiting for the robot to come online…'}
        </span>
      </div>
    )
  }
  const t = TONE[cardState] || TONE.green
  return (
    <div className={`mt-4 flex items-center gap-2.5 px-3 py-2.5 rounded-lg ${t.bg}`}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.dot}`} />
      <span className={`text-[clamp(13px,1.5vw,15px)] font-medium ${t.text}`}>{text || 'Everything is running fine'}</span>
    </div>
  )
}

// ── Issues in this order, attributed to a step ───────────────────────────────

function Issues({ issues }) {
  if (!issues.length) return null
  const shown = issues.slice(0, 4)
  const more = issues.length - shown.length
  return (
    <div className="mt-4">
      <div className="h-px bg-[var(--border)] mb-3" />
      <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Issues in this order</div>
      <div className="flex flex-col gap-1.5">
        {shown.map((f, i) => {
          const red = f.level === 'red'
          return (
            <div key={`${f.ts || ''}-${i}`} className={`flex items-start gap-2 px-3 py-2 rounded-lg ${red ? 'bg-[var(--danger-bg)]' : 'bg-[var(--warning-bg)]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-[7px] ${red ? 'bg-[var(--danger)]' : 'bg-[var(--warning)]'}`} />
              {f.ts && (
                <span className="text-[11px] font-mono tabular-nums shrink-0 mt-[2px] text-[var(--text-secondary)]">{clock(f.ts)}</span>
              )}
              {f.where && (
                <span className="shrink-0 px-1.5 rounded-md text-[11px] font-semibold leading-[18px] bg-[var(--surface)] text-[var(--text-secondary)] border border-solid border-[var(--border)]">
                  {f.where}
                </span>
              )}
              <span className={`text-[clamp(12px,1.4vw,13px)] ${red ? 'text-[var(--danger-text)]' : 'text-[var(--warning-text)]'}`}>{f.text}</span>
            </div>
          )
        })}
        {more > 0 && <div className="text-[12px] text-[var(--text-secondary)] pl-3">+ {more} earlier</div>}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AttentionPanel({ title, level, explanationText, style }) {
  const { liveData, history, sendMessage, sourceMode, connectionStatus, mode } = useDataSource()
  const { profile } = useRobot()
  const itemName = liveData?._itemName
  const cycleNum = liveData?._cycleNum
  const startedAt = liveData?._cycleStartedAt
  const isActive = !!itemName && !liveData?._cycleComplete && !liveData?._isAnomaly
  const waitingForHelp = !!itemName && !!liveData?._cycleComplete && liveData?._cardState === 'red'
  const now = useNow(isActive || waitingForHelp)
  const elapsed = startedAt ? now - startedAt : 0
  const retryCount = liveData?._retryCount || 0
  const waypointsSearched = liveData?._waypointsSearched?.length || 0

  // The robot link is "down" when the WS server told us it's waiting for the
  // robot, or when our own socket isn't up. Treat that as a distinct card state
  // so the panel doesn't claim everything is fine while the robot is offline.
  const robotOffline = mode !== 'mock'
    && (connectionStatus !== 'connected' || sourceMode === 'waiting')
  const cardState = robotOffline && !isActive
    ? 'waiting'
    : (liveData?._cardState || 'green')

  const view = liveData ? deriveNowServing(liveData, history, now) : null
  const judge = criticView(liveData)
  const basePill = cardState === 'orange' && view?.kind === 'search'
    ? { ...PILL.orange, text: "Can't find it" }
    : (PILL[cardState] || PILL.green)
  const pill = view?.pillText ? { ...basePill, text: view.pillText } : basePill

  // Only show action buttons once the robot has clearly tried a couple of times
  // (≥2 grasp retries or ≥2 waypoints searched) or once it has hit a red failure.
  // For transient warnings (bridge faults, first retry), let the robot recover on its own.
  const showActions = cardState === 'red' || retryCount >= 2 || waypointsSearched >= 2

  const waitingText = connectionStatus !== 'connected'
    ? 'Lost connection to the dashboard server — trying to reconnect…'
    : 'Waiting for the robot to come online…'

  const showDetail = (isActive || waitingForHelp) && view
  const onIntervene = (action) => sendMessage({ type: 'intervene', action })

  return (
    <Card style={style}>
      {/* Header row */}
      <div className="flex justify-between items-start gap-3 mb-1">
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Now serving</div>
          <h2 className="text-[clamp(22px,2.8vw,28px)] font-bold text-[var(--text-primary)] m-0 leading-tight">
            {itemName && (isActive || waitingForHelp)
              ? profile.heading(itemName)
              : cardState === 'waiting' ? 'Robot offline' : 'Idle'}
          </h2>
          <div className="flex items-center gap-3 mt-1 text-[clamp(13px,1.5vw,14px)] text-[var(--text-secondary)]">
            {(isActive || waitingForHelp) && cycleNum && <span>Order #{cycleNum}</span>}
            {!isActive && !waitingForHelp && cycleNum && cardState !== 'waiting' && (
              <span>Next: Order #{cycleNum + (liveData?._cycleComplete ? 1 : 0)}</span>
            )}
            {(isActive || waitingForHelp) && <span>· started {formatDuration(elapsed)} ago</span>}
            {!isActive && !waitingForHelp && cardState === 'waiting' && <span>Waiting for live connection</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold ${pill.cls}`}>
            <span className={`w-2 h-2 rounded-full ${
              cardState === 'green' ? 'bg-[var(--success)]'
              : cardState === 'orange' || cardState === 'waiting' ? 'bg-[var(--warning)]'
              : 'bg-[var(--danger)]'
            } ${isActive || cardState === 'waiting' ? 'animate-blink' : ''}`} />
            {pill.text}
          </span>
          {showDetail && (
            <div className="text-right">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">{view.eta.label}</div>
              <div className="text-[clamp(16px,2vw,20px)] font-bold text-[var(--text-primary)] tabular-nums">{view.eta.value}</div>
              {view.eta.note && <div className="text-[11px] text-[var(--text-secondary)]">{view.eta.note}</div>}
            </div>
          )}
        </div>
      </div>

      {showDetail ? (
        <>
          <StepBar seg={view.seg} label={view.phaseLabel} />
          <Headline cardState={cardState} text={view.headline || explanationText} evidence={view.evidence} />
          {/* only what a person has to do; the rest of "what happens next" was clutter */}
          <NextSteps next={cardState === 'red' ? view.next : ''} />
          <SmartJudgeBox view={judge} />
          <Actions
            cardState={cardState}
            onIntervene={onIntervene}
            retryCount={retryCount}
            explanationText={explanationText}
            showActions={showActions}
            custom={view.actions}
            noun={profile.nouns.order}
          />
          <Issues issues={view.issues} />
        </>
      ) : (
        <>
          <IdleBanner cardState={cardState} text={cardState === 'waiting' ? waitingText : explanationText} />
          {view && <Issues issues={view.issues} />}
          <SmartJudgeBox view={judge} />
        </>
      )}
    </Card>
  )
}
