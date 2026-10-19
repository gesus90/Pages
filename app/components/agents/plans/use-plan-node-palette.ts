import { useReactFlow } from "@xyflow/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { planDropGroup } from "./plan-layout";

import type { AgentPlanNode, AgentPlanPosition } from "@/definition/AgentPlan";
import type { AgentPlanScriptConfiguration } from "@/definition/AgentPlanScript";
import type { PlanCanvasProps } from "./plan-flow-context";

export type PlanPaletteKind = Exclude<AgentPlanNode["type"], "variable">;

/** An unconfirmed choice never enters the draft. Its position survives the source dialog. */
export interface PlanPaletteRequest {
  readonly kind: Exclude<PlanPaletteKind, "start" | "end">;
  readonly position?: AgentPlanPosition;
}

/** Shares native drag and keyboard insertion through the existing graph actions. */
export function usePlanNodePalette(canvas: PlanCanvasProps): {
  readonly request: PlanPaletteRequest | null;
  readonly blocked: string | null;
  readonly activate: (kind: PlanPaletteKind) => void;
  readonly dragStart: (event: React.DragEvent, kind: PlanPaletteKind) => void;
  readonly dragEnd: () => void;
  readonly dragOver: (event: React.DragEvent) => void;
  readonly drop: (event: React.DragEvent) => void;
  readonly confirm: (reference: string) => void;
  /** Adds the script the script dialog configured, where the request asked for it. */
  readonly confirmScript: (configuration: AgentPlanScriptConfiguration) => void;
  readonly close: () => void;
} {
  const { t } = useTranslation();
  const flow = useReactFlow();
  const [request, setRequest] = useState<PlanPaletteRequest | null>(null);
  const dragged = useRef<PlanPaletteKind | null>(null);
  const suppressClick = useRef(false);
  let blocked: string | null = null;
  if (!canvas.draft.workspaceId) blocked = t("plans.palette.workspaceRequired");
  else if (!canvas.canEdit) blocked = t("plans.palette.editBlocked");
  function insert(kind: PlanPaletteKind, position?: AgentPlanPosition): void {
    if (blocked) return;
    if (kind === "start" || kind === "end") {
      canvas.graph.add(kind, "", position);
      return;
    }
    setRequest({ kind, position });
  }
  function activate(kind: PlanPaletteKind): void {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    insert(kind);
  }
  function dragStart(event: React.DragEvent, kind: PlanPaletteKind): void {
    if (blocked) {
      event.preventDefault();
      return;
    }
    dragged.current = kind;
    suppressClick.current = true;
    event.dataTransfer.setData("application/x-pages-plan-node", kind);
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
    const kind = dragged.current;
    dragged.current = null;
    if (!kind || blocked) return;
    event.preventDefault();
    insert(
      kind,
      flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
  }
  function confirm(reference: string): void {
    if (!request || blocked || request.kind === "script") return;
    const group =
      request.kind === "agent" && request.position
        ? planDropGroup(canvas.draft, request.position, canvas.sources, null)
        : null;
    canvas.graph.add(request.kind, reference, request.position, group?.id);
    setRequest(null);
  }
  function confirmScript(configuration: AgentPlanScriptConfiguration): void {
    if (request?.kind !== "script" || blocked) return;
    canvas.graph.addScript(configuration, request.position);
    setRequest(null);
  }
  return {
    request,
    blocked,
    activate,
    dragStart,
    dragEnd,
    dragOver,
    drop,
    confirm,
    confirmScript,
    close: () => setRequest(null),
  };
}
