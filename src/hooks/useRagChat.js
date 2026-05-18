import { useState, useCallback, useRef } from 'react'

import { getRagBase } from '../lib/urls'

const RAG_BASE = getRagBase()

export default function useRagChat() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const send = useCallback(async (userText) => {
    const userMsg = { role: 'user', content: userText }
    const updated = [...messagesRef.current, userMsg]
    setMessages(updated)
    setLoading(true)

    // Add empty assistant message that we'll stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '', citations: [] }])

    try {
      const res = await fetch(`${RAG_BASE}/api/rag/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated }),
      })

      if (!res.ok) throw new Error(`${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue

          try {
            const data = JSON.parse(payload)
            if (data.final) {
              // Post-processed final text with term wrapping
              fullText = data.final
            } else if (data.text) {
              fullText += data.text
            }
            setMessages(prev => {
              const copy = [...prev]
              const last = copy[copy.length - 1]
              if (last && last.role === 'assistant') {
                copy[copy.length - 1] = { ...last, content: fullText }
              }
              return copy
            })
          } catch {}
        }
      }
    } catch {
      setMessages(prev => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant' && !last.content) {
          copy[copy.length - 1] = { ...last, content: '_Sorry, I couldn\'t get a response right now._' }
        }
        return copy
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => setMessages([]), [])

  return { messages, loading, send, reset }
}
