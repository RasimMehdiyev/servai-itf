/**
 * Start the relay in replay mode for UI work without a robot.
 *
 *   node scripts/dev-replay.cjs [log file]      (default: grocery_logs.txt)
 *   npm run replay
 *
 * The recorded log is replayed on a loop into a throw-away data folder seeded
 * with a copy of data/orders.json, so the real orders are never modified.
 * Env: REPLAY_SPEED (default 3), WS_PORT (default 8765).
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-dev-replay-'))
const seed = path.join(root, 'data', 'orders.json')
if (fs.existsSync(seed)) fs.copyFileSync(seed, path.join(dataDir, 'orders.json'))

process.env.STATIC_REPLAY = '1'
process.env.DATA_DIR = dataDir
process.env.REPLAY_LOG = path.resolve(process.argv[2] || path.join(root, 'grocery_logs.txt'))
process.env.REPLAY_SPEED = process.env.REPLAY_SPEED || '3'

console.log(`Replaying ${path.basename(process.env.REPLAY_LOG)} at ${process.env.REPLAY_SPEED}x into ${dataDir}`)
process.on('exit', () => { try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {} })
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

require(path.join(root, 'ws-test-server.js'))
