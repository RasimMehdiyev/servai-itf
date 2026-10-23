/**
 * A stand-in for a robot's log stream, to try the relay's live connection without the robot.
 *
 *   node scripts/fake-robot.cjs <log file> [--port 7878] [--speed 1] [--loop] [--batch 1] [--prefix "[orchestrator] "]
 *
 * It does what the real robots' streamers do: a WebSocket server that sends the log as text frames,
 * one line per frame, as the relay's `ROBOT_WS` client expects. Every new client gets the log from the
 * start, paced by the timestamps in the lines (gaps capped at 5 s, divided by --speed).
 *
 *   --batch N      send N lines per frame (the relay splits frames into lines)
 *   --prefix TEXT  put TEXT in front of every line (aggregated logs tag each line with its process)
 *   --loop         start over when the file ends
 *
 * Try it:  node scripts/fake-robot.cjs scripts/fixtures/bar_demo_2026-10-21.log --port 17879 --loop
 *          ROBOT_WS_BAR=ws://localhost:17879 npm run relay:bar
 */
const fs = require('fs')
const path = require('path')
const { WebSocketServer } = require('ws')

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a) && args[args.indexOf(a) - 1] !== '--prefix')
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : dflt }
const flag = (name) => args.includes(`--${name}`)

if (!file) { console.error('usage: node scripts/fake-robot.cjs <log file> [--port 7878] [--speed 1] [--loop] [--batch 1] [--prefix TEXT]'); process.exit(1) }
const PORT = parseInt(opt('port', '7878'), 10)
const SPEED = parseFloat(opt('speed', '1'))
const BATCH = Math.max(1, parseInt(opt('batch', '1'), 10))
const PREFIX = opt('prefix', '')
const LOOP = flag('loop')

// Every non-empty line is sent (an aggregated log also holds tagged lines such as "[critic-service] …" and
// untimed ones). Pacing follows the UTC timestamps; a line without one is sent right after the previous line.
const lines = fs.readFileSync(path.resolve(file), 'utf8').split(/\r?\n/).filter(l => l.trim())
if (!lines.some(l => /\d{4}-\d{2}-\d{2}T[\d:.]+Z/.test(l))) { console.error(`no timestamped lines in ${file}`); process.exit(1) }
const stamps = []
lines.forEach((l, i) => {
  const m = l.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  stamps.push(m ? Date.parse(m[1]) : (stamps[i - 1] ?? 0))
})

const wss = new WebSocketServer({ port: PORT })
wss.on('listening', () => console.log(`fake robot: ${lines.length} lines from ${path.basename(file)} on ws://0.0.0.0:${PORT} (speed ${SPEED}x, batch ${BATCH}${PREFIX ? `, prefix "${PREFIX}"` : ''}${LOOP ? ', looping' : ''})`))

wss.on('connection', (ws) => {
  console.log('fake robot: client connected, streaming')
  let i = 0
  let timer = null
  const step = () => {
    if (ws.readyState !== ws.OPEN) return
    const chunk = []
    while (chunk.length < BATCH && i < lines.length) chunk.push(PREFIX + lines[i++])
    ws.send(chunk.join('\n'))
    if (i >= lines.length) {
      if (!LOOP) return
      i = 0
      timer = setTimeout(step, 500 / SPEED)
      return
    }
    const gap = Math.min(5000, Math.max(0, stamps[i] - stamps[i - 1] || 0)) / SPEED
    timer = setTimeout(step, Math.max(1, gap))
  }
  step()
  ws.on('close', () => { clearTimeout(timer); console.log('fake robot: client disconnected') })
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
