# ServAI UI

Tablet-first React prototype for the **ServAI** operational workflow interface — a real-time monitoring dashboard for a robotic warehouse fulfillment system (operated by a robot called **ROBI**). The application provides live operational monitoring with employee intervention support, historical performance analytics with AI-powered insights, and detailed day/order-level views.

## Quick Start

```bash
npm install
npm run dev              # Vite dev server at http://localhost:5173
node ws-test-server.js   # WebSocket replay server at ws://localhost:8765
py src/rag/server.py     # RAG/AI server at http://localhost:5174
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
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text

# Verify:
curl http://localhost:11434/api/tags
```

The AI features (weekly summary, chart captions, order analysis, chat) require Ollama running. If Ollama is offline, the page degrades gracefully — AI sections show a "local AI is offline" notice instead of crashing.

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI Framework | React 18, JSX |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 + CSS custom properties |
| Charts | Custom stacked bar chart (CSS + JS) |
| Real-time | WebSocket (`ws` package), bidirectional |
| AI / RAG | Python FastAPI, Ollama (Qwen 2.5 7B), FAISS, nomic-embed-text |
| Build Tool | Vite 5 |
| State Management | React Context + `useReducer` |
| Persistence | Server-side JSON (`data/orders.json`) via HTTP API |

## Screens & Routing

| Path | Screen | Purpose |
|------|--------|---------|
| `/` | — | Redirects to `/live` |
| `/live` | LiveScreen | Real-time task monitoring, robot status, workflow timeline, employee intervention |
| `/history` | HistoryScreen | AI weekly summary, activity chart, orders list with expandable detail, AI chat |
| `/history/:dayId` | DayDetailsScreen | Single-day summary with individual order list |
| `/assistant` | — | Stub (coming soon) |
| `/settings` | — | Stub (coming soon) |

Navigation is via a bottom tab bar (Live, History, Settings).

## Architecture

```
src/
├── components/
│   ├── ui/             Reusable primitives (Card, SmartCaption, StatusChip, StarRating, etc.)
│   └── layout/         App shell (AppShell, TopBar, BottomTabBar, ScreenContainer)
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
4. **ActivityChart** — Tally tiles (delivered, couldn't deliver, avg fetch time) + stacked bar chart with animated bars, hover tooltips, TODAY marker, and an AI caption below
5. **OrdersList** — Filter chips (All, Delivered, Issues, by item), AI caption, date-grouped order rows with expandable step-by-step detail, "Why so long? Ask ROBI" button
6. **ChatPanel** — Slide-in right panel with SSE-streamed chat, suggested questions, SmartCaption rendering

### Color semantics
- **Emerald** (`emerald-50` through `emerald-700`) — success / delivered states
- **Rose** (`rose-50` through `rose-700`) — failure / issues
- **Teal** (`teal-50` through `teal-700`) — AI-content accents only (captions, term highlights, AI buttons)
- **Gray** — neutral content

### Smart Captions
AI-generated text uses `[[slug]]` markers for technical term tooltips and `[cite:N]` markers for clickable order references. The `SmartCaption` component renders these as interactive teal-underlined tooltips and blue citation chips.

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
- **Deterministic stats**: All numbers (counts, averages, rates) are computed in Python and injected as facts into prompts. The LLM handles phrasing only — it never counts.
- **Term-wrapping post-processor**: After LLM generation, a deterministic pass wraps technical terms in `[[brackets]]` even if the model forgot.
- **FAISS vector index**: Orders are embedded with `nomic-embed-text` (768-dim) for retrieval-augmented chat. Index rebuilt on startup, persisted to `data/rag_index.faiss`.
- **Caching**: File-based caching with per-surface TTLs (weekly: 30min, chart: 15min, orders_list: 10min, order_detail: forever). Weekly summary auto-refreshes in background.
- **Graceful degradation**: When Ollama is unreachable, captions show a soft "local AI offline" notice instead of crashing.

## Live Screen (`src/features/live/`)

The primary operational view. Shows the robot's current task in real time with bidirectional communication.

- **AttentionPanel** — Current order/item, 3-milestone progress bar, ETA, action buttons for employee intervention
- **RobotStatusCard** — Robot hardware parameters (drivetrain, gripper, camera, sensors) and recent orders
- **WorkflowTimeline** — 12-stage pipeline view with step state, description, timestamp, debug messages
- **TechnicalDetails** — Collapsed accordion for deeper robot parameter inspection

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

### History + AI

```
HistoryScreen (shared date range state)
    → ActivityChart fetches GET /api/orders/daily
    → OrdersList fetches GET /api/orders
    → Both use useRagCaption(surface, scope) for AI captions
    → ChatPanel uses useRagChat() with SSE streaming
    → All AI text rendered via SmartCaption (term tooltips + citations)
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
VITE_USE_WEBSOCKET=true            # true = live WebSocket mode, false = mock mode
VITE_WS_URL=ws://localhost:8765    # WebSocket server URL
VITE_RAG_URL=http://localhost:5174 # RAG/AI server URL

# Ollama RAG
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama                 # Ignored by Ollama, required by OpenAI client
LLM_MODEL=qwen2.5:7b-instruct
EMBED_MODEL=nomic-embed-text
```

## WebSocket Test Server (`ws-test-server.js`)

A development server that replays `grocery_logs.txt` to simulate a live robot connection.

- Parses the log file on startup and replays events with timing derived from real timestamps
- Caps inter-event delays at 5 seconds (`MAX_EVENT_DELAY`) to keep replay snappy
- Injects a simulated gripper failure after cycle 2
- Handles intervention pauses with 8-second auto-resolve in replay mode
- Persists replay state to `data/replay-state.json`
- Tracks failures per cycle and writes enriched order records to `data/orders.json`
- HTTP API: `GET /api/recent-orders`, `GET /api/orders`

## Accessibility

- CVD-friendly palette: blue/orange primary pair; darker green, clear red; never color-alone for meaning
- Icons + labels + shapes used alongside status colors
- Semantic HTML, ARIA labels on interactive elements
- Touch targets >= 44 x 44px

## Target Devices

iPad Mini (744x1133), iPad Air (820x1180), iPad Pro 11" (834x1194), iPad Pro 12.9" (1024x1366)
