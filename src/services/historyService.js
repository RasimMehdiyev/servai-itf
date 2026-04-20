import { historyMock } from '../mocks/historyMock'

export function fetchHistory(range = '7d'){
  return new Promise((resolve)=> setTimeout(()=> resolve({...historyMock, selectedRange: range}), 300))
}
