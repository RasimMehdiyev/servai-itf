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

# Defer annotation evaluation so `str | None` etc. work on Python 3.8/3.9.
from __future__ import annotations

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
CHAT_LOG_FILE = ROOT / "data" / "rag_chat.log"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def chat_log(entry: dict):
    """Append a JSON line to data/rag_chat.log for offline debugging.

    Records the exact decisions the chat endpoint made for every request:
    parsed intent, whether the deterministic path fired, what the verified
    count was, which order ids matched, and a sample of the response. If
    something looks wrong in the UI, the truth is here on disk.
    """
    try:
        entry.setdefault("ts", datetime.now(timezone.utc).isoformat())
        with CHAT_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        # Never let logging break a request.
        print(f"[RAG] chat_log error: {e}", file=sys.stderr)

# ── LLM client ──────────────────────────────────────────────────────────────

from openai import OpenAI

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "ollama")
LLM_MODEL = os.environ.get("LLM_MODEL", "gemma3")
VISION_MODEL = os.environ.get("VISION_MODEL", "gemma3")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
IMAGES_DIR = ROOT / "data" / "images"

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
    "voxels": "Voxels",
    "waypoint": "Waypoint",
    "goalset": "Goalset",
    "reachability": "Reachability",
    "scene-scan": "Scene scan",
    "retry": "Retry",
    "search-sweep": "Search sweep",
    "zenoh": "Zenoh",
    "d415": "Intel D415",
    # ── Failure reasons (must match orders.json failure.reason values).
    # Name is the snake_case form the LLM is likely to produce; wrap_terms
    # canonicalises it to the slug.
    "search-exhausted": "search_exhausted",
    "reachability-failed": "reachability_failed",
    "no-valid-depth": "no_valid_depth",
    "handover-failed": "handover_failed",
    "user-cancelled": "user_cancelled",
    "gripper-failed": "gripper_failed",
    "e-stopped": "e_stopped",
    "timeout": "timeout",
    "operator-abort": "operator_abort",
    "bridge-fault": "bridge_fault",
    # ── Pipeline phases (failure.at_phase values).
    "phase-searching": "searching",
    "phase-anchor-select": "anchor_select",
    "phase-closeup-move": "closeup_move",
    "phase-analyzing": "analyzing",
    "phase-grasping": "grasping",
    "phase-bringing-over": "bringing_over",
    "phase-handing-over": "handing_over",
    "phase-returning": "returning",
}
TERM_SLUGS = list(TERMS.keys())


def wrap_terms(text: str) -> str:
    """Deterministic post-processor: wrap first mention of each known term in [[slug]]
    AND clean up any [[unknown-slug]] the LLM invented so it doesn't leak as
    literal brackets in the UI.

    Gemma3 in particular likes to invent slugs like [[search_exhausted]] or
    [[collision warnings]] that aren't in our TERMS dictionary. We normalise
    those: if the slug (after lowercasing & hyphenating) matches a known term
    it's rewritten to the canonical slug; otherwise we strip the brackets and
    keep the readable text inside.
    """
    # 1) Normalise / strip any [[...]] the model already produced
    def _normalise(m: re.Match) -> str:
        inner = m.group(1).strip()
        norm = re.sub(r"[\s_]+", "-", inner.lower())
        if norm in TERMS:
            return f"[[{norm}]]"
        # Try matching by name too (e.g. "[[Gripper]]" → [[gripper]])
        for slug, name in TERMS.items():
            if name.lower() == inner.lower():
                return f"[[{slug}]]"
        # Unknown slug — keep the inner text without brackets so the UI shows
        # readable words instead of "[[search_exhausted]]".
        return inner.replace("_", " ").replace("-", " ")

    text = re.sub(r"\[\[([^\[\]]+?)\]\]", _normalise, text)

    # 2) Wrap the first plain-text mention of each known term that isn't
    #    already wrapped. For terms whose canonical "name" is the snake_case
    #    form (like search_exhausted), we also tolerate the LLM writing it in
    #    single/double quotes and strip those quotes when wrapping.
    for slug, name in TERMS.items():
        if f"[[{slug}]]" in text:
            continue
        # Try the bare form first (handles snake_case failure reasons / phases).
        pattern = rf"['\"]?(?<!\[\[){re.escape(name)}['\"]?(?!\]\])"
        text, n = re.subn(pattern, f"[[{slug}]]", text, count=1, flags=re.IGNORECASE)
        if n > 0:
            continue
        # Also tolerate the space-separated form ("search exhausted")
        spaced = name.replace("_", " ")
        if spaced != name:
            pattern = rf"(?<!\[\[){re.escape(spaced)}(?!\]\])"
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
    warning = sum(1 for o in orders if o.get("status") == "warning")
    failed = sum(1 for o in orders if o.get("status") == "failed")

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

    total_retries = sum(o.get("retries", 0) for o in orders)
    total_collisions = sum(o.get("collision_warnings", 0) for o in orders)
    orders_with_retries = sum(1 for o in orders if o.get("retries", 0) > 0)

    return {
        "total": total, "success": success, "warning": warning, "failed": failed,
        "avg_time": avg_time, "median_time": median_time, "avg_robot_time": avg_robot_time,
        "item_ranking": item_ranking,
        "busiest_day": {"date": busiest[0], "count": busiest[1]} if busiest else None,
        "failures": failures,
        "slowest": {"id": slowest.get("id"), "item": slowest.get("item"), "total_seconds": slowest.get("total_seconds", 0)} if slowest else None,
        "total_retries": total_retries,
        "total_collisions": total_collisions,
        "orders_with_retries": orders_with_retries,
    }


# ── FAISS index ──────────────────────────────────────────────────────────────

try:
    import faiss
    HAS_FAISS = True
except ImportError:
    HAS_FAISS = False

faiss_index = None
faiss_docs = []
faiss_orders = []   # raw order dicts, aligned with faiss_docs/faiss_index rows
last_rebuilt = None

# ═════════════════════════════════════════════════════════════════════════════
# INTENT — the structured representation of a user's chat question.
# ═════════════════════════════════════════════════════════════════════════════
#
# Every chat request goes through:   query → parse_intent → Intent → dispatch
#                                                        ↓
#                            either a deterministic handler (Python-only,
#                            no LLM, no hallucination)  or  an LLM handler
#                            (only for questions that genuinely need
#                            generation — "why", "compare", or fallback)
#
# Why this matters: the LLM is unreliable at counting, dates, IDs, and exact
# filtering. So we *never* ask it to do those. We classify the question into
# one of ~11 kinds, route to a specialised handler, and only invoke the LLM
# for "reason" / "compare" / "unknown" — and even then we hand it a verified
# Python-computed count it must not contradict.

from dataclasses import dataclass, field, asdict
from datetime import date as date_cls

# Items the robot knows about, plus common spelling/pluralisation aliases.
# Map keys are what the user might type, values are the canonical item label
# used in orders.json.
ITEM_ALIASES = {
    "pen": "pen", "pens": "pen", "ballpoint pen": "pen", "ballpoint pens": "pen",
    "ball": "ball", "balls": "ball",
    "sock": "sock", "socks": "sock",
    "towel": "towel", "towels": "towel",
    "t-shirt": "t-shirt", "t-shirts": "t-shirt", "tshirt": "t-shirt",
    "tshirts": "t-shirt", "t shirt": "t-shirt", "t shirts": "t-shirt", "shirt": "t-shirt",
    "water bottle": "water bottle", "water bottles": "water bottle",
    "bottle": "water bottle", "bottles": "water bottle",
    "phone holder": "phone holder", "phone holders": "phone holder",
    "coffee mug": "coffee mug", "coffee mugs": "coffee mug",
    "mug": "coffee mug", "mugs": "coffee mug",
}

# Phases (must match orders.json failure.at_phase values).
KNOWN_PHASES = [
    "scene_scan", "searching", "anchor_select", "closeup_move",
    "analyzing", "grasping", "bringing_over", "handing_over", "returning",
]
# Friendly phase synonyms users might say.
PHASE_ALIASES = {
    "scan": "scene_scan", "scene scan": "scene_scan", "scanning": "scene_scan",
    "search": "searching", "searching": "searching",
    "anchor": "anchor_select", "target": "anchor_select", "selecting target": "anchor_select",
    "moving closer": "closeup_move", "closeup": "closeup_move", "close-up": "closeup_move",
    "analyze": "analyzing", "analysis": "analyzing", "analysing": "analyzing",
    "grasp": "grasping", "grasping": "grasping", "picking": "grasping", "pickup": "grasping",
    "transit": "bringing_over", "bringing over": "bringing_over", "moving": "bringing_over",
    "handover": "handing_over", "handing over": "handing_over", "release": "handing_over",
    "return": "returning", "returning": "returning",
}

# Known failure reasons.
KNOWN_FAILURE_REASONS = [
    "search_exhausted", "reachability_failed", "no_valid_depth",
    "handover_failed", "user_cancelled", "gripper_failed",
    "e_stopped", "timeout", "operator_abort", "bridge_fault",
]

