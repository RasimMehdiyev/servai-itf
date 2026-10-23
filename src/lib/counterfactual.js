/**
 * "What could change this?" and the "Heads-up" before a pick-up: statements from the orders so far that were
 * picked in a similar spot, in plain words and plain counts.
 *
 * Only orders since the setup changed count: the distances, the height of the handover table and the placement of
 * the items were different before, so older orders say nothing about today's. With so few orders the statements
 * are counts ("2 of 2"), never percentages, and each carries a "hint, not a promise" line. They recompute whenever
 * the order history changes.
 *
 * "Similar" = same shelf row and side, from the order's `run_details` (src/robots/runDetails.cjs).
 */
import { describeAttempts, spotText } from './attempts'

/** The robot's setup changed on this date: orders before it are not compared. (UTC) */
export const SETUP_STARTED_AT = '2026-10-23T12:00:00Z'
const MIN_SIMILAR = 2   // similar orders needed before saying anything

/**
 * The orders that count: since the setup changed, each real order once. A replay plays the same recorded orders again
 * and again, each time as a "new" order, and the replay folder also holds copies of the real ones. They are told
 * apart by the robot's own clock (`robot_clock_started_at`, the log's time of the order, identical on every replay
 * of it), so 8 recorded orders count as 8 however many times they were replayed.
 */
function sinceSetup(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    if (Date.parse(r.robot_clock_started_at || r.started_at) < Date.parse(SETUP_STARTED_AT)) continue
    const key = r.robot_clock_started_at ? `${r.robot_clock_started_at}|${r.item}` : `id:${r.id}|${r.started_at}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}
const hasSpot = (r) => r.shelf_row && r.shelf_side && r.item_position_m

/** Rows for the shelf map: earlier orders with their position and whether they needed more tries. */
function mapDots(pool) {
  return pool.map(r => ({ id: r.id, y: r.item_position_m.y, row: r.shelf_row, needed: !!r.needed_more_than_one_try }))
}

/**
 * @param spot     { row, side, position }  where the item is
 * @param attempts { count, failedSoFar, inProgress }  how the current order's tries are going (null before the first)
 * @param history  rows from /api/orders/slim
 * @param exclude  (row) => true for rows that are this order itself
 * @param saved    true for a finished order (History): no "heads-up", only what could have changed it
 */
export function counterfactualCard({ spot, attempts, history, exclude = () => false, saved = false }) {
  if (!spot?.row || !spot.side) return { state: 'thinking' }
  const pool = sinceSetup(history || []).filter(r => hasSpot(r) && !exclude(r))
  const here = pool.filter(r => r.shelf_row === spot.row && r.shelf_side === spot.side)
  const harder = here.filter(r => r.needed_more_than_one_try)
  const recovered = harder.filter(r => r.status !== 'failed')
  const where = spotText(spot.row, spot.side)
  const map = { dots: mapDots(pool), current: { y: spot.position?.y ?? 0, row: spot.row } }
  const orders = pool.length
  const caption = `Based on the ${orders} order${orders === 1 ? '' : 's'} since the setup changed, so take it as a hint, not a promise.`
  const base = { where, map, caption }

  const triedAndFailed = attempts?.failedSoFar

  if (triedAndFailed) {
    if (here.length < MIN_SIMILAR || harder.length === 0) {
      return { ...base, state: 'nothing', title: 'What could change this?',
        sentence: here.length < MIN_SIMILAR ? 'Nothing to suggest yet. I haven’t picked enough orders from this spot to compare.' : 'Nothing to suggest yet. No earlier order from this spot needed a second look.' }
    }
    const sentence = recovered.length === harder.length
      ? 'Looking at the item again from a new angle has helped every time so far.'
      : recovered.length > 0 ? `Looking at the item again from a new angle has helped ${recovered.length} of ${harder.length} times so far.`
        : 'Looking again from a new angle hasn’t helped here yet.'
    return { ...base, state: 'counterfactual', title: 'What could change this?', sentence,
      tiles: [
        { big: `${harder.length} of ${here.length}`, text: `earlier orders from this spot needed more than one try`, tone: 'bad' },
        { big: `${recovered.length} of ${harder.length}`, text: 'worked once I looked from a new angle', tone: 'good' },
      ] }
  }

  if (saved) return { state: 'none' }

  // before the first try has failed: a heads-up
  if (here.length < MIN_SIMILAR) {
    return { ...base, state: 'unknown', title: 'Heads-up', badge: 'Before picking up',
      sentence: 'I haven’t picked enough orders from this spot to say how this one will go.' }
  }
  if (harder.length * 2 >= here.length) {
    return { ...base, state: 'heads_up', title: 'Heads-up', badge: 'Before picking up',
      sentence: `Items in this spot needed a second try ${harder.length} time${harder.length === 1 ? '' : 's'} out of ${here.length}, so this one may too. I’ll tell you what I try next.` }
  }
  return { ...base, state: 'heads_up_ok', title: 'Heads-up', badge: 'Before picking up',
    sentence: `Items in this spot worked first time ${here.length - harder.length} time${here.length - harder.length === 1 ? '' : 's'} out of ${here.length}.` }
}

/** For the Live page. */
export function liveCounterfactual(liveData, history) {
  const d = liveData?._runDetails
  if (!d?.shelf_row) return { state: 'thinking' }
  const info = describeAttempts(d, liveData._itemName || 'the item')
  const started = liveData._cycleStartedAt || 0
  return counterfactualCard({
    spot: { row: d.shelf_row, side: d.shelf_side, position: d.item_position_m },
    attempts: info ? { failedSoFar: info.failedSoFar } : null,
    history,
    exclude: (r) => Date.parse(r.started_at) >= started - 3000,
  })
}

/** For a saved order in History: null when there is nothing worth saying (a clean first-try delivery). */
export function orderCounterfactual(order, history) {
  const d = order?.run_details
  if (!d?.shelf_row) return null
  const info = describeAttempts(d, order.item)
  const card = counterfactualCard({
    spot: { row: d.shelf_row, side: d.shelf_side, position: d.item_position_m },
    attempts: { failedSoFar: !!(info?.failedSoFar || order.status === 'failed') },
    history, exclude: (r) => r.id === order.id, saved: true,
  })
  return card.state === 'none' || card.state === 'thinking' ? null : card
}
