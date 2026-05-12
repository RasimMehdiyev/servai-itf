"""
RAG API server — FastAPI on port 5174.

Endpoints:
  POST /api/rag/caption   — { surface, scope? }  → { text, citations, generated_at }
  POST /api/rag/chat      — { messages }          → SSE stream
  GET  /api/rag/health    — health + model status
  GET  /api/orders/daily   — daily activity buckets
  GET  /api/orders         — filtered order list

Uses Ollama via the OpenAI-compatible client.
FAISS index with nomic-embed-text embeddings for retrieval.
"""

import os, sys, json, re, hashlib, time, threading
from pathlib import Path
from datetime import datetime, timedelta, timezone

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# ── Paths ────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")

ORDERS_FILE = ROOT / "data" / "orders.json"
CACHE_DIR = ROOT / "data" / "cache" / "captions"
FAISS_PATH = ROOT / "data" / "rag_index.faiss"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ── LLM client ──────────────────────────────────────────────────────────────

from openai import OpenAI

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "ollama")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen2.5:3b")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")

llm = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)

# ── Terms dictionary (mirrors src/lib/terms.js) ─────────────────────────────

TERMS = {
    "gripper": "Gripper",
    "sam3": "SAM3",
    "molmo": "Molmo",
    "grasp-synthesis": "Grasp synthesis",
    "trajectory": "Trajectory",
    "anchor": "Anchor",
    "depth-offset": "Depth offset",
    "standoff": "Standoff",
    "handover": "Handover",
    "e-stop": "Emergency stop",
    "close-up": "Close-up view",
    "detection": "Detection",
    "fanuc": "FANUC CRX-10iA/L",
    "curobo": "cuRobo",
    "intervention": "Intervention",
}
TERM_SLUGS = list(TERMS.keys())


def wrap_terms(text: str) -> str:
    """Deterministic post-processor: wrap first mention of each known term in [[slug]]."""
    for slug, name in TERMS.items():
        if f"[[{slug}]]" in text:
            continue
        pattern = rf"(?<!\[\[){re.escape(name)}(?!\]\])"
        text = re.sub(pattern, f"[[{slug}]]", text, count=1, flags=re.IGNORECASE)
    return text


# ── Data access ──────────────────────────────────────────────────────────────

