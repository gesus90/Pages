import {
  Bot,
  Boxes,
  Braces,
  FlagTriangleRight,
  Play,
  Variable,
} from "lucide-react";

import type { AgentPlanNode } from "@/definition/AgentPlan";

/**
 * A ticket outline with a notch on either side and no perforation.
 *
 * @remarks
 * Drawn like the lucide icons it sits beside: a 24 unit box, a 2 unit
 * stroke in the current color.
 */
export function PlanTicketIcon(props: {
  readonly className?: string;
}): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v2a3.5 3.5 0 0 0 0 7v2a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-2a3.5 3.5 0 0 0 0-7v-2A2.5 2.5 0 0 1 4.5 4Z" />
    </svg>
  );
}

/** Angle brackets around a slash, the code symbol of script nodes, drawn like the lucide icons. */
export function PlanScriptIcon(props: {
  readonly className?: string;
}): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
    </svg>
  );
}

const NODE_ICONS = {
  agent: Bot,
  script: PlanScriptIcon,
  group: Boxes,
  task: PlanTicketIcon,
  parameter: Braces,
  variable: Variable,
  start: Play,
  end: FlagTriangleRight,
};

/** Node types have distinct symbols as well as their semantic color and label. */
export function PlanNodeIcon(props: {
  readonly type: AgentPlanNode["type"];
  readonly className?: string;
}): React.ReactElement {
  const Icon = NODE_ICONS[props.type];
  return <Icon aria-hidden="true" className={props.className ?? "size-4"} />;
}