# Term explanations for the `explain` kind. Mirrors the frontend slugs from
# `src/lib/terms.js` so chat answers about "what is X" match the dashboard.
TERM_DEFINITIONS = {
    "gripper": "The Gripper is ROBI's hand — the two-finger end-effector that closes around an item to pick it up.",
    "sam3": "SAM3 (Segment Anything 3) is the vision model that draws an outline around the item ROBI is searching for, so the planner knows exactly which pixels are 'the towel' or 'the pen'.",
    "molmo": "Molmo is the vision-language model that picks a single grasp point on an item — like saying 'aim for the center of the topmost bundle'.",
    "grasp-synthesis": "Grasp synthesis is the step where ROBI plans how to close its fingers around an item — picking the angle, width, and approach.",
    "trajectory": "A trajectory is a planned arm motion — a series of joint positions over time that get the gripper from one pose to another.",
    "anchor": "An anchor is a point in 3D space ROBI uses to aim its close-up view — typically the centre of a detected item cluster.",
    "depth-offset": "Depth offset is a small forward correction ROBI applies so the gripper actually contacts the item, not the air in front of it.",
    "standoff": "Standoff is the safe distance ROBI keeps before reaching in — it approaches the standoff first, then closes the last few centimetres.",
    "handover": "Handover is the step where ROBI extends the item toward the customer and waits for them to take it.",
    "e-stop": "Emergency stop. A safety button (physical or software) that immediately freezes the robot until manually reset.",
    "close-up": "The close-up view is ROBI's second look at an item from a closer distance — used to refine the grasp after the initial detection.",
    "detection": "A detection is the vision system spotting a candidate item on a shelf. Each detection has a score; a 'cluster' groups detections that look like the same object.",
    "fanuc": "FANUC CRX-10iA/L — the collaborative robot arm ROBI uses, capable of safely working near humans.",
    "curobo": "cuRobo is the GPU-accelerated motion planner ROBI uses to find collision-free arm trajectories quickly.",
    "intervention": "An intervention is when a human (you!) tells ROBI what to do — usually after a failure, e.g. 'I'll restock the shelf' or 'cancel this order'.",
    "voxels": "Voxels are 3D pixels — small cubes that map the world around ROBI so the planner knows what's empty and what's an obstacle.",
    "waypoint": "A waypoint is a named arm pose ROBI moves between — e.g. 'top-shelve', 'handover', 'clothes-rack'.",
    "goalset": "A goalset is a bundle of candidate end-effector poses that all achieve the same goal — the planner picks whichever one is reachable.",
    "reachability": "Reachability is whether the arm can physically reach a target pose without hitting itself or an obstacle.",
    "scene-scan": "The scene scan is ROBI's initial sweep of its surroundings — building a fresh voxel map before each pick cycle.",
    "retry": "A retry is when ROBI moves to a different viewpoint and tries the grasp again after the first attempt failed.",
    "search-sweep": "The search sweep is ROBI's pattern of checking multiple waypoints (top shelf, bottom shelf, etc.) when looking for an item.",
    "zenoh": "Zenoh is the message bus the cameras, planner, and robot bridge use to talk to each other in real time.",
    "d415": "Intel D415 — the depth camera mounted on ROBI's wrist. It produces colour + depth images used to find and measure items.",
}


@dataclass
class Intent:
    """Structured representation of a chat question.

    `kind` decides which handler runs. The other fields are filters/parameters
    used by the handler. Empty / None means "not set" (no constraint).
    """
    kind: str = "unknown"           # see KIND_NAMES below
    confidence: float = 1.0         # 0..1; <0.5 means ask for clarification
    notes: list = field(default_factory=list)   # explanations of parser choices

    # Status filter (with negation)
    status: str | None = None       # "failed" | "warning" | "success"
    not_status: str | None = None

    # Item filter (with negation)
    item: str | None = None         # canonical item, e.g. "sock"
    not_item: str | None = None

    # Date scope
    date_from: str | None = None    # ISO YYYY-MM-DD
    date_to: str | None = None
    date_label: str | None = None   # "today", "this week", "May", etc.

    # Phase / failure-reason filters
    phase: str | None = None
    failure_reason: str | None = None

    # Numeric thresholds (None means no constraint)
    min_duration_s: int | None = None
    max_duration_s: int | None = None
    min_retries: int | None = None
    has_collisions: bool | None = None    # True = ≥1 collision, False = none

    # Specific-order lookup
    order_id: int | None = None

    # Ranking
    rank_by: str | None = None      # "duration" | "retries" | "frequency" | "collisions"
    rank_order: str | None = None   # "asc" | "desc"
    limit: int | None = None

    # Aggregation
    agg_metric: str | None = None   # "avg" | "median" | "sum" | "min" | "max"
    agg_field: str | None = None    # "duration" | "robot_time" | "retries" | "collisions"
    agg_group_by: str | None = None # "item" | "status" | "phase" | "failure_reason" | "day"

    # Comparison (second filter set for 'compare' kind)
    compare_to: dict | None = None

    # Term lookup for 'explain' kind
    term: str | None = None

    def to_dict(self):
        return {k: v for k, v in asdict(self).items() if v not in (None, [], {})}


KIND_NAMES = (
    "count", "list", "existence", "lookup", "rank", "aggregate",
    "compare", "reason", "explain", "greeting", "unknown",
)


# ── LLM-based intent parsing ────────────────────────────────────────────────
# The LLM is given:
#   - a strict JSON schema (the Intent fields and allowed values)
#   - today's date + computed common windows (this_week, last_week, etc.)
#   - the recent conversation history
#   - a handful of few-shot examples
#
# The LLM is told to output ONLY a JSON object. We validate it; if it fails we
# retry once with a "your output was invalid, try again" prompt; if that still
# fails we fall back to `kind=unknown` and let the LLM-render path answer
# conversationally instead of guessing.


def _date_context_for_llm() -> dict:
    """Build the absolute-date context the LLM uses to resolve 'today',
    'this week', 'last month', etc. into ISO dates."""
    today = datetime.now().date()
    yesterday = today - timedelta(days=1)
    monday_this = today - timedelta(days=today.weekday())
    monday_last = monday_this - timedelta(days=7)
    sunday_last = monday_this - timedelta(days=1)
    first_this_month = today.replace(day=1)
    last_month_last = first_this_month - timedelta(days=1)
    last_month_first = last_month_last.replace(day=1)
    return {
        "today": today.isoformat(),
        "yesterday": yesterday.isoformat(),
        "this_week_start": monday_this.isoformat(),
        "this_week_end": today.isoformat(),
        "last_week_start": monday_last.isoformat(),
        "last_week_end": sunday_last.isoformat(),
        "this_month_start": first_this_month.isoformat(),
        "this_month_end": today.isoformat(),
        "last_month_start": last_month_first.isoformat(),
        "last_month_end": last_month_last.isoformat(),
    }


PARSE_SYSTEM_PROMPT_TMPL = """You translate user questions about a robot order database into a JSON Intent object. Output ONLY the JSON — no prose, no markdown fences, no explanation.

# INTENT SCHEMA
{{
  "kind": one of ["count", "list", "existence", "lookup", "rank", "aggregate", "compare", "reason", "explain", "greeting", "unknown"],
  "status": "failed" | "warning" | "success" | null,
  "not_status": "failed" | "warning" | "success" | null,
  "item": one of ["pen", "ball", "sock", "towel", "t-shirt", "water bottle", "phone holder", "coffee mug"] or null,
  "not_item": same options or null,
  "date_from": "YYYY-MM-DD" or null,
  "date_to": "YYYY-MM-DD" or null,
  "date_label": short human label like "today", "this week", "May 2026", "last month" or null,
  "phase": one of ["scene_scan", "searching", "anchor_select", "closeup_move", "analyzing", "grasping", "bringing_over", "handing_over", "returning"] or null,
  "failure_reason": one of ["search_exhausted", "reachability_failed", "no_valid_depth", "handover_failed", "user_cancelled", "gripper_failed", "e_stopped", "timeout", "operator_abort", "bridge_fault"] or null,
  "min_duration_s": integer or null,
  "max_duration_s": integer or null,
  "min_retries": integer or null,
  "has_collisions": boolean or null,
  "order_id": integer or null,
  "rank_by": "duration" | "retries" | "frequency" | "collisions" | null,
  "rank_order": "asc" | "desc" | null,
  "limit": integer or null,
  "agg_metric": "avg" | "median" | "sum" | "min" | "max" | "count" | null,
  "agg_field": "duration" | "robot_time" | "retries" | "collisions" | null,
  "agg_group_by": "item" | "status" | "phase" | "failure_reason" | "day" | null,
  "term": term slug or null
}}

# KIND MEANINGS
- count: user wants a number ("how many X")
- list: user wants the list itself ("show me X", "which X")
- existence: yes/no question ("are there any X", "were there X")
- lookup: a specific order by ID ("about order 42", "#42")
- rank: superlative or top-N ("slowest", "top 3", "most common failure reason", "top failed item")
- aggregate: average/median/sum/min/max ("average fetch time", "median duration", "total robot time")
- compare: comparing two windows or two groups ("this week vs last", "have things improved")
- reason: open-ended "why" question that needs reasoning
- explain: define a term ("what is the gripper", "what does cuRobo mean")
- greeting: hi / hello / thanks
- unknown: anything that doesn't fit above

# DATE CONTEXT (use these absolute dates to resolve relative expressions)
Today: {today}
Yesterday: {yesterday}
This week: {this_week_start} to {this_week_end}
Last week: {last_week_start} to {last_week_end}
This month: {this_month_start} to {this_month_end}
Last month: {last_month_start} to {last_month_end}

# RULES
1. Output ONLY the JSON object. No code fences, no explanation, no trailing text.
2. Use null for fields that don't apply — never omit fields.
3. "delivered with warnings" is status="warning", NOT "failed".
4. "failed" means the cycle did not complete: status="failed", NOT "warning".
5. If the user follows up with a partial question (e.g. "what about yesterday?"), carry the previous filters over and only change the dimension the user mentioned.
6. Resolve "today", "this week", etc. to ISO dates using the DATE CONTEXT above.
7. For "top failed item" / "most common failure reason" set kind="rank", rank_by="frequency", rank_order="desc", and pick agg_group_by from the question (item / failure_reason / phase / day). Default to "item".
8. If you're unsure, set kind="unknown" and confidence low — never invent filters.

# EXAMPLES
User: "how many failed sock orders today?"
Output: {{"kind":"count","status":"failed","item":"sock","date_from":"{today}","date_to":"{today}","date_label":"today","not_status":null,"not_item":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"rank_by":null,"rank_order":null,"limit":null,"agg_metric":null,"agg_field":null,"agg_group_by":null,"term":null}}

User: "show me the slowest order this week"
Output: {{"kind":"rank","status":null,"item":null,"date_from":"{this_week_start}","date_to":"{this_week_end}","date_label":"this week","rank_by":"duration","rank_order":"desc","limit":1,"not_status":null,"not_item":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"agg_metric":null,"agg_field":null,"agg_group_by":null,"term":null}}

User: "what is the top failed item?"
Output: {{"kind":"rank","status":"failed","rank_by":"frequency","rank_order":"desc","limit":1,"agg_group_by":"item","item":null,"not_status":null,"not_item":null,"date_from":null,"date_to":null,"date_label":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"agg_metric":null,"agg_field":null,"term":null}}

User: "average fetch time by item"
Output: {{"kind":"aggregate","agg_metric":"avg","agg_field":"duration","agg_group_by":"item","status":null,"item":null,"not_status":null,"not_item":null,"date_from":null,"date_to":null,"date_label":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"rank_by":null,"rank_order":null,"limit":null,"term":null}}

User: "any towels that failed yesterday?"
Output: {{"kind":"existence","status":"failed","item":"towel","date_from":"{yesterday}","date_to":"{yesterday}","date_label":"yesterday","not_status":null,"not_item":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"rank_by":null,"rank_order":null,"limit":null,"agg_metric":null,"agg_field":null,"agg_group_by":null,"term":null}}

User: "tell me about order 42"
Output: {{"kind":"lookup","order_id":42,"status":null,"item":null,"not_status":null,"not_item":null,"date_from":null,"date_to":null,"date_label":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"rank_by":null,"rank_order":null,"limit":null,"agg_metric":null,"agg_field":null,"agg_group_by":null,"term":null}}

User: "what is the gripper?"
Output: {{"kind":"explain","term":"gripper","status":null,"item":null,"not_status":null,"not_item":null,"date_from":null,"date_to":null,"date_label":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"rank_by":null,"rank_order":null,"limit":null,"agg_metric":null,"agg_field":null,"agg_group_by":null}}

User: "why do sock orders fail so often?"
Output: {{"kind":"reason","status":"failed","item":"sock","not_status":null,"not_item":null,"date_from":null,"date_to":null,"date_label":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"rank_by":null,"rank_order":null,"limit":null,"agg_metric":null,"agg_field":null,"agg_group_by":null,"term":null}}

User: "hi"
Output: {{"kind":"greeting","status":null,"item":null,"not_status":null,"not_item":null,"date_from":null,"date_to":null,"date_label":null,"phase":null,"failure_reason":null,"min_duration_s":null,"max_duration_s":null,"min_retries":null,"has_collisions":null,"order_id":null,"rank_by":null,"rank_order":null,"limit":null,"agg_metric":null,"agg_field":null,"agg_group_by":null,"term":null}}
"""


