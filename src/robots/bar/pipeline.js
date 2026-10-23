/**
 * The bartender's drink cycle as dashboard steps.
 * Components are the names the relay's bar profile gives the log lines (serverProfile.cjs);
 * saved orders use the same keys as `order.steps[].phase`.
 */
export const BAR_PIPELINE = [
  { key: 'decap',  title: 'Checking the bottle',     components: ['DECAP', 'SHAKE', 'DECAP_MOVE'] },
  { key: 'track',  title: 'Looking for a customer',  components: ['TRACK', 'TRACK_MOVE'] },
  { key: 'glass',  title: 'Finding the glass',       components: ['POUR_BEGIN', 'GLASS_DETECT'] },
  { key: 'grab',   title: 'Picking up the bottle',   components: ['BOTTLE_GRAB'] },
  { key: 'pour',   title: 'Pouring',                 components: ['POUR_MOVE', 'GLASS'] },
  { key: 'return', title: 'Putting the bottle back', components: ['BOTTLE_RETURN', 'BOTTLE', 'POUR_DONE'] },
]

export const BAR_WHY = {
  decap: 'Before pouring, the robot looks at the bottle: if it is capped it opens it, and a vision model checks that shaking it is safe.',
  track: 'The robot looks for a customer to serve. With nobody there it carries on and pours anyway.',
  glass: 'A camera looks for the glass to pour into. No glass means nothing to pour.',
  grab: 'The arm picks the bottle out of its hole in the rack.',
  pour: 'The arm moves the bottle to the pouring position and tips it until the glass is filled.',
  return: 'The arm puts the bottle back in the rack. If it then cannot find another bottle, the rack needs a refill.',
}

export function barStageIndex(component) {
  return BAR_PIPELINE.findIndex(p => p.components.includes(component))
}

export function barStageTitle(component) {
  const i = barStageIndex(component)
  return i >= 0 ? BAR_PIPELINE[i].title : null
}
