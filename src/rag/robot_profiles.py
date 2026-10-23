"""
Per-robot vocabulary for the RAG server.

The chat pipeline (question → Intent → Python handlers → prose) is the same for every robot, but
what a question can be *about* is not: the grocery robot picks items off shelves, the bartender
robot pours drinks from rack bottles. Everything that differs lives here, so the two robots never
share a prompt, an index, a cache entry or a log line:

    names / nouns             how the robot and its orders are called
    items, phases, reasons    the values an Intent may carry (and so the values the parser LLM is told about)
    group_by                  what "by …" can group on
    terms                     what "what is …?" can explain
    examples                  few-shot questions for the intent parser
    render_intro / rules      the voice of the answer writer
    status_words              how success / warning / failed read in a sentence
    swaps / note              how the shared caption prompts are re-pointed at this robot

Add a robot: add an entry here and in src/robots/robots.json.
"""
from __future__ import annotations

# ═════════════════════════════════════════════════════════════════════════════
# grocery (ROBI)
# ═════════════════════════════════════════════════════════════════════════════

GROCERY_ITEMS = ["pen", "ball", "sock", "towel", "t-shirt", "water bottle", "phone holder", "coffee mug"]

GROCERY_PHASES = [
    "scene_scan", "searching", "anchor_select", "closeup_move",
    "analyzing", "grasping", "bringing_over", "handing_over", "returning",
]

GROCERY_REASONS = [
    "search_exhausted", "reachability_failed", "no_valid_depth",
    "handover_failed", "user_cancelled", "gripper_failed",
    "e_stopped", "timeout", "operator_abort", "bridge_fault", "arm_fault", "item_not_held",
]

GROCERY_TERMS = {
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
    "ai-judge": "The AI Judge is an independent camera with a vision-language model that watches ROBI from the side, like a third person. Before a handover it checks that ROBI really is holding the item; it never moves the robot, it only judges what it sees.",
}

