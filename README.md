# ServAI UI

Tablet-first React dashboard for the **ServAI** operational workflow interface — a real-time monitoring UI for a robotic warehouse fulfillment system operated by a robot called **ROBI** (a FANUC CRX-10iA/L collaborative arm). It provides live operational monitoring with employee intervention support, historical performance analytics with AI-powered insights, and detailed day/order-level views.

> **Branch: `main`** — the WebSocket server connects to the real robot at `ROBOT_WS` (default `ws://olifant.local:7878`) **and replays `grocery_logs.txt`** as a fallback whenever no robot is reachable, so the dashboard always has data for development/demos. It broadcasts `source_mode: static` while replaying so the UI labels it "Demo replay".
> The **`main-live`** branch is identical *except* that it is **real-connection only** — no replay fallback (`ENABLE_STATIC_REPLAY = false`). Everything else — UI, components, RAG server — is the same across both branches.

## Quick Start

```bash
npm install
npm run dev              # Vite dev server at http://localhost:5173
node ws-test-server.js   # Robot relay + log replay + orders HTTP API at ws://localhost:8765
py src/rag/server.py     # RAG/AI server at http://localhost:5175
```

With no robot reachable, `ws-test-server.js` replays the bundled `grocery_logs.txt` so the UI is fully populated. Point it at a real controller with `ROBOT_WS=ws://<host>:<port> node ws-test-server.js`; set `STATIC_REPLAY=0` to disable the replay fallback.

Production build:

```bash
npm run build        # Outputs to dist/
npm run preview      # Preview production build locally
```

### Ollama setup (required for AI features)

