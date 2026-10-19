import { useState } from "react";

import { fetchPlanTemplates } from "./plan-template-requests";

import type { AgentPlanNodeTemplate } from "@/definition/AgentPlanNodeTemplate";

/** The person's templates as far as they are known. */
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

/** Loads the templates when the tab first needs them, and again on request. */
export function usePlanTemplateList(): PlanTemplateList {
  const [status, setStatus] = useState<PlanTemplateList["status"]>("idle");
  const [templates, setTemplates] = useState<readonly AgentPlanNodeTemplate[]>(
    [],
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  async function read(): Promise<void> {
    setStatus("loading");
    try {
      setTemplates(await fetchPlanTemplates());
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
    templates,
    savedId,
    load: () => void read(),
    add,
  };
}
