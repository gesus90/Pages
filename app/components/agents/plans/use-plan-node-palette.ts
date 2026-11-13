import { useReactFlow } from "@xyflow/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { planDropGroup } from "./plan-layout";

import type { TFunction } from "i18next";
import type { AgentPlanNode, AgentPlanPosition } from "@/definition/AgentPlan";
import type { AgentPlanScriptConfiguration } from "@/definition/AgentPlanScript";
import type { PlanCanvasProps } from "./plan-flow-context";

/** Legacy variables and the removed Git closeout (PAGE-285) stay readable but are never added. */
export type PlanPaletteKind = Exclude<
  AgentPlanNode["type"],
  "variable" | "git_closeout"
>;

/** The node types the palette adds at once, because they need no choice. */
type PlanImmediateKind =
  "start" | "end" | "loop" | "decision" | "stack" | "asset" | "swarm";

const IMMEDIATE_KINDS: readonly PlanPaletteKind[] = [
  "start",
  "end",
  "loop",
  "decision",
  "stack",
  "asset",
  "swarm",
];

function isImmediateKind(kind: PlanPaletteKind): kind is PlanImmediateKind {
  return IMMEDIATE_KINDS.includes(kind);
}

/** An unconfirmed choice never enters the draft. Its position survives the source dialog. */
export interface PlanPaletteRequest {
  readonly kind: Exclude<PlanPaletteKind, PlanImmediateKind>;
  readonly position?: AgentPlanPosition;
}

/** The name an immediately added container starts with. */
function immediateName(kind: PlanImmediateKind, translate: TFunction): string {
  if (kind === "loop") return translate("plans.loops.defaultName");
  if (kind === "asset") return translate("plans.asset.defaultName");
  return kind === "stack" ? translate("plans.stack.defaultName") : "";
}

/** Why the palette cannot add a node now, or `null`. */
function paletteBlock(
  canvas: PlanCanvasProps,
  translate: TFunction,
): string | null {
  if (!canvas.draft.workspaceId)
    return translate("plans.palette.workspaceRequired");
  return canvas.canEdit ? null : translate("plans.palette.editBlocked");
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
  const blocked = paletteBlock(canvas, t);
  function insert(kind: PlanPaletteKind, position?: AgentPlanPosition): void {
    if (blocked) return;
    if (isImmediateKind(kind)) {
      // A decision dropped on a group or loop stands in it (PAGE-286).
      const frame =
        kind === "decision" && position
          ? planDropGroup(canvas.draft, position, canvas.sources, null)
          : null;
      canvas.graph.add(kind, immediateName(kind, t), position, frame?.id);
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
    const frame = request.position
      ? planDropGroup(canvas.draft, request.position, canvas.sources, null)
      : null;
    canvas.graph.addScript(configuration, request.position, frame?.id);
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
