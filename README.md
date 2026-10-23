# ServAI UI

Tablet-first React dashboard for the **ServAI** operational workflow interface — a real-time monitoring UI for a robotic warehouse fulfillment system operated by a robot called **ROBI** (a FANUC CRX-10iA/L collaborative arm). It provides live operational monitoring with employee intervention support, historical performance analytics with AI-powered insights, and detailed day/order-level views.

> **Branch: `main-live`** — this branch is **real-connection only**. The WebSocket server always tries to reach the real robot at `ROBOT_WS` (default `ws://olifant.local:7878`) and shows a "waiting for robot" state until it connects. It never replays the bundled logs.
> The **`main`** branch is identical *except* that its WebSocket server also **replays `grocery_logs.txt`** as a fallback when no robot is connected (useful for offline development/demos). Everything else — UI, components, RAG server — is the same across both branches.

## Quick Start

```bash
npm install
npm run dev              # Vite dev server at http://localhost:5173
node ws-test-server.js   # Robot relay + orders HTTP API at ws://localhost:8765
py src/rag/server.py     # RAG/AI server at http://localhost:5175
```

On this branch `ws-test-server.js` connects straight to the robot — point it at your controller with `ROBOT_WS=ws://<host>:<port> node ws-test-server.js` if it isn't on `olifant.local`.

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
| **Robot relay** (`ws-test-server.js`) | 8765 | Connects to the robot, parses its log stream, persists orders, serves order/image HTTP APIs |
| **RAG/AI server** (`src/rag/server.py`) | 5175 | AI captions, chat, vision analysis, vector search via Ollama |

**Data independence**: the chart, tally stats, and orders list work with just the relay server. AI captions/chat/vision require the RAG server (which requires Ollama). The UI never breaks if the RAG server is down — it shows "AI offline" gracefully.

## Robots

The dashboard serves more than one robot. Pick the robot in the top bar (the menu next to the home icon); Live and History re-point at that robot and use its vocabulary. The choice is remembered per browser.

| Robot | Relay (port) | Orders file | Log dialect |
|-------|--------------|-------------|-------------|
| **ROBI** — grocery picker | `npm run relay` (8765) | `data/orders.json` | the pick pipeline (search → grasp → handover) |
| **Barista** — bartender | `npm run relay:bar` (8766) | `data/orders_bar.json` | `BARISTA:*` lines and the drink cycle (decap → track → glass → grab → pour → return) |

Each robot has its **own relay process, port and orders file** (`src/robots/robots.json`), so their orders never mix. The browser talks to the relay of the selected robot, and the RAG server reads that robot's orders file (the UI sends an `X-Robot` header).

What changes with the robot:

