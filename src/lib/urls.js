/**
 * Runtime URL helpers — resolve env-var URLs against the current hostname
 * so the app works both on localhost and over LAN (iPad, phone, etc.).
 *
 * Each robot has its own relay (port in src/robots/robots.json). The default robot keeps using
 * VITE_WS_URL; others use VITE_WS_URL_<ID> (e.g. VITE_WS_URL_BAR) or the same host on the robot's port.
 */

import { getRobotId, getRobot, DEFAULT_ROBOT_ID } from '../robots'

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

/** ws:// URL of a robot's relay */
export function getWsUrl(robotId = getRobotId()) {
  const robot = getRobot(robotId)
  const env = import.meta.env
  const explicit = env[`VITE_WS_URL_${robot.id.toUpperCase()}`] || (robot.id === DEFAULT_ROBOT_ID ? env.VITE_WS_URL : '')
  if (explicit) {
    const parsed = resolveToCurrentHost(explicit)
    return parsed ? parsed.href.replace(/\/$/, '') : explicit
  }
  return `ws://${window.location.hostname}:${robot.port}`
}

/** HTTP base for a robot's relay API (orders, images, etc.) */
export function getApiBase(robotId = getRobotId()) {
  const robot = getRobot(robotId)
  const env = import.meta.env
  const explicit = env[`VITE_WS_URL_${robot.id.toUpperCase()}`] || (robot.id === DEFAULT_ROBOT_ID ? env.VITE_WS_URL : '')
  // Default robot without an env URL: relative /api, handled by the Vite proxy
  if (!explicit && robot.id === DEFAULT_ROBOT_ID) return ''
  const parsed = resolveToCurrentHost((explicit || `ws://${window.location.hostname}:${robot.port}`).replace(/^ws/, 'http'))
  return parsed ? parsed.origin : ''
}

/** HTTP base for the RAG server — always routes through the Vite proxy
 *  so the iPad (and any LAN client) doesn't need direct access to port 5175. */
export function getRagBase() {
  return '/rag'
}

/** Headers that tell the RAG server which robot's orders to read. */
export function ragHeaders(extra = {}) {
  return { 'X-Robot': getRobotId(), ...extra }
}
