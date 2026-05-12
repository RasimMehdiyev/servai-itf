/**
 * Phase mapping — single source of truth for grouping raw pipeline stages
 * into user-facing phases.
 *
 * Verified against grocery_logs.txt (FANUC CRX-10iA/L grocery pick pipeline).
 * Actual stages in logs: 1, 3, 4, 5, 6, 7, 8, 9, 11, 12a, 12b, 12c, 12d.
 * No Stage 2 or Stage 10 exists in this robot's pipeline.
 */

export const PHASES = [
  {
    phase: 'going_to_shelf',
    friendly_name: 'Going to the shelf',
    raw_stages: ['1'],
    description: 'Robot plans and executes trajectory to the shelf position.',
  },
  {
    phase: 'finding_item',
    friendly_name: 'Finding the item',
    raw_stages: ['3', '4', '5'],
    description: 'SAM3 detection, anchor/centroid selection, move to close-up viewpoint.',
  },
  {
    phase: 'analyzing_grasp',
    friendly_name: 'Analyzing the grasp',
    raw_stages: ['6', '7', '8', '9'],
    description: 'Molmo grasp point, close-up segmentation, depth estimation, grasp synthesis.',
  },
  {
    phase: 'picking_up',
    friendly_name: 'Picking it up',
    raw_stages: ['11'],
    description: 'Pre-grasp opening, descent, gripper close, lift.',
  },
  {
    phase: 'bringing_over',
    friendly_name: 'Bringing it over',
    raw_stages: ['12a', '12b'],
    description: 'Transit through waypoint to the handover desk.',
  },
  {
    phase: 'handing_over',
    friendly_name: 'Handing over',
    raw_stages: ['12c'],
    description: 'Gripper opens to release the object.',
  },
  {
    phase: 'returning',
    friendly_name: 'Returning to the shelf',
    raw_stages: ['12d'],
    description: 'Robot returns to shelf position, ready for next cycle.',
  },
]

export const FAILURE_REASONS = [
  'gripper_failed',
  'item_not_found',
  'planning_failed',
  'e_stopped',
  'user_cancelled',
  'timeout',
]

// Build lookup: raw stage string → phase object
const _stageToPhase = {}
for (const p of PHASES) {
  for (const s of p.raw_stages) {
    _stageToPhase[s] = p
    _stageToPhase[`Stage ${s}`] = p
  }
}

export function phaseForStage(rawStageName) {
  const num = rawStageName.replace(/^Stage\s*/, '')
  return _stageToPhase[num] || _stageToPhase[rawStageName] || null
}
