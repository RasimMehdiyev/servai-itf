import React, { useMemo } from 'react'
import Card from '../../../components/ui/Card'
import CounterfactualBody from '../../../components/ui/CounterfactualView'
import { useDataSource } from '../../../context/DataSourceContext'
import { liveCounterfactual } from '../../../lib/counterfactual'

// "Heads-up" before a pick-up, "What could change this?" once a try has failed. It is always on screen: with nothing
// to say yet it just says "Thinking…".

export default function CounterfactualCard({ style }) {
  const { liveData, history } = useDataSource()
  const card = useMemo(() => liveCounterfactual(liveData, history), [liveData, history])
  return (
    <Card style={style}>
      <CounterfactualBody card={card} />
    </Card>
  )
}
