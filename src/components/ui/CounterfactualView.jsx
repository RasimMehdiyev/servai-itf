import React from 'react'

// The "What could change this?" / "Heads-up" body, shared by the Live card and the order drawer in History.
// `card` comes from lib/counterfactual.js.

const BULB = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0012 2z" />
  </svg>
)

const X0 = -0.4, X1 = 0.8   // sideways range the map shows, in metres
const mapX = (y, id = 0) => Math.min(186, Math.max(14, 20 + ((y - X0) / (X1 - X0)) * 160 + (((id * 13) % 5) - 2) * 2))
const mapY = (row) => (row === 'top' ? 26 : 70)

/** The shelf as seen from the front: earlier orders as dots, this one circled. */
export function ShelfMap({ map, width = 190 }) {
  return (
    <svg viewBox="0 0 200 118" style={{ width, maxWidth: '100%', flex: 'none', display: 'block' }} role="img"
         aria-label="Shelf map: earlier orders as dots, green if they worked first time and red if they needed more tries; this order is circled">
      <rect x="2" y="2" width="196" height="114" rx="8" fill="var(--bg)" stroke="var(--border)" />
      <rect x="14" y="38" width="172" height="5" rx="2.5" fill="#cbd2dc" />
      <rect x="14" y="82" width="172" height="5" rx="2.5" fill="#cbd2dc" />
      {map.dots.map(d => (
        <circle key={d.id ?? `${d.y}${d.row}`} cx={mapX(d.y, d.id)} cy={mapY(d.row) + (((d.id || 0) * 7) % 5 - 2) * 2.5} r="7" fill={d.needed ? 'var(--danger)' : 'var(--success)'} />
      ))}
      <circle cx={mapX(map.current.y)} cy={mapY(map.current.row) - 1} r="15" fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  )
}

export function MapLegend() {
  const dot = (bg, dashed) => <span style={{ width: 10, height: 10, boxSizing: 'border-box', borderRadius: 999, background: dashed ? 'transparent' : bg, border: dashed ? `2px dashed ${bg}` : 0 }} />
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px] text-[#374151]">
      <span className="inline-flex items-center gap-1.5">{dot('var(--success)')}worked first time</span>
      <span className="inline-flex items-center gap-1.5">{dot('var(--danger)')}needed more tries</span>
      <span className="inline-flex items-center gap-1.5">{dot('var(--primary)', true)}this order</span>
    </div>
  )
}

export function CardHeader({ card }) {
  return (
    <div className="flex items-center gap-2">
      {BULB}
      <h2 className="m-0 text-[17px] font-bold text-[var(--text-primary)]">{card.title || 'What could change this?'}</h2>
      {card.badge && <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--warning-bg)] text-[var(--warning-text)]">{card.badge}</span>}
    </div>
  )
}

const TILE = { bad: ['var(--danger-bg)', 'var(--danger-text)'], good: ['var(--success-bg)', 'var(--success-text)'] }

export function Tiles({ tiles }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 mt-2.5">
      {tiles.map(t => (
        <div key={t.text} className="px-3 py-2.5 rounded-[10px]" style={{ background: TILE[t.tone][0] }}>
          <div className="text-[22px] font-bold leading-[1.1]" style={{ color: TILE[t.tone][1] }}>{t.big}</div>
          <div className="mt-0.5 text-[12.5px] leading-[1.35] text-[var(--text-secondary)]">{t.text}</div>
        </div>
      ))}
    </div>
  )
}

/** The Live card's content. While the robot has not yet worked out where the item is, it is "thinking". */
export default function CounterfactualBody({ card }) {
  if (card.state === 'thinking') {
    return (
      <>
        <CardHeader card={{ title: 'What could change this?' }} />
        <p className="m-0 mt-2.5 text-[15px] font-medium text-[var(--text-secondary)]" role="status">Thinking…</p>
      </>
    )
  }
  return (
    <>
      <CardHeader card={card} />
      <p className="m-0 mt-2.5 text-[15px] leading-[1.45] font-medium text-[var(--text-primary)]">{card.sentence}</p>
      {card.tiles && <Tiles tiles={card.tiles} />}
      <div className="mt-3 flex gap-4 items-center flex-wrap">
        <ShelfMap map={card.map} />
        <MapLegend />
      </div>
      <p className="m-0 mt-2.5 text-[12px] leading-[1.4] text-[var(--text-secondary)]">{card.caption}</p>
    </>
  )
}
