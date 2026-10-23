/**
 * Start the relay for one robot (same as `ROBOT=<id> node ws-test-server.js`, but works the same on
 * Windows, macOS and Linux).
 *
 *   node scripts/start-relay.cjs [grocery|bar]
 *   npm run relay          (grocery, port 8765, ROBOT_WS=ws://olifant.local:7878)
 *   npm run relay:bar      (bar, port 8766, ROBOT_WS=ws://armadillo.local:7878)
 *
 * ROBOT_WS and WS_PORT still override the defaults in src/robots/robots.json.
 */
const path = require('path')
const ROBOTS = require(path.join(__dirname, '..', 'src', 'robots', 'robots.json'))
const id = process.argv[2] || process.env.ROBOT || ROBOTS.default
if (!ROBOTS.robots[id]) { console.error(`Unknown robot '${id}'. Known: ${Object.keys(ROBOTS.robots).join(', ')}`); process.exit(1) }
process.env.ROBOT = id
require(path.join(__dirname, '..', 'ws-test-server.js'))
