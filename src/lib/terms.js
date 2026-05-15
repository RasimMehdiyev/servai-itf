/**
 * Technical term dictionary for smart-caption highlighting.
 *
 * When the LLM wraps a term in [[slug]] markers, the renderer replaces it
 * with a teal-underlined tooltip element using this dictionary.
 * Unknown slugs render as plain text (graceful degradation).
 */

const TERMS = [
  { slug: 'gripper', name: 'Gripper', desc: "The robot's hand. It opens and closes to pick up and release items." },
  { slug: 'sam3', name: 'SAM3', desc: 'Segment Anything Model 3 — the vision system that detects and outlines items on the shelf.' },
  { slug: 'molmo', name: 'Molmo', desc: 'A pointing model that identifies the best grasp location on a detected item.' },
  { slug: 'grasp-synthesis', name: 'Grasp synthesis', desc: 'The step where the robot calculates how to grab the item — grip width, approach angle, and depth offset.' },
  { slug: 'trajectory', name: 'Trajectory', desc: 'The planned path the robot arm follows to move between positions.' },
  { slug: 'anchor', name: 'Anchor', desc: 'The detection candidate chosen as the target — usually the closest item with a high confidence score.' },
  { slug: 'depth-offset', name: 'Depth offset', desc: 'A small correction (in mm) applied to the grasp pose so the gripper reaches the right depth.' },
  { slug: 'standoff', name: 'Standoff', desc: 'The distance above the item where the gripper pauses before descending to grasp.' },
  { slug: 'handover', name: 'Handover', desc: 'The step where the robot delivers the item to the employee at the handover desk.' },
  { slug: 'e-stop', name: 'Emergency stop', desc: 'A safety mechanism that immediately halts all robot motion.' },
  { slug: 'close-up', name: 'Close-up view', desc: 'A second, closer look the robot takes to precisely locate the item before grasping.' },
  { slug: 'detection', name: 'Detection', desc: 'An item identified by the vision system, with a confidence score and bounding box.' },
  { slug: 'fanuc', name: 'FANUC CRX-10iA/L', desc: 'The collaborative robot arm used in this system — a FANUC CRX-10iA/L.' },
  { slug: 'curobo', name: 'cuRobo', desc: 'NVIDIA cuRobo — the GPU-accelerated motion planner that generates collision-free trajectories.' },
  { slug: 'intervention', name: 'Intervention', desc: 'When the robot pauses and asks an employee for help — e.g. an item is missing from the shelf.' },
  { slug: 'voxels', name: 'Voxels', desc: 'A 3D grid representation of the workspace built from depth camera data, used for collision avoidance.' },
  { slug: 'waypoint', name: 'Waypoint', desc: 'A predefined position the robot visits during search — e.g. top-shelve, bottom-corner, clothes-rack.' },
  { slug: 'goalset', name: 'Goalset', desc: 'A set of candidate grasp poses (distance × azimuth × pitch) that the planner evaluates for reachability.' },
  { slug: 'reachability', name: 'Reachability', desc: 'Whether the planner can find a collision-free path to a grasp pose. Fails when the target is obstructed.' },
  { slug: 'scene-scan', name: 'Scene scan', desc: 'The initial sweep where the robot rotates to build a 3D map of the workspace before searching.' },
  { slug: 'retry', name: 'Retry', desc: 'When a grasp attempt fails, the robot moves to a different viewpoint and tries again (up to 2 retries).' },
  { slug: 'search-sweep', name: 'Search sweep', desc: 'The robot visits multiple waypoints looking for the item — if not found at one, it moves to the next.' },
  { slug: 'zenoh', name: 'Zenoh', desc: 'The communication protocol used between the robot controller and the planning software.' },
  { slug: 'd415', name: 'Intel D415', desc: 'The depth camera mounted on the robot that provides RGB + depth images for detection and grasping.' },
]

export const TERM_MAP = {}
for (const t of TERMS) TERM_MAP[t.slug] = t

export const TERM_SLUGS = TERMS.map(t => t.slug)

export default TERMS
