import { dayDetailsMock } from '../mocks/dayDetailsMock'
import { calendarDayMap } from '../mocks/calendarMock'

export function fetchDayDetails(id){
  const dayData = calendarDayMap[id]
  if (dayData) {
    return new Promise((resolve)=> setTimeout(()=> resolve(dayData), 250))
  }
  // Fallback to static mock for unknown IDs
  return new Promise((resolve)=> setTimeout(()=> resolve(dayDetailsMock), 250))
}
