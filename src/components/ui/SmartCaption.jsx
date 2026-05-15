import React, { useState } from 'react'
import { TERM_MAP } from '../../lib/terms'

function TermTooltip({ slug, children }) {
  const [show, setShow] = useState(false)
  const term = TERM_MAP[slug]
  if (!term) return children

  return (
    <span
      className="relative inline"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(!show)}
    >
      <span className="border-b border-dashed cursor-help" style={{ borderColor: 'var(--teal, #14b8a6)', color: 'var(--teal, #0d9488)' }}>
        {children}
      </span>
      {show && (
        <span className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 px-3 py-2 rounded-lg text-xs bg-[var(--surface)] border border-solid border-[var(--border)] shadow-lg" style={{ color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{term.name}</strong>
          <br />
          {term.desc}
        </span>
      )}
    </span>
  )
}

function CitationChip({ id, onClick }) {
  return (
    <button
      onClick={() => onClick?.(id)}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold cursor-pointer border border-solid hover:opacity-80"
      style={{ background: 'var(--teal-bg, #f0fdfa)', color: 'var(--teal, #0d9488)', borderColor: 'var(--teal, #14b8a6)' }}
    >
      #{id}
    </button>
  )
}

export default function SmartCaption({ text, onCitationClick }) {
  if (!text) return null

  // Parse [[slug]], [cite:N], and **bold** markers into React elements
  const parts = []
  const re = /(\[\[([a-z0-9-]+)\]\]|\[cite:(\d+)\]|\*\*(.+?)\*\*)/g
  let lastIndex = 0
  let match

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      const slug = match[2]
      const term = TERM_MAP[slug]
      parts.push(
        <TermTooltip key={match.index} slug={slug}>
          {term?.name || slug}
        </TermTooltip>
      )
    } else if (match[3]) {
      parts.push(<CitationChip key={match.index} id={parseInt(match[3])} onClick={onCitationClick} />)
    } else if (match[4]) {
      parts.push(<strong key={match.index} style={{ color: 'var(--teal, #0d9488)' }}>{match[4]}</strong>)
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <span>{parts}</span>
}

export function CaptionSkeleton({ lines = 3 }) {
  return (
    <div className="animate-pulse flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="rounded"
          style={{
            height: 14,
            width: i === lines - 1 ? '60%' : '100%',
            background: 'var(--border)',
          }}
        />
      ))}
    </div>
  )
}
