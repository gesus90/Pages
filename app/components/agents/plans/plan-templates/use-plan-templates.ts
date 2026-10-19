import { useState } from "react";

import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { isPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

import { usePlanPaletteView } from "../use-plan-palette-view";
import { usePlanTemplateInsertion } from "./use-plan-template-insertion";
import { usePlanTemplateList } from "./use-plan-template-list";

import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";
import type { PlanCanvasProps } from "../plan-flow-context";
import type { PlanPaletteView } from "../use-plan-palette-view";
import type { PlanTemplateInsertion } from "./use-plan-template-insertion";
import type { PlanTemplateList } from "./use-plan-template-list";

/** The palette's tabs, the saved templates and the open save dialog of one editor. */
export interface PlanTemplates {
  readonly view: PlanPaletteView;
  readonly list: PlanTemplateList;
  readonly insertion: PlanTemplateInsertion;
  /** The node whose configuration the save dialog names, or `null`. */
  readonly saving: AgentPlanTemplateNode | null;
  /** Opens the save dialog for a parameter, agent or group node of the draft. */
  readonly requestSave: (nodeId: string) => void;
  readonly closeSave: () => void;
  /** Shows a template that was just saved at the top of the templates tab. */
  readonly saved: (template: AgentPlanNodeTemplate) => void;
}

/**
 * Saving node configurations as templates and inserting them again.
 *
 * @remarks
 * The dialog takes the node as the draft holds it at that moment, members
 * of a group included; neither saving nor inserting starts a run.
 */
export function usePlanTemplates(
  canvas: PlanCanvasProps,
  blocked: string | null,
): PlanTemplates {
  const view = usePlanPaletteView();
  const list = usePlanTemplateList(canvas.draft.workspaceId);
  const insertion = usePlanTemplateInsertion(canvas, blocked);
  const [saving, setSaving] = useState<AgentPlanTemplateNode | null>(null);
  function requestSave(nodeId: string): void {
    if (!canvas.canEdit) return;
    const node =
      findPlanStep(canvas.draft, nodeId)?.step ??
      canvas.draft.nodes.find((entry) => entry.id === nodeId);
    if (node && isPlanTemplateNode(node)) setSaving(structuredClone(node));
  }
  function saved(template: AgentPlanNodeTemplate): void {
    setSaving(null);
    if (list.status === "idle") list.load();
    list.add(template);
    view.showTemplates();
  }
  return {
    view,
    list,
    insertion,
    saving,
    requestSave,
    closeSave: () => setSaving(null),
    saved,
  };
}