def read_orders():
    try:
        return json.loads(ORDERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def filter_by_date(orders, start, end):
    return [o for o in orders if start <= (o.get("started_at", "")[:10] or "") <= end]


def today_str():
    return datetime.now().strftime("%Y-%m-%d")


def week_ago_str():
    return (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")


# ── Deterministic stats (numbers NEVER come from the LLM) ───────────────────

def compute_stats(orders):
    total = len(orders)
    success = sum(1 for o in orders if o.get("status") in ("success", "ok"))
    failed = total - success

    times = [o.get("total_seconds", 0) for o in orders if o.get("total_seconds", 0) > 0]
    avg_time = round(sum(times) / len(times)) if times else 0
    sorted_times = sorted(times)
    median_time = sorted_times[len(sorted_times) // 2] if sorted_times else 0

    robot_times = [o.get("robot_seconds", 0) for o in orders if o.get("robot_seconds", 0) > 0]
    avg_robot_time = round(sum(robot_times) / len(robot_times)) if robot_times else 0

    items = {}
    for o in orders:
        item = o.get("item", "unknown")
        items[item] = items.get(item, 0) + 1
    item_ranking = sorted(items.items(), key=lambda x: -x[1])

    days = {}
    for o in orders:
        d = (o.get("started_at") or "")[:10]
        if d:
            days[d] = days.get(d, 0) + 1
    busiest = max(days.items(), key=lambda x: x[1]) if days else None

    failures = {}
    for o in orders:
        if o.get("status") not in ("success", "ok"):
            reason = (o.get("failure") or {}).get("reason") or o.get("failureReason") or "unknown"
            failures[reason] = failures.get(reason, 0) + 1

    slowest = max(orders, key=lambda o: o.get("total_seconds", 0)) if orders else None

    return {
        "total": total, "success": success, "failed": failed,
        "avg_time": avg_time, "median_time": median_time, "avg_robot_time": avg_robot_time,
        "item_ranking": item_ranking,
        "busiest_day": {"date": busiest[0], "count": busiest[1]} if busiest else None,
        "failures": failures,
        "slowest": {"id": slowest.get("id"), "item": slowest.get("item"), "total_seconds": slowest.get("total_seconds", 0)} if slowest else None,
    }


# ── FAISS index ──────────────────────────────────────────────────────────────

try:
    import faiss
    HAS_FAISS = True
except ImportError:
    HAS_FAISS = False

faiss_index = None
faiss_docs = []
last_rebuilt = None


def order_to_text(o):
    status = "delivered" if o.get("status") in ("success", "ok") else f"failed ({(o.get('failure') or {}).get('reason', 'unknown')})"
    steps = ", ".join(s.get("friendly_name", s.get("phase", "?")) for s in (o.get("steps") or []))
    return (
        f"Order #{o.get('id')}: {o.get('item')}, {status}, "
        f"{o.get('total_seconds', 0)}s total, {o.get('robot_seconds', 0)}s robot, "
        f"started {o.get('started_at', '?')[:16]}. Phases: {steps}"
    )


def embed_texts(texts):
    try:
        resp = llm.embeddings.create(model=EMBED_MODEL, input=texts)
        return [np.array(e.embedding, dtype="float32") for e in resp.data]
    except Exception as e:
        print(f"[RAG] Embedding error: {e}", file=sys.stderr)
        return None


def rebuild_index():
    global faiss_index, faiss_docs, last_rebuilt
    if not HAS_FAISS:
        return
    orders = read_orders()
    if not orders:
        return
    texts = [order_to_text(o) for o in orders]
    vectors = embed_texts(texts)
    if vectors is None:
        return
    dim = len(vectors[0])
    index = faiss.IndexFlatIP(dim)
    mat = np.stack(vectors)
    faiss.normalize_L2(mat)
    index.add(mat)
    faiss_index = index
    faiss_docs = texts
    last_rebuilt = datetime.now(timezone.utc).isoformat()
    # Persist
    try:
        faiss.write_index(index, str(FAISS_PATH))
    except Exception:
        pass
    print(f"[RAG] FAISS index rebuilt: {len(texts)} docs, dim={dim}")


def retrieve(query, k=6):
    if faiss_index is None or not faiss_docs:
        return []
    vec = embed_texts([query])
    if vec is None:
        return []
    q = np.array(vec[0], dtype="float32").reshape(1, -1)
    faiss.normalize_L2(q)
    scores, indices = faiss_index.search(q, min(k, len(faiss_docs)))
    results = []
    for i, idx in enumerate(indices[0]):
        if idx >= 0 and idx < len(faiss_docs):
            text = faiss_docs[idx]
            if len(text) > 1200:
                text = text[:1200]
            results.append(text)
    return results


# ── Prompts (Qwen-optimized: numbered lists, facts injected) ────────────────

SYSTEM_PROMPT = f"""You are ROBI's assistant. You write short operational summaries for supermarket employees who monitor a grocery-picking robot.

Rules:
1. Write in plain, friendly English. Use "ROBI" to refer to the robot.
2. Wrap technical terms from this list in [[slug]] brackets when you mention them: {', '.join(TERM_SLUGS)}.
3. Cite specific orders as [cite:N] where N is the order number.
4. Never invent numbers. Only use the FACTS provided.
5. Keep responses concise and factual."""


def weekly_prompt(stats):
    items = ", ".join(f"{item} ({count})" for item, count in stats["item_ranking"])
    failures_line = ", ".join(f"{r}: {c}" for r, c in stats["failures"].items()) if stats["failures"] else "No failures"
    busiest = f"{stats['busiest_day']['date']} with {stats['busiest_day']['count']} orders" if stats.get("busiest_day") else "N/A"
    slowest = f"#{stats['slowest']['id']} ({stats['slowest']['item']}, {stats['slowest']['total_seconds']}s)" if stats.get("slowest") else "N/A"
    return {
        "system": SYSTEM_PROMPT,
        "user": f"""Write a 2-paragraph weekly summary. Each paragraph should be 2-3 sentences. No headings, no bullet points.

FACTS:
1. Orders this week: {stats['total']} ({stats['success']} delivered, {stats['failed']} failed)
2. Average fetch time: {stats['avg_time']} seconds ({stats['avg_robot_time']}s robot work)
3. Median fetch time: {stats['median_time']} seconds
4. Items handled: {items}
5. Busiest day: {busiest}
6. Slowest order: {slowest}
7. Failures: {failures_line}

First paragraph: headline performance. Second: notable details or patterns.""",
    }


def chart_prompt(stats):
    items = ", ".join(f"{item} ({count})" for item, count in stats["item_ranking"][:5])
    busiest = f"{stats['busiest_day']['date']} ({stats['busiest_day']['count']} orders)" if stats.get("busiest_day") else "N/A"
    return {
        "system": SYSTEM_PROMPT,
        "user": f"""Write a 1-2 sentence caption for a daily activity chart. No headings, no bullet points.

FACTS:
1. Period: {stats.get('start_date', '?')} to {stats.get('end_date', '?')}
2. Total orders: {stats['total']} ({stats['success']} delivered, {stats['failed']} failed)
3. Average fetch time: {stats['avg_robot_time']}s (robot time only)
4. Top items: {items}
5. Busiest day: {busiest}

Be brief — this sits below a chart that already shows the data visually.""",
    }


def orders_list_prompt(stats, status_filter="all"):
    return {
        "system": SYSTEM_PROMPT,
        "user": f"""Write a 1-sentence summary for the orders list section. No headings.

FACTS:
1. Showing: {status_filter} orders from {stats.get('start_date', '?')} to {stats.get('end_date', '?')}
2. Count: {stats['total']} orders ({stats['success']} delivered, {stats['failed']} failed)
3. Average robot time: {stats['avg_robot_time']}s

One sentence only. Don't repeat what the filters already show.""",
    }


def order_detail_prompt(order):
    steps = "\n  ".join(
        f"{s.get('friendly_name', s.get('phase', '?'))}: {s.get('duration_seconds', 0)}s"
        + (f" ({json.dumps(s.get('meta', {}))})" if s.get("meta") else "")
        for s in (order.get("steps") or [])
    )
    failure_info = ""
    if order.get("failure"):
        f = order["failure"]
        failure_info = f" — {f.get('reason', '?')}: {f.get('detail', '?')}"

    return {
        "system": SYSTEM_PROMPT,
        "user": f"""An employee tapped "Why so long? Ask ROBI" on order #{order.get('id')}.

FACTS:
1. Item: {order.get('item')}
2. Status: {order.get('status')}{failure_info}
3. Total time: {order.get('total_seconds', 0)}s (robot: {order.get('robot_seconds', '?')}s, human wait: {order.get('human_wait_seconds', '?')}s)
4. Steps:
  {steps}

Explain in 2-3 sentences why this order took the time it did. Reference specific phases and numbers. If it failed, explain what went wrong.""",
    }


def chat_prompt_build(messages, context):
    return {
        "system": SYSTEM_PROMPT + f"\n\nYou have access to order data. When answering, cite order IDs as [cite:N]. Here is relevant context:\n{context}",
        "messages": messages,
    }


# ── LLM call ────────────────────────────────────────────────────────────────

def check_llm_reachable():
    try:
        llm.models.list()
        return True
    except Exception:
        return False


def check_embed_reachable():
    try:
        llm.embeddings.create(model=EMBED_MODEL, input=["test"])
        return True
    except Exception:
        return False


def call_llm(system, user_msg, max_tokens=400):
    messages = [{"role": "system", "content": system}]
    if isinstance(user_msg, str):
        messages.append({"role": "user", "content": user_msg})
    elif isinstance(user_msg, list):
        messages.extend(user_msg)

    try:
        resp = llm.chat.completions.create(
            model=LLM_MODEL,
            messages=messages,
            temperature=0.3,
            max_tokens=max_tokens,
        )
        text = resp.choices[0].message.content or ""
        text = wrap_terms(text)
        citations = [int(m) for m in re.findall(r"\[cite:(\d+)\]", text)]
        return {"text": text, "citations": citations}
    except Exception as e:
        print(f"[RAG] LLM error: {e}", file=sys.stderr)
        return {"text": "_ROBI's report is unavailable right now — local AI is offline._", "citations": []}


# ── Caching ──────────────────────────────────────────────────────────────────

CACHE_TTL_LIVE = {
    "weekly": 30 * 60,        # 30 min — includes today, may change
    "chart": 15 * 60,         # 15 min
    "orders_list": 10 * 60,   # 10 min
    "order_detail": float("inf"),  # immutable once an order is closed
}


def cache_key(surface, scope):
    h = hashlib.md5(json.dumps({"surface": surface, "scope": scope}, sort_keys=True).encode()).hexdigest()[:12]
    return f"{surface}_{h}.json"


def _scope_is_closed(scope):
    """A date range that ends before today is immutable — cache forever."""
    end = scope.get("to") or scope.get("endDate")
    if not end:
        return False
    return end < today_str()


def read_cache(surface, scope):
    path = CACHE_DIR / cache_key(surface, scope)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if surface == "order_detail" or _scope_is_closed(scope):
            return data  # immutable — cache forever
        ttl = CACHE_TTL_LIVE.get(surface, 600)
        age = time.time() - datetime.fromisoformat(data["generated_at"]).timestamp()
        if age < ttl:
            return data
    except Exception:
        pass
    return None


def write_cache(surface, scope, result):
    entry = {**result, "surface": surface, "scope": scope, "generated_at": datetime.now(timezone.utc).isoformat()}
    path = CACHE_DIR / cache_key(surface, scope)
    try:
        path.write_text(json.dumps(entry, indent=2), encoding="utf-8")
    except Exception:
        pass
    return entry


# ── Caption generation ───────────────────────────────────────────────────────

def generate_caption(surface, scope):
    cached = read_cache(surface, scope)
    if cached:
        return cached

    orders = read_orders()

    if surface == "weekly":
        start, end = week_ago_str(), today_str()
        filtered = filter_by_date(orders, start, end)
        stats = compute_stats(filtered)
        stats["start_date"] = start
        stats["end_date"] = end
        p = weekly_prompt(stats)
    elif surface == "chart":
        start = scope.get("from") or week_ago_str()
        end = scope.get("to") or today_str()
        filtered = filter_by_date(orders, start, end)
        stats = compute_stats(filtered)
        stats["start_date"] = start
        stats["end_date"] = end
        p = chart_prompt(stats)
    elif surface == "orders_list":
        start = scope.get("from") or week_ago_str()
        end = scope.get("to") or today_str()
        filtered = filter_by_date(orders, start, end)
        stats = compute_stats(filtered)
        stats["start_date"] = start
        stats["end_date"] = end
        p = orders_list_prompt(stats, scope.get("status", "all"))
    elif surface == "order_detail":
        order = next((o for o in orders if o.get("id") == scope.get("order_id")), None)
        if not order:
            return {"text": "Order not found.", "citations": [], "generated_at": datetime.now(timezone.utc).isoformat()}
        p = order_detail_prompt(order)
    else:
        return {"text": f"Unknown surface: {surface}", "citations": [], "generated_at": datetime.now(timezone.utc).isoformat()}

    result = call_llm(p["system"], p["user"])
    return write_cache(surface, scope, result)


# ── Background weekly summary refresh ───────────────────────────────────────

def _refresh_weekly_loop():
    while True:
        time.sleep(30 * 60)  # 30 min
        try:
            # Force regenerate by clearing cache first
            path = CACHE_DIR / cache_key("weekly", {})
            if path.exists():
                path.unlink()
            generate_caption("weekly", {})
            print("[RAG] Weekly summary refreshed in background")
        except Exception as e:
            print(f"[RAG] Background refresh error: {e}", file=sys.stderr)


# ── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="ServAI RAG Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    threading.Thread(target=rebuild_index, daemon=True).start()
    threading.Thread(target=_refresh_weekly_loop, daemon=True).start()


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/api/rag/health")
def health():
    llm_ok = check_llm_reachable()
    embed_ok = check_embed_reachable()
    return {
        "ok": llm_ok and embed_ok,
        "llm_reachable": llm_ok,
        "llm_model": LLM_MODEL,
        "embed_reachable": embed_ok,
        "index_size": faiss_index.ntotal if faiss_index is not None else 0,
        "last_rebuilt": last_rebuilt,
    }


# ── Caption ──────────────────────────────────────────────────────────────────

@app.post("/api/rag/caption")
async def caption(request: Request):
    body = await request.json()
    surface = body.get("surface")
    scope = body.get("scope", {})
    force = body.get("force", False)

    if not surface:
        return JSONResponse({"error": "surface is required"}, status_code=400)

    if force:
        path = CACHE_DIR / cache_key(surface, scope)
        if path.exists():
            path.unlink()

    result = generate_caption(surface, scope)
    return result


# ── Chat (SSE streaming) ────────────────────────────────────────────────────

@app.post("/api/rag/chat")
async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    if not messages:
        return JSONResponse({"error": "messages array is required"}, status_code=400)

    # Build context from retrieval + stats
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    chunks = retrieve(last_user, k=6)
    context_text = "\n".join(chunks) if chunks else ""

    # Also add aggregate stats
    orders = read_orders()
    start, end = week_ago_str(), today_str()
    filtered = filter_by_date(orders, start, end)
    stats = compute_stats(filtered)
    stats_line = f"\nWeekly stats: {stats['total']} orders, {stats['success']} delivered, {stats['failed']} failed, avg {stats['avg_time']}s."
    full_context = context_text + stats_line

    prompt = chat_prompt_build(messages, full_context)

    def generate():
        sys_messages = [{"role": "system", "content": prompt["system"]}]
        sys_messages.extend(prompt["messages"])
        try:
            stream = llm.chat.completions.create(
                model=LLM_MODEL,
                messages=sys_messages,
                stream=True,
                temperature=0.3,
                max_tokens=600,
            )
            full_text = ""
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                full_text += delta
                yield f"data: {json.dumps({'text': delta})}\n\n"
            # Post-process full text for terms and send final version
            wrapped = wrap_terms(full_text)
            if wrapped != full_text:
                yield f"data: {json.dumps({'final': wrapped})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'text': f'_Sorry, I could not get a response right now. ({e})_'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Orders daily endpoint ───────────────────────────────────────────────────

@app.get("/api/orders/daily")
def orders_daily(
    start: str = Query(None, alias="from"),
    end: str = Query(None, alias="to"),
):
    if not start:
        start = week_ago_str()
    if not end:
        end = today_str()

    orders = read_orders()
    filtered = filter_by_date(orders, start, end)

    # Bucket by date
    buckets = {}
    d = datetime.strptime(start, "%Y-%m-%d")
    end_d = datetime.strptime(end, "%Y-%m-%d")
    while d <= end_d:
        buckets[d.strftime("%Y-%m-%d")] = {"delivered": 0, "failed": 0}
        d += timedelta(days=1)

    for o in filtered:
        date = (o.get("started_at") or "")[:10]
        if date in buckets:
            if o.get("status") in ("success", "ok"):
                buckets[date]["delivered"] += 1
            else:
                buckets[date]["failed"] += 1

    days = [{"date": d, **v} for d, v in sorted(buckets.items())]

    robot_times = [o.get("robot_seconds", 0) for o in filtered if o.get("robot_seconds", 0) > 0]
    avg_fetch = round(sum(robot_times) / len(robot_times)) if robot_times else 0

    total_delivered = sum(d["delivered"] for d in days)
    total_failed = sum(d["failed"] for d in days)

    return {
        "from": start,
        "to": end,
        "days": days,
        "totals": {
            "delivered": total_delivered,
            "failed": total_failed,
            "avg_fetch_seconds": avg_fetch,
        },
    }


# ── Orders list endpoint ────────────────────────────────────────────────────

@app.get("/api/orders")
def orders_list(
    start: str = Query(None, alias="from"),
    end: str = Query(None, alias="to"),
    status: str = Query("all"),
    item: str = Query("all"),
):
    if not start:
        start = week_ago_str()
    if not end:
        end = today_str()

    orders = read_orders()
    filtered = filter_by_date(orders, start, end)

    # Counts before status/item filter
    all_count = len(filtered)
    delivered_count = sum(1 for o in filtered if o.get("status") in ("success", "ok"))
    failed_count = all_count - delivered_count

    by_item = {}
    for o in filtered:
        i = o.get("item", "unknown")
        by_item[i] = by_item.get(i, 0) + 1

    # Apply filters
    if status == "delivered":
        filtered = [o for o in filtered if o.get("status") in ("success", "ok")]
    elif status == "failed":
        filtered = [o for o in filtered if o.get("status") not in ("success", "ok")]

    if item != "all":
        filtered = [o for o in filtered if o.get("item") == item]

    # Sort descending by completed_at
    filtered.sort(key=lambda o: o.get("completed_at") or o.get("started_at") or "", reverse=True)

    # Project fields
    result_orders = []
    for o in filtered:
        result_orders.append({
            "id": o.get("id"),
            "order_number": o.get("order_number", str(o.get("id", ""))),
            "item": o.get("item"),
            "status": o.get("status"),
            "failure": o.get("failure"),
            "started_at": o.get("started_at"),
            "completed_at": o.get("completed_at"),
            "total_seconds": o.get("total_seconds", 0),
            "robot_seconds": o.get("robot_seconds", 0),
            "human_wait_seconds": o.get("human_wait_seconds", 0),
            "phases": o.get("steps", []),
        })

    return {
        "filter": {"from": start, "to": end, "status": status, "item": item},
        "counts": {
            "all": all_count,
            "delivered": delivered_count,
            "failed": failed_count,
            "by_item": dict(sorted(by_item.items(), key=lambda x: -x[1])),
        },
        "orders": result_orders,
    }


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5175)
