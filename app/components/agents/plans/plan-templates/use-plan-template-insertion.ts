import { useReactFlow } from "@xyflow/react";
import { useRef, useState } from "react";

import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { allPlanSteps } from "@/definition/AgentPlanGroup";

import { planDropGroup } from "../plan-layout";
import { insertPlanTemplate } from "./plan-template-requests";

import type { AgentPlanPosition } from "@/definition/AgentPlan";
import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";
import type { PlanCanvasProps } from "../plan-flow-context";

const DRAG_TYPE = "application/x-pages-plan-template";
// Inputs whose value is missing after outer connections stayed behind.
const OPEN_INPUT_REASONS = new Set([
  "required",
  "resultMissing",
  "resultAmbiguous",
]);

/** What the last insertion of a template led to. */
export type PlanTemplateOutcome =
  | {
      readonly kind: "inserted";
      readonly name: string;
      /** Inputs of the copy that still need a value or connection. */
      readonly openInputs: readonly string[];
    }
  | { readonly kind: "failed"; readonly name: string; readonly error: string };

/** Inserting templates by click, keyboard and drag and drop. */
export interface PlanTemplateInsertion {
  readonly pendingId: string | null;
  readonly outcome: PlanTemplateOutcome | null;
  readonly activate: (template: AgentPlanNodeTemplate) => void;
  readonly dragStart: (
    event: React.DragEvent,
    template: AgentPlanNodeTemplate,
  ) => void;
  readonly dragEnd: () => void;
  readonly dragOver: (event: React.DragEvent) => void;
  readonly drop: (event: React.DragEvent) => void;
  readonly dismiss: () => void;
}

/** The inputs of a copy that the plan would refuse to run without. */
function openInputs(
  canvas: PlanCanvasProps,
  node: AgentPlanTemplateNode,
): readonly string[] {
  const plan = { ...canvas.draft, nodes: [...canvas.draft.nodes, node] };
  const ids = new Set([
    node.id,
    ...allPlanSteps({ ...plan, nodes: [node] }).map((step) => step.id),
  ]);
  const names = planExecutionIssues(plan, canvas.sources.agents).flatMap(
    (issue) =>
      issue.nodeId !== null &&
      ids.has(issue.nodeId) &&
      issue.port !== null &&
      OPEN_INPUT_REASONS.has(issue.reason)
        ? [issue.port]
        : [],
  );
  return [...new Set(names)];
}

/**
 * Inserts checked copies of templates into the edited plan.
 *
 * @remarks
 * The server checks the plan, the rights and every reference first; a
 * refusal names its reason and inserts nothing. Inserting never starts a
 * run, saves the plan or moves the viewport.
 */
export function usePlanTemplateInsertion(
  canvas: PlanCanvasProps,
  blocked: string | null,
): PlanTemplateInsertion {
  const flow = useReactFlow();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PlanTemplateOutcome | null>(null);
  const dragged = useRef<AgentPlanNodeTemplate | null>(null);
  const suppressClick = useRef(false);
  async function insert(
    template: AgentPlanNodeTemplate,
    position?: AgentPlanPosition,
  ): Promise<void> {
    if (blocked || pendingId) return;
    setPendingId(template.id);
    setOutcome(null);
    const result = await insertPlanTemplate(
      { planId: canvas.planId ?? "", workspaceId: canvas.draft.workspaceId },
      template.id,
    );
    setPendingId(null);
    if (!result.ok) {
      setOutcome({ kind: "failed", name: template.name, error: result.error });
      return;
    }
    const node = result.value;
    const group =
      node.type === "agent" && position
        ? planDropGroup(canvas.draft, position, canvas.sources, null)
        : null;
    if (canvas.graph.insertTemplate(node, position, group?.id) === null) return;
    setOutcome({
      kind: "inserted",
      name: template.name,
      openInputs: openInputs(canvas, node),
    });
  }
  function activate(template: AgentPlanNodeTemplate): void {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    void insert(template);
  }
  function dragStart(
    event: React.DragEvent,
    template: AgentPlanNodeTemplate,
  ): void {
    if (blocked || pendingId) {
      event.preventDefault();
      return;
    }
    dragged.current = template;
    suppressClick.current = true;
    event.dataTransfer.setData(DRAG_TYPE, template.id);
    event.dataTransfer.effectAllowed = "copy";
  }
  function dragEnd(): void {
    dragged.current = null;
    // Native drag does not dispatch click; clear on the next task for later keyboard use.
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }
  function dragOver(event: React.DragEvent): void {
    if (!dragged.current || blocked) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
  function drop(event: React.DragEvent): void {
    const template = dragged.current;
    dragged.current = null;
    if (!template || blocked) return;
    event.preventDefault();
    void insert(
      template,
      flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
  }
  return {
    pendingId,
    outcome,
    activate,
    dragStart,
    dragEnd,
    dragOver,
    drop,
    dismiss: () => setOutcome(null),
  };
}
