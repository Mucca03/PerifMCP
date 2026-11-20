import { MacroEditor } from '../components/MacroEditor'
import { PlanList } from '../components/PlanList'
import { Panel } from '../components/ui'

export function MacrosPage() {
  return (
    <div className="grid gap-6">
      <MacroEditor />
      <Panel title="pending plans" id="plans">
        <PlanList />
      </Panel>
    </div>
  )
}
