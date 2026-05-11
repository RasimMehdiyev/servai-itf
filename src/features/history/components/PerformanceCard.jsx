import React, { useState, useMemo } from 'react'
import { LineChart } from '@mui/x-charts/LineChart'
import Card from '../../../components/ui/Card'

const FAIL_COLOR = '#fca5a5'
const SUCCESS_COLOR = '#88ffae'
const AXIS_COLOR = '#9ca3af'
const GRID_COLOR = '#e5e7eb'

const DATA_MIN = '2020-01-01'
const DATA_MAX = new Date().toISOString().slice(0, 10)

const INPUT_STYLE = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '5px 9px',
  fontSize: 12,
  color: 'var(--text-primary)',
  background: 'var(--bg)',
  outline: 'none',
  fontFamily: 'inherit',
  cursor: 'pointer',
  borderStyle: 'solid',
}

const TOGGLE_BASE = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '5px 12px',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
  fontWeight: 500,
  transition: 'all 0.15s ease',
}

export default function PerformanceCard({
  successCount, failureCount,
  bars = [],
  startDate, endDate, onDateChange, onDateClear,
  selectedDay, onDaySelect,
  chartMode, onChartModeChange,
}) {
  const isFail = chartMode === 'failures'
  const lineColor = isFail ? FAIL_COLOR : SUCCESS_COLOR
  const hasDateValue = startDate || endDate

  const AxisContent = useMemo(() => {
    return function AxisTooltipContent({ axisData, dataIndex }) {
      const idx = dataIndex ?? axisData?.x?.index
      if (idx == null) return null
      const bar = bars[idx]
      if (!bar) return null
      const date = new Date(bar.date + 'T12:00:00')
      const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      const value = isFail ? bar.failure : bar.success
      const label = isFail ? 'failure' : 'successful order'
      const color = isFail ? 'var(--danger)' : 'var(--success)'
      const breakdown = isFail
        ? Object.entries(bar.failuresByType || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
        : []
      return (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderStyle: 'solid',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 13,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          minWidth: 180,
          pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>{dateLabel}</div>
          <div style={{ color, fontWeight: 500, marginBottom: breakdown.length ? 8 : 0 }}>
            {value} {label}{value !== 1 ? 's' : ''}
          </div>
          {breakdown.map(([type, count]) => (
            <div key={type} style={{
              display: 'flex', justifyContent: 'space-between', gap: 20,
              color: 'var(--text-secondary)', fontSize: 12, marginBottom: 3,
            }}>
              <span>{type}</span>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{count}</span>
            </div>
          ))}
        </div>
      )
    }
  }, [bars, isFail])

  const interval = Math.max(1, Math.floor(bars.length / 7))
  const xIndices = bars.map((_, i) => i)
  const xValueFormatter = (i) => {
    if (i == null || !bars[i]) return ''
    if (i % interval !== 0 && i !== bars.length - 1) return ''
    const d = new Date(bars[i].date + 'T12:00:00')
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const yData = bars.map(b => isFail ? b.failure : b.success)

  const selectedIdx = selectedDay ? bars.findIndex(b => b.date === selectedDay) : -1

  function handleAxisClick(event, axisData) {
    const idx = axisData?.dataIndex
    if (idx == null) return
    const bar = bars[idx]
    if (bar && onDaySelect) onDaySelect(bar.date)
  }

  return (
    <Card>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 'clamp(16px,2.2vw,19px)', fontWeight: 600, margin: 0 }}>
          {isFail ? 'Failure Trend' : 'Success Trend'}
        </h2>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>{successCount} successful</span>
          <span style={{ color: 'var(--danger)' }}>{failureCount} failed</span>
        </div>
      </div>

      {/* Controls: toggle + date range picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 0 }}>
          <button
            onClick={() => onChartModeChange('failures')}
            style={{
              ...TOGGLE_BASE,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              borderRight: 'none',
              background: isFail ? 'var(--danger-bg)' : 'var(--surface)',
              color: isFail ? 'var(--danger)' : 'var(--text-secondary)',
              borderColor: isFail ? 'var(--danger)' : 'var(--border)',
            }}
          >
            Failures
          </button>
          <button
            onClick={() => onChartModeChange('successes')}
            style={{
              ...TOGGLE_BASE,
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              background: !isFail ? 'var(--success-bg)' : 'var(--surface)',
              color: !isFail ? 'var(--success)' : 'var(--text-secondary)',
              borderColor: !isFail ? 'var(--success)' : 'var(--border)',
            }}
          >
            Successful
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={startDate || ''}
            min={DATA_MIN}
            max={endDate || DATA_MAX}
            style={INPUT_STYLE}
            onChange={e => onDateChange({ startDate: e.target.value, endDate: endDate || '' })}
          />
          <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>→</span>
          <input
            type="date"
            value={endDate || ''}
            min={startDate || DATA_MIN}
            max={DATA_MAX}
            style={INPUT_STYLE}
            onChange={e => onDateChange({ startDate: startDate || '', endDate: e.target.value })}
          />
          {hasDateValue && (
            <button
              onClick={onDateClear}
              style={{
                border: '1px solid var(--border)',
                borderStyle: 'solid',
                borderRadius: 6,
                padding: '4px 9px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                background: 'var(--surface)',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div style={{ cursor: 'pointer', position: 'relative' }}>
        {selectedDay && (
          <div style={{ fontSize: 11, color: 'var(--primary)', textAlign: 'right', marginBottom: 2 }}>
            Showing {new Date(selectedDay + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {' — '}
            <span
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => onDaySelect && onDaySelect(selectedDay)}
            >
              clear
            </span>
          </div>
        )}
        <LineChart
          xAxis={[{
            data: xIndices,
            scaleType: 'point',
            valueFormatter: xValueFormatter,
            tickLabelStyle: { fill: AXIS_COLOR, fontSize: 11 },
            tickSize: 0,
            disableLine: true,
            disableTicks: true,
          }]}
          yAxis={[{
            tickLabelStyle: { fill: AXIS_COLOR, fontSize: 11 },
            tickSize: 0,
            disableLine: true,
            disableTicks: true,
          }]}
          series={[{
            data: yData,
            area: true,
            color: lineColor,
            showMark: ({ index }) => index === selectedIdx,
          }]}
          onAxisClick={handleAxisClick}
          height={220}
          margin={{ left: 32, right: 10, top: 10, bottom: 28 }}
          grid={{ horizontal: true }}
          sx={{
            '& .MuiAreaElement-root': { fillOpacity: 0.2 },
            '& .MuiChartsGrid-horizontalLine': { stroke: GRID_COLOR, strokeDasharray: '3 3' },
            '& .MuiChartsAxis-tickLabel': { fill: AXIS_COLOR },
            '& .MuiChartsAxis-line': { display: 'none' },
            '& .MuiChartsAxis-tick': { display: 'none' },
            '& .MuiLineElement-root': { strokeWidth: 2 },
            '& .MuiMarkElement-root': { fill: lineColor, stroke: 'var(--surface)', strokeWidth: 2, r: 5 },
            cursor: 'pointer',
          }}
          slotProps={{ legend: { hidden: true } }}
          slots={{ axisContent: AxisContent, itemContent: () => null }}
          tooltip={{ trigger: 'axis' }}
        />
      </div>
    </Card>
  )
}
