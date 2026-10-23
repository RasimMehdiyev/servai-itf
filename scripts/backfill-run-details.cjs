/**
 * Add `run_details` (item position, every grasp attempt, the robot's settings…) to orders that were saved before
 * the relay recorded them, by replaying the robot's log of that time through the relay.
 *
 *   node scripts/backfill-run-details.cjs [robot log] [orders file ...]
 *   defaults: scripts/fixtures/grocery_robot_2026-10-23.log   data/orders.json  data/replay/grocery/orders.json
 *
 * An order is matched to the log's order by item and start time (the relay stamps an order with the moment it saw
 * it; the log with the robot's clock; they agree to within a minute on a live run). Only orders without
 * `run_details` are touched, only that field is added, and the file is copied to <file>.before-run-details first.
 * Orders the log does not cover are left as they are.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const log = path.resolve(root, args[0] || 'scripts/fixtures/grocery_robot_2026-10-23.log')
const files = (args.length > 1 ? args.slice(1) : ['data/orders.json', 'data/replay/grocery/orders.json']).map(f => path.resolve(root, f))
const WINDOW_MS = 90 * 1000

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-backfill-'))
  const relay = spawn(process.execPath, [path.join(root, 'ws-test-server.js')], {
    cwd: root,
    env: { ...process.env, ROBOT: 'grocery', STATIC_REPLAY: '1', REPLAY_ONCE: '1', REPLAY_LOG: log, DATA_DIR: tmp, WS_PORT: '8898', REPLAY_SPEED: '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  relay.stdout.on('data', d => { out += d })
  relay.stderr.on('data', d => { out += d })
  for (let i = 0; i < 900 && !/Loop \d+ complete/.test(out); i++) await new Promise(r => setTimeout(r, 100))
  relay.kill()
  const replayed = JSON.parse(fs.readFileSync(path.join(tmp, 'orders.json'), 'utf8')).filter(o => o.run_details)
  console.log(`${replayed.length} orders with details from ${path.basename(log)}`)

  for (const file of files) {
    if (!fs.existsSync(file)) { console.log(`${path.relative(root, file)}: not found, skipped`); continue }
    const orders = JSON.parse(fs.readFileSync(file, 'utf8'))
    let added = 0
    const used = new Set()
    for (const o of orders) {
      if (o.run_details) continue
      const t = Date.parse(o.started_at)
      const hit = replayed.find((r, i) => !used.has(i) && r.item === o.item
        && Math.abs(Date.parse(r.run_details.robot_clock_started_at) - t) <= WINDOW_MS)
      if (!hit) continue
      used.add(replayed.indexOf(hit))
      o.run_details = hit.run_details
      added++
    }
    if (added) {
      fs.copyFileSync(file, file + '.before-run-details')
      fs.writeFileSync(file + '.tmp', JSON.stringify(orders, null, 2))
      fs.renameSync(file + '.tmp', file)
    }
    console.log(`${path.relative(root, file)}: details added to ${added} of ${orders.length} orders`)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
})()