# canonical → spelling variants a user might type (documented here for the parser prompt; the
# parser LLM does the matching)
GROCERY_ITEM_ALIASES = {
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

GROCERY_PHASE_ALIASES = {
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

# ── few-shot examples for the intent parser: (question, fields that are not null) ──

GROCERY_EXAMPLES = [
    ("how many failed sock orders today?",
     {"kind": "count", "status": "failed", "item": "sock", "date_from": "{today}", "date_to": "{today}", "date_label": "today"}),
    ("show me the slowest order this week",
     {"kind": "rank", "date_from": "{this_week_start}", "date_to": "{this_week_end}", "date_label": "this week",
      "rank_by": "duration", "rank_order": "desc", "limit": 1}),
    ("what is the top failed item?",
     {"kind": "rank", "status": "failed", "rank_by": "frequency", "rank_order": "desc", "limit": 1, "agg_group_by": "item"}),
    ("average fetch time by item",
     {"kind": "aggregate", "agg_metric": "avg", "agg_field": "duration", "agg_group_by": "item"}),
    ("any towels that failed yesterday?",
     {"kind": "existence", "status": "failed", "item": "towel", "date_from": "{yesterday}", "date_to": "{yesterday}", "date_label": "yesterday"}),
    ("tell me about order 42", {"kind": "lookup", "order_id": 42}),
    ("what is the gripper?", {"kind": "explain", "term": "gripper"}),
    ("why do sock orders fail so often?", {"kind": "reason", "status": "failed", "item": "sock"}),
    ("hi", {"kind": "greeting"}),
]

# ═════════════════════════════════════════════════════════════════════════════
# bar (Barista)
# ═════════════════════════════════════════════════════════════════════════════

BAR_PHASES = ["decap", "track", "glass", "grab", "pour", "return"]

BAR_PHASE_ALIASES = {
    "decap": "decap", "checking the bottle": "decap", "cap": "decap", "shake": "decap", "shaking": "decap",
    "track": "track", "tracking": "track", "looking for a customer": "track", "customer": "track",
    "glass": "glass", "finding the glass": "glass", "glass detection": "glass",
    "grab": "grab", "picking up the bottle": "grab", "pick": "grab", "pickup": "grab",
    "pour": "pour", "pouring": "pour",
    "return": "return", "putting the bottle back": "return", "putting back": "return",
}

BAR_REASONS = [
    "bottles_empty", "unsafe_to_shake", "no_glass", "bottle_pick_failed",
    "pour_failed", "gripper_failed", "e_stopped", "timeout", "operator_abort",
]

BAR_TERMS = {
    "rack": "The rack is the stand holding the bottles. The Barista picks a bottle from one of its holes, pours from it and puts it back. When no bottle is left it needs a person to refill it.",
    "refill": "A refill is a person putting bottles back into the rack. The Barista asks for one when it finds no bottle to pick; the drink it just poured is fine.",
    "decap": "Decap is the first step of a drink: the Barista looks at the bottle, opens it if it is capped and checks that shaking it is safe.",
    "shake": "Before pouring, the Barista shakes the bottle when that is safe. If the AI Judge thinks it is not safe (for example the bottle looks too full or unstable), the shake is skipped and the drink continues.",
    "track": "Tracking is the step where the Barista looks for the customer, so it knows whether someone is waiting for the drink.",
    "pour": "The pour is when the Barista tilts the bottle over the glass. The amount is reported in litres by the robot (0.2 is 200 ml).",
    "glass": "The Barista finds the glass with its camera before it pours. If it sees none, nothing is poured.",
    "gripper": "The gripper is the Barista's hand — it holds the bottle while pouring.",
    "ai-judge": "The AI Judge is a vision-language model that looks at the camera image like a third person and says whether something is safe or right, for example whether it is safe to shake a bottle. It only judges; it never moves the robot.",
    "e-stop": "Emergency stop. A safety button (physical or software) that immediately freezes the robot until manually reset.",
}

BAR_EXAMPLES = [
    ("how many drinks needed attention today?",
     {"kind": "count", "status": "warning", "date_from": "{today}", "date_to": "{today}", "date_label": "today"}),
    ("did the rack run out of bottles this week?",
     {"kind": "existence", "failure_reason": "bottles_empty", "date_from": "{this_week_start}", "date_to": "{this_week_end}", "date_label": "this week"}),
    ("which bottle was used the most?",
     {"kind": "rank", "rank_by": "frequency", "rank_order": "desc", "limit": 1, "agg_group_by": "bottle"}),
    ("show me the slowest drink this week",
     {"kind": "rank", "date_from": "{this_week_start}", "date_to": "{this_week_end}", "date_label": "this week",
      "rank_by": "duration", "rank_order": "desc", "limit": 1}),
    ("average drink time by bottle",
     {"kind": "aggregate", "agg_metric": "avg", "agg_field": "duration", "agg_group_by": "bottle"}),
    ("how many drinks failed yesterday?",
     {"kind": "count", "status": "failed", "date_from": "{yesterday}", "date_to": "{yesterday}", "date_label": "yesterday"}),
    ("were there drinks where the shake was skipped?",
     {"kind": "existence", "failure_reason": "unsafe_to_shake"}),
    ("tell me about drink 12", {"kind": "lookup", "order_id": 12}),
    ("what is the rack?", {"kind": "explain", "term": "rack"}),
    ("why does the rack keep running out?", {"kind": "reason", "failure_reason": "bottles_empty"}),
    ("hi", {"kind": "greeting"}),
]

# ═════════════════════════════════════════════════════════════════════════════
# the profiles
# ═════════════════════════════════════════════════════════════════════════════

PROFILES = {
    "grocery": {
        "name": "ROBI",
        "assistant": "ROBI's assistant",
        "noun": "order", "nouns": "orders",
        "items": GROCERY_ITEMS,
        "item_aliases": GROCERY_ITEM_ALIASES,
        "phases": GROCERY_PHASES,
        "phase_aliases": GROCERY_PHASE_ALIASES,
        "reasons": GROCERY_REASONS,
        "group_by": ["item", "status", "phase", "failure_reason", "day"],
        "default_group": "item",
        "terms": GROCERY_TERMS,
        "examples": GROCERY_EXAMPLES,
        "status_words": {"success": "successfully delivered", "warning": "delivered-with-warnings", "failed": "failed"},
        "render_intro": "You are ROBI's assistant — a robot that picks grocery items off shelves.",
        "render_name_rule": 'Refer to the robot as "ROBI".',
        "render_zero_example": '("No, there were no failed sock orders today.")',
        "greeting": ("Hi! I'm ROBI's assistant. Ask me things like 'how many failed orders today', "
                     "'slowest sock order this week', 'why do towel orders fail', or 'tell me about order 42'."),
        # glossary slugs the answer writer may wrap in [[…]] (the front end has a popover for each)
        "term_slugs": None,   # None = all of server.TERMS
        "swaps": [],
        "note": "",
    },
    "bar": {
        "name": "Barista",
        "assistant": "the Barista's assistant",
        "noun": "drink", "nouns": "drinks",
        # every order is a drink poured from a rack bottle, so there is no item to filter by
        "items": [],
        "item_aliases": {},
        "phases": BAR_PHASES,
        "phase_aliases": BAR_PHASE_ALIASES,
        "reasons": BAR_REASONS,
        "group_by": ["bottle", "status", "phase", "failure_reason", "day"],
        "default_group": "bottle",
        "terms": BAR_TERMS,
        "examples": BAR_EXAMPLES,
        "status_words": {"success": "poured", "warning": "attention-needed", "failed": "failed"},
        "render_intro": "You are the Barista's assistant — a bartender robot that pours drinks from the bottles in its rack.",
        "render_name_rule": 'Refer to the robot as "the Barista" and to orders as drinks.',
        "render_zero_example": '("No, there were no failed drinks today.")',
        "greeting": ("Hi! I'm the Barista's assistant. Ask me things like 'how many drinks today', "
                     "'did the rack run out of bottles', 'slowest drink this week', or 'tell me about drink 12'."),
        "term_slugs": ["ai-judge", "gripper", "e-stop", "e-stopped", "timeout", "operator-abort", "gripper-failed"],
        "swaps": [
            ("a robot that picks grocery items off shelves", "a bartender robot that pours drinks"),
            ("supermarket employees who monitor a grocery-picking robot", "bar staff who monitor a bartender robot"),
            ("grocery-picking robot (ROBI)", "bartender robot (the Barista)"),
            ("grocery-picking robot", "bartender robot"),
            ("ROBI's assistant", "the Barista's assistant"),
            ("Refer to the robot as \"ROBI\"", "Refer to the robot as \"the Barista\""),
            ("Use \"ROBI\" to refer to the robot", "Use \"the Barista\" to refer to the robot"),
            ("Ask ROBI", "Ask the Barista"),
            ("ROBI's report", "the Barista's report"),
            ("ROBI", "the Barista"),
            ("restock shelf", "refill the rack"),
            ("restock the top shelf", "refill the rack"),
            ("check gripper calibration", "check that the rack is full and the glass is in place"),
            ("ensure items face forward", "ensure the glass is in place"),
            ("reposition items", "reposition the glass"),
            ("check lighting", "check the lighting"),
            ("which items the Barista handles best, optimal ordering times", "which bottles are used most, busy hours"),
            ("fetch time", "drink time"),
            ("grocery items", "drinks"),
            ("grocery", "bar"),
            ("supermarket", "bar"),
            ("shelves", "the rack"),
            ("shelf", "rack"),
        ],
        "note": (
            "\n\nIMPORTANT CONTEXT: this database belongs to the BARTENDER robot (called the Barista). "
            "This robot only pours drinks; it does not pick or hand over items. "
            "Each order is one drink cycle: the robot checks a bottle (decap), looks for a customer (track), finds the glass (glass), "
            "picks the bottle from the rack (grab), pours (pour) and puts the bottle back (return). "
            "Every order is a drink poured from one of the rack's bottles; the bottle number counts from 1. "
            "Pours are reported in litres: 0.2 means 200 ml, a full and correct pour. "
            "Failure reasons: bottles_empty (the drink was poured fine, but the rack then had no bottle left and needs a refill), "
            "unsafe_to_shake (the AI Judge, a camera + vision model, thought shaking was unsafe so the shake was skipped), "
            "no_glass, bottle_pick_failed, pour_failed. Status 'warning' means the drink was poured but something needs a person, usually a refill; "
            "'failed' means the drink was not finished. "
            "Refer to the robot as the Barista and to orders as drinks."
        ),
    },
}


def get(robot: str, default: str = "grocery") -> dict:
    return PROFILES.get(robot) or PROFILES[default]


# ── prompt building ──────────────────────────────────────────────────────────

_ALL_FIELDS_NULL = {
    "kind": None, "status": None, "not_status": None, "item": None, "not_item": None,
    "date_from": None, "date_to": None, "date_label": None, "phase": None, "failure_reason": None,
    "min_duration_s": None, "max_duration_s": None, "min_retries": None, "has_collisions": None,
    "order_id": None, "rank_by": None, "rank_order": None, "limit": None,
    "agg_metric": None, "agg_field": None, "agg_group_by": None, "term": None,
}


def _quoted(values) -> str:
    return "[" + ", ".join(f'"{v}"' for v in values) + "]"


def enum_lines(p: dict) -> dict:
    """The `one of [...]` fragments of the intent schema for this robot."""
    items = p["items"]
    return {
        "item_enum": (f"one of {_quoted(items)} or null" if items
                      else "always null (this robot has a single kind of item, so there is nothing to filter by)"),
        "not_item_enum": "same options or null" if items else "always null",
        "phase_enum": f"one of {_quoted(p['phases'])} or null",
        "reason_enum": f"one of {_quoted(p['reasons'])} or null",
        "group_enum": " | ".join(f'"{g}"' for g in p["group_by"]) + " | null",
        "group_choices": " / ".join(p["group_by"][:1] + [g for g in p["group_by"][1:] if g != "status"]),
        "default_group": p["default_group"],
    }


def render_examples(p: dict, ctx: dict) -> str:
    import json
    out = []
    for question, fields in p["examples"]:
        data = dict(_ALL_FIELDS_NULL)
        for k, v in fields.items():
            data[k] = v.format(**ctx) if isinstance(v, str) else v
        out.append(f'User: "{question}"\nOutput: {json.dumps(data, ensure_ascii=False, separators=(",", ":"))}')
    return "\n\n".join(out)
