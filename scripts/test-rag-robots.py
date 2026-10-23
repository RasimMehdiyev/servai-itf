"""
The RAG server keeps the two robots apart: their orders, prompts, indexes, caches and logs.

    py scripts/test-rag-robots.py

No real LLM or relay is needed: stand-ins for each robot's relay (/api/orders) and for the LLM
(/v1/chat/completions, /v1/embeddings) run on local ports, and the FastAPI app is driven with
TestClient exactly as the browser does, with the X-Robot header.

Checks, among others:
  * a Barista question is answered from the Barista's orders (the old bug: zero orders)
  * the same question without the header / with the grocery header is answered from the grocery orders
  * a robot without a relay and without a file has no orders (never the other robot's)
  * the prompts the LLM receives carry the robot's own vocabulary and none of the other's
  * indexes, caches and chat logs are per robot
"""
import json, os, re, sys, tempfile, threading, shutil
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src" / "rag"))

TMP = Path(tempfile.mkdtemp(prefix="servai-rag-test-"))
now = datetime.now(timezone.utc)
today = now.strftime("%Y-%m-%d")


def at(minutes_ago):
    return (now - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def step(phase, name, secs):
    return {"phase": phase, "friendly_name": name, "duration_seconds": secs}


GROCERY_ORDERS = [
    {"id": 1, "item": "sock", "status": "success", "started_at": at(50), "total_seconds": 70, "robot_seconds": 60, "retries": 0, "steps": [step("searching", "Searching", 20)]},
    {"id": 2, "item": "towel", "status": "failed", "started_at": at(40), "total_seconds": 90, "robot_seconds": 80, "retries": 1,
     "failure": {"reason": "handover_failed", "at_phase": "handing_over", "detail": "x"}, "steps": []},
    {"id": 3, "item": "sock", "status": "warning", "started_at": at(30), "total_seconds": 80, "robot_seconds": 70, "retries": 2,
     "failure": {"reason": "timeout", "at_phase": "searching", "detail": "y"}, "steps": []},
]


def drink(i, mins, status, reason=None, bottle=0, poured=0.2, shake=False):
    o = {"id": i, "robot": "bar", "robot_id": "BAR", "item": "bottle", "bottle": bottle, "status": status, "started_at": at(mins),
         "total_seconds": 60 + i, "robot_seconds": 55 + i, "retries": 0, "poured": poured, "glasses": 1, "glasses_filled": 1,
         "shake_unsafe": shake, "steps": [step("decap", "Checking the bottle", 10), step("pour", "Pouring", 20)]}
    if reason:
        o["failure"] = {"reason": reason, "at_phase": "return", "detail": "d"}
    return o


BAR_ORDERS = [
    drink(1, 60, "warning", "bottles_empty", bottle=0, shake=True),
    drink(2, 50, "warning", "bottles_empty", bottle=1, shake=True),
    drink(3, 40, "success", bottle=1),
    drink(4, 30, "failed", "pour_failed", bottle=1, poured=None),
    drink(5, 20, "success", bottle=2),
]

relay_data = {"grocery": GROCERY_ORDERS, "bar": BAR_ORDERS}


class RelayStub(BaseHTTPRequestHandler):
    robot = None

    def do_GET(self):
        if self.path.split("?")[0] == "/api/orders":
            body = json.dumps(relay_data[self.robot]).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()

    def log_message(self, *a):
        pass


def serve(handler, port=0):
    srv = HTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def relay_for(robot):
    h = type(f"Relay_{robot}", (RelayStub,), {"robot": robot})
    return serve(h)


prompts_seen = []   # (kind, system prompt, robot the request was for)
CUR = {"robot": None}
parse_answers = {}  # lower-case substring of the question -> intent dict


class LlmStub(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(n) or b"{}")
        if self.path.endswith("/embeddings"):
            inputs = req.get("input")
            inputs = inputs if isinstance(inputs, list) else [inputs]
            data = [{"object": "embedding", "index": i, "embedding": [((hash(t) >> k) % 7) / 7.0 + 0.01 for k in range(8)]} for i, t in enumerate(inputs)]
            return self.reply({"object": "list", "data": data, "model": "stub", "usage": {"prompt_tokens": 1, "total_tokens": 1}})
        msgs = req.get("messages", [])
        system = next((m["content"] for m in msgs if m["role"] == "system"), "")
        user = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
        if "translate user questions" in system:
            q = user.split("# CURRENT QUESTION")[-1].split("Output the JSON")[0].strip().lower()
            prompts_seen.append(("parse", system, CUR["robot"]))
            intent = next((v for k, v in parse_answers.items() if k in q), {"kind": "unknown"})
            return self.reply_chat(json.dumps(intent))
        prompts_seen.append(("render", system, CUR["robot"]))
        m = re.search(r'"deterministic_baseline_answer": "(.*?)",?\n', user)
        base = json.loads('"' + m.group(1) + '"') if m else ""
        return self.reply_chat("ANSWER: " + base)

    def reply_chat(self, text):
        return self.reply({"id": "x", "object": "chat.completion", "created": 0, "model": "stub",
                           "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}],
                           "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

    def reply(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"object": "list", "data": [{"id": "stub", "object": "model"}]}).encode())

    def log_message(self, *a):
        pass


relays = {r: relay_for(r) for r in ("grocery", "bar")}
llm_srv = serve(LlmStub)

os.environ["DATA_DIR"] = str(TMP)
os.environ["RAG_REPLAY_DIR"] = str(TMP / "replay")   # not the repo's own data/replay
os.environ["LLM_BASE_URL"] = f"http://127.0.0.1:{llm_srv.server_port}/v1"
os.environ["LLM_MODEL"] = "stub"
os.environ["EMBED_MODEL"] = "stub"
for r, srv in relays.items():
    os.environ[f"RELAY_URL_{r.upper()}"] = f"http://127.0.0.1:{srv.server_port}"

import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(server.app)

failures = 0
checks = 0


def check(cond, msg, extra=None):
    global failures, checks
    checks += 1
    if not cond:
        failures += 1
        print(f"  FAIL  {msg}" + (f"  → {extra!r}" if extra is not None else ""))


def chat(question, robot=None):
    headers = {"X-Robot": robot} if robot else {}
    CUR["robot"] = robot or "grocery"
    r = client.post("/api/rag/chat", json={"messages": [{"role": "user", "content": question}]}, headers=headers)
    text = ""
    for line in r.text.splitlines():
        if line.startswith("data: {"):
            text += json.loads(line[6:]).get("text", "")
    return r, text


def last_log(robot):
    f = server.chat_log_file(robot)
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8").strip().splitlines()[-1])


TODAY = {"date_from": today, "date_to": today, "date_label": "today"}
parse_answers.update({
    "needed attention": {"kind": "count", "status": "warning", **TODAY, "item": "bottle"},     # the LLM reaches for an item
    "how many orders": {"kind": "count", **TODAY},
    "rack run out": {"kind": "existence", "failure_reason": "bottles_empty"},
    "which bottle": {"kind": "rank", "rank_by": "frequency", "rank_order": "desc", "limit": 1, "agg_group_by": "bottle"},
    "tell me about drink 1": {"kind": "lookup", "order_id": 1},
    "what is the rack": {"kind": "explain", "term": "rack"},
    "slowest sock": {"kind": "rank", "rank_by": "duration", "rank_order": "desc", "limit": 1, "item": "sock"},
    "phase bogus": {"kind": "count", "phase": "bogus_phase", "failure_reason": "made_up"},
    "hi": {"kind": "greeting"},
})

try:
    # ── where the orders come from ───────────────────────────────────────────
    h = client.get("/api/rag/health", headers={"X-Robot": "bar"}).json()
    check(h["robot"] == "bar", "health says which robot answered", h["robot"])
    check(h["orders"]["bar"]["source"] == "relay" and h["orders"]["bar"]["orders"] == len(BAR_ORDERS), "the Barista's orders are read from its relay", h["orders"]["bar"])
    check(h["orders"]["grocery"]["source"] == "relay" and h["orders"]["grocery"]["orders"] == len(GROCERY_ORDERS), "the grocery robot's orders are read from its relay", h["orders"]["grocery"])

    # ── the bug: Barista questions were answered with zero orders ─────────────
    r, text = chat("how many drinks needed attention today?", "bar")
    check(r.headers.get("x-robot") == "bar", "the response says it was answered for the Barista", r.headers.get("x-robot"))
    check("2" in text and "0 drinks" not in text, "the Barista's two attention-needed drinks are counted", text)
    check("attention-needed drink" in text, "the answer says drinks, not orders", text)
    e = last_log("bar")
    check(e and e["robot"] == "bar" and e["orders_scanned"] == len(BAR_ORDERS) and e["verified_total"] == 2, "the Barista chat log shows 5 orders scanned, 2 matched", e and (e.get("orders_scanned"), e.get("verified_total")))
    check(e and "item" not in e["intent"], "the made-up item filter was dropped for the Barista", e and e["intent"])
    check(not server.chat_log_file("grocery").exists(), "nothing was written to the grocery chat log")

    # ── grocery stays grocery ─────────────────────────────────────────────────
    r, text = chat("how many orders today?", "grocery")
    e = last_log("grocery")
    check(e and e["orders_scanned"] == len(GROCERY_ORDERS) and e["verified_total"] == 3, "grocery: 3 orders scanned and counted", e and (e.get("orders_scanned"), e.get("verified_total")))
    check("3 orders" in text, "grocery answers say orders", text)
    r, text = chat("how many orders today?")   # no header → the default robot
    check(last_log("grocery")["orders_scanned"] == 3, "without X-Robot the default robot (grocery) answers")
    r, text = chat("slowest sock order", "grocery")
    check("[cite:1]" in text or "[cite:3]" in text, "grocery item filter still works (sock)", text)
    r, text = chat("how many orders today?", "bar")
    check(last_log("bar")["orders_scanned"] == len(BAR_ORDERS), "the same words with the Barista header read the Barista's orders", last_log("bar")["orders_scanned"])

    # ── bar vocabulary ────────────────────────────────────────────────────────
    r, text = chat("did the rack run out of bottles?", "bar")
    check(text.startswith("ANSWER: Yes") and "2" in text, "existence by failure reason bottles_empty", text)
    r, text = chat("which bottle was used most?", "bar")
    check("Bottle 2" in text, "ranking groups by bottle number (Bottle 2 poured 3 drinks)", text)
    r, text = chat("tell me about drink 1", "bar")
    check("200 ml" in text and re.search(r"ai.judge", text, re.I) and "Bottle 1" in text, "lookup describes the drink: 200 ml, AI Judge, Bottle 1", text)
    r, text = chat("what is the rack?", "bar")
    check("rack" in text.lower() and "stand holding" in text, "the Barista can explain 'rack'", text)
    r, text = chat("what is the rack?", "grocery")
    check("don't have a definition" in text, "the grocery robot has no 'rack'", text)
    r, text = chat("phase bogus", "bar")
    e = last_log("bar")
    check(e and "phase" not in e["intent"] and "failure_reason" not in e["intent"], "phases / reasons that do not exist for the Barista are dropped", e and e["intent"])
    r, text = chat("hi", "bar")
    check("Barista" in text and "ROBI" not in text, "greeting names the Barista", text)
    r, text = chat("hi", "grocery")
    check("ROBI" in text and "Barista" not in text, "greeting names ROBI", text)

    # ── prompts ───────────────────────────────────────────────────────────────
    leak = re.compile(r"ROBI|grocer|supermarket|shelf|shelves|\bsocks?\b|towel|t-shirt|coffee mug|phone holder", re.I)
    bar_prompts = [(k, s) for k, s, r in prompts_seen if r == "bar"]
    grocery_prompts = [(k, s) for k, s, r in prompts_seen if r == "grocery"]
    check(bar_prompts and grocery_prompts, "the LLM received prompts for both robots")
    leaks = sorted({m.group(0).lower() for _, s in bar_prompts for m in leak.finditer(s)})
    check(not leaks, "no grocery word in any prompt the Barista's questions produced", leaks)
    check(all("bottles_empty" in s for k, s in bar_prompts if k == "parse"), "the Barista's parser prompt lists its own failure reasons")
    check(all("handover_failed" not in s and "\"sock\"" not in s for k, s in bar_prompts), "the Barista's prompts do not list grocery values")
    check(all("bottles_empty" not in s and "unsafe_to_shake" not in s for k, s in grocery_prompts), "grocery prompts do not list Barista values")
    check(any('"sock"' in s for k, s in grocery_prompts if k == "parse"), "the grocery parser prompt still lists its items")

    # ── a robot with no relay and no file has no orders (never the other robot's) ──
    relays["bar"].shutdown(); relays["bar"].server_close()
    os.environ["RELAY_URL_BAR"] = "http://127.0.0.1:9"   # nothing listens
    r, text = chat("how many drinks needed attention today?", "bar")
    check(last_log("bar")["orders_scanned"] == 0, "Barista relay down and no file: 0 orders, not the grocery orders", last_log("bar")["orders_scanned"])
    (TMP / "orders_bar.json").write_text(json.dumps(BAR_ORDERS[:2]), encoding="utf-8")
    r, text = chat("how many drinks needed attention today?", "bar")
    check(last_log("bar")["orders_scanned"] == 2, "Barista relay down: its own orders file is used", last_log("bar")["orders_scanned"])
    check(h["orders"]["grocery"]["orders"] == 3 and last_log("grocery")["orders_scanned"] == 3, "the grocery robot was not affected")

    # ── indexes, caches ───────────────────────────────────────────────────────
    server.rebuild_index("bar"); server.rebuild_index("grocery")
    check(server.HAS_FAISS is False or (server._indexes["bar"]["docs"] and server._indexes["bar"]["docs"][0].startswith("Drink #")), "the Barista's index holds drinks")
    check(server.HAS_FAISS is False or (server._indexes["grocery"]["docs"] and server._indexes["grocery"]["docs"][0].startswith("Order #")), "the grocery index holds orders")
    check(server.HAS_FAISS is False or server.faiss_path("bar") != server.faiss_path("grocery"), "each robot persists its own index file")
    tok = server._current_robot.set("bar"); kb = server.cache_key("weekly", {}); server._current_robot.reset(tok)
    tok = server._current_robot.set("grocery"); kg = server.cache_key("weekly", {}); server._current_robot.reset(tok)
    check(kb != kg, "caption cache keys differ per robot")
    check(server.chat_log_file("bar") != server.chat_log_file("grocery"), "chat logs differ per robot")

    # ── swaps: captions for the Barista never say ROBI ────────────────────────
    tok = server._current_robot.set("bar")
    p = server.order_detail_prompt(BAR_ORDERS[0])
    adapted = server.adapt_prompt(p["system"]) + server.swap_text(p["user"])
    server._current_robot.reset(tok)
    check(not leak.search(adapted), "order-detail caption prompt for a drink has no grocery word", sorted({m.group(0) for m in leak.finditer(adapted)}))
finally:
    for s in (llm_srv, relays["grocery"]):
        s.shutdown()
    shutil.rmtree(TMP, ignore_errors=True)

print(f"\n{checks - failures}/{checks} checks passed")
sys.exit(1 if failures else 0)