_INTENT_FIELDS = {
    "kind", "status", "not_status", "item", "not_item",
    "date_from", "date_to", "date_label",
    "phase", "failure_reason",
    "min_duration_s", "max_duration_s", "min_retries", "has_collisions",
    "order_id",
    "rank_by", "rank_order", "limit",
    "agg_metric", "agg_field", "agg_group_by",
    "term",
}


def _extract_json_object(text: str) -> dict:
    """Pull the first {...} block out of the LLM's output, handling code
    fences and trailing prose. Returns {} if nothing parseable."""
    if not text:
        return {}
    s = text.strip()
    # Strip ```json … ``` fences if present
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.IGNORECASE | re.MULTILINE).strip()
    # Find first balanced { … }
    start = s.find("{")
    if start < 0:
        return {}
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{": depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[start:i + 1])
                except json.JSONDecodeError:
                    return {}
    return {}


def _intent_from_dict(data: dict) -> Intent:
    """Build an Intent from a (possibly LLM-emitted) dict, dropping any
    fields not in the schema and coercing types where needed."""
    intent = Intent()
    if not isinstance(data, dict):
        return intent
    kind = data.get("kind")
    if isinstance(kind, str) and kind in KIND_NAMES:
        intent.kind = kind
    for f in _INTENT_FIELDS - {"kind"}:
        if f in data and data[f] is not None:
            try:
                setattr(intent, f, data[f])
            except Exception:
                pass
    # Coerce numeric strings to int / bool to bool, just in case.
    for int_f in ("min_duration_s", "max_duration_s", "min_retries", "order_id", "limit"):
        v = getattr(intent, int_f, None)
        if isinstance(v, str) and v.isdigit():
            setattr(intent, int_f, int(v))
    return intent


def _format_history(messages: list, max_turns: int = 3) -> str:
    """Last N user/assistant turns formatted for the LLM."""
    if not messages:
        return "(empty)"
    turns = []
    for m in messages[-(max_turns * 2):]:
        role = m.get("role", "?")
        content = (m.get("content") or "").strip()
        if content:
            turns.append(f"{role}: {content}")
    return "\n".join(turns) if turns else "(empty)"


def parse_intent_via_llm(query: str, history_messages: list) -> tuple[Intent, dict]:
    """Ask the LLM to translate `query` into a JSON Intent.

    Returns (intent, debug) where debug is a dict suitable for the chat log.
    Never raises — falls back to kind=unknown on any failure.
    """
    debug = {"raw_outputs": []}
    if not query or not query.strip():
        return Intent(kind="unknown", confidence=0.0), debug

    ctx = _date_context_for_llm()
    system_prompt = PARSE_SYSTEM_PROMPT_TMPL.format(**ctx)
    history_text = _format_history(history_messages)

    user_block = (
        f"# CONVERSATION HISTORY (use this to carry over filters on follow-ups)\n{history_text}\n\n"
        f"# CURRENT QUESTION\n{query.strip()}\n\n"
        f"Output the JSON Intent now."
    )

    def _call(extra_hint: str = "") -> str:
        sys_msg = system_prompt + (("\n\n# RETRY HINT\n" + extra_hint) if extra_hint else "")
        try:
            resp = llm.chat.completions.create(
                model=LLM_MODEL,
                messages=[
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": user_block},
                ],
                temperature=0,
                max_tokens=600,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            debug["llm_error"] = str(e)
            return ""

    raw1 = _call()
    debug["raw_outputs"].append(raw1)
    data = _extract_json_object(raw1)
    if not data or "kind" not in data:
        # Retry once, scolding the model
        raw2 = _call("Your previous output was not valid JSON or was missing the 'kind' field. "
                     "Output ONLY the JSON object — no markdown, no prose.")
        debug["raw_outputs"].append(raw2)
        data = _extract_json_object(raw2)

    intent = _intent_from_dict(data) if data else Intent(kind="unknown", confidence=0.2)
    debug["parsed_intent"] = intent.to_dict()
    if not data:
        debug["parse_failure"] = True
        intent.kind = "unknown"
        intent.confidence = 0.2
    else:
        intent.confidence = 0.9
    return intent, debug


# ── LLM-based answer renderer ───────────────────────────────────────────────
#
# Once the deterministic handler has computed the answer (count, list, etc.),
# we hand the LLM the verified data and ask it to write a natural-language
# answer. The LLM is told the numbers and order IDs are non-negotiable. This
# replaces the hand-templated strings the handlers produce, giving more
# conversational responses while preserving correctness.

RENDER_SYSTEM_PROMPT = """You are ROBI's assistant — a robot that picks grocery items off shelves.

You write a 1-3 sentence natural-language answer to the user's question, grounded in the verified data below.

CRITICAL RULES (never break these):
1. The "verified_total" and "matched_ids" in the VERIFIED DATA block are the SOURCE OF TRUTH. Quote those exact numbers and IDs verbatim. Never invent, change, or guess a number.
2. Cite specific orders as [cite:N], using only IDs that appear in "matched_ids". Do not invent IDs.
3. Plain English, friendly tone. Refer to the robot as "ROBI".
4. Use past tense when the question is about a specific past period (today, yesterday, this week, etc.). Present tense for general / unbounded queries.
5. If verified_total is 0, say so plainly ("No, there were no failed sock orders today.").
6. If the user asked a "why" or "compare" question, you may interpret the sample orders to explain — but never invent statistics that aren't in the verified data.
7. Wrap technical terms in [[double brackets]] only if they appear in the term list. If unsure, leave them as plain text.
8. Don't repeat the user's question. Get straight to the answer.
9. Don't say "the data shows" or "according to the database" — just give the answer.
"""


def _filter_description(intent: Intent) -> str:
    bits = []
    if intent.status:           bits.append(f"status={intent.status}")
    if intent.not_status:       bits.append(f"NOT status={intent.not_status}")
    if intent.item:             bits.append(f"item={intent.item}")
    if intent.not_item:         bits.append(f"NOT item={intent.not_item}")
    if intent.date_label:       bits.append(f"period={intent.date_label}")
    elif intent.date_from or intent.date_to:
        bits.append(f"date={intent.date_from or '*'}..{intent.date_to or '*'}")
    if intent.phase:            bits.append(f"phase={intent.phase}")
    if intent.failure_reason:   bits.append(f"failure_reason={intent.failure_reason}")
    if intent.min_duration_s is not None: bits.append(f"min_duration_s={intent.min_duration_s}")
    if intent.max_duration_s is not None: bits.append(f"max_duration_s={intent.max_duration_s}")
    if intent.min_retries is not None:    bits.append(f"min_retries={intent.min_retries}")
    if intent.has_collisions is not None: bits.append(f"has_collisions={intent.has_collisions}")
    if intent.order_id is not None:       bits.append(f"order_id={intent.order_id}")
    return "; ".join(bits) or "(no filter)"


def _build_render_user_block(intent: Intent, deterministic_text: str, matched_orders: list,
                             user_question: str, history_text: str) -> str:
    """Compose the prompt the renderer LLM sees, including verified data."""
    sample = matched_orders[:6]

    def brief(o: dict):
        return {
            "id": o.get("id"),
            "item": o.get("item"),
            "status": o.get("status"),
            "failure_reason": ((o.get("failure") or {}).get("reason")),
            "at_phase": ((o.get("failure") or {}).get("at_phase")),
            "duration_s": o.get("total_seconds"),
            "retries": o.get("retries"),
            "started_at": (o.get("started_at") or "")[:16],
        }

    verified = {
        "kind": intent.kind,
        "filter_applied": _filter_description(intent),
        "verified_total": len(matched_orders),
        "matched_ids": [o.get("id") for o in matched_orders][:50],
        "sample_orders": [brief(o) for o in sample],
        "deterministic_baseline_answer": deterministic_text,
    }
    return (
        f"# CONVERSATION HISTORY\n{history_text}\n\n"
        f"# USER'S CURRENT QUESTION\n{user_question.strip()}\n\n"
        f"# VERIFIED DATA (source of truth — use these numbers and IDs verbatim)\n"
        f"```json\n{json.dumps(verified, indent=2, default=str)}\n```\n\n"
        f"Now write the answer. Stay grounded — every number and citation must match the VERIFIED DATA."
    )


def render_answer_via_llm(intent: Intent, deterministic_text: str, matched_orders: list,
                          user_question: str, history_messages: list) -> str:
    """Use the LLM to write the final prose, using the deterministic result as
    ground truth. Falls back to `deterministic_text` if the LLM call fails."""
    history_text = _format_history(history_messages)
    user_block = _build_render_user_block(
        intent, deterministic_text, matched_orders, user_question, history_text
    )
    try:
        resp = llm.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": RENDER_SYSTEM_PROMPT},
                {"role": "user", "content": user_block},
            ],
            temperature=0.3,
            max_tokens=400,
        )
        text = (resp.choices[0].message.content or "").strip()
        if text:
            return wrap_terms(text)
    except Exception as e:
        print(f"[RAG] render LLM error: {e}", file=sys.stderr)
    # Fallback: the deterministic baseline is always correct, just less natural.
    return wrap_terms(deterministic_text)


