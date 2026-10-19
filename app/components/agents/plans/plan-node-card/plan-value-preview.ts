import { findPlanStep } from "@/definition/AgentPlanGroupEdit";

import { planNodeLabel } from "../plan-layout";

import type { TFunction } from "i18next";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** What a card needs to name a value without reading more than the editor already shows. */
export interface PlanValueContext {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly translate: TFunction;
}

/**
 * Whether a typed value is empty, so that an input falls back to its default.
 *
 * @remarks
 * Unlike a check for usable input, text with only spaces is not empty, so
 * typing never loses a space.
 */
export function isEmptyPlanValue(value: AgentParameterValue): boolean {
  switch (value.type) {
    case "text":
      return value.text === "";
    case "number":
      return !Number.isFinite(value.number);
    case "ticket":
      return value.ticketId === "";
    case "workspace":
      return value.workspaceId === "";
    case "wiki":
      return value.pageId === "";
  }
}

/**
 * A short readable form of a typed value.
 *
 * @returns Ticket key and title or workspace name; a reference that is gone
 * or not readable is named as unavailable, without any of its content.
 */
export function planValuePreview(
  value: AgentParameterValue | null,
  context: PlanValueContext,
): string {
  if (value === null || isEmptyPlanValue(value)) return "";
  switch (value.type) {
    case "text":
      return value.text;
    case "number":
      return String(value.number);
    case "wiki":
      return value.pageId;
    case "ticket": {
      const task = context.sources.tasks.find(
        (entry) => entry.id === value.ticketId,
      );
      return task
        ? `${task.key}: ${task.title}`
        : context.translate("plans.ticketUnavailable");
    }
    case "workspace":
      return (
        context.workspaces.find((entry) => entry.id === value.workspaceId)
          ?.name ?? context.translate("plans.workspaceUnavailable")
      );
  }
}

/** Names the value source of a connected input: a value node, a ticket, a frame's port or a predecessor's result. */
export function planBindingPreview(
  binding: AgentPlanBinding,
  context: PlanValueContext,
): string {
  const { draft, sources, translate } = context;
  if (binding.kind === "literal")
    return planValuePreview(binding.value, context);
  if (binding.kind === "result") {
    const step =
      findPlanStep(draft, binding.stepId)?.step ??
      draft.nodes.find(
        (node) => node.type === "script" && node.id === binding.stepId,
      );
    return translate("plans.resultOf", {
      name: step ? planNodeLabel(step, sources) : binding.stepId,
    });
  }
  const source = draft.nodes.find((node) => node.id === binding.nodeId);
  if (source?.type === "parameter")
    return planValuePreview(source.value, context);
  if (source?.type === "task")
    return planValuePreview(
      { type: "ticket", ticketId: source.taskId },
      context,
    );
  if (source) return planNodeLabel(source, sources);
  const port = draft.nodes
    .flatMap((node) => (node.type === "group" ? node.parameters : []))
    .find((entry) => entry.id === binding.nodeId);
  return port
    ? translate("plans.groupPortValue", { name: port.name })
    : translate("plans.validation.source");
}
