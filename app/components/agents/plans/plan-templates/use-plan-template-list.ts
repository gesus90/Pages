import { useState } from "react";

import { fetchPlanTemplates } from "./plan-template-requests";

import type { AgentPlanNodeTemplate } from "@/definition/AgentPlanNodeTemplate";

/** The templates the person works with as far as they are known. */
export interface PlanTemplateList {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly templates: readonly AgentPlanNodeTemplate[];
  /** The template saved last in this editor, marked in the list. */
  readonly savedId: string | null;
  /** Reads the list again; a failure keeps no stale entries. */
  readonly load: () => void;
  /** Puts a template that was just saved at the top and marks it. */
  readonly add: (template: AgentPlanNodeTemplate) => void;
}

/**
 * Loads the templates when the tab first needs them, and again on request.
 *
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
  async function read(): Promise<void> {
    setLoadedFor(workspaceId);
    setStatus("loading");
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
  return {
    status,
    templates: status === "idle" ? [] : templates,
    savedId,
    load: () => void read(),
    add,
  };
}
