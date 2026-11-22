import { useState } from "react";

import {
  deletePlanTemplate,
  fetchPlanTemplates,
} from "./plan-template-requests";

import type { AgentPlanNodeTemplate } from "@/definition/AgentPlanNodeTemplate";

/** Where the deletion of one template stands: asked for, or refused by the server. */
export type PlanTemplateDeletion = "pending" | "failed";

/** The templates the person works with as far as they are known. */
export interface PlanTemplateList {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly templates: readonly AgentPlanNodeTemplate[];
  /** The template saved last in this editor, marked in the list. */
  readonly savedId: string | null;
  /** The templates whose deletion runs or failed, by identifier. */
  readonly deletions: Readonly<Record<string, PlanTemplateDeletion>>;
  /** Reads the list again; a failure keeps no stale entries. */
  readonly load: () => void;
  /** Puts a template that was just saved at the top and marks it. */
  readonly add: (template: AgentPlanNodeTemplate) => void;
  /**
   * Deletes a template on the server and drops it from the list once the
   * server confirmed it.
   * @returns Whether the server deleted it; a refusal keeps the entry and marks it failed.
   */
  readonly remove: (template: AgentPlanNodeTemplate) => Promise<boolean>;
}

/** The deletions without the one of a template. */
function withoutDeletion(
  deletions: Readonly<Record<string, PlanTemplateDeletion>>,
  templateId: string,
): Readonly<Record<string, PlanTemplateDeletion>> {
  return Object.fromEntries(
    Object.entries(deletions).filter(([id]) => id !== templateId),
  );
}

/**
 * Loads the templates when the tab first needs them, and again on request.
 * @param workspaceId - The workspace of the open plan. Its project decides
 * which shared templates are listed, so a list read for another workspace
 * counts as not loaded yet.
 */
export function usePlanTemplateList(workspaceId: string): PlanTemplateList {
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [state, setStatus] = useState<PlanTemplateList["status"]>("idle");
  const status = loadedFor === workspaceId ? state : "idle";
  const [templates, setTemplates] = useState<readonly AgentPlanNodeTemplate[]>(
    [],
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  const [deletions, setDeletions] = useState<
    Readonly<Record<string, PlanTemplateDeletion>>
  >({});
  async function read(): Promise<void> {
    setLoadedFor(workspaceId);
    setStatus("loading");
    setDeletions({});
    try {
      setTemplates(await fetchPlanTemplates(workspaceId));
      setStatus("ready");
    } catch (error: unknown) {
      console.error("Pages could not list the node templates.", error);
      setTemplates([]);
      setStatus("failed");
    }
  }
  function add(template: AgentPlanNodeTemplate): void {
    setTemplates((current) => [
      template,
      ...current.filter((entry) => entry.id !== template.id),
    ]);
    setSavedId(template.id);
  }
  async function remove(template: AgentPlanNodeTemplate): Promise<boolean> {
    if (!template.isOwn || deletions[template.id] === "pending") return false;
    setDeletions((current) => ({ ...current, [template.id]: "pending" }));
    const result = await deletePlanTemplate(
      { planId: "", workspaceId },
      template.id,
    );
    if (!result.ok) {
      console.warn("Pages could not delete the node template.", result.error);
      setDeletions((current) => ({ ...current, [template.id]: "failed" }));
      return false;
    }
    setTemplates((current) =>
      current.filter((entry) => entry.id !== template.id),
    );
    setDeletions((current) => withoutDeletion(current, template.id));
    setSavedId((current) => (current === template.id ? null : current));
    return true;
  }
  return {
    status,
    templates: status === "idle" ? [] : templates,
    savedId,
    deletions,
    load: () => void read(),
    add,
    remove,
  };
}
