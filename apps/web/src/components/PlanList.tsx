import type { ConfigPlan } from '@perifmcp/core'
import { useApp } from '../state/app'
import { PlanCard } from './PlanCard'

export function useVisiblePlans(): ConfigPlan[] {
  const { plans, dismissedPlanIds } = useApp()
  return plans.filter((p) => !dismissedPlanIds.has(p.id))
}

export function PlanList({ emptyText = 'No pending plans.' }: { emptyText?: string }) {
  const plans = useVisiblePlans()
  if (plans.length === 0) return <p className="text-xs text-gray-500">{emptyText}</p>
  return (
    <div className="grid gap-3">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </div>
  )
}