Install [Ollama](https://ollama.ai/) and pull the models referenced in `.env`:

```bash
ollama pull qwen2.5:3b        # LLM_MODEL (chat / captions)
ollama pull nomic-embed-text  # EMBED_MODEL (FAISS retrieval)
# Optional, for camera-feed analysis (VISION_MODEL):
ollama pull gemma3

curl http://localhost:11434/api/tags   # verify
```

The AI features (weekly summary, order analysis, chat, vision) require Ollama running. If Ollama is offline the page degrades gracefully — AI sections show a soft "local AI is offline" notice instead of crashing.

### Python dependencies (RAG server)

```bash
py -m pip install fastapi uvicorn openai numpy python-dotenv faiss-cpu
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI framework | React 18, JSX (no TypeScript) |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 + **daisyUI 4** (custom `servai` theme) + CSS custom properties |
| Components | daisyUI (`btn`, `badge`, `stats`, `tooltip`, `collapse`, `loading`, plus v5 `list`/`dock` ported into the v4 setup) |
| Charts | **Recharts 3** — stacked bar chart (activity) + radar chart (failure breakdown) |
| Real-time | WebSocket (`ws` package), bidirectional |
| AI / RAG | Python FastAPI, Ollama, FAISS, `nomic-embed-text` embeddings |
| Build tool | Vite 5 |
| State management | React Context + `useReducer` |
| Persistence | Server-side JSON (`data/orders.json`) via HTTP API |

> The design system is driven by CSS custom properties in `src/index.css` (`--primary`, `--success`, `--warning`, `--danger`, …). The daisyUI `servai` theme in `tailwind.config.js` mirrors those exact values, so daisyUI components stay on-brand. daisyUI emits its component classes in Tailwind's `components` layer, so the app's own un-layered class rules always win — existing styling is never clobbered.

## Three Servers

| Server | Port | Purpose |
|--------|------|---------|
| **Vite dev server** | 5173 | Serves the React frontend |
| **Robot relay / replay** (`ws-test-server.js`) | 8765 | Connects to the robot (or replays `grocery_logs.txt`), parses the log stream, persists orders, serves order/image HTTP APIs |
| **RAG/AI server** (`src/rag/server.py`) | 5175 | AI captions, chat, vision analysis, vector search via Ollama |

**Data independence**: the chart, tally stats, and orders list work with just the relay server. AI captions/chat/vision require the RAG server (which requires Ollama). The UI never breaks if the RAG server is down — it shows "AI offline" gracefully.

## Screens & Routing

| Path | Screen | Purpose |
|------|--------|---------|
| `/` | — | Redirects to `/live` |
| `/live` | LiveScreen | Real-time task monitoring, robot status, workflow timeline, employee intervention |
| `/history` | HistoryScreen | AI weekly summary, activity chart, failure radar, orders list, AI chat |
| `/history/:dayId` | DayDetailsScreen | Single-day summary with individual order list |
| `/settings` | — | Stub (coming soon) |

Navigation is a bottom **dock** (daisyUI dock, ported) with Live / History / Settings; the active tab keeps the `--primary` color coding.

## Architecture

```
src/
├── components/
│   ├── ui/             Reusable primitives (Card, SmartCaption, StatusChip, LoadingState, …)
│   └── layout/         App shell (TopBar, BottomTabBar (dock), ScreenContainer)
├── features/
│   ├── live/           Live monitoring screen + components
│   ├── history/        Performance analytics + AI insights
│   │   ├── components/ ActivityChart, FailureRadar, OrdersList, WeeklySummaryCard, ChatPanel, …
│   │   └── pages/      HistoryScreen (composes all with a shared date range)
│   ├── day-details/    Day breakdown screen + components
│   └── assistant/      Floating assistant stub
├── hooks/              Data-fetching hooks (useRobotSocket, useRagCaption, useRagChat, …)
├── services/           API abstraction + data layer (messageMapper, orderStore, …)
├── context/            Global state (DataSourceContext — connection, live data, send)
├── lib/                Terms dictionary, phase mapping, URL helpers
└── rag/                Python FastAPI RAG server (server.py)
```

## History Page

Top-to-bottom:

1. **WeeklySummaryCard** — AI weekly summary rendered via SmartCaption (term tooltips, order citations).
2. **ChatCard** — slim "Ask ROBI" card (daisyUI button) that opens the chat panel.
3. **Range chips** — Today / Week / Month (daisyUI `btn`) controlling chart + orders list.
4. **ActivityChart** — daisyUI `stats` tally tiles (delivered / with warnings / couldn't deliver / avg fetch time) above a **Recharts** stacked bar chart with a custom TODAY marker and tooltip.
5. **FailureRadar** — a **Recharts** radar of failure-reason frequency (rose = couldn't deliver, amber = with warnings). Each failure label is **clickable**; a right-side panel shows what that failure means in plain language plus daisyUI count badges. Defaults to the most frequent failure.
6. **OrdersList** — daisyUI `list` of date-grouped orders with daisyUI `badge` status pills and filter chips; each row expands (`list-col-wrap`) into a step-by-step breakdown, failure camera feed, and "Ask ROBI".
7. **ChatPanel** — slide-in panel with SSE-streamed chat and SmartCaption rendering.

### Order statuses

| Status | Color | Meaning |
|--------|-------|---------|
| `success` / `ok` | Emerald | Delivered with no issues |
| `warning` | Amber | Delivered, but with issues during execution |
| `failed` | Rose | Could not be delivered (gripper failure, timeout, e-stop, etc.) |

### Color semantics
- **Emerald** — success / delivered · **Amber** — warnings · **Rose** — failure · **Teal** — AI-content accents · **Gray** — neutral. daisyUI theme colors map: `success`→emerald, `warning`→amber, `error`→rose, `accent`→teal, `primary`→blue.

### Smart Captions
AI text uses three marker types, rendered by `SmartCaption`:
- `[[slug]]` — technical term, shown with a daisyUI `tooltip` definition (teal dashed underline).
- `[cite:N]` — clickable order reference, rendered as a daisyUI `badge` that scrolls to the order.
- `**bold**` — highlighted suggestion (teal bold).

## RAG Server (`src/rag/server.py`)

A Python FastAPI server providing AI insight via local Ollama inference.

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rag/caption` | POST | AI caption for a surface (`weekly`, `order_detail`) |
| `/api/rag/chat` | POST | Streaming chat via SSE |
| `/api/rag/vision` | POST | Analyse failure camera images (vision model) |
| `/api/rag/health` | GET | LLM/embed reachability, model, index size |
| `/api/rag/parse` | GET | Debug: show the parsed Intent for a query |
| `/api/rag/cache` | DELETE | Clear caches (caption/vision/FAISS/chat log) and rebuild the index |
| `/api/orders/daily` | GET | Daily activity buckets (`?from=&to=`) |
| `/api/orders` | GET | Filtered order list (`?from=&to=&status=&item=`) |

### Key design decisions
- **Chat = parse → compute → render.** The LLM only translates a question into a typed `Intent` (one of ~11 kinds: count, list, rank, aggregate, lookup, compare, reason, explain, …). Python then deterministically filters/counts/ranks `orders.json` and produces a *verified* answer; the LLM finally renders prose that it is told **must not contradict** the verified numbers and IDs. Every decision is logged to `data/rag_chat.log`.
- **Deterministic stats** — all counts, averages, and rates are computed in Python and injected as FACTS; the LLM never counts.
- **Term-wrapping post-processor** — wraps known technical terms in `[[slug]]` (and strips slugs the model invents) so the UI renders them consistently.
- **Vision analysis** — failure images are sent to the vision model, grounded in a per-image event-context window captured by the relay server.
- **FAISS retrieval** — orders are embedded with `nomic-embed-text` for retrieval; index rebuilt on startup, persisted to `data/rag_index.faiss`.
- **Caching** — file-based with per-surface TTLs (weekly 30 min; `order_detail` forever); closed date ranges and vision results cache forever. LLM-failure responses are never cached.
- **Graceful degradation** — when Ollama is unreachable, AI surfaces show a soft "offline" notice.
- Models are configurable via `.env` (`LLM_MODEL`, `VISION_MODEL`, `EMBED_MODEL`).

## Robot Relay / Replay Server (`ws-test-server.js`)

Relays robot events to the dashboard indistinguishably from a direct socket, with a log-replay fallback for offline work.

- Connects to `ROBOT_WS` (default `ws://olifant.local:7878`). When no robot is reachable it **replays `grocery_logs.txt`** (broadcasting `source_mode: static`), then switches to `live` the moment a robot connects and back to replay if it drops. Set `STATIC_REPLAY=0` to disable the fallback and sit in `waiting` mode instead (the behaviour `main-live` hard-codes).
- Parses the structured log format `timestamp | LEVEL | COMPONENT:ACTION | STATUS | details` (plus image and loguru lines) into typed events.
- Cycle bookkeeping: tracks steps, retries, waypoints, collisions, and failure levels; classifies each order as `success`, `warning`, or `failed`; appends an enriched record to `data/orders.json`.
- Saves failure images to `data/images/` with a ±30s event-context window so the vision endpoint can ground its interpretation.
- New clients get a rapid catch-up burst of the current cycle, then the live stream; heartbeats and ws-level pings keep flaky iPad sockets alive.
- HTTP endpoints: `GET /api/recent-orders`, `/api/orders/daily`, `/api/orders/list`, `/api/orders`, `/api/source`, `/api/images/:id`, `POST /api/upload-image`.

## Live Screen (`src/features/live/`)

- **AttentionPanel** — current order/item, a daisyUI `progress` bar, ETA, and intervention action buttons.
- **RobotStatusCard** — a daisyUI `stats` "Today so far" overview (orders / avg time / needed help) + recently delivered.
- **WorkflowTimeline** — 9-phase pipeline view with step state, description, timestamp, and debug messages; the next-expected step shows a loading skeleton.
- **TechnicalDetails** — collapsible accordion for deeper robot-parameter inspection.

## Data Flow

### Live (WebSocket)

```
ws-test-server.js (robot relay / replay)
    → WebSocket messages
    → useRobotSocket (buffers, reconnects)
    → DataSourceContext reducer
    → messageMapper.applyMessageToScenario()
    → LiveScreen components re-render

Employee action → DataSourceContext.sendMessage() → useRobotSocket.send()
    → { type: "intervene" } to the server → server resumes the paused pipeline
```

### History + AI

```
HistoryScreen (shared date range)
    ├─ ActivityChart / FailureRadar → GET /api/orders/{daily,list}  (relay, 8765)
    ├─ WeeklySummaryCard / order detail → POST /api/rag/caption     (RAG, 5175)
    ├─ Failure camera analysis          → POST /api/rag/vision       (RAG, 5175)
    └─ ChatPanel                        → POST /api/rag/chat (SSE)    (RAG, 5175)
    → AI text rendered via SmartCaption (daisyUI term tooltips + citation badges + bold suggestions)
```

## Employee Intervention Flow

1. During detection, if 0 items are found, the server emits an `intervention_wait` event.
2. The frontend shows an orange status with action buttons.
3. The server pauses and waits up to **2 minutes** for an employee response.
4. **Button click:** the client sends `{ type: "intervene" }` → the server resumes.
5. **No response in 2 minutes:** the server writes a failed order and moves on.

## Environment Configuration

`.env`:

```bash
VITE_USE_WEBSOCKET=true            # live WebSocket mode
VITE_WS_URL=ws://localhost:8765    # robot relay server URL
VITE_RAG_URL=http://localhost:5175 # RAG/AI server URL (proxied via /rag in dev)

ROBOT_WS=ws://olifant.local:7878   # real robot controller (relay server)
STATIC_REPLAY=1                    # 1 = replay grocery_logs.txt as fallback; 0 = disable

# Ollama / RAG
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama                 # ignored by Ollama, required by the OpenAI client
LLM_MODEL=qwen2.5:3b
VISION_MODEL=gemma3
EMBED_MODEL=nomic-embed-text
```

## Accessibility & Target Devices

- CVD-friendly palette; never color-alone for meaning (icons + labels + shapes alongside status colors).
- Semantic HTML, ARIA labels, touch targets ≥ 44×44px.
- Tuned for iPad Mini (744×1133) through iPad Pro 12.9" (1024×1366).
