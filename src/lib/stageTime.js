/**
 * Seconds a pipeline step has taken so far, for either robot.
 * A step can be visited more than once, so time is added up per step as the robot leaves it
 * (`_stageInfo[key].spent`); the step it is in right now adds the time since it was entered.
 */
export function spentSeconds(liveData, key, nowMs) {
  const info = liveData._stageInfo?.[key]
  if (!info) return null
  let ms = info.spent || 0
  const cur = liveData._stageCursor
  if (cur && cur.key === key && !liveData._cycleComplete) {
    const le = liveData._lastEvent
    const lastEventNow = le ? le.ts + Math.max(0, nowMs - le.seen) : cur.ts
    ms += Math.max(0, lastEventNow - cur.ts)
  } else if (cur && cur.key === key && liveData._cycleComplete && liveData._lastEvent) {
    ms += Math.max(0, liveData._lastEvent.ts - cur.ts)
  }
  return Math.round(ms / 1000)
}
