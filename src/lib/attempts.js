/**
 * The robot's grasp attempts in plain words, from `run_details.attempts` (see src/robots/runDetails.cjs).
 *
 * "Viewpoint", "goalset", "IK" and the like mean nothing to the people using the dashboard, so an attempt is
 * described by where the robot looked from compared with the attempt before ("from higher up and a little to the
 * left"), and by what happened ("my arm couldn't reach any of them from there").
 *
 * ASSUMPTION: a more negative y (sideways) position is further to the LEFT as seen from the front. Not yet
 * confirmed against the real shelves; it only decides the words "left" and "right".
 */

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']
const ordinal = (n) => ORDINAL[n - 1] || `Try ${n}`
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)

const LITTLE = 0.03     // m: a move smaller than this is not worth a word
const MUCH = 0.15       // m: a sideways move of at least this is "much further"

/** "top shelf, left side" */
export function spotText(row, side) {
  if (!row) return ''
  const r = row === 'top' ? 'top shelf' : 'lower shelf'
  const s = side === 'left' ? 'left side' : side === 'right' ? 'right side' : side === 'middle' ? 'middle' : ''
  return s ? `${r}, ${s}` : r
}

/** How this attempt's look differs from the previous one: ['higher up', 'a little to the left'] */
export function lookChange(prev, cur) {
  const a = prev?.look_from?.hand_position_m, b = cur?.look_from?.hand_position_m
  if (!a || !b) return []
  const out = []
  const dz = b.z - a.z
  if (dz > LITTLE) out.push('higher up')
  else if (dz < -LITTLE) out.push('lower down')
  const dy = b.y - a.y
  if (Math.abs(dy) >= LITTLE) {
    const dir = dy < 0 ? 'left' : 'right'
    out.push(Math.abs(dy) >= MUCH ? `much further to the ${dir}` : `a little to the ${dir}`)
  }
  return out
}

function lookTitle(attempts, i) {
  const a = attempts[i]
  if (i === 0) return 'First look, from straight in front'
  const change = lookChange(attempts[i - 1], a)
  return `${ordinal(i + 1)} look, ${change.length ? `from ${change.join(' and ')}` : 'from a new angle'}`
}

/** From the same words, lower-case, for use inside a sentence: "from higher up and a little to the left" */
function lookPhrase(attempts, i) {
  if (i === 0) return ''
  const change = lookChange(attempts[i - 1], attempts[i])
  return change.length ? `from ${change.join(' and ')}` : 'from a new angle'
}

const FAILED = new Set(['no_reachable_grip', 'lift_failed_awkward_wrist', 'blocked_by_obstacle', 'planning_failed_other'])

const OUTCOME = {
  grabbed:                   { label: 'Got it',            tone: 'ok' },
  no_reachable_grip:         { label: 'Couldn’t reach it', tone: 'fail' },
  lift_failed_awkward_wrist: { label: 'Couldn’t lift it',  tone: 'fail' },
  blocked_by_obstacle:       { label: 'Something in the way', tone: 'fail' },
  planning_failed_other:     { label: 'Couldn’t plan the grip', tone: 'fail' },
}

function whatHappened(a, i, item) {
  const ways = a.grip_plan?.proposed_grips
  switch (a.outcome) {
    case 'no_reachable_grip':
      return ways ? `I found ${ways} ways to grip ${item}, but my arm couldn’t reach any of them from there.` : `My arm couldn’t reach ${item} from there.`
    case 'lift_failed_awkward_wrist':
      return 'I could reach it, but lifting it would have twisted my wrist into an awkward position, so I stopped.'
    case 'blocked_by_obstacle':
      return `Something next to ${item} was in the way of my arm.`
    case 'planning_failed_other':
      return 'I couldn’t work out a safe way to grip it from there.'
    case 'grabbed':
      return i === 0 ? 'I could reach it and lift it cleanly on the first try.' : 'From this side I could reach it and lift it cleanly.'
    default:
      return ''
  }
}