# ─── Deterministic tools (used by handle_* after LLM parses the intent) ─────
# Everything below — Intent dataclass, apply_intent_filter, the per-kind
# handlers — is unchanged. With the LLM doing the parsing, these handlers are
# now the *tools*: they perform the actual filtering/counting/sorting against
# orders.json. Their textual output is then handed to the LLM renderer to be
# turned into natural-language prose.

# (regex-based parse_intent and its helpers have been removed — the LLM
# now does the parsing via parse_intent_via_llm above.)


# ── Filter application ──────────────────────────────────────────────────────

def apply_intent_filter(orders: list, intent: Intent) -> list:
    """Return orders matching every populated filter on the intent.

    Also dedupes by order id — orders.json has occasionally contained duplicate
    rows (e.g. when a cycle was written by both `cycle_end` and the
    executor_shutdown fallback). Without deduping here, every count is inflated
    and the chip in the chat answer cites the same id twice.
    """
    seen_ids: set = set()
    out = []
    for o in orders:
        st = o.get("status", "")
        # status / not_status
        if intent.status:
            target = intent.status
            if target == "success" and st not in ("success", "ok"):
                continue
            if target == "warning" and st != "warning":
                continue
            if target == "failed" and st != "failed":
                continue
        if intent.not_status:
            if intent.not_status == "success" and st in ("success", "ok"):
                continue
            if intent.not_status == "warning" and st == "warning":
                continue
            if intent.not_status == "failed" and st == "failed":
                continue
        # item / not_item
        item_l = (o.get("item") or "").lower()
        if intent.item and intent.item not in item_l:
            continue
        if intent.not_item and intent.not_item in item_l:
            continue
        # dates
        if intent.date_from or intent.date_to:
            started = (o.get("started_at") or "")[:10]
            if not started:
                continue
            if intent.date_from and started < intent.date_from:
                continue
            if intent.date_to and started > intent.date_to:
                continue
        # phase
        if intent.phase:
            failure_phase = (o.get("failure") or {}).get("at_phase")
            if failure_phase != intent.phase:
                continue
        # failure reason
        if intent.failure_reason:
            reason = (o.get("failure") or {}).get("reason")
            if reason != intent.failure_reason:
                continue
        # duration
        total_s = o.get("total_seconds") or 0
        if intent.min_duration_s is not None and total_s < intent.min_duration_s:
            continue
        if intent.max_duration_s is not None and total_s > intent.max_duration_s:
            continue
        # retries
        if intent.min_retries is not None and (o.get("retries") or 0) < intent.min_retries:
            continue
        # collisions
        coll = o.get("collision_warnings") or 0
        if intent.has_collisions is True and coll == 0:
            continue
        if intent.has_collisions is False and coll > 0:
            continue
        # specific id
        if intent.order_id is not None and o.get("id") != intent.order_id:
            continue
        # Dedupe: keep the first occurrence of each id.
        oid = o.get("id")
        if oid is not None:
            if oid in seen_ids:
                continue
            seen_ids.add(oid)
        out.append(o)
    return out


# ── Render helpers ──────────────────────────────────────────────────────────

def _status_phrase(intent: Intent) -> str:
    s = intent.status
    if s == "failed": return "failed"
    if s == "warning": return "delivered-with-warnings"
    if s == "success": return "successfully delivered"
    return ""


def _filter_label(intent: Intent, plural: bool = True) -> str:
    """Human-readable description of the filter, e.g. 'failed sock orders'."""
    bits = []
    if intent.not_status == "failed":
        bits.append("non-failed")
    elif intent.status:
        bits.append(_status_phrase(intent))
    if intent.not_item:
        bits.append(f"non-{intent.not_item}")
    elif intent.item:
        bits.append(intent.item)
    if intent.failure_reason:
        bits.append(f"{intent.failure_reason.replace('_', ' ')}")
    if intent.phase:
        bits.append(f"{intent.phase.replace('_', ' ')}-phase")
    if intent.min_duration_s is not None:
        bits.append(f"over {intent.min_duration_s}s")
    if intent.max_duration_s is not None:
        bits.append(f"under {intent.max_duration_s}s")
    if intent.min_retries is not None:
        bits.append("with retries")
    if intent.has_collisions:
        bits.append("with collisions")
    head = " ".join(bits)
    return f"{head + ' ' if head else ''}order{'s' if plural else ''}"


def _scope_phrase(intent: Intent) -> str:
    return f" {intent.date_label}" if intent.date_label else ""


def _format_order_brief(o: dict) -> str:
    oid = o.get("id")
    item = o.get("item") or "unknown"
    status = o.get("status", "")
    reason = ((o.get("failure") or {}).get("reason") or "").replace("_", " ") if status in ("failed", "warning") else ""
    secs = o.get("total_seconds") or 0
    text = f"[cite:{oid}] ({item}"
    if reason:
        text += f", {reason}"
    if secs:
        text += f", {secs}s"
    text += ")"
    return text


def _format_order_long(o: dict) -> str:
    """Multi-line full description of a single order — used by lookup."""
    oid = o.get("id")
    item = o.get("item") or "unknown"
    st = o.get("status", "unknown")
    started = (o.get("started_at") or "")[:16].replace("T", " ")
    secs = o.get("total_seconds") or 0
    robot_s = o.get("robot_seconds") or 0
    retries = o.get("retries", 0)
    waypoints = ", ".join(o.get("waypoints_searched") or []) or "—"
    fail = o.get("failure") or {}
    lines = [
        f"Order [cite:{oid}]: a {item} order, {st}",
        f"  Started {started}, took {secs}s total ({robot_s}s of which was robot work).",
        f"  Retries: {retries}. Waypoints searched: {waypoints}.",
    ]
    if fail:
        lines.append(f"  Failure: {fail.get('reason', 'unknown').replace('_', ' ')} at {fail.get('at_phase') or 'unknown phase'} — {fail.get('detail') or ''}")
    return "\n".join(lines)


# ── Per-kind handlers ───────────────────────────────────────────────────────

SHOW_LIMIT = 8   # how many orders to enumerate in deterministic answers


def handle_count(intent: Intent, orders: list) -> tuple[str, dict]:
    matches = apply_intent_filter(orders, intent)
    n = len(matches)
    label = _filter_label(intent, plural=(n != 1))
    scope = _scope_phrase(intent)
    has_scope = bool(intent.date_label)
    be_were = "were" if has_scope else "are"
    if n == 0:
        return f"There {be_were} no {label}{scope}.", {"matched_ids": []}
    ordered = sorted(matches, key=lambda o: o.get("started_at") or "", reverse=True)
    ids = [o.get("id") for o in ordered]
    sample = ordered[:SHOW_LIMIT]
    cites = " ".join(f"[cite:{o.get('id')}]" for o in sample)
    if n == 1:
        return f"There {('was' if has_scope else 'is')} 1 {_filter_label(intent, plural=False)}{scope}: {cites}.", {"matched_ids": ids}
    if n <= SHOW_LIMIT:
        return f"There {be_were} {n} {label}{scope}: {cites}.", {"matched_ids": ids}
    return f"There {be_were} {n} {label}{scope} in total. Most recent {SHOW_LIMIT}: {cites}.", {"matched_ids": ids}


def handle_existence(intent: Intent, orders: list) -> tuple[str, dict]:
    matches = apply_intent_filter(orders, intent)
    n = len(matches)
    label = _filter_label(intent, plural=(n != 1))
    scope = _scope_phrase(intent)
    has_scope = bool(intent.date_label)
    if n == 0:
        return f"No, there {('were' if has_scope else 'are')} no {label}{scope}.", {"matched_ids": []}
    ordered = sorted(matches, key=lambda o: o.get("started_at") or "", reverse=True)
    ids = [o.get("id") for o in ordered]
    sample = ordered[:SHOW_LIMIT]
    brief = "; ".join(_format_order_brief(o) for o in sample)
    be_were = "were" if has_scope else "are"
    be_was = "was" if has_scope else "is"
    if n == 1:
        return f"Yes — there {be_was} 1 {_filter_label(intent, plural=False)}{scope}: {brief}.", {"matched_ids": ids}
    if n <= SHOW_LIMIT:
        return f"Yes — there {be_were} {n} {label}{scope}: {brief}.", {"matched_ids": ids}
    return f"Yes — there {be_were} {n} {label}{scope} in total. Most recent {SHOW_LIMIT}: {brief}.", {"matched_ids": ids}


def handle_list(intent: Intent, orders: list) -> tuple[str, dict]:
    matches = apply_intent_filter(orders, intent)
    n = len(matches)
    label = _filter_label(intent, plural=(n != 1))
    scope = _scope_phrase(intent)
    has_scope = bool(intent.date_label)
    be_were = "were" if has_scope else "are"
    if n == 0:
        return f"There {be_were} no {label}{scope} to list.", {"matched_ids": []}
    ordered = sorted(matches, key=lambda o: o.get("started_at") or "", reverse=True)
    ids = [o.get("id") for o in ordered]
    sample = ordered[:SHOW_LIMIT]
    items = "; ".join(_format_order_brief(o) for o in sample)
    if n <= SHOW_LIMIT:
        return f"Here {be_were} the {n} {label}{scope}: {items}.", {"matched_ids": ids}
    return f"Here {be_were} the {SHOW_LIMIT} most recent of {n} {label}{scope}: {items}.", {"matched_ids": ids}


