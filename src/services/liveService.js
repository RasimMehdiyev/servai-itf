import { buildScenario } from '../mocks/liveMock'

export function fetchLive(scenarioKey){
  // Simulate network latency; in future this will call real API
  return new Promise((resolve) => setTimeout(()=> resolve(buildScenario(scenarioKey)), 300))
}
