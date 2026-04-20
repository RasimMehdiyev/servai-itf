export const historyMock = {
  selectedRange: '7d',
  successRate: 76,
  successCount: 51,
  failureCount: 16,
  performanceBars: [
    {label:'16-03', success:51, failure:16},
    {label:'17-03', success:35, failure:27},
    {label:'18-03', success:60, failure:10},
    {label:'19-03', success:62, failure:12},
    {label:'20-03', success:66, failure:14},
    {label:'21-03', success:55, failure:16},
    {label:'22-03', success:70, failure:20}
  ],
  topFailures: [
    {id:'f1', title:'Dropped item', count:8, trendPercent:12, trendDirection:'up', description:'My grip was not stable enough to hold onto the item'},
    {id:'f2', title:'Customer not found', count:8, trendPercent:25, trendDirection:'down', description:'I could not detect the customer'}
  ]
}
