/**
 * Robot registry + the "current robot" store.
 *
 * The dashboard serves several robots. Each has its own relay (port), orders file and
 * vocabulary; the robot picked in the top bar decides which relay the app talks to and
 * how the Live and History screens read. `getRobotId()` is readable outside React
 * (urls.js uses it), `useRobot()` (RobotContext.jsx) is the React side.
 */

import registry from './robots.json'
import { PROFILES } from './profiles'

export const ROBOT_LIST = Object.values(registry.robots)
export const DEFAULT_ROBOT_ID = registry.default

const STORAGE_KEY = 'servai.robot'

function initialRobotId() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && registry.robots[saved]) return saved
  } catch { /* storage can be blocked */ }
  return DEFAULT_ROBOT_ID
}

let current = initialRobotId()
const listeners = new Set()

export function getRobotId() {
  return current
}

export function setRobotId(id) {
  if (!registry.robots[id] || id === current) return
  current = id
  try { window.localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  listeners.forEach(fn => fn())
}

export function subscribeRobot(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Registry entry (name, port, files…) merged with the UI profile (vocabulary, pipeline…). */
export function getRobot(id = current) {
  const meta = registry.robots[id] || registry.robots[DEFAULT_ROBOT_ID]
  return { ...meta, profile: PROFILES[meta.id] }
}
