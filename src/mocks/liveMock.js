import scenarioData from './scenarios.json'

/**
 * Build a full live-dashboard payload from the shared pipeline + a named scenario.
 * Every step before the failure step is "completed"; the failure step gets the
 * scenario's failState + alert; every step after is "pending".
 * If failAtStep is null (e.g. "all_ok"), every step is completed.
 */
export function buildScenario(scenarioKey) {
  const key = scenarioKey || scenarioData.defaultScenario
  const scenario = scenarioData.scenarios[key]
  if (!scenario) throw new Error(`Unknown scenario: "${key}"`)

  const pipeline = scenarioData.pipeline
  const failIndex = scenario.failAtStep
    ? pipeline.findIndex(s => s.key === scenario.failAtStep)
    : pipeline.length // no failure → all completed

  let stepCounter = 0
  const steps = pipeline.map((tpl, i) => {
    let state, description, alert, badgeLabel
    const ts = scenario.timestamps[tpl.key] || 'TBD'

    if (i < failIndex) {
      state = 'completed'
      description = tpl.description
    } else if (i === failIndex) {
      state = scenario.failState
      description = scenario.failDescription || tpl.description
      alert = scenario.alert || undefined
      badgeLabel = alert ? '1' : undefined
    } else {
      state = 'pending'
      description = 'Waiting…'
    }

    stepCounter++
    return {
      id: `s${stepCounter}`,
      title: tpl.title,
      description,
      state,
      timestamp: ts,
      ...(alert ? { alert, badgeLabel } : {}),
    }
  })

  // Everything up to the first visible step is "earlier"
  const firstNonCompleted = steps.findIndex(s => s.state !== 'completed')
  const earlierStepsCount = firstNonCompleted === -1 ? 0 : Math.max(0, firstNonCompleted - 1)

  return {
    storeId: scenario.storeId,
    liveStatus: 'live',
    attentionTitle: scenario.attentionTitle,
    attentionLevel: scenario.attentionLevel,
    orderId: scenario.orderId,
    explanationTitle: 'WHY',
    explanationText: scenario.explanationText,
    explanationBullets: scenario.explanationBullets,
    quickActions: scenario.quickActions || [],
    validation: scenario.validation || null,
    resolutionActions: scenario.resolutionActions || [],
    activeWorkflowTitle: 'What I am doing right now',
    earlierStepsCount,
    steps,
  }
}

/** Available scenario keys for UI selectors */
export const scenarioKeys = Object.keys(scenarioData.scenarios)
export const scenarioLabels = Object.fromEntries(
  scenarioKeys.map(k => [k, scenarioData.scenarios[k].label])
)

/** Default export for backward-compat */
export const liveMock = buildScenario(scenarioData.defaultScenario)

