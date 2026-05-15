# ServAI UI

Tablet-first React prototype for the **ServAI** operational workflow interface — a real-time monitoring dashboard for a robotic warehouse fulfillment system (operated by a robot called **ROBI**). The application provides live operational monitoring with employee intervention support, historical performance analytics with AI-powered insights, and detailed day/order-level views.

## Quick Start

```bash
npm install
npm run dev              # Vite dev server at http://localhost:5173
node ws-test-server.js   # WebSocket replay server at ws://localhost:8765
py src/rag/server.py     # RAG/AI server at http://localhost:5175
```

Production build:

```bash
npm run build        # Outputs to dist/
npm run preview      # Preview production build locally
```

### Ollama setup (required for AI features)

Install [Ollama](https://ollama.ai/) and pull the required models:

```bash
# Install Ollama (Windows: download from https://ollama.ai/download)
# Then pull models:
ollama pull qwen2.5:3b
ollama pull nomic-embed-text

# Verify:
curl http://localhost:11434/api/tags
```

The AI features (weekly summary, chart captions, order analysis, chat) require Ollama running with both models. If Ollama is offline, the page degrades gracefully — AI sections show a "local AI is offline" notice instead of crashing.

### Python dependencies (for RAG server)

```bash
py -m pip install fastapi uvicorn openai numpy python-dotenv faiss-cpu
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI Framework | React 18, JSX |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 + CSS custom properties |
| Charts | Custom stacked bar chart (CSS + JS) |
| Real-time | WebSocket (`ws` package), bidirectional |
| AI / RAG | Python FastAPI, Ollama (Qwen 2.5 3B), FAISS, nomic-embed-text |
| Build Tool | Vite 5 |
| State Management | React Context + `useReducer` |
| Persistence | Server-side JSON (`data/orders.json`) via HTTP API |

## Three Servers

The application requires three processes running simultaneously:

| Server | Port | Purpose |
|--------|------|---------|
| **Vite dev server** | 5173 | Serves the React frontend |
| **WebSocket replay server** (`ws-test-server.js`) | 8765 | Replays robot logs in real time (dev only), serves order data via HTTP API |
| **RAG/AI server** (`src/rag/server.py`) | 5175 | AI captions, chat, vector search via Ollama |

**Data independence**: The chart, order numbers, tally tiles, and orders list work with just the WS server. AI captions and chat require the RAG server (which requires Ollama). The UI never breaks if the RAG server is down — it shows "AI offline" gracefully.

## Screens & Routing

| Path | Screen | Purpose |
|------|--------|---------|
| `/` | — | Redirects to `/live` |
| `/live` | LiveScreen | Real-time task monitoring, robot status, workflow timeline, employee intervention |
| `/history` | HistoryScreen | AI weekly summary, activity chart, orders list with expandable detail, AI chat |
| `/history/:dayId` | DayDetailsScreen | Single-day summary with individual order list |
| `/settings` | — | Stub (coming soon) |

Navigation is via a bottom tab bar (Live, History, Settings).

## Architecture

```
src/
├── components/
│   ├── ui/             Reusable primitives (Card, SmartCaption, StatusChip, StarRating, etc.)
│   └── layout/         App shell (TopBar, BottomTabBar, ScreenContainer)
├── features/
│   ├── live/           Live monitoring screen + components
│   ├── history/        Performance analytics + AI insights
│   │   ├── components/ ActivityChart, OrdersList, WeeklySummaryCard, ChatPanel, ChatCard, AiCaption
│   │   └── pages/      HistoryScreen (composes all with shared date range)
│   ├── day-details/    Day breakdown screen + components
│   └── assistant/      Floating assistant stub
├── hooks/              Data-fetching hooks (useRobotSocket, useRagCaption, useRagChat, etc.)
├── services/           API abstraction + data layer (orderStore, historyService, messageMapper)
├── context/            Global state (DataSourceContext — live/mock mode, connection, send)
├── lib/                Terms dictionary, phase mapping
├── rag/                Python FastAPI RAG server (server.py)
└── theme/              Design tokens
```

## History Page

The History page is organized top-to-bottom:

1. **WeeklySummaryCard** — AI-generated weekly summary with SmartCaption rendering (term tooltips, order citations)
2. **ChatCard** — Slim "Ask ROBI" card that opens the chat panel
3. **Range chips** — Today / Week / Month toggle that controls both the chart and orders list
4. **ActivityChart** — Tally tiles (delivered, with warnings, couldn't deliver, avg fetch time) + stacked bar chart with animated bars, hover tooltips, TODAY marker, and an AI caption below
5. **OrdersList** — Filter chips (All, Delivered, Warnings, Failed, by item), AI caption with actionable suggestions, date-grouped order rows with expandable step-by-step detail, "Why so long? Ask ROBI" button
6. **ChatPanel** — Slide-in right panel with SSE-streamed chat, suggested questions, SmartCaption rendering

### Order statuses

| Status | Color | Meaning |
|--------|-------|---------|
| `success` / `ok` | Emerald (green) | Delivered successfully with no issues |
| `warning` | Amber (yellow) | Delivered, but with issues during execution (e.g. 0 detections recovered) |
| `failed` | Rose (red) | Could not be delivered (gripper failure, timeout, e-stop, etc.) |

### Color semantics
- **Emerald** (`emerald-50` through `emerald-700`) — success / delivered states
- **Amber** (`amber-50` through `amber-700`) — warnings / delivered with issues
- **Rose** (`rose-50` through `rose-700`) — failure / could not deliver
- **Teal** (`teal-50` through `teal-700`) — AI-content accents only (captions, term highlights, AI buttons)
- **Gray** — neutral content

### Smart Captions
AI-generated text uses three marker types:
- `[[slug]]` — technical term tooltips (teal underline, hover to see definition)
- `[cite:N]` — clickable order reference chips (scrolls to order in list)
- `**bold text**` — highlighted suggestions (rendered in teal bold)

The `SmartCaption` component renders all three as interactive elements.

### AI Captions by Filter
The orders list AI caption adapts to the active status filter:
- **All**: Overall performance summary + top failure reason + actionable suggestion
- **Delivered**: Positive summary + timing patterns + suggestion to maintain performance
- **Warnings**: What went wrong in these orders + most common warning reason + concrete action for employee
- **Failed**: Failure rate analysis + breakdown by reason + specific remediation suggestion

Each caption ends with a **Suggestion:** highlighted in teal bold.

## RAG Server (`src/rag/server.py`)

A Python FastAPI server that provides AI-powered insights via local Ollama inference.

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rag/caption` | POST | Generate AI caption for a surface (weekly, chart, orders_list, order_detail) |
| `/api/rag/chat` | POST | Streaming chat via SSE (Server-Sent Events) |
| `/api/rag/health` | GET | Health check — reports LLM/embed reachability, model name, index size |
| `/api/orders/daily` | GET | Daily activity buckets for the chart (`?from=&to=`) |
| `/api/orders` | GET | Filtered order list (`?from=&to=&status=&item=`) |

### Key design decisions
- **Deterministic stats**: All numbers (counts, averages, rates) are computed in Python and injected as FACTS into prompts. The LLM handles phrasing only — it never counts.
- **Term-wrapping post-processor**: After LLM generation, a deterministic pass wraps technical terms in `[[brackets]]` even if the model forgot.
- **FAISS vector index**: Orders are embedded with `nomic-embed-text` (768-dim) for retrieval-augmented chat. Index rebuilt on startup, persisted to `data/rag_index.faiss`.
- **Caching**: File-based caching with per-surface TTLs (weekly: 30min, chart: 15min, orders_list: 10min, order_detail: forever). Closed date ranges (ending before today) cache forever.
- **Graceful degradation**: When Ollama is unreachable, captions show a soft "local AI offline" notice instead of crashing.

## WebSocket Test Server (`ws-test-server.js`)

A development server that replays `grocery_logs.txt` to simulate a live robot connection. In production, this would be replaced by a real connection to the FANUC robot controller.

- Parses the log file on startup and replays events with real timing
- Caps inter-event delays at 5s to keep replay snappy
- Injects a simulated gripper failure after cycle 2
- Handles intervention pauses with 8s auto-resolve in replay mode
- Persists replay state to `data/replay-state.json`
- Classifies order outcomes as `success`, `warning`, or `failed`
- Appends enriched order records to `data/orders.json` with phases, timing, and failure details
- HTTP endpoints: `GET /api/recent-orders`, `GET /api/orders/daily`, `GET /api/orders/list`, `GET /api/orders`

**Order data is independent from the robot connection.** `data/orders.json` is a persistent file on disk. Once written, order records stay there regardless of whether any server is running. Both the WS server and the RAG server read this file and serve its contents through their own HTTP endpoints. The dashboard never depends on a live robot connection to display historical data.

## Live Screen (`src/features/live/`)

The primary operational view. Shows the robot's current task in real time with bidirectional communication.

- **AttentionPanel** — Current order/item, 3-milestone progress bar, ETA, action buttons for employee intervention
- **RobotStatusCard** — Robot hardware parameters (drivetrain, gripper, camera, sensors) and recent orders
- **WorkflowTimeline** — 7-phase pipeline view with step state, description, timestamp, debug messages
- **TechnicalDetails** — Collapsed accordion for deeper robot parameter inspection

## Data Flow

### Live Mode (WebSocket)

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

### History + AI

```
HistoryScreen (shared date range state)
    ├─ ActivityChart → GET /api/orders/daily (WS server, port 8765)
    ├─ OrdersList   → GET /api/orders/list  (WS server, port 8765)
    ├─ Both         → POST /api/rag/caption (RAG server, port 5175)
    └─ ChatPanel    → POST /api/rag/chat    (RAG server, port 5175, SSE stream)
    → All AI text rendered via SmartCaption (term tooltips + citations + bold suggestions)
```

## Employee Intervention Flow

1. During stage 3 (detection), if 0 items are detected, the server emits an `intervention_wait` event
2. The frontend shows an **orange status** with action buttons
3. The server pauses the replay and waits up to **2 minutes** for an employee response
4. **If the employee clicks a button:** the client sends `{ type: "intervene" }` → the server resumes
5. **If no response within 2 minutes:** the server writes a failed order and skips to the next cycle

## Environment Configuration

`.env` file:

```bash
VITE_USE_WEBSOCKET=true            # true = live WebSocket mode
VITE_WS_URL=ws://localhost:8765    # WebSocket replay server URL
VITE_RAG_URL=http://localhost:5175 # RAG/AI server URL

# Ollama RAG
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama                 # Ignored by Ollama, required by OpenAI client
LLM_MODEL=qwen2.5:3b
EMBED_MODEL=nomic-embed-text
```

## Accessibility

- CVD-friendly palette: blue/orange primary pair; darker green, clear red; never color-alone for meaning
- Icons + labels + shapes used alongside status colors
- Semantic HTML, ARIA labels on interactive elements
- Touch targets >= 44 x 44px

## Target Devices

iPad Mini (744x1133), iPad Air (820x1180), iPad Pro 11" (834x1194), iPad Pro 12.9" (1024x1366)
