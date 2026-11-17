import {
  ArrowRightFromLine,
  ArrowRightToLine,
  Bot,
  Boxes,
  Braces,
  File,
  FlagTriangleRight,
  GitFork,
  GitPullRequestArrow,
  Layers,
  Network,
  Play,
  Repeat2,
  Send,
  Variable,
} from "lucide-react";

import type { AgentPlanNode } from "@/definition/AgentPlan";

/**
 * A ticket outline with a notch on either side and no perforation.
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
  git_closeout: GitPullRequestArrow,
  group: Boxes,
  loop: Repeat2,
  decision: GitFork,
  stack: Layers,
  swarm: Network,
  task: PlanTicketIcon,
  parameter: Braces,
  variable: Variable,
  asset: File,
  start: Play,
  end: FlagTriangleRight,
  jump: ArrowRightFromLine,
  signal: Send,
};

/**
 * Node types have distinct symbols as well as their semantic color and label.
 * @remarks
 * A Jump shows its direction by its arrow, never by its colour: an arrow
 * leaving the line for a call, an arrow entering it for a receiving entry.
 * Without a direction a Jump is a call.
 */
export function PlanNodeIcon(props: {
  readonly type: AgentPlanNode["type"];
  readonly direction?: "in" | "out";
  readonly className?: string;
}): React.ReactElement {
  const Icon =
    props.type === "jump" && props.direction === "in"
      ? ArrowRightToLine
      : NODE_ICONS[props.type];
  return <Icon aria-hidden="true" className={props.className ?? "size-4"} />;
}
