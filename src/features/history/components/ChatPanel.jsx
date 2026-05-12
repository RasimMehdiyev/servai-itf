import React, { useState, useRef, useEffect } from 'react'
import SmartCaption from '../../../components/ui/SmartCaption'
import useRagChat from '../../../hooks/useRagChat'

const SUGGESTIONS = [
  'How did ROBI perform this week?',
  'Which orders took the longest?',
  'Were there any failures today?',
]

export default function ChatPanel({ open, onClose, onCitationClick, prefill }) {
  const { messages, loading, send } = useRagChat()
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const prefillSent = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open && prefill && prefill !== prefillSent.current && !loading) {
      prefillSent.current = prefill
      send(prefill)
    }
  }, [open, prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    send(text)
  }

  if (!open) return null

  return (
    <div
      className="fixed top-0 right-0 bottom-0 z-50 flex flex-col border-l border-solid"
      style={{
        width: 'min(480px, 100vw)',
        background: 'var(--bg)',
        borderColor: 'var(--border)',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-solid" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--teal, #14b8a6)' }} />
          <span className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Ask ROBI</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg border-0 cursor-pointer hover:bg-[var(--surface)]"
          style={{ background: 'transparent', color: 'var(--text-secondary)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <>
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: 'var(--teal-bg, #f0fdfa)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--teal, #0d9488)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>Hi! I'm ROBI's assistant.</p>
              <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>Ask me about orders, performance, or failures.</p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  className="text-left px-3 py-2.5 rounded-lg text-[13px] border border-solid cursor-pointer hover:bg-[var(--surface)] transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'transparent' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[85%] px-3 py-2.5 rounded-xl text-[13px] leading-relaxed"
              style={msg.role === 'user' ? {
                background: 'var(--primary)',
                color: 'white',
                borderBottomRightRadius: 4,
              } : {
                background: 'var(--surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderBottomLeftRadius: 4,
              }}
            >
              {msg.role === 'assistant' ? (
                <SmartCaption text={msg.content} onCitationClick={onCitationClick} />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="px-3 py-2.5 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--teal, #14b8a6)', animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--teal, #14b8a6)', animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--teal, #14b8a6)', animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-solid" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask about orders, timing, failures…"
            className="flex-1 px-3 py-2.5 rounded-lg text-[13px] border border-solid outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 rounded-lg text-[13px] font-semibold border-0 cursor-pointer hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--teal, #14b8a6)', color: 'white' }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