/** The short reason a try failed, for a sentence about it. */
function shortReason(outcome, item) {
  switch (outcome) {
    case 'no_reachable_grip': return `my arm couldn’t reach ${item} from there`
    case 'lift_failed_awkward_wrist': return `I couldn’t lift ${item} from there`
    case 'blocked_by_obstacle': return `something was in the way of ${item}`
    default: return 'I couldn’t work out a safe grip'
  }
}

/**
 * @param details run_details of an order (live or saved), or null
 * @param item    "the water bottle"-style name: the plain item name, e.g. "water bottle"
 * @returns null when there is nothing to say, else
 *   { spot, rows, footer, failedCount, failedSoFar, inProgress, headline, evidence }
 */
export function describeAttempts(details, itemName = 'the item') {
  const attempts = details?.attempts || []
  if (!attempts.length) return null
  const item = itemName === 'the item' ? 'the item' : `the ${itemName}`
  const spot = spotText(details.shelf_row, details.shelf_side)

  const rows = attempts.map((a, i) => {
    const inProgress = !a.outcome
    const o = inProgress ? { label: 'Trying now', tone: 'active' } : (OUTCOME[a.outcome] || { label: 'Didn’t work', tone: 'fail' })
    const text = inProgress
      ? (i === 0 ? 'Working out how to grip it…' : `I moved to see ${item} ${lookPhrase(attempts, i)} and I’m working out how to grip it.`)
      : whatHappened(a, i, item)
    return { n: i + 1, title: lookTitle(attempts, i), text, label: o.label, tone: o.tone, secs: a.seconds != null ? Math.round(a.seconds) : null }
  })

  const failed = attempts.filter(a => FAILED.has(a.outcome))
  const inProgress = !attempts[attempts.length - 1].outcome
  const limit = attempts.find(a => a.after_failure?.retry_limit)?.after_failure.retry_limit
  const moves = attempts.slice(1).map((a, i) => lookChange(attempts[i], a))
  const alwaysLeft = attempts.length > 2 && moves.every(m => m.some(x => /left/.test(x)))
  const footer = [
    attempts.length > 1 || failed.length ? (limit ? `I can try up to ${limit} times before I ask for help.` : '') : '',
    alwaysLeft ? 'What changed: each time I looked from a spot further to the left than before.' : '',
  ].filter(Boolean)

  const lastFailed = failed[failed.length - 1]
  const next = attempts.length > failed.length ? lookPhrase(attempts, attempts.length - 1) : ''
  const headline = failed.length && inProgress
    ? `My ${lower(ordinal(failed.length))} try didn’t work: ${shortReason(lastFailed.outcome, item)}. I’m trying again${next ? `, ${next}` : ' from a new angle'}.`
    : ''
  const evidence = failed.length ? [
    ...rows.map(r => ({ label: `Try ${r.n}`, value: r.label, note: r.n === rows.length && inProgress ? (lookPhrase(attempts, r.n - 1) || 'from a new angle') : r.text, tone: r.tone })),
    ...(spot ? [{ label: 'Where it is', value: spot.split(',')[0].replace(/^./, c => c.toUpperCase()), note: (spot.split(',')[1] || '').trim() }] : []),
  ] : []

  // one line for the step: "Try 1 couldn’t reach it. Try 2 is under way." / "Got it on try 3. Try 1 couldn’t reach it and try 2 couldn’t lift it."
  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)
  const failedRows = rows.filter(r => r.tone === 'fail')
  const parts = failedRows.map((r, i) => `${i === 0 ? 'Try' : 'try'} ${r.n} ${lowerFirst(r.label)}`)
  const failedSentence = parts.length === 0 ? ''
    : parts.length === 1 ? `${parts[0]}.`
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`
  const grabbed = attempts.find(a => a.outcome === 'grabbed')
  const summary = inProgress
    ? `${failedSentence} Try ${attempts.length} is under way.`.trim()
    : grabbed ? `Got it on try ${attempts.indexOf(grabbed) + 1}.${failedSentence ? ' ' + failedSentence : ''}` : failedSentence

  return { spot, rows, footer, summary, failedCount: failed.length, failedSoFar: failed.length > 0, inProgress, headline, evidence }
}
