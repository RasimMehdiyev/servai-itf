/**
 * Phase mapping — single source of truth for grouping raw pipeline components
 * into user-facing phases.
 *
 * Verified against recent_grocery_logs.txt (FANUC CRX-10iA/L grocery pick pipeline).
 * New structured log format: timestamp | LEVEL | COMPONENT:ACTION | STATUS | details
 */

export const PHASES = [
  {
    phase: 'scene_scan',
    friendly_name: 'Scanning the scene',
    components: ['SCENE_SCAN'],
    description: 'Robot moves to scan-pose and sweeps J1 to build a 3D voxel map of the workspace.',
  },
  {
    phase: 'searching',
    friendly_name: 'Searching for item',
    components: ['SEARCH_DETECT'],
    description: 'SAM3 detection at each search waypoint — looking for the requested item.',
  },
  {
    phase: 'anchor_select',
    friendly_name: 'Selecting target',
    components: ['ANCHOR_SELECT'],
    description: 'Chooses the best detection candidate by distance and confidence score.',
  },
  {
    phase: 'closeup_move',
    friendly_name: 'Moving closer',
    components: ['CLOSEUP_MOVE'],
    description: 'Plans and moves to a close-up viewpoint near the selected anchor.',
  },
  {
    phase: 'analyzing',
    friendly_name: 'Analyzing the grasp',
    components: ['CLOSEUP_MOLMO', 'CLOSEUP_REFINE', 'CLOSEUP_LIFT', 'SYNTHESISE'],
    description: 'Molmo grasp point, SAM3 refinement, depth estimation, and grasp parameter synthesis.',
  },
  {
    phase: 'grasping',
    friendly_name: 'Picking up',
    components: ['EXECUTE_GRASP', 'CLOSEUP_RETRY'],
    description: 'Executes the grasp sequence: pre-grasp open, descent, close, lift. May retry with different viewpoints.',
  },
  {
    phase: 'bringing_over',
    friendly_name: 'Bringing it over',
    components: ['HANDOVER_TRANSIT', 'HANDOVER_MOVE'],
    description: 'Transits through a safe waypoint and moves to the handover desk.',
  },
  {
    phase: 'handing_over',
    friendly_name: 'Handing over',
    components: ['HANDOVER_RELEASE'],
    description: 'Opens the gripper to release the object at the handover desk.',
  },
  {
    phase: 'returning',
    friendly_name: 'Returning to position',
    components: ['HANDOVER_RETURN', 'RETURN_HOME'],
    description: 'Robot returns to its home waypoint, ready for the next cycle.',
  },
]

export const FAILURE_REASONS = [
  'search_exhausted',
  'reachability_failed',
  'no_valid_depth',
  'handover_failed',
  'user_cancelled',
  'item_not_found',
  'gripper_failed',
  'e_stopped',
  'timeout',
]

const _componentToPhase = {}
for (const p of PHASES) {
  for (const c of p.components) {
    _componentToPhase[c] = p
  }
}

export function phaseForComponent(component) {
  return _componentToPhase[component] || null
}
