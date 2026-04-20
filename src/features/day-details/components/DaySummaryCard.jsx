import React from 'react'
import Card from '../../../components/ui/Card'
import StatusChip from '../../../components/ui/StatusChip'
import MetricStat from '../../../components/ui/MetricStat'

export default function DaySummaryCard({ dateLabel, attentionLabel, ordersReceived, failureCount }) {
  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <div className="text-muted text-sm">{dateLabel}</div>
        <div className="mt-sm">
          <StatusChip label={attentionLabel} variant="warning" icon="⚠" />
        </div>
      </div>

      <div className="summary-row">
        <div className="summary-cell">
          <MetricStat value={ordersReceived} label="Orders received" />
        </div>
        <div className="summary-cell">
          <MetricStat value={failureCount} label="Failure" color="var(--danger)" />
        </div>
      </div>
    </Card>
  )
}