def handle_lookup(intent: Intent, orders: list) -> tuple[str, dict]:
    if intent.order_id is None:
        return ("I need an order number to look up — try 'tell me about order 42'.",
                {"matched_ids": []})
    match = next((o for o in orders if o.get("id") == intent.order_id), None)
    if not match:
        return f"I couldn't find order #{intent.order_id}.", {"matched_ids": []}
    return _format_order_long(match), {"matched_ids": [intent.order_id]}


def handle_rank(intent: Intent, orders: list) -> tuple[str, dict]:
    matches = apply_intent_filter(orders, intent)
    if not matches:
        return f"No {_filter_label(intent)}{_scope_phrase(intent)} to rank.", {"matched_ids": []}

    key = intent.rank_by or "duration"

    # ── Frequency ranking: group by item / reason / phase / day, count, sort.
    # Produces answers like "Pen is the top failed item, with 13 failed orders".
    if key == "frequency":
        group_by = intent.agg_group_by or "item"
        groups: dict[str, list[dict]] = {}
        for o in matches:
            groups.setdefault(_agg_group_key(o, group_by), []).append(o)
        # Drop empty / "none" groups so they don't dominate.
        ordered = sorted(
            ((k, v) for k, v in groups.items() if k and k.lower() != "none"),
            key=lambda kv: len(kv[1]),
            reverse=(intent.rank_order != "asc"),
        )
        if not ordered:
            return f"No grouped {_filter_label(intent)}{_scope_phrase(intent)} to rank.", {"matched_ids": []}

        limit = intent.limit or 1
        top = ordered[:limit]
        # Sample IDs from each top group for citation
        ids: list = []
        for _, group_orders in top:
            ids.extend(o.get("id") for o in group_orders[:3])

        adj = "top" if (intent.rank_order != "asc") else "least common"
        label = _filter_label(intent, plural=True)
        scope = _scope_phrase(intent)

        if limit == 1:
            k, group_orders = top[0]
            sample_cites = " ".join(f"[cite:{o.get('id')}]" for o in group_orders[:5])
            return (
                f"{k} is the {adj} {group_by} among {label}{scope}, with {len(group_orders)} matching orders. "
                f"Examples: {sample_cites}.",
                {"matched_ids": ids},
            )
        body = "; ".join(f"#{i+1} {k} ({len(v)})" for i, (k, v) in enumerate(top))
        return (
            f"{adj.capitalize()} {len(top)} {group_by}s among {label}{scope}: {body}.",
            {"matched_ids": ids},
        )

    # ── Numeric ranking: sort individual orders by a numeric field.
    if key == "duration":
        sortfn = lambda o: o.get("total_seconds") or 0
    elif key == "retries":
        sortfn = lambda o: o.get("retries") or 0
    elif key == "collisions":
        sortfn = lambda o: o.get("collision_warnings") or 0
    else:
        sortfn = lambda o: o.get("total_seconds") or 0

    reverse = (intent.rank_order != "asc")
    ranked = sorted(matches, key=sortfn, reverse=reverse)
    limit = intent.limit or 1
    top = ranked[:limit]
    ids = [o.get("id") for o in top]

    if limit == 1:
        o = top[0]
        oid = o.get("id")
        val = sortfn(o)
        unit = "s" if key == "duration" else ""
        adj = {
            ("duration", True):  "slowest",
            ("duration", False): "fastest",
            ("retries", True):   "most-retried",
            ("retries", False):  "least-retried",
            ("collisions", True):"highest-collision",
        }.get((key, reverse), "top")
        scope = _scope_phrase(intent)
        return (
            f"The {adj} {_filter_label(intent, plural=False)}{scope} is [cite:{oid}]: "
            f"a {o.get('item') or 'unknown'}, {val}{unit}.",
            {"matched_ids": ids},
        )

    head = f"Top {limit} {_filter_label(intent)}{_scope_phrase(intent)} by {key}:"
    body = "; ".join(
        f"#{i+1} [cite:{o.get('id')}] ({o.get('item') or 'unknown'}, {sortfn(o)}{'s' if key=='duration' else ''})"
        for i, o in enumerate(top)
    )
    return f"{head} {body}.", {"matched_ids": ids}


def _agg_value(o: dict, field_name: str) -> float:
    if field_name == "duration":  return o.get("total_seconds") or 0
    if field_name == "robot_time":return o.get("robot_seconds") or 0
    if field_name == "retries":   return o.get("retries") or 0
    if field_name == "collisions":return o.get("collision_warnings") or 0
    return 0


def _agg_group_key(o: dict, group_by: str) -> str:
    if group_by == "item":   return o.get("item") or "unknown"
    if group_by == "status": return o.get("status") or "unknown"
    if group_by == "day":    return (o.get("started_at") or "")[:10] or "unknown"
    if group_by == "phase":  return ((o.get("failure") or {}).get("at_phase")) or "none"
    if group_by == "failure_reason": return ((o.get("failure") or {}).get("reason")) or "none"
    return "all"


def _agg_compute(values: list, metric: str) -> float:
    if not values:
        return 0.0
    if metric == "avg":    return sum(values) / len(values)
    if metric == "median":
        s = sorted(values); m = len(s) // 2
        return s[m] if len(s) % 2 else (s[m-1] + s[m]) / 2
    if metric == "sum":    return sum(values)
    if metric == "min":    return min(values)
    if metric == "max":    return max(values)
    if metric == "count":  return len(values)
    return 0.0


def handle_aggregate(intent: Intent, orders: list) -> tuple[str, dict]:
    matches = apply_intent_filter(orders, intent)
    if not matches:
        return f"No {_filter_label(intent)}{_scope_phrase(intent)} to aggregate.", {"matched_ids": []}
    metric = intent.agg_metric or "avg"
    field_name = intent.agg_field or "duration"
    group_by = intent.agg_group_by

    if group_by:
        groups: dict[str, list[float]] = {}
        for o in matches:
            groups.setdefault(_agg_group_key(o, group_by), []).append(_agg_value(o, field_name))
        rows = sorted(((k, _agg_compute(v, metric), len(v)) for k, v in groups.items()),
                      key=lambda r: -r[1])
        head = f"{metric.capitalize()} {field_name} by {group_by}{_scope_phrase(intent)} across {len(matches)} {_filter_label(intent)}:"
        body = "; ".join(f"{k}: {round(val, 1)} (n={n})" for k, val, n in rows)
        return f"{head} {body}.", {"matched_ids": [o.get('id') for o in matches]}
    val = _agg_compute([_agg_value(o, field_name) for o in matches], metric)
    return (f"{metric.capitalize()} {field_name} across {len(matches)} {_filter_label(intent)}{_scope_phrase(intent)}: "
            f"{round(val, 1)}{'s' if field_name in ('duration','robot_time') else ''}.",
            {"matched_ids": [o.get("id") for o in matches]})


def handle_explain(intent: Intent, orders: list) -> tuple[str, dict]:
    if intent.term and intent.term in TERM_DEFINITIONS:
        return TERM_DEFINITIONS[intent.term], {"term": intent.term}
    return ("I don't have a definition for that term. Try one of: "
            + ", ".join(sorted(TERM_DEFINITIONS.keys())[:10]) + ", …",
            {"term": None})


def handle_greeting(intent: Intent, orders: list) -> tuple[str, dict]:
    return ("Hi! I'm ROBI's assistant. Ask me things like 'how many failed orders today', "
            "'slowest sock order this week', 'why do towel orders fail', or 'tell me about order 42'."), {}


