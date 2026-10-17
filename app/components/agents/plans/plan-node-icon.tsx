import {
  Bot,
  Boxes,
  Braces,
  CircleStop,
  Play,
  Ticket,
  Variable,
} from "lucide-react";

import type { AgentPlanNode } from "@/definition/AgentPlan";

const NODE_ICONS = {
  agent: Bot,
  group: Boxes,
  task: Ticket,
  parameter: Braces,
  variable: Variable,
  start: Play,
  end: CircleStop,
};

/** Node types have distinct symbols as well as their semantic color and label. */
export function PlanNodeIcon(props: {
  readonly type: AgentPlanNode["type"];
  readonly className?: string;
}): React.ReactElement {
  const Icon = NODE_ICONS[props.type];
  return <Icon aria-hidden="true" className={props.className ?? "size-4"} />;
}
