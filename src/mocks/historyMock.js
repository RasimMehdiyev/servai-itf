import failureTypes from './failureTypes.json'

const failureMeta = [
  { count: 8,  trendPercent: 12,  trendDirection: 'up',      description: 'My grip was not stable enough to hold onto the item.' },
  { count: 6,  trendPercent: 25,  trendDirection: 'down',    description: 'I could not detect the customer in the expected location.' },
  { count: 5,  trendPercent: 8,   trendDirection: 'up',      description: 'An obstacle blocked my path and I could not navigate around it.' },
  { count: 4,  trendPercent: 3,   trendDirection: 'down',    description: 'I could not establish a secure grip on the item.' },
  { count: 3,  trendPercent: 0,   trendDirection: 'neutral', description: 'I could not find the requested item at the expected pick location.' },
  { count: 3,  trendPercent: 15,  trendDirection: 'up',      description: 'I exceeded the allowed travel time to reach the delivery destination.' },
  { count: 2,  trendPercent: 5,   trendDirection: 'down',    description: 'I found the serving tray was not positioned correctly upon arrival.' },
  { count: 1,  trendPercent: 0,   trendDirection: 'neutral', description: 'I did not receive a verbal acknowledgment from the customer.' },
  { count: 1,  trendPercent: 33,  trendDirection: 'up',      description: 'My camera sensor was partially blocked, preventing object detection.' },
  { count: 1,  trendPercent: 100, trendDirection: 'up',      description: 'A mid-task return to charge was triggered unexpectedly.' },
]

export const allFailures = failureTypes.map((title, i) => ({
  id: `f${i + 1}`,
  title,
  ...failureMeta[i],
}))

// Legacy export kept for backward compat
export const historyMock = { selectedRange: '7d', topFailures: allFailures }
