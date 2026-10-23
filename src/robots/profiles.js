/**
 * UI profiles: everything the screens say or show that depends on which robot is selected.
 * Pipeline steps, wording, failure reasons and which History controls make sense.
 * The robots' log dialects themselves are handled by the relay (serverProfile.cjs) and the
 * live mappers (messageMapper.js for grocery, bar/mapper.js for the bar).
 */

// ── grocery ─────────────────────────────────────────────────────────────────

const GROCERY_REASONS = {
  search_exhausted: 'Not found',
  reachability_failed: 'Path blocked',
  no_valid_depth: 'Depth failed',
  handover_failed: 'Handover blocked',
  user_cancelled: 'Cancelled',
  gripper_failed: 'Grip failed',
  e_stopped: 'E-stop',
  timeout: 'Timeout',
  operator_abort: 'Operator aborted',
  bridge_fault: 'Hardware fault',
  arm_fault: 'Arm fault',
  item_not_held: 'Item not held',
  unknown: 'Unknown',
}

const GROCERY_EXPLANATIONS = {
  search_exhausted: "ROBI checked every shelf location it knows and still couldn't find the item — usually it's out of stock, hidden behind other things, or not where it was expected.",
  reachability_failed: "ROBI found the item but couldn't plan a safe path for its arm to reach it — something was in the way, or the item sat outside the arm's comfortable range.",
  no_valid_depth: "ROBI's depth camera couldn't get a reliable distance reading on the item. This usually happens with shiny, dark, or see-through surfaces that confuse the sensor.",
  handover_failed: "ROBI picked the item up but couldn't finish handing it to the customer — the handover position was blocked or the motion was interrupted.",
  gripper_failed: "ROBI's gripper didn't open or close as expected when grabbing or releasing, so the pick couldn't be trusted.",
  e_stopped: 'The emergency stop was triggered, which instantly freezes ROBI for safety until a person resets it.',
  timeout: 'A step took longer than allowed, so ROBI stopped rather than stay stuck — often a sign an earlier step quietly went wrong.',
  operator_abort: 'A person manually stopped the handover part-way through (for example an interrupt on the controller).',
  user_cancelled: 'The order was cancelled before ROBI could finish it.',
  bridge_fault: "A brief hardware or communication glitch on ROBI's control bridge. These are usually temporary and recover on their own.",
  arm_fault: "The arm's controller reported a fault, so the gripper could not open and the arm stopped moving. ROBI's own recovery attempts did not work: someone has to check that the drives are powered and look for active alarms on the teach pendant, then restart the arm.",
  item_not_held: 'The AI Judge — an independent camera and AI model watching from the side — did not see the item in the gripper, so ROBI did not hand it over.',
  unknown: "ROBI recorded a problem it couldn't categorise — check the order's step-by-step detail and camera feed to see what happened.",
}

const grocery = {
  id: 'grocery',
  assistantName: 'ROBI',
  nouns: { order: 'order', orders: 'orders', Orders: 'Orders', delivered: 'Delivered', deliveredVerb: 'handed over' },
  labels: {
    delivered: 'Delivered', warning: 'With warnings', failed: 'Couldn’t deliver',
    chipDelivered: '✓ Delivered', chipWarning: '⚠ Warnings', chipFailed: '✕ Failed',
    warningOutcome: 'Delivered with warnings',
  },
  // History
  itemLabel: 'Item',
  hasItemFilter: true,
  avgTimeLabel: 'Avg fetch time',
  weeklyTitle: "ROBI's weekly report",
  askPlaceholder: 'Ask ROBI anything about orders, timing, or failures.',
  reasons: GROCERY_REASONS,
  explanations: GROCERY_EXPLANATIONS,
  itemText: (order) => order.item,
  // Live
  heading: (item) => (item ? item.charAt(0).toUpperCase() + item.slice(1) : ''),
  needHelp: (today) => today.failed,
  cameras: [
    { id: 'd415', label: 'Close-up (D415)' },
    { id: 'zed', label: 'Wide (ZED)' },
  ],
  legend: ['box', 'grip', 'miss', 'try'],
  noImages: false,
}

// ── bar ─────────────────────────────────────────────────────────────────────

const BAR_REASONS = {
  bottles_empty: 'Refill needed',
  unsafe_to_shake: 'Unsafe to shake',
  no_glass: 'No glass',
  bottle_pick_failed: 'Bottle not picked',
  pour_failed: 'Pour failed',
  gripper_failed: 'Grip failed',
  e_stopped: 'E-stop',
  timeout: 'Timeout',
  operator_abort: 'Operator aborted',
  unknown: 'Unknown',
}

const BAR_EXPLANATIONS = {
  bottles_empty: 'The drink was poured and the glass is full, but the robot then found no bottle left to pick up. The rack needs refilling before the next drink can be made.',
  unsafe_to_shake: 'I think it is not safe to shake this bottle, so I skipped the shake.',
  no_glass: 'The robot could not find a glass to pour into, so nothing was poured.',
  bottle_pick_failed: 'The robot could not pick up the bottle from the rack — it may be missing, out of reach or not seated.',
  pour_failed: 'The pour did not complete. Check the glass position and the bottle.',
  gripper_failed: "The gripper didn't open or close as expected, so the bottle could not be trusted in its hand.",
  e_stopped: 'The emergency stop was triggered, which freezes the robot for safety until a person resets it.',
  timeout: 'A step took longer than allowed, so the robot stopped rather than stay stuck.',
  operator_abort: 'A person manually stopped the drink part-way through.',
  unknown: "The robot recorded a problem it couldn't categorise — open the order's steps to see where it happened.",
}

const bar = {
  id: 'bar',
  assistantName: 'Barista',
  nouns: { order: 'drink', orders: 'drinks', Orders: 'Drinks', delivered: 'Poured', deliveredVerb: 'poured' },
  labels: {
    delivered: 'Poured', warning: 'Needs attention', failed: 'Failed',
    chipDelivered: '✓ Poured', chipWarning: '⚠ Needs attention', chipFailed: '✕ Failed',
    warningOutcome: 'Poured, needs attention',
  },
  itemLabel: 'Bottle',
  hasItemFilter: false,            // every order is a drink poured from a bottle: nothing to filter by
  avgTimeLabel: 'Avg drink time',
  weeklyTitle: "Barista's weekly report",
  askPlaceholder: 'Ask the Barista anything about drinks, timing, or refills.',
  reasons: BAR_REASONS,
  explanations: BAR_EXPLANATIONS,
  // "Bottle 1" for hole 0_0 (the robot counts from 0; people count from 1)
  itemText: (order) => (typeof order.bottle === 'number' ? `Bottle ${order.bottle + 1}` : 'Bottle'),
  heading: () => 'Drink',
  // a drink that finished with the rack empty also needs a person
  needHelp: (today) => today.failed + today.warning,
  cameras: [{ id: 'wrist', label: 'Wrist camera' }],
  legend: ['box'],
  noImages: true,
}

export const PROFILES = { grocery, bar }
