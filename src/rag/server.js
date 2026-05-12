/**
 * RAG API handler — mounts on the existing HTTP server.
 *
 * Endpoints:
 *   POST /api/rag/caption  — { surface, scope? }  → { text, citations, generated_at }
 *   POST /api/rag/chat     — { messages }          → { text, citations }
 *   GET  /api/rag/health   — { ok, order_count, last_caption_at }
 *
 * Uses Claude API via Anthropic SDK for generation.
 * Caches captions to data/cache/captions/.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { weeklyStats, rangeStats, orderDetail, readOrders, retrieveOrders } = require('./stats')
const { weeklyPrompt, chartPrompt, ordersListPrompt, orderDetailPrompt, chatPrompt } = require('./prompts')

const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'cache', 'captions')
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })

// Cache TTLs in ms
const CACHE_TTL = {
  weekly: 60 * 60 * 1000,       // 1 hour
  chart: 15 * 60 * 1000,        // 15 min
  orders_list: 10 * 60 * 1000,  // 10 min
  order_detail: Infinity,        // immutable
}

let lastCaptionAt = null

// ── Claude API ──────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250514'

async function callClaude(system, userMessage) {
  if (!ANTHROPIC_API_KEY) {
    return { text: '_AI captions require ANTHROPIC_API_KEY environment variable._', citations: [] }
  }

  const messages = Array.isArray(userMessage)
    ? userMessage
    : [{ role: 'user', content: userMessage }]

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system,
        messages,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[RAG] Claude API error:', res.status, err)
      return { text: `_AI caption unavailable (${res.status})._`, citations: [] }
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''

    // Extract [cite:N] markers
    const citations = []
    const citeRe = /\[cite:(\d+)\]/g
    let m
    while ((m = citeRe.exec(text)) !== null) {
      citations.push(parseInt(m[1]))
    }

    return { text, citations }
  } catch (err) {
    console.error('[RAG] Claude API call failed:', err.message)
    return { text: '_AI caption temporarily unavailable._', citations: [] }
  }
}

// ── Caching ─────────────────────────────────────────────────────────────────

function cacheKey(surface, scope) {
  const hash = crypto.createHash('md5').update(JSON.stringify({ surface, scope })).digest('hex').slice(0, 12)
  return `${surface}_${hash}.json`
}

function readCache(surface, scope) {
  const file = path.join(CACHE_DIR, cacheKey(surface, scope))
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const ttl = CACHE_TTL[surface] || 10 * 60 * 1000
    if (ttl === Infinity || (Date.now() - new Date(raw.generated_at).getTime()) < ttl) {
      return raw
    }
  } catch {}
  return null
}

function writeCache(surface, scope, result) {
  const file = path.join(CACHE_DIR, cacheKey(surface, scope))
  const entry = { ...result, surface, scope, generated_at: new Date().toISOString() }
  try { fs.writeFileSync(file, JSON.stringify(entry, null, 2)) } catch {}
  return entry
}

// ── Caption generation ──────────────────────────────────────────────────────

async function generateCaption(surface, scope) {
  // Check cache first
  const cached = readCache(surface, scope)
  if (cached) return cached

  let prompt
  let stats

  switch (surface) {
    case 'weekly':
      stats = weeklyStats()
      prompt = weeklyPrompt(stats)
      break
    case 'chart':
      stats = rangeStats(scope?.startDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), scope?.endDate || new Date().toISOString().slice(0, 10))
      prompt = chartPrompt(stats)
      break
    case 'orders_list':
      stats = rangeStats(scope?.startDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), scope?.endDate || new Date().toISOString().slice(0, 10))
      prompt = ordersListPrompt(stats, scope?.status)
      break
    case 'order_detail': {
      const order = orderDetail(scope?.order_id)
      if (!order) return { text: 'Order not found.', citations: [], generated_at: new Date().toISOString() }
      prompt = orderDetailPrompt(order)
      break
    }
    default:
      return { text: `Unknown surface: ${surface}`, citations: [], generated_at: new Date().toISOString() }
  }

  const result = await callClaude(prompt.system, prompt.user)
  lastCaptionAt = new Date().toISOString()
  return writeCache(surface, scope, result)
}

// ── Chat ────────────────────────────────────────────────────────────────────

async function handleChat(messages) {
  // Build context from recent/relevant orders
  const orders = readOrders()
  const recent = orders.slice(-20)
  const context = recent.map(o => {
    const status = o.status === 'success' || o.status === 'ok' ? 'delivered' : `failed (${o.failure?.reason || o.failureReason || 'unknown'})`
    return `Order #${o.id}: ${o.item}, ${status}, ${o.total_seconds}s, ${o.started_at?.slice(0, 10)}`
  }).join('\n')

  // Also add aggregate stats
  const stats = weeklyStats()
  const statsContext = `\nWeekly stats: ${stats.total} orders, ${stats.success} delivered, ${stats.failed} failed, avg ${stats.avgTime}s.`

  const prompt = chatPrompt(messages, context + statsContext)
  return callClaude(prompt.system, prompt.messages)
}

// ── HTTP handler ────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

async function handleRagRequest(req, res, pathname) {
  res.setHeader('Content-Type', 'application/json')

  if (pathname === '/api/rag/health') {
    const orders = readOrders()
    res.writeHead(200)
    res.end(JSON.stringify({ ok: true, order_count: orders.length, last_caption_at: lastCaptionAt }))
    return true
  }

  if (pathname === '/api/rag/caption' && req.method === 'POST') {
    const body = await parseBody(req)
    const { surface, scope } = body
    if (!surface) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'surface is required' }))
      return true
    }
    const result = await generateCaption(surface, scope || {})
    res.writeHead(200)
    res.end(JSON.stringify(result))
    return true
  }

  if (pathname === '/api/rag/chat' && req.method === 'POST') {
    const body = await parseBody(req)
    if (!body.messages || !Array.isArray(body.messages)) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'messages array is required' }))
      return true
    }
    const result = await handleChat(body.messages)
    res.writeHead(200)
    res.end(JSON.stringify(result))
    return true
  }

  if (pathname === '/api/rag/stats' && req.method === 'POST') {
    const body = await parseBody(req)
    const stats = rangeStats(
      body.startDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      body.endDate || new Date().toISOString().slice(0, 10),
    )
    res.writeHead(200)
    res.end(JSON.stringify(stats))
    return true
  }

  return false // not handled
}

module.exports = { handleRagRequest }
