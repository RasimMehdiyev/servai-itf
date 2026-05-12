#!/usr/bin/env node
/**
 * Migration script: converts existing orders.json to the enriched schema.
 *
 * - Groups duplicate stage entries into phases with combined duration
 * - Backfills missing fields (orderNumber, timestamp, status)
 * - Adds phase-level friendly names
 * - Backs up old file to data/orders.legacy.json
 *
 * Usage: node scripts/migrate_orders.js
 */

const fs = require('fs')
const path = require('path')

const ORDERS_FILE = path.join(__dirname, '..', 'data', 'orders.json')
const BACKUP_FILE = path.join(__dirname, '..', 'data', 'orders.legacy.json')

// Phase mapping — must match src/lib/phases.js
const PHASES = [
  { phase: 'going_to_shelf',   friendly_name: 'Going to the shelf',      raw_stages: ['1', 'Return to start'] },
  { phase: 'finding_item',     friendly_name: 'Finding the item',         raw_stages: ['3', '4', '5'] },
  { phase: 'analyzing_grasp',  friendly_name: 'Analyzing the grasp',      raw_stages: ['6', '7', '8', '9'] },
  { phase: 'picking_up',       friendly_name: 'Picking it up',            raw_stages: ['11'] },
  { phase: 'bringing_over',    friendly_name: 'Bringing it over',         raw_stages: ['12a', '12b'] },
  { phase: 'handing_over',     friendly_name: 'Handing over',             raw_stages: ['12c'] },
  { phase: 'returning',        friendly_name: 'Returning to the shelf',   raw_stages: ['12d'] },
]

function normalizeStageKey(name) {
  // "Stage 12a" → "12a", "Return to start" → "Return to start", "Stage 3" → "3"
  const m = name.match(/^Stage\s+(.+)$/)
  return m ? m[1] : name
}

function findPhase(stageKey) {
  for (const p of PHASES) {
    if (p.raw_stages.includes(stageKey)) return p
  }
  return null
}

function groupStepsIntoPhases(steps) {
  if (!steps || steps.length === 0) return []

  const grouped = []
  let currentPhase = null
  let currentEntry = null

  for (const step of steps) {
    const key = normalizeStageKey(step.name)
    const phase = findPhase(key)

    if (!phase) {
      // Unknown stage — keep as-is in a misc phase
      if (currentEntry) grouped.push(currentEntry)
      currentEntry = null
      currentPhase = null
      grouped.push({
        phase: 'unknown',
        friendly_name: step.name,
        raw_stages: [step.name],
        duration_seconds: step.duration_seconds || 0,
        meta: step.meta || {},
      })
      continue
    }

    if (currentPhase === phase.phase) {
      // Same phase — merge
      currentEntry.duration_seconds += step.duration_seconds || 0
      if (!currentEntry.raw_stages.includes(step.name)) {
        currentEntry.raw_stages.push(step.name)
      }
      currentEntry._step_count++
    } else {
      // New phase
      if (currentEntry) grouped.push(currentEntry)
      currentPhase = phase.phase
      currentEntry = {
        phase: phase.phase,
        friendly_name: phase.friendly_name,
        raw_stages: [step.name],
        duration_seconds: step.duration_seconds || 0,
        meta: {},
        _step_count: 1,
      }
    }
  }

  if (currentEntry) grouped.push(currentEntry)

  // Clean up internal tracking field
  for (const g of grouped) {
    if (g._step_count > 1) {
      g.meta.raw_event_count = g._step_count
    }
    delete g._step_count
  }

  return grouped
}

function normalizeStatus(order) {
  if (order.status === 'ok' || order.status === 'success') return 'success'
  if (order.status === 'failed') return 'failed'
  // No status field — infer from failureReason
  if (order.failureReason) return 'failed'
  return 'success'
}

function normalizeFailure(order) {
  if (!order.failureReason) return null
  const r = order.failureReason.toLowerCase()
  if (r.includes('grip')) return { reason: 'gripper_failed', detail: order.failureReason, at_phase: 'picking_up' }
  if (r.includes('not detected') || r.includes('not found') || r.includes('item not')) return { reason: 'item_not_found', detail: order.failureReason, at_phase: 'finding_item' }
  if (r.includes('emergency') || r.includes('e_stop') || r.includes('e-stop')) return { reason: 'e_stopped', detail: order.failureReason, at_phase: null }
  if (r.includes('timeout') || r.includes('connection')) return { reason: 'timeout', detail: order.failureReason, at_phase: null }
  if (r.includes('error')) return { reason: 'planning_failed', detail: order.failureReason, at_phase: null }
  return { reason: 'gripper_failed', detail: order.failureReason, at_phase: null }
}

function migrateOrder(order) {
  const status = normalizeStatus(order)
  const failure = status === 'failed' ? normalizeFailure(order) : null
  const steps = groupStepsIntoPhases(order.steps || [])

  // Compute robot_seconds (sum of step durations) vs total
  const robotSeconds = steps.reduce((s, p) => s + p.duration_seconds, 0)
  const totalSeconds = order.total_seconds || 0
  const humanWaitSeconds = Math.max(0, totalSeconds - robotSeconds)

  // Derive timestamp from started_at if missing
  let timestamp = order.timestamp
  if (!timestamp && order.started_at) {
    const d = new Date(order.started_at)
    timestamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return {
    id: order.id,
    order_number: order.orderNumber || order.order_number || String(order.id),
    status,
    failure,
    item: order.item || 'unknown',
    robot_id: 'ROBI',
    started_at: order.started_at,
    completed_at: order.completed_at,
    total_seconds: totalSeconds,
    robot_seconds: robotSeconds,
    human_wait_seconds: humanWaitSeconds,
    steps,
    timestamp: timestamp || '',
    rating: order.rating ?? (status === 'success' ? 5 : 1),
  }
}

// ── Main ──

if (!fs.existsSync(ORDERS_FILE)) {
  console.error('No orders.json found at', ORDERS_FILE)
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'))
console.log(`Read ${raw.length} orders from ${ORDERS_FILE}`)

// Backup
fs.writeFileSync(BACKUP_FILE, JSON.stringify(raw, null, 2))
console.log(`Backup saved to ${BACKUP_FILE}`)

// Migrate
const migrated = raw.map(migrateOrder)

// Validate
let phaseIssues = 0
for (const order of migrated) {
  const unknowns = order.steps.filter(s => s.phase === 'unknown')
  if (unknowns.length > 0) {
    console.warn(`  Order #${order.id}: ${unknowns.length} unknown phase(s): ${unknowns.map(u => u.friendly_name).join(', ')}`)
    phaseIssues++
  }
}

// Stats
const statuses = {}
for (const o of migrated) statuses[o.status] = (statuses[o.status] || 0) + 1
console.log(`\nMigration complete:`)
console.log(`  Total: ${migrated.length}`)
console.log(`  Statuses: ${JSON.stringify(statuses)}`)
console.log(`  Phase issues: ${phaseIssues}`)
console.log(`  Avg steps per order: ${(migrated.reduce((s, o) => s + o.steps.length, 0) / migrated.length).toFixed(1)}`)

// Sample
const sample = migrated[migrated.length - 1]
console.log(`\nSample (last order):`)
console.log(JSON.stringify(sample, null, 2))

// Write
fs.writeFileSync(ORDERS_FILE, JSON.stringify(migrated, null, 2))
console.log(`\nWritten ${migrated.length} migrated orders to ${ORDERS_FILE}`)
