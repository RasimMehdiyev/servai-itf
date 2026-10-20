import { applyMessageToScenario } from './messageMapper'

// Reducer + initial state for the Live dashboard. Kept out of the React context
// so the same code can be exercised against recorded robot logs in Node.

export function liveReducer(state, action) {
  switch (action.type) {
    case 'ws_message': {
      const next = { ...applyMessageToScenario(state, action.message), _idle: false }
      if (action.message._catchUp && next.progress) {
        next.progress = { ...next.progress, animDuration: 0 }
      }
      return next
    }
    case 'idle':
      if (state._idle) return state
      return {
        ...state,
        _idle: true,
        _cardState: 'red',
        attentionLevel: 'needs_attention',
        explanationText: 'No updates received for a while. The robot may be stuck or disconnected.',
        _cycleFailures: [...(state._cycleFailures || []), {
          level: 'red',
          message: 'Connection timeout — no updates received',
          ts: new Date().toISOString(),
        }],
      }
    case 'reset':
      return action.data
    default:
      return state
  }
}

export const liveInitialState = {
  storeId: 'ROBI',
  liveStatus: 'live',
  orderId: '',
  attentionTitle: 'Waiting for orders…',
  attentionLevel: 'ok',
  explanationTitle: 'STATUS',
  explanationText: 'The robot is connected and ready. It will start when an order comes in.',
  explanationBullets: [],
  validation: null,
  resolutionActions: [],
  robotParams: null,
  activeWorkflowTitle: 'What I am doing right now',
  earlierStepsCount: 0,
  steps: [],
  _cardState: 'green',
  _cycleStartedAt: null,
  progress: { fraction: 0, milestone: 0, animDuration: 0 },
}
