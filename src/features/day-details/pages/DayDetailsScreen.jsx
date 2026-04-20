import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import DaySummaryCard from '../components/DaySummaryCard'
import OrderListItem from '../components/OrderListItem'
import SectionHeader from '../../../components/ui/SectionHeader'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import useDayDetails from '../../../hooks/useDayDetails'

export default function DayDetailsScreen() {
  const { dayId } = useParams()
  const navigate = useNavigate()
  const { data, loading, error } = useDayDetails(dayId)

  const topLeft = (
    <button className="back-btn" onClick={() => navigate(-1)} aria-label="Go back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6"/></svg>
      Back
    </button>
  )

  return (
    <>
      <TopBar left={topLeft} center="Day Details" right={<div />} />
      <ScreenContainer>
        {loading && <LoadingState />}
        {error && <ErrorState />}
        {data && (
          <>
            <DaySummaryCard
              dateLabel={data.dateLabel}
              attentionLabel={data.attentionLabel}
              ordersReceived={data.ordersReceived}
              failureCount={data.failureCount}
            />
            <div className="mt-lg">
              <SectionHeader title="Individual Orders" />
              <div className="order-list">
                {data.orders.map(order => (
                  <OrderListItem key={order.id} order={order} />
                ))}
              </div>
            </div>
          </>
        )}
      </ScreenContainer>
    </>
  )
}
