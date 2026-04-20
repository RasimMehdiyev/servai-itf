import { dayDetailsMock } from '../mocks/dayDetailsMock'

export function fetchDayDetails(id){
  return new Promise((resolve)=> setTimeout(()=> resolve(dayDetailsMock), 250))
}
