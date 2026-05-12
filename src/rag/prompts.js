/**
 * Prompt templates for AI caption generation.
 * Numbers are computed deterministically and injected as facts.
 * The LLM handles phrasing only.
 */

const TERM_SLUGS = [
  'gripper', 'sam3', 'molmo', 'grasp-synthesis', 'trajectory', 'anchor',
  'depth-offset', 'standoff', 'handover', 'e-stop', 'close-up', 'detection',
  'fanuc', 'curobo', 'intervention',
]

const SYSTEM = `You are ROBI's assistant, writing short operational summaries for supermarket employees who monitor a grocery-picking robot. Write in plain, friendly English. Use "ROBI" to refer to the robot. Wrap technical terms from this list in [[slug]] brackets when you use them: ${TERM_SLUGS.join(', ')}. Cite specific orders as [cite:N] when relevant. Keep responses concise.`

function weeklyPrompt(stats) {
  const items = stats.itemRanking.map(([item, count]) => `${item} (${count})`).join(', ')
  return {
    system: SYSTEM,
    user: `Write a 2-paragraph weekly summary for the ops team.

Facts you must use accurately:
- Orders this week: ${stats.total} (${stats.success} delivered, ${stats.failed} failed)
- Date range: ${stats.startDate} to ${stats.endDate}
- Average fetch time: ${stats.avgTime} seconds (${stats.avgRobotTime}s robot work)
- Median fetch time: ${stats.medianTime} seconds
- Items handled: ${items}
${stats.busiestDay ? `- Busiest day: ${stats.busiestDay.date} with ${stats.busiestDay.count} orders` : ''}
${stats.slowest ? `- Slowest order: #${stats.slowest.id} (${stats.slowest.item}, ${stats.slowest.total_seconds}s)` : ''}
${Object.keys(stats.failures).length > 0 ? `- Failures: ${Object.entries(stats.failures).map(([r, c]) => `${r}: ${c}`).join(', ')}` : '- No failures this week'}

Keep it to 2 short paragraphs. First paragraph: headline performance. Second: notable details or patterns.`,
  }
}

function chartPrompt(stats) {
  const items = stats.itemRanking.slice(0, 5).map(([item, count]) => `${item} (${count})`).join(', ')
  return {
    system: SYSTEM,
    user: `Write a 1-2 sentence caption for a daily activity chart.

Facts:
- Period: ${stats.startDate} to ${stats.endDate}
- Total orders: ${stats.total} (${stats.success} delivered, ${stats.failed} failed)
- Average fetch time: ${stats.avgTime}s
- Top items: ${items}
${stats.busiestDay ? `- Busiest day: ${stats.busiestDay.date} (${stats.busiestDay.count} orders)` : ''}

Be brief — this sits below a chart that already shows the data visually.`,
  }
}

function ordersListPrompt(stats, statusFilter) {
  return {
    system: SYSTEM,
    user: `Write a 1-sentence summary for the orders list section.

Facts:
- Showing: ${statusFilter || 'all'} orders from ${stats.startDate} to ${stats.endDate}
- Count: ${stats.total} orders (${stats.success} delivered, ${stats.failed} failed)
- Average time: ${stats.avgTime}s

One sentence only. Don't repeat what the filters already show.`,
  }
}

function orderDetailPrompt(order) {
  const steps = (order.steps || []).map(s =>
    `${s.friendly_name}: ${s.duration_seconds}s${Object.keys(s.meta || {}).length > 0 ? ` (${JSON.stringify(s.meta)})` : ''}`
  ).join('\n  ')

  return {
    system: SYSTEM,
    user: `An employee tapped "Why so long? Ask ROBI" on order #${order.id}.

Order details:
- Item: ${order.item}
- Status: ${order.status}${order.failure ? ` — ${order.failure.reason}: ${order.failure.detail}` : ''}
- Total time: ${order.total_seconds}s (robot: ${order.robot_seconds || '?'}s, human wait: ${order.human_wait_seconds || '?'}s)
- Steps:
  ${steps}

Explain in 2-3 sentences why this order took the time it did. Reference specific phases and numbers. If it failed, explain what went wrong.`,
  }
}

function chatPrompt(messages, context) {
  return {
    system: SYSTEM + `\n\nYou have access to order data. When answering, cite order IDs as [cite:N]. Here is relevant context:\n${context}`,
    messages,
  }
}

module.exports = { weeklyPrompt, chartPrompt, ordersListPrompt, orderDetailPrompt, chatPrompt, SYSTEM }