def order_to_text(o):
    st = o.get("status", "unknown")
    if st in ("success", "ok"):
        status = "delivered"
    elif st == "warning":
        status = f"delivered with warnings ({(o.get('failure') or {}).get('reason', 'retries')})"
    else:
        status = f"failed ({(o.get('failure') or {}).get('reason', 'unknown')})"
    steps = ", ".join(s.get("friendly_name", s.get("phase", "?")) for s in (o.get("steps") or []))
    retries = o.get("retries", 0)
    waypoints = o.get("waypoints_searched", [])
    collisions = o.get("collision_warnings", 0)
    extra = ""
    if retries > 0:
        extra += f", {retries} retries"
    if len(waypoints) > 1:
        extra += f", searched {len(waypoints)} waypoints ({', '.join(waypoints)})"
    if collisions > 0:
        extra += f", {collisions} collision warnings"
    return (
        f"Order #{o.get('id')}: {o.get('item')}, {status}, "
        f"{o.get('total_seconds', 0)}s total, {o.get('robot_seconds', 0)}s robot{extra}, "
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
    global faiss_index, faiss_docs, faiss_orders, last_rebuilt
    if not HAS_FAISS:
        return
    orders = read_orders()
    if not orders:
        return
    texts = [order_to_text(o) for o in orders]
    # nomic-embed-text was trained with task prefixes — using them improves
    # retrieval quality noticeably (~+2 NDCG@10). Documents get
    # "search_document:", queries get "search_query:".
    vectors = embed_texts([f"search_document: {t}" for t in texts])
    if vectors is None:
        return
    dim = len(vectors[0])
    index = faiss.IndexFlatIP(dim)
    mat = np.stack(vectors)
    faiss.normalize_L2(mat)
    index.add(mat)
    faiss_index = index
    faiss_docs = texts
    faiss_orders = orders   # aligned row-for-row with faiss_docs
    last_rebuilt = datetime.now(timezone.utc).isoformat()
    # Persist
    try:
        faiss.write_index(index, str(FAISS_PATH))
    except Exception:
        pass
    print(f"[RAG] FAISS index rebuilt: {len(texts)} docs, dim={dim}")


def retrieve(query, k=6, intent=None):
    """Retrieve order summaries relevant to `query`.

    If `intent` carries a structured filter (e.g. {"status": "failed"}),
    we pre-filter the index by metadata FIRST, then rank the survivors by
    semantic similarity. This stops the embedder from blending "failed sock"
    and "delivered-with-warnings sock" results together.

    Returns (texts, matched_total) so the caller can show an exact count.
    """
    if faiss_index is None or not faiss_docs:
        return [], 0

    # Build the candidate pool. With no intent we use the whole index.
    candidate_idxs = list(range(len(faiss_docs)))
    if intent and faiss_orders:
        # `intent` here is an Intent dataclass; reuse the same filter as the
        # deterministic handlers so retrieval matches what counts/lists return.
        matching = set(id(o) for o in apply_intent_filter(faiss_orders, intent))
        candidate_idxs = [
            i for i in candidate_idxs
            if i < len(faiss_orders) and id(faiss_orders[i]) in matching
        ]
    matched_total = len(candidate_idxs)
    if not candidate_idxs:
        return [], 0

    # If the filter alone leaves few candidates, just return them sorted by
    # recency — semantic rank adds noise on a 1–6 item set.
    if matched_total <= k:
        ordered = sorted(
            candidate_idxs,
            key=lambda i: (faiss_orders[i].get("started_at") or "") if faiss_orders else "",
            reverse=True,
        )
        return [faiss_docs[i] for i in ordered], matched_total

    # Otherwise rank the candidate pool by cosine similarity to the query.
    # nomic-embed-text was trained with task prefixes — give the query one.
    vec = embed_texts([f"search_query: {query}"])
    if vec is None:
        return [faiss_docs[i] for i in candidate_idxs[:k]], matched_total
    q = np.array(vec[0], dtype="float32").reshape(1, -1)
    faiss.normalize_L2(q)

    # Reconstruct candidate vectors out of the index (it's a flat index, so
    # this is cheap) and score them directly.
    cand_mat = np.stack([faiss_index.reconstruct(int(i)) for i in candidate_idxs])
    sims = (cand_mat @ q.T).flatten()
    top = np.argsort(-sims)[:k]
    chosen = [candidate_idxs[int(j)] for j in top]
    return [faiss_docs[i] for i in chosen], matched_total


# ── Prompts (Qwen-optimized: numbered lists, facts injected) ────────────────

SYSTEM_PROMPT = f"""You are ROBI's assistant. You write short operational summaries for supermarket employees who monitor a grocery-picking robot.

Rules:
1. Write in plain, friendly English. Use "ROBI" to refer to the robot.
2. The ONLY slugs you may wrap in [[double brackets]] are those from this exact list (use the slug exactly as written, lowercase, with hyphens — never underscores or spaces): {', '.join(TERM_SLUGS)}.
3. NEVER invent new slugs. NEVER write [[search_exhausted]], [[reachability_failed]], [[collision warnings]], or any slug not in the list above. If a concept isn't in the list, write it as plain text.
4. Cite specific orders as [cite:N] where N is the order number. Do NOT wrap citations in bold or other markdown.
5. Do NOT use **bold** markdown around long sentences. Plain prose only.
6. NEVER invent numbers, durations, dates, or events. Only use the FACTS provided.
7. NEVER refer to "sessions", "shifts", "periods of activity", or invent timeframes that aren't in the FACTS.
8. Treat any duration value as exactly the unit stated in the FACTS — do not convert seconds into minutes/hours/etc. unless the FACTS already give a multi-unit value.
9. When a "### FILTER" block is present in the context, it is AUTHORITATIVE. The user is asking about that filtered subset, not the whole database. Rules for that case:
   a. Only the "Exact total number of orders matching this filter" line is the correct count. Quote that number verbatim.
   b. IGNORE any "Weekly stats" numbers — they are not in this context anymore, and "failed" totals from other sections are NOT the answer.
   c. "delivered with warnings" orders are NOT failed orders. "failed" means status=failed only.
   d. Never say "in total" to refer to anything other than the filter's exact match count.
   e. If you can't answer from the filtered facts, say "I don't see any matching orders" — never fall back to unrelated numbers.
10. Keep responses concise and factual."""


def weekly_prompt(stats):
    items = ", ".join(f"{item} ({count})" for item, count in stats["item_ranking"])
    failures_line = ", ".join(f"{r}: {c}" for r, c in stats["failures"].items()) if stats["failures"] else "No failures"
    busiest = f"{stats['busiest_day']['date']} with {stats['busiest_day']['count']} orders" if stats.get("busiest_day") else "N/A"
    # Always state durations in seconds and clarify what "slowest" refers to: a
    # single order, not a session.
    slowest = (
        f"order #{stats['slowest']['id']} for the {stats['slowest']['item']} took {stats['slowest']['total_seconds']} seconds (single order, not a session)"
        if stats.get("slowest") else "N/A"
    )
    return {
        "system": SYSTEM_PROMPT,
        "user": f"""Write a 2-paragraph weekly summary. Each paragraph should be 2-3 sentences. No headings, no bullet points.

FACTS:
1. Period: {stats.get('start_date', '?')} to {stats.get('end_date', '?')} (last 7 days)
2. Orders this week: {stats['total']} ({stats['success']} delivered, {stats['warning']} delivered with warnings, {stats['failed']} failed)
3. Average fetch time: {stats['avg_time']} seconds ({stats['avg_robot_time']}s robot work)
4. Median fetch time: {stats['median_time']} seconds
5. Items handled: {items}
6. Busiest day: {busiest}
7. Slowest order: {slowest}
8. Failures: {failures_line}
9. Total retries across all orders: {stats.get('total_retries', 0)} ({stats.get('orders_with_retries', 0)} orders needed retries)
10. Total collision warnings: {stats.get('total_collisions', 0)}

Start the first paragraph by stating the date range and total. Second paragraph: notable details or patterns (include retry/collision info if significant). No headings, no bullet points.""",
    }


def chart_prompt(stats):
    items = ", ".join(f"{item} ({count})" for item, count in stats["item_ranking"][:5])
    busiest = f"{stats['busiest_day']['date']} ({stats['busiest_day']['count']} orders)" if stats.get("busiest_day") else "N/A"
    return {
        "system": SYSTEM_PROMPT,
        "user": f"""Write a 1-2 sentence caption for a daily activity chart. No headings, no bullet points.

FACTS:
1. Period: {stats.get('start_date', '?')} to {stats.get('end_date', '?')}
2. Total orders: {stats['total']} ({stats['success']} delivered, {stats['warning']} with warnings, {stats['failed']} failed)
3. Average fetch time: {stats['avg_robot_time']}s (robot time only)
4. Top items: {items}
5. Busiest day: {busiest}

Be brief — this sits below a chart that already shows the data visually.""",
    }


def orders_list_prompt(stats, status_filter="all", orders_subset=None):
    failures_line = ", ".join(f"{r}: {c}" for r, c in stats["failures"].items()) if stats["failures"] else "None"
    top_failure = max(stats["failures"].items(), key=lambda x: x[1]) if stats["failures"] else None
    slowest = f"#{stats['slowest']['id']} ({stats['slowest']['item']}, {stats['slowest']['total_seconds']}s)" if stats.get("slowest") else "N/A"
    items = ", ".join(f"{item} ({count})" for item, count in stats["item_ranking"][:5])

    order_ids = []
    if orders_subset:
        order_ids = [o.get("id") for o in orders_subset[:8] if o.get("id")]

    if status_filter == "warning":
        cited = ", ".join(f"[cite:{oid}]" for oid in order_ids[:5])
        return {
            "system": SYSTEM_PROMPT,
            "user": f"""Write a 3-4 sentence analysis of orders that were delivered but had warnings. No headings, no bullet points.

FACTS:
1. Period: {stats.get('start_date', '?')} to {stats.get('end_date', '?')}
2. Warning orders: {stats['total']} out of {stats.get('all_total', '?')} total ({round(stats['total'] / max(stats.get('all_total', 1), 1) * 100)}% of all orders)
3. Warning reasons: {failures_line}
4. Top warning reason: {top_failure[0] if top_failure else 'N/A'} ({top_failure[1] if top_failure else 0} occurrences)
5. Items affected: {items}
6. Average time for warning orders: {stats['avg_time']}s (vs overall average may differ)
7. Slowest warning order: {slowest}
8. Example order IDs: {cited}

First sentence: explain what "delivered with warnings" means in plain language — ROBI completed these but ran into issues along the way.
Second sentence: identify the most common warning reason and which items it affected most — cite specific orders as [cite:N].
Third sentence: note if warning orders took longer than usual.
Final sentence: give ONE specific, actionable **Suggestion:** for what the employee can do to reduce warnings (e.g., restock shelf, reposition items, check lighting). Make it concrete and practical.""",
        }

    if status_filter == "failed":
        cited = ", ".join(f"[cite:{oid}]" for oid in order_ids[:5])
        return {
            "system": SYSTEM_PROMPT,
            "user": f"""Write a 3-4 sentence analysis of failed orders. No headings, no bullet points.

FACTS:
1. Period: {stats.get('start_date', '?')} to {stats.get('end_date', '?')}
2. Failed orders: {stats['total']} out of {stats.get('all_total', '?')} total ({round(stats['total'] / max(stats.get('all_total', 1), 1) * 100)}% failure rate)
3. Failure reasons: {failures_line}
4. Top failure: {top_failure[0] if top_failure else 'N/A'} ({top_failure[1] if top_failure else 0} occurrences)
5. Items that failed: {items}
6. Slowest failed order: {slowest}
7. Example order IDs: {cited}

First sentence: summarize the failure rate and whether it's concerning.
Second sentence: break down the top failure reasons and cite the worst offenders as [cite:N].
Third sentence: note any patterns — are failures clustered on specific items or times?
Final sentence: give ONE specific, actionable **Suggestion:** for the employee to reduce failures. Be concrete (e.g., "check gripper calibration", "restock the top shelf", "ensure items face forward").""",
        }

    if status_filter == "delivered":
        return {
            "system": SYSTEM_PROMPT,
            "user": f"""Write a 2-3 sentence summary of successfully delivered orders. No headings, no bullet points.

FACTS:
1. Period: {stats.get('start_date', '?')} to {stats.get('end_date', '?')}
2. Delivered: {stats['total']} orders (out of {stats.get('all_total', '?')} total)
3. Average robot time: {stats['avg_robot_time']}s, median: {stats['median_time']}s
4. Top items: {items}
5. Slowest successful order: {slowest}

First sentence: summarize delivery performance positively.
Second sentence: note the fastest and slowest items or any timing patterns.
Final sentence: give ONE **Suggestion:** to maintain or improve performance — e.g., which items ROBI handles best, optimal ordering times.""",
        }

    # "all" filter
    cited_fails = ", ".join(f"[cite:{oid}]" for oid in order_ids[:5]) if order_ids else ""
    return {
        "system": SYSTEM_PROMPT,
        "user": f"""Write a 3-4 sentence summary for the orders list. No headings, no bullet points.

FACTS:
1. Period: {stats.get('start_date', '?')} to {stats.get('end_date', '?')}
2. Total: {stats['total']} orders ({stats['success']} delivered, {stats['warning']} with warnings, {stats['failed']} failed)
3. Average robot time: {stats['avg_robot_time']}s, median: {stats['median_time']}s
4. Top items: {items}
5. Failure breakdown: {failures_line}
6. Top failure: {top_failure[0] if top_failure else 'None'} ({top_failure[1] if top_failure else 0} times)
7. Slowest order: {slowest}

First sentence: summarize overall performance — delivery rate, timing.
Second sentence: highlight the top failure reason and which orders were affected — cite them as [cite:N].
Third sentence: note any patterns in warnings or slow orders.
Final sentence: give ONE concrete, actionable **Suggestion:** for the employee. Start with the bold marker. Relate it to the most common issue.""",
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

    retries = order.get("retries", 0)
    waypoints = order.get("waypoints_searched", [])
    collisions = order.get("collision_warnings", 0)
    grasp_width = order.get("grasp_width_mm")
    extra_facts = ""
    if retries > 0:
        extra_facts += f"\n5. Retries: {retries} (ROBI tried different viewpoints before succeeding)"
    if len(waypoints) > 1:
        extra_facts += f"\n{'6' if retries > 0 else '5'}. Waypoints searched: {', '.join(waypoints)} (found at {order.get('waypoint_found_at', 'unknown')})"
    if collisions > 0:
        extra_facts += f"\n{'7' if retries > 0 and len(waypoints) > 1 else '6' if retries > 0 or len(waypoints) > 1 else '5'}. Collision warnings: {collisions} (planner had trouble finding a collision-free path)"
    if grasp_width:
        extra_facts += f"\n8. Grasp width: {grasp_width}mm"

    return {
        "system": SYSTEM_PROMPT,
        "user": f"""An employee tapped "Why so long? Ask ROBI" on order #{order.get('id')}.

FACTS:
1. Item: {order.get('item')}
2. Status: {order.get('status')}{failure_info}
3. Total time: {order.get('total_seconds', 0)}s (robot: {order.get('robot_seconds', '?')}s, human wait: {order.get('human_wait_seconds', '?')}s)
4. Steps:
  {steps}{extra_facts}

Explain in 2-3 sentences why this order took the time it did. Reference specific phases and numbers. If it failed, explain what went wrong. If there were retries or collision warnings, explain what that means in plain language.""",
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


# ── Vision analysis (gemma3) ────────────────────────────────────────────────

VISION_CACHE_DIR = ROOT / "data" / "cache" / "vision"
VISION_CACHE_DIR.mkdir(parents=True, exist_ok=True)

import base64

def read_vision_cache(image_ids_key: str):
    path = VISION_CACHE_DIR / f"{image_ids_key}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

def write_vision_cache(image_ids_key: str, result: dict):
    entry = {**result, "generated_at": datetime.now(timezone.utc).isoformat()}
    path = VISION_CACHE_DIR / f"{image_ids_key}.json"
    try:
        path.write_text(json.dumps(entry, indent=2), encoding="utf-8")
    except Exception:
        pass
    return entry

def load_image_b64(image_id: str) -> str | None:
    for ext in (".jpg", ".bmp", ".png"):
        p = IMAGES_DIR / f"{image_id}{ext}"
        if p.exists():
            data = p.read_bytes()
            mime = {"jpg": "image/jpeg", "bmp": "image/bmp", "png": "image/png"}[ext.lstrip(".")]
            return f"data:{mime};base64,{base64.b64encode(data).decode()}"
    return None

def load_image_context(image_id: str) -> dict | None:
    """Load the surrounding-event context written by the WS server when the
    image landed. Returns the parsed JSON or None if the file is missing."""
    p = IMAGES_DIR / f"{image_id}.context.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def format_image_context(ctx: dict) -> str:
    """Render the event log into a compact, LLM-friendly bulleted timeline."""
    if not ctx or not ctx.get("events"):
        return ""
    lines = [
        f"Image was captured at {ctx.get('imageReceivedAt', '?')} (UI clock).",
        f"Events in the {ctx.get('windowFrom', '?')} … {ctx.get('windowTo', '?')} window:",
    ]
    for e in ctx["events"][-40:]:  # cap at 40 lines so the prompt stays reasonable
        comp = e.get("component") or e.get("type") or "?"
        action = f":{e['action']}" if e.get("action") else ""
        status = f" [{e['status']}]" if e.get("status") else ""
        detail = e.get("detail")
        detail_part = f" — {detail}" if detail else ""
        lines.append(f"  • {e.get('serverTs', '?')}  {comp}{action}{status}{detail_part}")
    return "\n".join(lines)


def analyze_failure_images(image_ids: list[str], failure_context: str = "") -> dict:
    cache_key = hashlib.md5("_".join(sorted(image_ids)).encode()).hexdigest()[:16]
    cached = read_vision_cache(cache_key)
    if cached:
        return cached

    content = []
    for img_id in image_ids:
        data_url = load_image_b64(img_id)
        if data_url:
            content.append({"type": "image_url", "image_url": {"url": data_url}})

    if not content:
        return {"text": "No images available for analysis.", "generated_at": datetime.now(timezone.utc).isoformat()}

    # Pull surrounding-event context for each image (synced to UI clock,
    # not the robot's local time which can drift).
    context_blocks = []
    for img_id in image_ids:
        ctx = load_image_context(img_id)
        if ctx:
            block = format_image_context(ctx)
            if block:
                context_blocks.append(f"=== Context for image {img_id} ===\n{block}")
    event_context = "\n\n".join(context_blocks)

    prompt_text = f"""You are analyzing camera feeds from a grocery-picking robot (ROBI) that just failed a task.
{f"Failure context: {failure_context}" if failure_context else ""}

{f"Robot event log around the moment the image was captured (use this to ground your interpretation):{chr(10)}{event_context}" if event_context else ""}

Look at the image(s) and explain in 2-3 sentences:
1. What you see in the scene (shelf layout, item positions, obstacles)
2. Why the robot likely failed (e.g., item blocked, bad angle, cluttered shelf, item too small) — cite the event log if relevant
3. What an employee could do to help (e.g., move items apart, reposition the target)

Be specific about what you observe. Use plain language. Do NOT invent events that aren't in the log above."""

    content.append({"type": "text", "text": prompt_text})

    try:
        resp = llm.chat.completions.create(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": content}],
            temperature=0.3,
            max_tokens=300,
        )
        text = resp.choices[0].message.content or ""
        text = wrap_terms(text)
        result = {"text": text}
        return write_vision_cache(cache_key, result)
    except Exception as e:
        print(f"[RAG] Vision analysis error: {e}", file=sys.stderr)
        return {"text": f"_Vision analysis unavailable — {VISION_MODEL} may not be running._", "generated_at": datetime.now(timezone.utc).isoformat()}


# ── Caching ──────────────────────────────────────────────────────────────────

CACHE_TTL_LIVE = {
    "weekly": 30 * 60,                  # 30 min — includes today, may change
    "order_detail": float("inf"),       # immutable once an order is closed
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

def generate_caption(surface, scope, client_stats=None, force=False):
    # When force=true we must NOT short-circuit on the cache — the caller
    # (refresh button, background loop) explicitly wants a fresh LLM call.
    # Without this guard, a race between the endpoint's unlink() and another
    # writer can serve us the stale file we were trying to replace.
    if not force:
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
        # Honour client-provided totals if present so the weekly summary's
        # numbers match what the chart / orders list already display.
        if client_stats:
            stats["total"] = client_stats.get("total", stats["total"])
            stats["success"] = client_stats.get("delivered", stats["success"])
            stats["warning"] = client_stats.get("warning", stats["warning"])
            stats["failed"] = client_stats.get("failed", stats["failed"])
        p = weekly_prompt(stats)
    elif surface == "order_detail":
        order = next((o for o in orders if o.get("id") == scope.get("order_id")), None)
        if not order:
            return {"text": "Order not found.", "citations": [], "generated_at": datetime.now(timezone.utc).isoformat()}
        p = order_detail_prompt(order)
    else:
        return {"text": f"Unknown surface: {surface}", "citations": [], "generated_at": datetime.now(timezone.utc).isoformat()}

    result = call_llm(p["system"], p["user"])
    # Don't cache obvious LLM failures — otherwise a transient gemma3 hiccup
    # poisons the cache and every retry serves the same "_unavailable_" text
    # until someone deletes the file by hand.
    text = (result.get("text") or "").strip()
    if not text or text.startswith("_") or "unavailable" in text.lower():
        result.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
        return result
    return write_cache(surface, scope, result)


# ── Background weekly summary refresh ───────────────────────────────────────

def _refresh_weekly_loop():
    while True:
        time.sleep(30 * 60)  # 30 min
        try:
            # Force regenerate by clearing cache first
            path = CACHE_DIR / cache_key("weekly", {})
            if path.exists():
                try:
                    path.unlink()
                except Exception:
                    pass
            generate_caption("weekly", {}, force=True)
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
    client_stats = body.get("stats")   # UI-provided numbers for consistency
    force = body.get("force", False)
    cache_only = body.get("cache_only", False)

    if not surface:
        return JSONResponse({"error": "surface is required"}, status_code=400)

    # When client sends stats, include the totals in the cache scope so
    # a caption generated for 28 orders isn't reused when there are 32.
    effective_scope = dict(scope)
    if client_stats:
        effective_scope["_totals"] = (
            client_stats.get("total", 0),
            client_stats.get("delivered", 0),
            client_stats.get("warning", 0),
            client_stats.get("failed", 0),
        )

    # Fast path: only return what's in the cache, never call the LLM
    if cache_only:
        cached = read_cache(surface, effective_scope)
        if cached:
            return cached
        return JSONResponse({"text": None, "cache_miss": True})

    if force:
        path = CACHE_DIR / cache_key(surface, effective_scope)
        if path.exists():
            try:
                path.unlink()
            except Exception:
                pass

    result = generate_caption(surface, effective_scope, client_stats, force=force)
    return result


# ── Vision analysis ─────────────────────────────────────────────────────────

@app.post("/api/rag/vision")
async def vision(request: Request):
    body = await request.json()
    image_ids = body.get("image_ids", [])
    failure_context = body.get("failure_context", "")
    cache_only = body.get("cache_only", False)

    if not image_ids:
        return JSONResponse({"error": "image_ids is required"}, status_code=400)

    # Fast path: return cached result without calling the vision model
    if cache_only:
        cache_key_str = hashlib.md5("_".join(sorted(image_ids)).encode()).hexdigest()[:16]
        cached = read_vision_cache(cache_key_str)
        if cached:
            return cached
        return JSONResponse({"text": None, "cache_miss": True})

    result = analyze_failure_images(image_ids, failure_context)
    return result


# ── Chat router (LLM parse → Python compute → LLM render) ──────────────────
#
# Pipeline per request:
#   1. LLM parses the user's question + recent history into a typed Intent.
#   2. Python dispatches to the matching handler (handle_count, handle_list,
#      handle_rank, etc.) which filters orders.json and produces a verified
#      result (deterministic, exact numbers, real order IDs).
#   3. LLM renders the verified result into natural-language prose. The
#      renderer is told the numbers and IDs are non-negotiable.
#
# Conversation memory: the frontend already sends the whole `messages`
# array, so the parser LLM sees the conversation and can resolve follow-ups
# like "and what about yesterday?" on its own. No server-side memory needed.


HANDLERS_BY_KIND = {
    "count":     handle_count,
    "list":      handle_list,
    "existence": handle_existence,
    "lookup":    handle_lookup,
    "rank":      handle_rank,
    "aggregate": handle_aggregate,
    "explain":   handle_explain,
    "greeting":  handle_greeting,
}


def _run_handler(intent: Intent, orders: list) -> tuple[str, list, str]:
    """Run the deterministic handler for an Intent.kind.

    Returns (deterministic_text, matched_orders, kind_used).
    `kind_used` may differ from intent.kind if we had to fall back to a
    generic filter (e.g. when intent.kind == "reason" or "compare" — those
    don't have deterministic handlers, so we still want the filtered orders
    to pass to the renderer).
    """
    handler = HANDLERS_BY_KIND.get(intent.kind)
    if handler is not None:
        text, extra = handler(intent, orders)
        matched_ids = extra.get("matched_ids") or []
        matched = [o for o in orders if o.get("id") in set(matched_ids)]
        # Preserve the order the handler returned them in.
        order_index = {oid: i for i, oid in enumerate(matched_ids)}
        matched.sort(key=lambda o: order_index.get(o.get("id"), 0))
        return text, matched, intent.kind
    # No deterministic handler (reason / compare / unknown) — still apply the
    # filter so the renderer has grounded data to work with.
    matched = apply_intent_filter(orders, intent)
    return "", matched, intent.kind


@app.post("/api/rag/chat")
async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    if not messages:
        return JSONResponse({"error": "messages array is required"}, status_code=400)

    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    history_messages = messages[:-1] if messages else []

    log_entry = {"query": last_user}

    # ── 1. LLM PARSE ────────────────────────────────────────────────────────
    intent, parse_dbg = parse_intent_via_llm(last_user, history_messages)
    log_entry["intent"] = intent.to_dict()
    log_entry["kind"] = intent.kind
    log_entry["parse_debug"] = {
        # Don't dump raw outputs unless parse failed; they're long.
        "parse_failure": parse_dbg.get("parse_failure", False),
        "llm_error": parse_dbg.get("llm_error"),
        "raw_outputs": parse_dbg.get("raw_outputs", []) if parse_dbg.get("parse_failure") else None,
    }

    # ── 2. PYTHON COMPUTE (the "tools") ─────────────────────────────────────
    orders = read_orders()
    deterministic_text, matched_orders, _ = _run_handler(intent, orders)
    log_entry["orders_scanned"] = len(orders)
    log_entry["verified_total"] = len(matched_orders)
    log_entry["matched_ids"] = [o.get("id") for o in matched_orders][:50]
    log_entry["deterministic_text"] = deterministic_text

    # Greetings don't need the LLM renderer — the canned reply is best.
    if intent.kind == "greeting":
        text = wrap_terms(deterministic_text or "Hi! How can I help?")
        log_entry["path"] = "greeting_short_circuit"
        log_entry["response_text"] = text
        chat_log(log_entry)
        return StreamingResponse(
            iter([f"data: {json.dumps({'text': text})}\n\n", "data: [DONE]\n\n"]),
            media_type="text/event-stream",
        )

    # ── 3. LLM RENDER ───────────────────────────────────────────────────────
    rendered = render_answer_via_llm(
        intent, deterministic_text, matched_orders, last_user, history_messages,
    )
    log_entry["path"] = f"llm_parse_render_{intent.kind}"
    log_entry["response_text"] = rendered
    chat_log(log_entry)

    return StreamingResponse(
        iter([f"data: {json.dumps({'text': rendered})}\n\n", "data: [DONE]\n\n"]),
        media_type="text/event-stream",
    )


# ── Parse-debug endpoint ────────────────────────────────────────────────────

@app.get("/api/rag/parse")
def rag_parse(q: str = Query(..., description="The chat query to parse")):
    """Return what the LLM parser sees for a given query.

    Useful in a browser or with curl to debug why a question is producing
    the wrong answer:
        curl 'http://localhost:5174/api/rag/parse?q=how+many+failed+socks+today'
    will show the Intent the LLM produced and what kind it decided on.
    """
    intent, debug = parse_intent_via_llm(q, [])
    return {
        "query": q,
        "kind": intent.kind,
        "confidence": intent.confidence,
        "intent": intent.to_dict(),
        "debug": {
            "parse_failure": debug.get("parse_failure", False),
            "llm_error": debug.get("llm_error"),
            "raw_outputs": debug.get("raw_outputs"),
        },
    }


# ── Cache management endpoint ───────────────────────────────────────────────

@app.delete("/api/rag/cache")
def rag_cache_clear(include_chat_log: bool = Query(True, description="Also clear data/rag_chat.log")):
    """Clear all caches (caption, vision, FAISS, chat log) and rebuild FAISS.

    Use after orders.json changes shape, after switching LLMs, or any time a
    cached answer looks wrong. Returns counts so you can verify.
    """
    captions_removed = 0
    vision_removed = 0
    try:
        for p in CACHE_DIR.glob("*.json"):
            try:
                p.unlink(); captions_removed += 1
            except Exception:
                pass
    except Exception:
        pass
    vision_dir = ROOT / "data" / "cache" / "vision"
    if vision_dir.exists():
        for p in vision_dir.glob("*.json"):
            try:
                p.unlink(); vision_removed += 1
            except Exception:
                pass
    faiss_removed = False
    try:
        if FAISS_PATH.exists():
            FAISS_PATH.unlink(); faiss_removed = True
    except Exception:
        pass
    chat_log_removed = False
    if include_chat_log:
        try:
            if CHAT_LOG_FILE.exists():
                CHAT_LOG_FILE.unlink(); chat_log_removed = True
        except Exception:
            pass
    # Trigger an in-process rebuild so chat keeps working without restart.
    try:
        rebuild_index()
    except Exception as e:
        return {"captions_removed": captions_removed, "vision_removed": vision_removed,
                "faiss_removed": faiss_removed, "chat_log_removed": chat_log_removed,
                "rebuild_error": str(e)}
    return {
        "captions_removed": captions_removed,
        "vision_removed": vision_removed,
        "faiss_removed": faiss_removed,
        "chat_log_removed": chat_log_removed,
        "faiss_rebuilt": True,
    }


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
        buckets[d.strftime("%Y-%m-%d")] = {"delivered": 0, "warning": 0, "failed": 0}
        d += timedelta(days=1)

    for o in filtered:
        date = (o.get("started_at") or "")[:10]
        if date in buckets:
            if o.get("status") == "warning":
                buckets[date]["warning"] += 1
            elif o.get("status") in ("success", "ok"):
                buckets[date]["delivered"] += 1
            else:
                buckets[date]["failed"] += 1

    days = [{"date": d, **v} for d, v in sorted(buckets.items())]

    robot_times = [o.get("robot_seconds", 0) for o in filtered if o.get("robot_seconds", 0) > 0]
    avg_fetch = round(sum(robot_times) / len(robot_times)) if robot_times else 0

    total_delivered = sum(d["delivered"] for d in days)
    total_warning = sum(d["warning"] for d in days)
    total_failed = sum(d["failed"] for d in days)

    return {
        "from": start,
        "to": end,
        "days": days,
        "totals": {
            "delivered": total_delivered,
            "warning": total_warning,
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
    warning_count = sum(1 for o in filtered if o.get("status") == "warning")
    failed_count = sum(1 for o in filtered if o.get("status") == "failed")

    by_item = {}
    for o in filtered:
        i = o.get("item", "unknown")
        by_item[i] = by_item.get(i, 0) + 1

    # Apply filters
    if status == "delivered":
        filtered = [o for o in filtered if o.get("status") in ("success", "ok")]
    elif status == "warning":
        filtered = [o for o in filtered if o.get("status") == "warning"]
    elif status == "failed":
        filtered = [o for o in filtered if o.get("status") == "failed"]

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
            "warning": warning_count,
            "failed": failed_count,
            "by_item": dict(sorted(by_item.items(), key=lambda x: -x[1])),
        },
        "orders": result_orders,
    }


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5175)
