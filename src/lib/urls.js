/**
 * Runtime URL helpers — resolve env-var URLs against the current hostname
 * so the app works both on localhost and over LAN (iPad, phone, etc.).
 */

function resolveToCurrentHost(url) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = window.location.hostname
    }
    return parsed
  } catch {
    return null
  }
}

/** HTTP base for the WS server API (orders, images, etc.) */
export function getApiBase() {
  const envUrl = import.meta.env.VITE_WS_URL
  if (!envUrl) return ''
  const parsed = resolveToCurrentHost(envUrl.replace(/^ws/, 'http'))
  return parsed ? parsed.origin : ''
}

/** WebSocket URL for the robot relay */
export function getWsUrl() {
  const envUrl = import.meta.env.VITE_WS_URL
  if (!envUrl) return `ws://${window.location.hostname}:8765`
  const parsed = resolveToCurrentHost(envUrl)
  return parsed ? parsed.href.replace(/\/$/, '') : envUrl
}

/** HTTP base for the RAG server — always routes through the Vite proxy
 *  so the iPad (and any LAN client) doesn't need direct access to port 5175. */
export function getRagBase() {
  return '/rag'
}
