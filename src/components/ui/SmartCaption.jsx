import React from 'react'
import { TERM_MAP } from '../../lib/terms'

// daisyUI `tooltip` — the dashed-underline term keeps its teal styling, the
// definition shows in the daisyUI tooltip bubble (wrapped via the .tooltip:before
// rule in index.css since these are full sentences).
function TermTooltip({ slug, children }) {
  const term = TERM_MAP[slug]
  if (!term) return children

  return (
    <span className="tooltip tooltip-top" data-tip={`${term.name} — ${term.desc}`}>
      <span className="border-b border-dashed cursor-help" style={{ borderColor: 'var(--teal, #14b8a6)', color: 'var(--teal, #0d9488)' }}>
        {children}
      </span>
    </span>
  )
}

// daisyUI `badge` (accent = teal in the servai theme), clickable to scroll to
// the cited order.
function CitationChip({ id, onClick }) {
  return (
    <button
      onClick={() => onClick?.(id)}
      className="badge badge-sm badge-accent badge-outline align-middle cursor-pointer hover:opacity-80"
    >
      #{id}
    </button>
  )
}

// Humanise an unknown slug for display when it isn't in TERM_MAP — e.g.
// "search_exhausted" → "search exhausted", "reachability-failed" → "reachability failed".
function humaniseSlug(slug) {
  return String(slug || '').replace(/[_-]+/g, ' ').trim()
}

// Render a chunk of caption text, parsing [[slug]], [cite:N] and **bold**.
// Bold runs are parsed recursively so brackets nested inside a bold span are
// still rendered as chips / term tooltips instead of leaking as literal text.
function renderCaption(text, onCitationClick, keyPrefix = 'r') {
  if (!text) return []
  const parts = []
  // Slug now allows underscores, spaces and digits so gemma3-style
  // "[[search_exhausted]]" or "[[collision warnings]]" still get unwrapped.
  // Bold body uses [\s\S]+? to also cross newlines if any sneak in.
  const re = /(\[\[([A-Za-z0-9_\-\s]+?)\]\]|\[cite:(\d+)\]|\*\*([\s\S]+?)\*\*)/g
  let lastIndex = 0
  let match
  let idx = 0

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const k = `${keyPrefix}-${idx++}-${match.index}`

    if (match[2]) {
      // Normalise the slug to the form we use in TERM_MAP (lowercase, hyphens)
      const rawSlug = match[2].trim()
      const normSlug = rawSlug.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-')
      const term = TERM_MAP[normSlug] || TERM_MAP[rawSlug.toLowerCase()]
      const label = term?.name || humaniseSlug(rawSlug)
      parts.push(
        <TermTooltip key={k} slug={term ? (TERM_MAP[normSlug] ? normSlug : rawSlug.toLowerCase()) : rawSlug}>
          {label}
        </TermTooltip>
      )
    } else if (match[3]) {
      parts.push(<CitationChip key={k} id={parseInt(match[3])} onClick={onCitationClick} />)
    } else if (match[4]) {
      // Recurse into bold content so its inner chips/terms still get rendered.
      parts.push(
        <strong key={k} style={{ color: 'var(--teal, #0d9488)' }}>
          {renderCaption(match[4], onCitationClick, `${k}b`)}
        </strong>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export default function SmartCaption({ text, onCitationClick }) {
  if (!text) return null
  return <span>{renderCaption(text, onCitationClick)}</span>
}

export function CaptionSkeleton({ lines = 3 }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton rounded"
          style={{
            height: 14,
            width: i === lines - 1 ? '60%' : '100%',
          }}
        />
      ))}
    </div>
  )
}