- **Live** — the pipeline steps, the headline and evidence ("Bottle 2 of 2", "Glass 1 of 1 filled"), the status wording and the action buttons ("I've refilled the rack"). A drink that finds the rack empty after pouring is saved as a **warning** (the robot still reports the cycle as successful); the "refill needed" note stays up for the next drink until one finishes with a bottle left.
- **History** — "Drinks" instead of "Orders", the bottle number instead of an item (the bar only has bottles, so there is **no item filter**), no Photos column while there are no camera captures, and the failure reasons are the bar's (`bottles_empty` …).
- **Where it lives** — `src/robots/profiles.js` (wording), `src/robots/bar/` (live mapper, view builders, saved-order steps), `src/robots/serverProfile.cjs` (the relay's per-robot parsing and order fields).

### The AI Judge

Both robots are watched by an **AI Judge**: an independent camera with a vision-language model that looks at the scene from the side, like a third person. It never moves the robot; it says what it sees. The dashboard always draws it the same way so it cannot be mistaken for the robot speaking: a violet frame with a "AI JUDGE" label (like a detection label on a camera image), its sentence in the first person, and the numbers behind it.

| | Grocery (ROBI) | Bar (Barista) |
|---|---|---|
| What the judge rules on | "Is the robot holding the coffee mug?" — asked ~4 times a second while the item is carried to the check spot and on to the handover | "Is it safe to shake this bottle?" (`BARISTA:SHAKE \| FAIL \| VLM: not safe to shake …`) |
| Where its lines come from | the `critic-service` process (its own loguru lines, local time) and the orchestrator's `ITEM_CHECK` lines | the bar's `BARISTA:SHAKE` line |
| Live | the violet box under "Now serving"; a note on "Bringing it over"; rows tagged "AI Judge" in the plain-words log | the box; a note on step 1 ("Shake skipped") |
| History | the same box and notes in an order's drawer; `order.critic` in the orders file | the same |

The relay turns the judge's lines into `critic` events (`phase`, `roi`, `check`, `verdict`, `alert`) on the orchestrator's clock (the critic logs local time; the offset is learned from the first line that follows an orchestrator line). `src/lib/critic.js` folds them into the dashboard state and the sentences, `src/components/ui/SmartJudge.jsx` draws them. `order.critic` keeps the summary: question, looks, how many said yes, the area watched, the verdict, any alert.

**The arm's faults.** Lines such as `RMI: … FRC_SystemFault`, `FanucDriverExecutor: FAULTED …` and `airo_fanuc: recovery …` have no timestamp or level, but they explain a handover that ends in "gripper open failed: no result". They become red `system_fault` events (repeats collapsed): the order is saved as `arm_fault` at the step that was running, the Live card says what to check (drives powered, alarms on the teach pendant), and the fault is **not hidden by the idle state** — it stays until the robot reports that motion is possible again or a new order starts.

### What is saved about every order (`run_details`)

Besides the steps, each grocery order carries `run_details`, taken from the robot's log by `src/robots/runDetails.cjs`, for explanations now and prediction models later. Every name says what it holds (lengths in metres unless the name says otherwise); the file's header documents each one.

| Field | What it holds |
|---|---|
| `robot_clock_started_at` | when the order started, by the robot's own clock |
| `item_position_m` `{x,y,z}`, `shelf_row`, `shelf_side` | where the item was (x forward, y sideways, z up); the row and side are derived from it. *Assumption: negative y is the left side; unconfirmed.* |
| `target_candidates` | the best matches considered: `distance_cm`, `match_score` |
| `item_search` | per shelf looked at: what it looked for, pictures checked, raw detections, clusters found / kept |
| `attempts[]` | one per try to pick the item up: `after_failure` (retry number, limit, cause, how the new angle was searched), `look_from` (hand and camera position, look-down angle, which of the candidate angles), `grasp_point_px`, `item_outline` (score, visible area), `grip_plan` (planner, reachable vs proposed grips, width), `outcome` (`grabbed`, `no_reachable_grip`, `lift_failed_awkward_wrist`, `blocked_by_obstacle`, `planning_failed_other`), `failure_text`, `seconds` |
| `grip` | the grip used: width, how far the hand opens first and its mode, which candidate, whether it is set per item |
| `planner_settings`, `motion_speed_ceiling_x`, `held_item_box_m`, `gripper_close_force` | the planner's settings, the speed limit near the shelf, the box assumed for the held item, the closing force |
| `handover` | where the person was, the arm's joint angles at the desk |
| `robot_setup` | the robot's configuration at start-up: perception models and device, planner and IK backend, camera resolution, tactile thresholds, shelves searched per item, arm driver |
| `attempt_count`, `needed_more_than_one_try` | summaries |

The relay also sends the growing details to the dashboard (`run_details` events) so Live explains tries as they happen. Orders saved earlier can be given details from the robot's log of that time: `npm run backfill:details` (matches by item and start time; adds only that field; keeps a `.before-run-details` copy).

**Counterfactuals** (`src/lib/counterfactual.js`): "Heads-up" before a pick-up and "What could change this?" after a failed try compare an order with earlier orders from the same shelf row and side, using only orders since the setup changed (`SETUP_STARTED_AT`), as plain counts with a "hint, not a promise" line. They need at least 2 similar orders; otherwise the card says there is nothing to suggest yet.

### Keeping the robots apart

The two logs look nothing alike, so each relay only understands its own: the grocery relay ignores the bar's `drink cycle N` and `BARISTA:*` lines, the bar relay ignores the grocery's `cycle N` lines, and either one fed the other's log records nothing and keeps running. Orders (`orders.json` / `orders_bar.json`), replay state, raw logs and the browser's socket are per robot, and so is everything in the RAG server (below). `node scripts/test-robot-isolation.mjs` runs both relays at once in **one** data folder, then feeds each the other's log.

### Connecting a robot

The relay connects to a WebSocket that sends the robot's log as text frames (one line per frame; several lines in a frame are fine, and a `[process] ` tag in front of a line is ignored). Set the address per robot — in the environment or in `.env`:

```bash
ROBOT_WS=ws://10.42.0.1:7878         # grocery (the default robot)
ROBOT_WS_BAR=ws://armadillo.local:7878   # bar — host and port are a guess until confirmed

> ssh -L 7878:localhost:7878 rasim@10.42.0.1 -> first connect to Louis\'s laptop
```

`npm run relay:bar` prints each connection attempt. With no robot it shows "waiting" and retries with backoff (1 s → 15 s), connects by itself when the robot appears, and drops a link that has gone silent for a minute. Everything the robot sends is also saved under `data/logs/` (`robot-bar-<day>.log`).

If the bar machine has no WebSocket for its log yet, `scripts/robot-log-stream.py` (Python 3, no packages) serves a log file as one — run it **on the robot's machine**:

```bash
python3 robot-log-stream.py ~/demos/CriticBarista/airo-barista/scripts/bar_demo.log --port 7878
```

It sends only new lines matching `' | (SYSTEM|WORKFLOW) | '` (the same filter as `tail -f … | grep`) plus the AI Judge's lines (`[critic-service]`) and the arm controller's fault lines; vLLM start-up, tactile-sensor warnings and planner chatter stay behind. To try the relay without any robot: `node scripts/fake-robot.cjs scripts/fixtures/bar_demo_2026-10-21.log --port 17879 --loop`, then `ROBOT_WS_BAR=ws://localhost:17879 npm run relay:bar` (on Windows, ports 7868–7967 are reserved, so a fake robot cannot listen on 7878 locally).

### Trying the bar without a robot

```bash
npm run replay        # grocery relay replaying the newest recorded log (with the AI Judge and an arm fault; port 8765). Older log: npm run replay -- recent_grocery_logs.txt
npm run replay:bar    # bar relay replaying scripts/fixtures/bar_demo_2026-10-21.log (port 8766)
npm run dev           # then choose the robot in the top bar

# the newest grocery log (AI Judge + an arm fault), twice as fast, into its own folder:
node scripts/dev-replay.cjs grocery scripts/fixtures/grocery_critic_2026-10-21.log --data data/replay/critic-demo --fresh --speed 2
```

`dev-replay.cjs` flags: `--fresh` (wipe the replay folder first), `--data <folder>`, `--speed <n>`, `--port <n>`.

```bash
npm run test:replay   # grocery log → relay → Live reducer, History, heatmap
npm run test:bar      # bar log → relay → Live, History, saved orders (and the grocery file stays untouched)
node scripts/test-bar-live.mjs          # the live connection: waits for a robot, connects, reconnects, tagged lines
node scripts/test-robot-log-stream.mjs  # robot-log-stream.py → relay → orders
node scripts/test-grocery-critic.mjs    # newest grocery log: judge events, arm fault, orders, Live and History views
node scripts/test-tries.mjs             # run_details saved per order, "My tries" in plain words, Heads-up / What could change this?
node scripts/test-grocery-live.mjs      # the same log over the live connection and through the streamer (with noise)
node scripts/test-robot-isolation.mjs   # both relays at once in one data folder; each fed the other's log
py scripts/test-rag-robots.py           # the RAG server keeps the robots apart (no LLM or relay needed)
```

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
│   │   ├── components/ ActivityHeatmap, FailureRadar, OrdersList, WeeklySummaryCard, ChatPanel, …
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
3. **Range chips** — Today / Week / Month / Custom (daisyUI `btn`; Custom adds two date fields, default last 14 days) controlling the heatmap + orders list.
4. **ActivityHeatmap** — daisyUI `stats` tally tiles (delivered / with warnings / couldn't deliver / avg fetch time) above a heatmap of when orders happen: hours for one day, 2-hour blocks for up to a week, a calendar for longer ranges. Switch between **Orders** (volume, blue) and **Failure rate** (rose; cells under 3 orders are greyed out). Hover or tap a cell for its breakdown; the default selection is the busiest cell or day. Orders are bucketed in the browser's local time.
5. **FailureRadar** — a **Recharts** radar of failure-reason frequency (rose = couldn't deliver, amber = with warnings). Each failure label is **clickable**; a right-side panel shows what that failure means in plain language plus daisyUI count badges. Defaults to the most frequent failure.
6. **OrdersList** — date-grouped orders as a table (Item · Order · Time · Took · Photos · Status), with status chips and a multi-select **Item** dropdown (combined with AND; `/api/orders/list?item=pen,ball`). Orders with camera captures show a camera icon and count. A row expands into what happened in a sentence, how orders of that item usually go, the failure camera feed, and the same step list as the Live pipeline (`components/ui/StepList.jsx`): time against typical, the numbers, **Why**, grasp tries and the raw log, built by `lib/orderSteps.js`. "Ask ROBI" opens the chat.
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

### One server, two separate assistants

The UI sends `X-Robot: grocery|bar` with every request (the response says which robot answered). Nothing is shared between the robots:

- **Orders** — read from **that robot's relay** (`/api/orders` on its own port), i.e. exactly what the History page shows, wherever that relay keeps its files (a replay keeps its own copy under `data/replay/<robot>/`). With no relay running, the robot's own orders file is used (`DATA_DIR/<file>`, or the replay copy if it is newer). A robot with neither has **no orders** — never the other robot's. `GET /api/rag/health` shows the source of each robot's orders. `RELAY_URL_<ROBOT>` / `RELAY_HOST` point it at relays on other machines; `RAG_ORDERS_SOURCE=file` skips the relays.
- **Questions** — `src/rag/robot_profiles.py` holds each robot's vocabulary: the values an Intent may take (the Barista has no items; its phases are decap/track/glass/grab/pour/return, its reasons `bottles_empty`, `unsafe_to_shake` …, and it can group by bottle), its few-shot examples, its glossary ("what is the rack?", "what is the AI Judge?"), its wording (drinks, "attention-needed", 200 ml) and the voice of the answer writer. Values that do not exist for a robot are dropped from a parsed question instead of filtering everything away.
- **Prompts** — the shared caption prompts are re-pointed at the robot (names, nouns, advice such as "refill the rack"); `scripts/test-rag-robots.py` checks that no prompt for the Barista contains a grocery word.
- **State** — one FAISS index, one chat log (`rag_chat.log` / `rag_chat_bar.log`), one index file and separate caption cache entries per robot; clearing the cache clears the current robot's only.

### Key design decisions
- **Chat = parse → compute → render.** The LLM only translates a question into a typed `Intent` (one of ~11 kinds: count, list, rank, aggregate, lookup, compare, reason, explain, …). Python then deterministically filters/counts/ranks `orders.json` and produces a *verified* answer; the LLM finally renders prose that it is told **must not contradict** the verified numbers and IDs. Every decision is logged to `data/rag_chat.log`.
- **Deterministic stats** — all counts, averages, and rates are computed in Python and injected as FACTS; the LLM never counts.
- **Term-wrapping post-processor** — wraps known technical terms in `[[slug]]` (and strips slugs the model invents) so the UI renders them consistently.
- **Vision analysis** — failure images are sent to the vision model, grounded in a per-image event-context window captured by the relay server.
- **FAISS retrieval** — orders are embedded with `nomic-embed-text` for retrieval; index rebuilt on startup, persisted to `data/rag_index.faiss`.
- **Caching** — file-based with per-surface TTLs (weekly 30 min; `order_detail` forever); closed date ranges and vision results cache forever. LLM-failure responses are never cached.
- **Graceful degradation** — when Ollama is unreachable, AI surfaces show a soft "offline" notice.
- Models are configurable via `.env` (`LLM_MODEL`, `VISION_MODEL`, `EMBED_MODEL`).

## Robot Relay Server (`ws-test-server.js`)

Connects to the robot and relays its events to the dashboard indistinguishably from a direct socket.

- Connects to `ROBOT_WS` (default `ws://olifant.local:7878`); on disconnect it sits in `waiting` mode and retries with capped exponential backoff (1s → 15s). **Real connection only on this branch — no static replay.** (The legacy replay code remains in the file but is disabled via `ENABLE_STATIC_REPLAY = false`.)
- Parses the structured log format `timestamp | LEVEL | COMPONENT:ACTION | STATUS | details` (plus image and loguru lines) into typed events.
- Cycle bookkeeping: tracks steps, retries, waypoints, collisions, and failure levels; classifies each order as `success`, `warning`, or `failed`; appends an enriched record to `data/orders.json`.
- Saves failure images to `data/images/` with a ±30s event-context window so the vision endpoint can ground its interpretation.
- New clients get a rapid catch-up burst of the current cycle, then the live stream; heartbeats and ws-level pings keep flaky iPad sockets alive.
- HTTP endpoints: `GET /api/recent-orders`, `/api/orders/daily`, `/api/orders/list`, `/api/orders`, `/api/source`, `/api/images/:id`, `POST /api/upload-image`.

> **On `main`** the same server additionally replays `grocery_logs.txt` (controlled by `ENABLE_STATIC_REPLAY` / `STATIC_REPLAY` env) as a fallback when no robot is reachable, broadcasting `source_mode: static` so the UI labels it "Demo replay".

## Live Screen (`src/features/live/`)

The Live page explains what the robot is doing and why, not just its status.

- **AttentionPanel (Now serving)** — item, order, status pill, and an ETA based on how long that item usually takes (`/api/orders/slim`). A step bar with one segment per pipeline step (an amber or red step stays amber or red), a headline with the numbers behind it (target match, grasp point, grasp tries…), what happens next / if it goes wrong / how orders of this item usually end, the intervention buttons, and "Issues in this order" tagged with the step that caused them.
- **FailurePicturesCard ("What I saw")** — the pictures the robot took when something went wrong in the current order: the latest large with a one-line caption ("While handing over"), thumbnails for the others (Close-up / Wide), tap to enlarge. With nothing to show it says "All clear. Nothing to show." with a small sketch. The relay sends a `failure_image` event per picture and the dashboard loads the file from `GET /api/images/<id>`. The robot does not stream live video; whether it ever should is undecided. In a replay the logs hold no picture data, so a picture the robot saved earlier in `data/images/` is used if it exists, otherwise a sample picture (`scripts/fixtures/sample_failure_*.jpg`). There is no automatic face blurring (no detector is available); `IMAGE_RETENTION_HOURS=<n>` makes the relay delete pictures older than n hours (default: keep them).
- **RobotStatusCard** — "Today so far" as one strip: the day's orders / avg time / needed help (from `/api/recent-orders` → `today`), an outcome bar, and the two latest orders with their outcome.
- **WorkflowTimeline** — the pipeline, oldest step first. Each step shows its time against the typical time, the numbers behind it, and a Why / grasp tries / raw log drawer.
- **TechnicalDetails** — arm / gripper / planner / speed, and the robot log next to a plain-words version of each line. Opens by itself when something is amber or red.

The facts behind these cards are collected per order by `messageMapper.js` (`_ev`, `_stageInfo`, `_log`) and turned into sentences by `src/lib/liveView.js`. `src/lib/logTranslate.js` turns raw controller text (contact_stop, IK branch flips…) into plain words and `src/lib/orderStats.js` computes the history numbers.

### Raw robot log

While the relay is connected to the robot, every line it receives is also saved unchanged to `data/logs/robot-YYYY-MM-DD.log` (one file per day; `RAW_LOG_DIR` changes the folder). Only the robot's own lines are written (connects and disconnects are printed in the relay's console, not saved). The base64 picture in `IMAGE` lines is replaced by its size, since the image is already saved under `data/images`. A saved file can be replayed with `node scripts/dev-replay.cjs data/logs/robot-<day>.log`. Static replays write no raw log. `npm run test:rawlog` checks this against a fake robot.

### Testing the Live page against recorded logs

```bash
npm run test:replay            # replays grocery_logs.txt through the relay and the Live reducer, checks the result
npm run replay                 # relay in replay mode for UI work (no robot needed), real orders untouched
```

Each time the replay starts it also adds the orders the robot completed since the replay folder was first copied (a live run writes them to `data/orders.json`), with the next free order numbers, so the replay history is the robot's real history plus the replays.

The replay runs the real relay with `STATIC_REPLAY=1` at the log's own speed (`REPLAY_SPEED=3` for faster) into `data/replay/<robot>/` (git-ignored), a copy of that robot's orders file made on the first run, so `data/orders.json` is never modified. That folder is kept: restart the replay and the history of completed orders is still there and order numbers carry on. `npm run replay -- --fresh` (or `npm run replay:bar -- --fresh`) starts over. The default stays real-connection-only.

With a real robot nothing is ever cleared: the relay appends to `data/orders.json` / `data/orders_bar.json` on every finished order and reads them again when it starts, so restarting the relay keeps the history.

The RAG server asks the robot's relay for its orders (see "One server, two separate assistants"), so it no longer matters which `DATA_DIR` a relay or a replay writes to. If no relay is running it reads the orders file (`DATA_DIR`, or the replay copy in `data/replay/<robot>/`). The relay writes its orders file atomically, and the RAG server retries a failed read and falls back to its last good copy instead of reporting "no orders".

## Data Flow

### Live (WebSocket)

```
ws-test-server.js (robot relay)
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
    ├─ ActivityHeatmap / FailureRadar → GET /api/orders/{daily,times,list}  (relay, 8765)
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
