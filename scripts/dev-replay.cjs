/**
 * Start a relay in replay mode for UI work without a robot.
 *
 *   node scripts/dev-replay.cjs [grocery|bar] [log file] [--fresh] [--data <folder>] [--speed <n>] [--port <n>]
 *   npm run replay            (grocery, scripts/fixtures/grocery_critic_2026-10-21.log)
 *   npm run replay:bar        (bar, scripts/fixtures/bar_demo_2026-10-21.log)
 *
 * The recorded log is replayed on a loop at the speed it was recorded (the pauses between events
 * are the log's own). Orders go to data/replay/<robot>/, a copy of that robot's orders file made the
 * first time, so the real orders are never modified. That folder is kept between runs: restart the
 * replay and the history is still there, and order numbers carry on. `--fresh` wipes it first.
 * Each robot has its own relay on its own port (grocery 8765, bar 8766); run both to switch
 * between them in the top bar.
 * Several log files can be given; they are played one after the other. Pauses longer than a minute
 * are cut to a minute (REPLAY_MAX_DELAY, in ms, changes that) and idle stretches between orders are skipped
 * (REPLAY_SKIP_IDLE=0 plays them).
 * Env: REPLAY_SPEED (default 1 = real time), REPLAY_MAX_DELAY, WS_PORT, DATA_DIR.
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const ROBOTS = require(path.join(root, 'src', 'robots', 'robots.json'))

const argv = process.argv.slice(2)
const fresh = argv.includes('--fresh')
// --data <folder>: keep this run's orders somewhere else (e.g. a demo that must not touch the usual history)
// --speed <n>:       replay n times faster than the log (same as REPLAY_SPEED=n)
const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null }
const dataArg = valueOf('--data')
const speedArg = valueOf('--speed')
const portArg = valueOf('--port')
const flagValues = new Set([dataArg, speedArg, portArg].filter(Boolean))
const positional = argv.filter(a => !a.startsWith('--') && !flagValues.has(a))
const robotId = positional.find(a => ROBOTS.robots[a]) || process.env.ROBOT || ROBOTS.default
const robot = ROBOTS.robots[robotId]
if (!robot) { console.error(`Unknown robot '${robotId}'. Known: ${Object.keys(ROBOTS.robots).join(', ')}`); process.exit(1) }
const fileArgs = positional.filter(a => !ROBOTS.robots[a])
// the grocery robot replays the untagged recorded log (grocery_logs.txt is whatever the robot wrote last)
// (the newest grocery log has the AI Judge's lines and an arm fault; recent_grocery_logs.txt is the older one: `npm run replay -- recent_grocery_logs.txt`)
// The grocery default plays two recordings one after the other: the critic/arm-fault log and the day's live log of the robot.
const defaultLogs = robotId === ROBOTS.default
  ? ['scripts/fixtures/grocery_critic_2026-10-21.log', 'scripts/fixtures/grocery_robot_2026-10-23.log']
  : [robot.replayLog]

// DATA_DIR=<folder> uses another folder (e.g. one the RAG server also reads: DATA_DIR=<folder> py src/rag/server.py)
const given = process.env.DATA_DIR || dataArg
const dataDir = given ? path.resolve(given) : path.join(root, 'data', 'replay', robotId)
if (fresh) fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })
const seed = path.join(root, 'data', robot.ordersFile)
const target = path.join(dataDir, robot.ordersFile)
const existing = fs.existsSync(target)
if (!existing && fs.existsSync(seed)) fs.copyFileSync(seed, target)

// The replay folder was copied from the real orders file the first time. Orders the robot has completed
// since (a live run writes them to data/<file>) are added now, so the history is the robot's real history
// plus whatever the replays added. They get the next free numbers; nothing is removed or changed.
let imported = 0
if (existing && fs.existsSync(seed) && !dataArg && !process.env.DATA_DIR) {
  try {
    const mine = JSON.parse(fs.readFileSync(target, 'utf8'))
    const real = JSON.parse(fs.readFileSync(seed, 'utf8'))
    const known = new Set(mine.map(o => `${o.started_at}|${o.item}`))
    let next = Math.max(0, ...mine.map(o => o.id || 0)) + 1
    const fresh = real.filter(o => !known.has(`${o.started_at}|${o.item}`)).map(o => ({ ...o, id: next, order_number: String(next++) }))
    if (fresh.length) {
      fs.writeFileSync(target + '.tmp', JSON.stringify([...mine, ...fresh], null, 2))
      fs.renameSync(target + '.tmp', target)
      imported = fresh.length
    }
  } catch (e) { console.log(`Could not add the robot's newer orders: ${e.message}`) }
}

process.env.ROBOT = robotId
process.env.STATIC_REPLAY = '1'
process.env.DATA_DIR = dataDir
// Several recordings are joined into one file in the replay folder (the relay replays a single file).
const logs = (fileArgs.length ? fileArgs : defaultLogs).map(f => path.resolve(root, f))
if (logs.length === 1) process.env.REPLAY_LOG = logs[0]
else {
  const joined = path.join(dataDir, 'replay-input.log')
  fs.writeFileSync(joined, logs.map(f => fs.readFileSync(f, 'utf8').replace(/\s*$/, '\n')).join(''))
  process.env.REPLAY_LOG = joined
}
process.env.REPLAY_SPEED = process.env.REPLAY_SPEED || speedArg || '1'
if (portArg) process.env.WS_PORT = portArg
// The log's own timing, except that a pause longer than a minute (the robot idling between orders) is cut to a minute
process.env.REPLAY_MAX_DELAY = process.env.REPLAY_MAX_DELAY || '60000'
// ... and the robot idling between orders (minutes of "idle" ticks in a day's log) is skipped; REPLAY_SKIP_IDLE=0 plays it
process.env.REPLAY_SKIP_IDLE = process.env.REPLAY_SKIP_IDLE || '1'

console.log(`[${robot.name}] replaying ${logs.map(f => path.basename(f)).join(' + ')} at ${process.env.REPLAY_SPEED}x (log's own timing) into ${dataDir}`)
console.log(existing ? `Keeping the history from the previous run${imported ? ` and adding ${imported} order(s) the robot completed since` : ''} (--fresh starts over).` : `Started from a copy of data/${robot.ordersFile}.`)
console.log('The RAG server reads data/ unless started with the same DATA_DIR — the page would show orders the AI cannot see.')
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

require(path.join(root, 'ws-test-server.js'))
