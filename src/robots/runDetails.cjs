/**
 * Everything about one order that the robot's log says and the dashboard did not keep until now:
 * where the item was, what the robot searched, every grasp attempt (where it looked from, how many
 * ways to grip the item it found, why it failed), the grip it used, and the robot's own settings.
 * It is saved on the order as `run_details`, so that later it can feed predictions and explanations.
 *
 * Used by the relay (ws-test-server.js). `observe(event)` is fed every event as it is processed;
 * it returns true when the details changed. `snapshot()` is what gets saved on the order and sent to
 * the dashboard (as a `run_details` event). Only the grocery robot's lines match; anything else is ignored.
 *
 * ── Names (all lengths in metres unless the name says otherwise) ──────────────────────────────────
 * robot_clock_started_at    when the order started, by the robot's own clock (the log's timestamp)
 * item_position_m           { x, y, z } of the item in the robot's base frame: x forward, y sideways, z up
 * shelf_row                 'top' | 'lower'  (z above SHELF_ROW_SPLIT_Z_M is the top row)
 * shelf_side                'left' | 'middle' | 'right'  (ASSUMPTION: negative y is the left side as seen from
 *                           the front; not yet confirmed against the real shelves)
 * target_candidates         the best matches the robot considered: { distance_cm, match_score }
 * item_search               one entry per shelf looked at: what it looked for and what it found
 * attempts                  one entry per try to pick the item up (see `newAttempt`)
 * grip                      the grip finally used: width, how far the hand opens first, which candidate
 * planner_settings          the grasp planner's settings: how far in front it stops, how far it lifts
 * motion_speed_ceiling_x    the speed limit the planner applied near the shelf (1 = the validated limit)
 * held_item_box_m           the size of the box the planner assumes the held item fills
 * gripper_close_force       the force setting used to close the gripper
 * handover                  where the person was, and the arm's joint angles at the handover desk
 * robot_setup               the robot's configuration at start-up (models, planner, cameras, tactile thresholds)
 */
'use strict'

const SHELF_ROW_SPLIT_Z_M = 1.4
const SHELF_SIDE_LEFT_BELOW_Y_M = -0.05
const SHELF_SIDE_RIGHT_ABOVE_Y_M = 0.3

const num = (s) => (s == null || s === '' ? null : parseFloat(s))
const round = (n, d = 3) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d)

/** "[0.926, -0.151, 1.651]" -> { x, y, z } */
function xyz(text) {
  const m = String(text || '').match(/\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]/)
  return m ? { x: +m[1], y: +m[2], z: +m[3] } : null
}
const after = (text, label) => {
  const m = String(text || '').match(new RegExp(`${label}=(\\[[^\\]]*\\])`))
  return m ? xyz(m[1]) : null
}

function shelfRow(p) { return p ? (p.z > SHELF_ROW_SPLIT_Z_M ? 'top' : 'lower') : null }
function shelfSide(p) {
  if (!p) return null
  return p.y < SHELF_SIDE_LEFT_BELOW_Y_M ? 'left' : p.y > SHELF_SIDE_RIGHT_ABOVE_Y_M ? 'right' : 'middle'
}

/** What the planner said when a grasp could not be planned, as a short machine name. */
function failureKind(text) {
  const t = String(text || '')
  if (/pre-filter rejected entire goalset/i.test(t)) return 'no_reachable_grip'          // none of the candidate grips could be reached
  if (/failed at lift|branch flip/i.test(t)) return 'lift_failed_awkward_wrist'            // reached it, but lifting needed an unreachable wrist position
  if (/collision/i.test(t)) return 'blocked_by_obstacle'
  return 'planning_failed_other'
}

