import React from 'react'
import Card from '../../../components/ui/Card'
import AiCaption from './AiCaption'
import useRagCaption from '../../../hooks/useRagCaption'
import { useDataSource } from '../../../context/DataSourceContext'

export default function WeeklySummaryCard({ onCitationClick }) {
  const { recentOrders } = useDataSource()
  const cachedWeekly = recentOrders?.cached_weekly_caption || null

  const { caption, loading, error, stale, generate, refresh } = useRagCaption('weekly', {}, undefined, cachedWeekly)

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: 'var(--teal, #14b8a6)',
              animation: loading ? 'pulse 2s ease-in-out infinite' : 'none',
            }}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--teal, #0d9488)' }}>
            ROBI's weekly report
          </span>
        </div>
      </div>

      <AiCaption
        caption={caption}
        loading={loading}
        error={error}
        stale={stale}
        onCitationClick={onCitationClick}
        onGenerate={generate}
        onRefresh={refresh}
      />
    </Card>
  )
}
