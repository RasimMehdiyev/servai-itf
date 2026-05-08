import React, { useState, useRef, useEffect } from 'react'

// ── Simple markdown → JSX renderer ──────────────────────────────────────────
// Handles # / ## headings and plain paragraphs (sufficient for the API format)

function renderMarkdown(text) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let para = []
  let key = 0

  const flushPara = () => {
    if (para.length) {
      const content = para.join(' ').trim()
      if (content) elements.push(<p key={key++} style={{ margin: '0 0 6px', lineHeight: 1.55 }}>{content}</p>)
      para = []
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('### ')) {
      flushPara()
      elements.push(<strong key={key++} style={{ display: 'block', fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.6, marginTop: 10, marginBottom: 2 }}>{line.slice(4)}</strong>)
    } else if (line.startsWith('## ')) {
      flushPara()
      elements.push(<strong key={key++} style={{ display: 'block', marginTop: 10, marginBottom: 2 }}>{line.slice(3)}</strong>)
    } else if (line.startsWith('# ')) {
      flushPara()
      elements.push(<strong key={key++} style={{ display: 'block', marginTop: 10, marginBottom: 2 }}>{line.slice(2)}</strong>)
    } else if (line.startsWith('- ')) {
      flushPara()
      elements.push(<li key={key++} style={{ marginLeft: 16, marginBottom: 2 }}>{line.slice(2)}</li>)
    } else if (line === '') {
      flushPara()
    } else {
      para.push(line)
    }
  }
  flushPara()
  return elements
}

// ── Suggested questions ──────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Why did the robot fail to detect the glass?',
  'Why did pour_drinks fail before succeeding?',
  'What happened during the ‘Getting ready to accept a drink order’ phase?',
  'What changed between the failed and successful glass detection attempts?',
  'What state was the robot in when the first failure occurred?'
]

// ── Icons ────────────────────────────────────────────────────────────────────

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FloatingAssistant() {
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState([])   // { role: 'user'|'assistant', text: string, loading?: bool }
  const [input, setInput]     = useState('')
  const [busy, setBusy]       = useState(false)
  const bottomRef             = useRef(null)
  const inputRef              = useRef(null)

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  async function ask(question) {
    if (!question.trim() || busy) return
    setInput('')
    setBusy(true)

    setMessages(prev => [
      ...prev,
      { role: 'user', text: question },
      { role: 'assistant', text: '', loading: true },
    ])

    try {
      const res = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const answer = data.answer_user || data.answer || '(no response)'

      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', text: answer },
      ])
    } catch (err) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', text: `Could not reach the assistant. ${err.message}` },
      ])
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    ask(input)
  }

  const showSuggestions = messages.length === 0

  return (
    <>
      {/* ── Floating button ── */}
      {!open && (
        <button
          className="fixed z-[90] flex items-center justify-center w-14 h-14 rounded-full bg-[var(--primary)] text-white border-0 cursor-pointer shadow-[0_4px_16px_rgba(43,127,255,.4)] transition-transform hover:scale-105 active:scale-95"
          style={{ bottom: 'calc(64px + 20px)', right: 20 }}
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
        >
          <ChatIcon />
        </button>
      )}

      {/* ── Chat panel ── */}
      {open && (
        <div
          className="fixed z-[90] flex flex-col bg-[var(--surface)] rounded-[18px] shadow-[0_8px_40px_rgba(15,23,42,0.22)] overflow-hidden"
          style={{
            bottom: 'calc(64px + 16px)',
            right: 16,
            width: 'min(420px, calc(100vw - 32px))',
            height: 'min(580px, calc(100vh - 120px))',
            animation: 'slideUp .22s ease',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-solid border-[var(--border)] shrink-0"
            style={{ background: 'var(--surface)' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white shrink-0">
                <ChatIcon />
              </div>
              <div>
                <div className="font-semibold text-[var(--text-primary)] text-[15px] leading-none">Ask ROBI</div>
                <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">AI assistant</div>
              </div>
            </div>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--bg)] text-[var(--text-secondary)] border border-solid border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--border)]"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {showSuggestions && (
              <>
                <p className="text-[13px] text-[var(--text-tertiary)] text-center m-0 mt-1">
                  Ask me anything about ROBI's activity
                </p>
                <div className="flex flex-col gap-2 mt-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      className="text-left px-4 py-2.5 rounded-[10px] bg-[var(--bg)] border border-solid border-[var(--border)] text-[var(--text-primary)] text-[14px] cursor-pointer transition-colors hover:bg-[var(--info-bg)] hover:border-[var(--primary)]"
                      onClick={() => ask(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                {/* Bubble */}
                <div
                  className="max-w-[85%] rounded-[14px] px-4 py-2.5 text-[14px] leading-relaxed"
                  style={msg.role === 'user'
                    ? { background: 'var(--primary)', color: '#fff', borderBottomRightRadius: 4 }
                    : { background: 'var(--bg)', color: 'var(--text-primary)', borderBottomLeftRadius: 4, border: '1px solid var(--border)' }
                  }
                >
                  {msg.loading
                    ? <span className="flex gap-1 items-center py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: '240ms' }} />
                      </span>
                    : msg.role === 'assistant'
                      ? <div>{renderMarkdown(msg.text)}</div>
                      : msg.text
                  }
                </div>
                {/* Footer label */}
                <span className="text-[11px] text-[var(--text-tertiary)] mt-1 px-1">
                  {msg.role === 'user' ? 'You' : 'ROBI'}
                </span>
              </div>
            ))}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-3 py-3 border-t border-solid border-[var(--border)] shrink-0 bg-[var(--surface)]"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask a question…"
              disabled={busy}
              className="flex-1 bg-[var(--bg)] border border-solid border-[var(--border)] rounded-[10px] px-4 py-2 text-[14px] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--primary)]"
              style={{ minHeight: 40 }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-[10px] bg-[var(--primary)] text-white border-0 cursor-pointer transition-opacity disabled:opacity-40"
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
