import { PlanList } from '../components/PlanList'
import { Panel } from '../components/ui'

export function PlansPage() {
  return (
    <div className="grid gap-4">
      <p className="text-xs text-gray-400">
        Pending plans from this UI and from agents (MCP). Review the diff, then confirm. Plans are immutable, and a plan that was made
        before another change is stale and cannot be applied.
      </p>
      <Panel title="pending plans" id="plans">
        <PlanList emptyText="No pending plans. Plans an agent creates over MCP appear here within a few seconds." />
      </Panel>
    </div>
  )
}
