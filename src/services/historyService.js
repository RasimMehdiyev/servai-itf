import { historyMock } from '../mocks/historyMock'
import { calendarDays } from '../mocks/calendarMock'

export function fetchHistory(range = '7d'){
  return new Promise((resolve)=> setTimeout(()=> resolve({...historyMock, selectedRange: range, calendarDays}), 300))
}