function newAttempt(number, ts) {
  return {
    attempt_number: number,
    started_at: ts || null,
    seconds: null,
    // why this attempt exists: null for the first, otherwise { retry_number, retry_limit, cause, new_angle_search }
    after_failure: null,
    // where the camera and hand looked at the item from
    look_from: null,           // { kind, hand_position_m, camera_position_m, look_down_deg, candidate_index, candidate_count }
    grasp_point_px: null,      // where the pointing model said to grip, in the picture
    pointing_seconds: null,
    item_outline: null,        // { score, visible_area_px, point_inside_outline, used_nearest_fallback, outline_candidates }
    grip_plan: null,           // { planner, reachable_grips, proposed_grips, width_mm, accepted, reason }
    outcome: null,             // 'grabbed' | 'no_reachable_grip' | 'lift_failed_awkward_wrist' | 'blocked_by_obstacle' | 'planning_failed_other'
    failure_text: null,
    ended_at: null,
  }
}

function create() {
  let setup = {}
  let d
  let pendingRetry
  const reset = () => {
    d = {
      robot_clock_started_at: null,
      item_position_m: null, shelf_row: null, shelf_side: null,
      target_candidates: [], item_search: [], attempts: [],
      grip: null, planner_settings: null, motion_speed_ceiling_x: null,
      held_item_box_m: null, gripper_close_force: null, handover: null,
    }
    pendingRetry = null
  }
  reset()
  const cur = () => d.attempts[d.attempts.length - 1]
  const ensure = (ts) => {
    if (!cur() || cur().outcome) d.attempts.push(newAttempt(d.attempts.length + 1, ts))
    return cur()
  }
  const seconds = (a, ts) => {
    const t0 = Date.parse(a.started_at), t1 = Date.parse(ts)
    return Number.isFinite(t0) && Number.isFinite(t1) ? round(Math.max(0, (t1 - t0) / 1000), 1) : null
  }

  function observeSetup(evt) {
    const detail = evt.detail || ''
    const a = evt.action
    if (evt.status !== 'SUCCESS') return
    let m
    if (a === 'OBJECT_CATALOG' && (m = detail.match(/(\d+) graspable objects/))) setup.object_catalog_size = +m[1]
    else if (a === 'SAM3_STARTUP') {
      const dev = detail.match(/'device': '([^']+)'/)
      const models = [...detail.matchAll(/'(\w+)': True/g)].map(x => x[1]).filter(n => n !== 'status')
      if (dev) setup.perception_device = dev[1]
      if (models.length) setup.perception_models = models
    } else if (a === 'PLANNER_STARTUP') {
      const ik = detail.match(/IK backend=(\w+)/), vox = detail.match(/voxels=(\w+)/)
      setup.planner = { name: /CuroboAdapter/i.test(detail) ? 'cuRobo' : 'unknown', ik_backend: ik ? ik[1] : null, collision_voxels_on: vox ? vox[1] === 'on' : null }
    } else if (a === 'D415_INTRINSICS_AND_EXTRINSICS' && (m = detail.match(/\((\d+)x(\d+)\)/))) setup.close_up_camera_resolution_px = [+m[1], +m[2]]
    else if (a === 'SEARCH_WAYPOINTS') {
      const map = {}
      for (const x of detail.matchAll(/'([^']+)': \(([^)]*)\)/g)) map[x[1]] = [...x[2].matchAll(/'([^']+)'/g)].map(y => y[1])
      if (Object.keys(map).length) setup.shelves_searched_per_item = map
    } else if (a === 'TACTILE_RELEASE' && (m = detail.match(/default=([\d.]+)/))) setup.tactile_release_default_threshold = +m[1]
    else if (a === 'TACTILE_GRASP_DETECT' && (m = detail.match(/threshold=([\d.]+) sigma/))) setup.tactile_grip_threshold_sigma = +m[1]
    else if (a === 'IDLE_BEHAVIOR' && (m = detail.match(/spin-trigger=([^)]*\))/))) setup.wheel_spin_trigger = m[1]
  }

  /** @returns {boolean} true when the order's details changed */
  function observe(evt) {
    if (!evt) return false
    if (evt.type === 'cycle_start') { reset(); d.robot_clock_started_at = evt.ts || null; return true }
    if (evt.type === 'calibration') { observeSetup(evt); return false }

    if (evt.type === 'system_event') {
      const detail = evt.text || ''
      if (evt.component === 'BRIDGE' && evt.action === 'CONNECT' && evt.status === 'SUCCESS') {
        const j = detail.match(/joints \[([^\]]*)\]/)
        setup.arm_driver = { name: (detail.match(/^(\w+) driver/) || [])[1] || null, start_joint_angles_deg: j ? j[1].split(',').map(Number) : null }
        return false
      }
      if (evt.component === 'PLANNER' && evt.action === 'MOTION_TUNING') {
        const m = detail.match(/ceiling → ([\d.]+)×/)
        if (m) { d.motion_speed_ceiling_x = +m[1]; return true }
      }
      if (evt.component === 'PLANNER' && evt.action === 'GRASP_PLAN' && evt.status === 'BEGIN') {
        const g = detail.match(/goalset_size=(\d+)/), s = detail.match(/standoff=([\d.]+) mm/), l = detail.match(/lift=([\d.]+) mm/), r = detail.match(/\+ ([\d.]+) mm/)
        d.planner_settings = { proposed_grips: g ? +g[1] : null, stop_in_front_mm: s ? +s[1] : null, lift_mm: l ? +l[1] : null, retract_mm: r ? +r[1] : null }
        return true
      }
      if (evt.component === 'PLANNER' && evt.action === 'HELD_OBB') {
        const m = detail.match(/size=\(([^)]*)\)/)
        if (m) { d.held_item_box_m = m[1].split(',').map(Number); return true }
      }
      return false
    }

    if (evt.type === 'gripper') {
      const m = String(evt.raw || '').match(/close \(force=(\d+)\)/)
      if (m) { d.gripper_close_force = +m[1]; return true }
      return false
    }

    if (evt.type === 'handover' && evt.detail) {
      const p = /presenting toward person at/i.test(evt.detail) ? xyz(evt.detail) : null
      if (p) { d.handover = { ...(d.handover || {}), person_position_m: p }; return true }
      return false
    }

    if (evt.type !== 'phase') return false
    const detail = evt.detail || ''
    const st = evt.status
    let m

    switch (evt.component) {
      case 'SEARCH_DETECT':
        if (st === 'BEGIN') {
          m = detail.match(/looking for '([^']*)'/)
          d.item_search.push({ shelf_name: evt.waypoint || null, looking_for: m ? m[1] : null, pictures_checked: null, raw_detections: null, clusters_found: null, clusters_kept: null })
        } else if (d.item_search.length) {
          const s = d.item_search[d.item_search.length - 1]
          if (st === 'SUCCESS' && (m = detail.match(/(\d+) frames, (\d+) raw detections → (\d+) cluster\(s\); (\d+) survived/))) {
            s.pictures_checked = +m[1]; s.raw_detections = +m[2]; s.clusters_found = +m[3]; s.clusters_kept = +m[4]
          } else if (st === 'FAIL') s.clusters_kept = 0
        }
        return true

      case 'ANCHOR_SELECT':
        if (st !== 'SUCCESS') return false
        d.target_candidates = [...detail.matchAll(/#\d+\(d=([\d.]+)cm,score=([\d.]+)\)/g)].map(x => ({ distance_cm: +x[1], match_score: +x[2] }))
        d.item_position_m = xyz(detail.split('anchor')[1])
        d.shelf_row = shelfRow(d.item_position_m)
        d.shelf_side = shelfSide(d.item_position_m)
        return true

      case 'CLOSEUP_MOVE':
        if (st === 'BEGIN' && /retry/i.test(detail)) {
          const t = detail.match(/tiers \[([^\]]*)\]/), dist = detail.match(/d0=([\d.]+) m/), pitch = detail.match(/pitch0=([\d.]+)°/)
          pendingRetry = {
            ...(pendingRetry || {}),
            new_angle_search: { steepness_tiers_deg: t ? t[1].split(',').map(Number) : null, distance_m: dist ? +dist[1] : null, start_pitch_deg: pitch ? +pitch[1] : null },
          }
          return false
        }
        if (st === 'SUCCESS') {
          const a = ensure(evt.ts)
          const pick = detail.match(/picked candidate #(\d+)\/(\d+)/), look = detail.match(/look-down=([\d.]+)°/)
          a.look_from = {
            kind: pick ? 'new_angle' : 'search_shelf_view',
            hand_position_m: after(detail, 'tcp'), camera_position_m: after(detail, 'camera'),
            look_down_deg: look ? +look[1] : null,
            candidate_index: pick ? +pick[1] : null, candidate_count: pick ? +pick[2] : null,
          }
          if (pendingRetry) { a.after_failure = pendingRetry; pendingRetry = null }
          return true
        }
        return false

      case 'CLOSEUP_RETRY':
        if (st === 'BEGIN' && (m = detail.match(/retry (\d+)\/(\d+)(?: \(cause=([^,)]*))?/))) {
          pendingRetry = { retry_number: +m[1], retry_limit: +m[2], cause: m[3] || null }
        }
        return false

      case 'CLOSEUP_MOLMO':
        if (st !== 'SUCCESS') return false
        m = detail.match(/in ([\d.]+) s; selected \(([\d.]+), ([\d.]+)\)/)
        if (m) { const a = ensure(evt.ts); a.pointing_seconds = +m[1]; a.grasp_point_px = [+m[2], +m[3]]; return true }
        return false

      case 'CLOSEUP_REFINE':
        if (st !== 'SUCCESS') return false
        if ((m = detail.match(/score=([\d.]+) region=(\d+)px/))) {
          const a = ensure(evt.ts)
          a.item_outline = {
            score: +m[1], visible_area_px: +m[2],
            point_inside_outline: /contains_click=True/.test(detail), used_nearest_fallback: /nearest_fallback=True/.test(detail),
            outline_candidates: (detail.match(/\((\d+) body/) || [])[1] ? +detail.match(/\((\d+) body/)[1] : null,
          }
          return true
        }
        return false

      case 'SYNTHESISE':
        if (st !== 'SUCCESS') return false
        m = detail.match(/^(\w+) goalset=(\d+)\/(\d+) reachable; headline\.accepted=(\w+) width=([\d.]+) mm reason=(\w+)/)
        if (m) {
          const a = ensure(evt.ts)
          a.grip_plan = { planner: m[1], reachable_grips: +m[2], proposed_grips: +m[3], accepted: m[4] === 'True', width_mm: +m[5], reason: m[6] }
          return true
        }
        return false

      case 'EXECUTE_GRASP': {
        const a = ensure(evt.ts)
        if (st === 'FAIL') {
          a.outcome = failureKind(detail); a.failure_text = detail.slice(0, 300); a.ended_at = evt.ts; a.seconds = seconds(a, evt.ts)
          return true
        }
        if (st === 'SUCCESS') {
          a.outcome = 'grabbed'; a.ended_at = evt.ts; a.seconds = seconds(a, evt.ts)
          const pre = detail.match(/pregrasp=(\w+) \(POSITION (\d+), ~(\d+) mm\)/), idx = detail.match(/goalset_idx=(\d+)/), w = detail.match(/width=([\d.]+) mm/)
          d.grip = {
            width_mm: w ? +w[1] : null, hand_opening_before_mm: pre ? +pre[3] : null, hand_opening_mode: pre ? pre[1] : null,
            chosen_grip_index: idx ? +idx[1] : null, set_per_item: /per-object override/.test(detail),
          }
          return true
        }
        return false
      }

      case 'HANDOVER_MOVE':
        if (st === 'SUCCESS' && (m = detail.match(/joints \[([^\]]*)\]/))) {
          d.handover = { ...(d.handover || {}), arm_joint_angles_deg: m[1].split(',').map(Number) }
          return true
        }
        return false

      default:
        return false
    }
  }

  function snapshot() {
    const hasSomething = d.item_position_m || d.attempts.length || d.item_search.length
    if (!hasSomething) return null
    return {
      ...d,
      attempt_count: d.attempts.length,
      needed_more_than_one_try: d.attempts.length > 1,
      robot_setup: Object.keys(setup).length ? { ...setup } : null,
    }
  }

  return { observe, snapshot, reset }
}

module.exports = { create, failureKind, shelfRow, shelfSide, SHELF_ROW_SPLIT_Z_M, SHELF_SIDE_LEFT_BELOW_Y_M, SHELF_SIDE_RIGHT_ABOVE_Y_M }
