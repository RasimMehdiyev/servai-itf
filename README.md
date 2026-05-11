# ServAI UI

Tablet-first React prototype for the **ServAI** operational workflow interface — a real-time monitoring dashboard for a robotic warehouse fulfillment system (operated by a robot called **ROBI**). The application provides live operational monitoring with employee intervention support, historical performance analytics backed by server-side persistence, and detailed day/order-level views.

## Quick Start

```bash
npm install
npm run dev              # Vite dev server at http://localhost:5173
node ws-test-server.js   # WebSocket replay server at ws://localhost:8765
```

Production build:

```bash
npm run build        # Outputs to dist/
npm run preview      # Preview production build locally
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI Framework | React 18, JSX |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 + CSS custom properties |
| Component Library | Material UI 9 (MUI) |
| Charts | MUI X-Charts (line charts) |
| Real-time | WebSocket (`ws` package), bidirectional |
| Build Tool | Vite 5 |
| State Management | React Context + `useReducer` |
| Persistence | Server-side JSON (`data/orders.json`) via HTTP API |

## Screens & Routing

| Path | Screen | Purpose |
|------|--------|---------|
| `/` | — | Redirects to `/live` |
| `/live` | LiveScreen | Real-time task monitoring, robot status, workflow timeline, employee intervention |
| `/history` | HistoryScreen | Performance line chart (failures/successes toggle), order list with infinite scroll |
| `/history/:dayId` | DayDetailsScreen | Single-day summary with individual order list |
| `/assistant` | — | Stub (coming soon) |
| `/settings` | — | Stub (coming soon) |

Navigation is via a bottom tab bar (Live, History, Settings).

## Architecture

```
src/
├── components/
│   ├── ui/             Reusable primitives (Card, StatusChip, FilterPills, StarRating, etc.)
│   └── layout/         App shell (AppShell, TopBar, BottomTabBar, ScreenContainer)
├── features/
│   ├── live/           Live monitoring screen + components
│   ├── history/        Performance analytics screen + components
│   ├── day-details/    Day breakdown screen + components
│   └── assistant/      Floating assistant stub
├── hooks/              Data-fetching hooks (useRobotSocket, useLiveDashboard, etc.)
├── services/           API abstraction + data layer (orderStore, historyService, messageMapper)
├── context/            Global state (DataSourceContext — live/mock mode, connection, send)
├── mocks/              Static mock data, scenarios, calendar generation
└── theme/              Design tokens
```

## What Each Part Does

### Live Screen (`src/features/live/`)

The primary operational view. Shows the robot's current task in real time with bidirectional communication.

- **AttentionPanel** — Displays the current order/item, a 3-milestone progress bar, ETA, and a status banner (green/orange/red). Action buttons let the employee intervene: "I'll restock the shelf" (orange state), "I'm on my way" (red state), "Cancel this order", etc. Clicking an action button sends `{ type: "intervene" }` back to the server via WebSocket to resume the pipeline.
- **RobotStatusCard** — Shows robot hardware parameters (drivetrain, gripper, camera, sensors) and a list of recently delivered orders.
- **WorkflowTimeline** — A 12-stage pipeline view (from "Return to start" through "Return to base"). Each step shows its state (completed/active/loading/pending), a description, timestamp, and optional debug messages.
- **TechnicalDetails** — Collapsed accordion for deeper robot parameter inspection.
- **DiagnosticModal** — Modal for diagnostic information.
- **ConnectionIndicator** — Dot indicator for WebSocket status (live/connecting/disconnected/mock).

### History Screen (`src/features/history/`)

Performance analytics dashboard backed by server-side order data.

- **PerformanceCard** — Date range picker (custom start/end dates) with a line chart. A **Failures/Successful toggle** switches between a red failure line and a green success line. Individual days on the chart are clickable to drill into that day's orders.
- **OrderSummary** — Replaces the old FailureList. Shows individual orders (not grouped by type) with **infinite scroll** via IntersectionObserver. Loads 10 orders at a time with skeleton placeholder animation while loading. When no day is selected, shows all failed orders (failures mode) or all successful orders (success mode) for the entire date range.

### Day Details Screen (`src/features/day-details/`)

Drills into a single day's operations.

- **DaySummaryCard** — Date label, attention status, totals (orders received, failures).
- **OrderListItem** — Individual order rows showing order number, time, status (ok/failed), star rating (1-5), and failure reason if applicable.

### Hooks (`src/hooks/`)

Custom hooks that manage data fetching and state for each screen.

| Hook | Purpose |
|------|---------|
| `useRobotSocket` | Manages the WebSocket connection with auto-reconnect (exponential backoff 1s–30s), message buffering, `send()` for bidirectional communication, and cleanup on unmount |
| `useLiveDashboard` | Switches between live (WebSocket) and mock mode; returns current live state from context |
| `useHistorySummary` | Fetches aggregated history from the server for a date range; supports manual `refresh()` for cache invalidation |
| `useDayDetails` | Fetches detail data for a single calendar day from the server |

### Services (`src/services/`)

Data layer — fetches from the WebSocket server's HTTP API.

| Service | Purpose |
|---------|---------|
| `orderStore` | Core data access: `fetchOrders()` from `GET /api/orders`, `buildDayMap()` to group/normalize orders by date, `FAILURE_DESCRIPTIONS` map for human-readable failure text. Normalizes legacy formats (`"success"` → `"ok"`) and derives missing fields (timestamp, orderNumber, rating). |
| `historyService` | Aggregates order data into line chart bars with per-day success/failure counts, period-over-period trend calculations, and failure type breakdowns |
| `dayDetailsService` | Fetches a single day's data from the server and returns it as a structured day object |
| `messageMapper` | Maps raw WebSocket events into structured live dashboard state — parses the 12-stage pipeline, derives progress milestones, detects failures (red/orange), handles intervention flow, builds timeline steps |
| `liveService` | Fetches mock scenarios by key (fallback when not in live mode) |

### Context (`src/context/`)

- **DataSourceContext** — Global state provider that holds the current mode (live/mock), WebSocket connection status, live data state, recent orders, and a `sendMessage()` function for bidirectional WebSocket communication. Uses `useReducer` with a `liveReducer` that applies WebSocket messages via the message mapper. Includes idle detection (15s timeout → red state).

## Data Flow

### Live Mode (WebSocket enabled)

```
ws-test-server.js (replays robot logs)
    → WebSocket messages
    → useRobotSocket (buffers, reconnects)
    → DataSourceContext reducer
    → messageMapper.applyMessageToScenario()
    → LiveScreen components re-render

