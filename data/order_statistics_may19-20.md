# Order Statistics — 19 & 20 May 2026

Source: `data/orders.json` — 163 total orders (95 on 2026-05-19, 68 on 2026-05-20). All records in the file fall on these two dates.

## 1. Outcome counts by status

| Date | Failed | Warning | Success | Total | Success rate |
|------|-------:|--------:|--------:|------:|-------------:|
| 2026-05-19 | 45 | 21 | 29 | 95 | 30.5% |
| 2026-05-20 | 23 | 16 | 29 | 68 | 42.6% |
| Combined | 68 | 37 | 58 | 163 | 35.6% |

## 2. Object fetching time (`total_seconds`)

Time from order start to completion, in seconds.

| Group | Count | Mean | Median | Std dev | Min | Max |
|-------|------:|-----:|-------:|--------:|----:|----:|
| All orders | 163 | 97.3 | 95 | 79.2 | 16 | 817 |
| 2026-05-19 | 95 | 103.1 | 95 | 98.7 | 27 | 817 |
| 2026-05-20 | 68 | 89.2 | 95.5 | 36.3 | 16 | 167 |
| Successful only | 58 | 105.9 | 100.5 | 20.8 | 75 | 207 |
| Failed only | 68 | 73.6 | 43.5 | 108.3 | 16 | 817 |
| Warning only | 37 | 127.4 | 115 | 58.2 | 88 | 433 |

**Overall mean object-fetch time: 97.3 s** &nbsp;|&nbsp; **Median: 95 s**

## 3. Failure statistics (status = `failed`), sorted by frequency

Total failed orders: 68

### By failure reason

| Failure reason | Count | % of failures |
|----------------|------:|--------------:|
| `unknown` | 33 | 48.5% |
| `search_exhausted` | 26 | 38.2% |
| `reachability_failed` | 7 | 10.3% |
| `no_valid_depth` | 1 | 1.5% |
| `operator_abort` | 1 | 1.5% |

### By failure phase (`at_phase`)

| Phase | Count |
|-------|------:|
| `null` | 42 |
| `grasping` | 24 |
| `analyzing` | 1 |
| `bringing_over` | 1 |

### Failures by date and reason

| Failure reason | 2026-05-19 | 2026-05-20 |
|----------------|-----------:|-----------:|
| `unknown` | 21 | 12 |
| `search_exhausted` | 17 | 9 |
| `reachability_failed` | 5 | 2 |
| `no_valid_depth` | 1 | 0 |
| `operator_abort` | 1 | 0 |

### Failures by item

Failure rate is the share of that item's total orders that failed.

| Item | Total orders | Failed | Failure rate | Breakdown by reason |
|------|-------------:|-------:|-------------:|---------------------|
| ball | 42 | 31 | 73.8% | search_exhausted 25, unknown 5, no_valid_depth 1 |
| pen | 63 | 19 | 30.2% | unknown 14, reachability_failed 4, search_exhausted 1 |
| water bottle | 26 | 7 | 26.9% | unknown 6, reachability_failed 1 |
| coffee mug | 8 | 5 | 62.5% | unknown 4, reachability_failed 1 |
| towel | 8 | 4 | 50.0% | unknown 2, reachability_failed 1, operator_abort 1 |
| sock | 16 | 2 | 12.5% | unknown 2 |

### Failure reason × item

| Failure reason | Items (count) |
|----------------|---------------|
| `unknown` | pen 14, water bottle 6, ball 5, coffee mug 4, towel 2, sock 2 |
| `search_exhausted` | ball 25, pen 1 |
| `reachability_failed` | pen 4, coffee mug 1, water bottle 1, towel 1 |
| `no_valid_depth` | ball 1 |
| `operator_abort` | towel 1 |

### Top failure detail messages

| Count | Detail (truncated) |
|------:|--------------------|
| 25 | search exhausted (3 waypoints tried); 'ball' not found |
| 9 | Gripper closed |
| 7 | Pipeline aborted (operator interrupt) |
| 2 | failed at descent_motion: timed_out=False fault=Fault(type=<FaultType.CONTACT_STOP: 'conta… |
| 1 | failed at descent_motion: descent trajectory's first knot is 11.4° from live arm (max perm… |
| 1 | failed at descent_motion: timed_out=False fault=Fault(type=<FaultType.SAFETY_CLAMP: 'safet… |

## 4. Warning statistics (status = `warning`)

37 orders completed with a `warning` status (21 on 2026-05-19, 16 on 2026-05-20). These finished but flagged a recoverable issue — they take the longest on average (mean 127.4 s, median 115 s), consistent with retries and re-planning.

### By warning reason

| Reason (`failure.reason`) | Count | % of warnings | Phase (`at_phase`) |
|---------------------------|------:|--------------:|--------------------|
| `unknown` | 24 | 64.9% | analyzing |
| `reachability_failed` | 13 | 35.1% | grasping |

### By item

| Item | Warnings | Breakdown by reason |
|------|---------:|---------------------|
| pen | 25 | unknown 15, reachability_failed 10 |
| water bottle | 4 | unknown 4 |
| sock | 4 | unknown 2, reachability_failed 2 |
| ball | 3 | unknown 3 |
| coffee mug | 1 | reachability_failed 1 |

Pen accounts for 25 of 37 warnings (67.6%).

### By date

| Date | Warnings | Top items |
|------|---------:|-----------|
| 2026-05-19 | 21 | pen 17, then coffee mug / ball / water bottle / sock (1 each) |
| 2026-05-20 | 16 | pen 8, water bottle 3, sock 3, ball 2 |

### Warning detail messages

| Count | Detail (truncated) |
|------:|--------------------|
| 24 | Gripper closed |
| 13 | failed at plan_grasp: Chained-IK plan_grasp — ranked candidates failed at grasp |

### Step-level warnings & retries

- All 45 step-level warnings occur in the **grasping** phase, all with detail **"Path blocked (collision)"**.
- 13 of 37 warning orders required at least one retry (11×1, 1×2, 1×3 retries); the rest recovered without a retry.
- `collision_warnings` counter is 0 on all warning orders (collisions are surfaced via step status/detail rather than that field).

---
*Generated 2026-06-01 from `data/orders.json`.*