// Lightweight API hook with mocks and easy swap to real backend
export function useApi(){
  // Use Vite env when available; guard against `process` being undefined in browser
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) ? import.meta.env.VITE_API_BASE : ''

  async function fetchWithTimeout(url, opts = {}, timeout = 4000){
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeout)
    try{
      const res = await fetch(url, {...opts, signal: controller.signal})
      clearTimeout(id)
      return res
    }catch(e){
      clearTimeout(id)
      throw e
    }
  }

  async function request(method, path, body){
    const url = base + path
    // Try real fetch only when a base URL is provided; otherwise skip to mocks
    if(base){
      try{
        const res = await fetchWithTimeout(url, {method, headers:{'content-type':'application/json'}, body: body ? JSON.stringify(body) : undefined}, 5000)
        if(!res.ok) throw new Error('Network')
        return await res.json()
      }catch(e){
        // fall through to mocks on any network error
        console.warn('API request failed, falling back to mock data', e)
      }
    }

    // Mock responses for the UI prototype — richer dataset matching screenshot
    if(path === '/example'){
      return [
        {
          id: '1234',
          title: 'Order #1234',
          reason: 'Cannot find the customer with Order #1234.',
          status: 'needs_attention',
          steps: [
            {text: 'Order received', ok: true},
            {text: 'Item found in stock', ok: true},
            {text: 'Target customer not found', ok: false},
            {text: 'Sending an audio signal to the customer', ok: false}
          ],
          time: '12:36'
        },
        {id:'1237', title:'Order #1237', status:'ok', time:'12:36'},
        {id:'1240', title:'Order #1240', status:'ok', time:'12:36'},
        {id:'1245', title:'Order #1245', status:'ok', time:'12:36'}
      ]
    }

    if(path === '/performance'){
      return {
        successRate: 76,
        days: [
          {date:'16-03', success:51, failed:16},
          {date:'17-03', success:40, failed:27},
          {date:'18-03', success:60, failed:10},
          {date:'19-03', success:62, failed:12},
          {date:'20-03', success:66, failed:14},
          {date:'21-03', success:55, failed:16},
          {date:'22-03', success:70, failed:20}
        ],
        topFailures: [
          {title:'Dropped item', count:8, note:'My grip was not stable enough to hold onto the item'},
          {title:'Customer not found', count:8, note:'I could not detect the customer'}
        ]
      }
    }

    return {ok:true}
  }

  return {
    get: (p)=> request('GET', p),
    post: (p,d)=> request('POST', p, d)
  }
}