Employee action (button click)
    → DataSourceContext.sendMessage()
    → useRobotSocket.send()
    → WebSocket message to server { type: "intervene" }
    → Server resumes paused pipeline
```

WebSocket message types:
- **Server → Client:** `cycle_start`, `object_selected`, `stage`, `motion`, `gripper`, `cycle_end`, `robot_status`, `robot_log`, `heartbeat`, `init`, `intervention_wait`, `intervention_resolved`
- **Client → Server:** `intervene` (employee action to resume a paused pipeline)

### History

```
useHistorySummary({ startDate, endDate })
    → historyService.fetchHistory()
    → orderStore.fetchOrders()    — GET /api/orders
    → orderStore.buildDayMap()    — normalize + group by date
    → Returns { successRate, successCount, failureCount, performanceBars, failureTypes, allFailures }
```

### Mock Mode (fallback)

```
Scenario key (UI dropdown)
    → liveService.fetchLive(key)
    → buildScenario() from scenarios.json
    → Static snapshot rendered
```

## Server-Side Persistence

All order data is persisted in `data/orders.json` on the WebSocket server. Each completed cycle writes an enriched order record with:

- `id`, `item`, `orderNumber`, `timestamp`, `started_at`, `completed_at`
- `total_seconds` (cycle duration)
- `steps[]` (pipeline step log with durations)
- `status` (`"ok"` or `"failed"`)
- `failureReason` (classified: Grip failure, Item not detected, Emergency stop, Robot error, Connection timeout)
- `rating` (5 for success, 1 for failure)

Failure classification is done server-side by `classifyFailure()`, which analyzes raw log messages for keywords (gripper, detection, e-stop, error state, timeout).

## Employee Intervention Flow

The system supports a "item not found" scenario where the robot pauses and waits for employee action:

1. During stage 3 (detection), if 0 items are detected, the server emits an `intervention_wait` event
2. The frontend shows an **orange status** with action buttons ("I'll restock the shelf", "Tell customer we're out", "Cancel this order")
3. The server pauses the replay and waits up to **2 minutes** for an employee response
4. **If the employee clicks a button:** the client sends `{ type: "intervene" }` → the server resumes the pipeline from where it left off (re-detection, grasp, handover)
5. **If no response within 2 minutes:** the server writes a failed order and skips to the next cycle

## WebSocket Test Server (`ws-test-server.js`)

A development server that replays `grocery_logs.txt` to simulate a live robot connection.

- Parses the log file on startup and replays events with timing derived from real timestamps
- Caps inter-event delays at 5 seconds (`MAX_EVENT_DELAY`) to keep replay snappy
- New clients receive a rapid catch-up burst of the current cycle's events
- Persists replay state to `data/replay-state.json` (survives restarts)
- Injects a simulated gripper failure (20s silence) after cycle 2
- Handles intervention pauses: waits for employee WebSocket message or 2-minute timeout
- Tracks failures per cycle (red: gripper/e-stop/error; orange: 0 detections) and writes enriched order records
- Sends heartbeats every 4 seconds
- HTTP API endpoints:
  - `GET /api/recent-orders` — last 4 orders + totals
  - `GET /api/orders` — all orders (used by history screen)
- Configurable: `REPLAY_SPEED` (default 1.0), `WS_PORT` (default 8765)

### Robot Log Format (`grocery_logs.txt`)

The log contains 5 cycles from a real FANUC CRX-10iA/L robot running a grocery pick pipeline:

- **Cycles 1–3:** Successful picks (ballpoint pen, water bottle, ballpoint pen)
- **Cycle 4:** "Item not found" failure — 0 detections for plastic-wrapped towel, employee intervention after ~93s, then successful completion
- **Cycle 5:** Aborted by user at stage 1

Each cycle follows: `=== Cycle N ===` → stage 1 (return to start) → object selection → stage 3 (SAM3 detection) → stages 4–9 (anchor, viewpoint, Molmo, segmentation, depth, grasp synthesis) → stage 11 (grasp execution) → stages 12a–12d (transit, handover, release, return).

## Environment Configuration

`.env` file controls the data source:

```
VITE_USE_WEBSOCKET=true          # true = live WebSocket mode, false = mock mode
VITE_WS_URL=ws://localhost:8765  # WebSocket server URL
```

## Error Handling & Resilience

- **WebSocket reconnection** — Exponential backoff (1s to 30s max), auto-reconnects on close
- **Idle detection** — 15-second timeout after last message triggers a red status card with "Connection timeout" failure
- **Client catch-up** — New WebSocket clients receive all events from the current cycle as a rapid burst (with `animDuration: 0` to skip progress animations)
- **Order normalization** — `orderStore.normalizeOrder()` handles legacy formats (`status: "success"` → `"ok"`) and derives missing fields
- **Loading/error states** — `LoadingState` and `ErrorState` components handle pending and failed data fetches
- **Infinite scroll** — IntersectionObserver-based lazy loading with skeleton placeholders prevents rendering large order lists

## Accessibility

- CVD-friendly palette: blue/orange primary pair; darker green, clear red; never color-alone for meaning
- Icons + labels + shapes used alongside status colors
- Semantic HTML (`<header role="banner">`, `<nav aria-label>`)
- ARIA labels on interactive elements, `focus-visible` states
- Touch targets >= 44 x 44px

## Target Devices

iPad Mini (744x1133), iPad Air (820x1180), iPad Pro 11" (834x1194), iPad Pro 12.9" (1024x1366)
