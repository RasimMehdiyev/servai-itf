import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { ROBOT_LIST, getRobot, getRobotId, setRobotId, subscribeRobot } from './index'

const RobotContext = createContext(null)

/** Which robot the dashboard is showing. Changing it re-points the whole app (see DataSourceContext). */
export function RobotProvider({ children }) {
  const robotId = useSyncExternalStore(subscribeRobot, getRobotId)
  const value = useMemo(() => ({
    robotId,
    robot: getRobot(robotId),
    profile: getRobot(robotId).profile,
    robots: ROBOT_LIST,
    setRobotId,
  }), [robotId])
  return <RobotContext.Provider value={value}>{children}</RobotContext.Provider>
}

export function useRobot() {
  const ctx = useContext(RobotContext)
  if (!ctx) throw new Error('useRobot must be used within RobotProvider')
  return ctx
}
