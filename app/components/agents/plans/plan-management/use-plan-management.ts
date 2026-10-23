import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";

import { createRandomUuid } from "@/app/lib/random-uuid";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";

/** The dialogs of the plan menu. */
export type PlanManagementDialog = "create" | "edit" | "clone" | "delete";

/** The request of a create, clone or delete dialog, without its key. */
export type PlanManagementRequest = Readonly<Record<string, string>>;

/**
 * The open dialog of the plan menu and the requests of its dialogs.
 *
 * @remarks
 * Creating and cloning open the new plan once the server stored it; deleting
 * is answered by the server with the plan that opens next. The editor's own
 * unsaved changes are never saved here; leaving the plan asks first.
 */
export function usePlanManagement(): {
  readonly dialog: PlanManagementDialog | null;
  readonly open: (dialog: PlanManagementDialog) => void;
  readonly close: () => void;
  readonly submit: (request: PlanManagementRequest, key: string) => void;
  readonly isPending: boolean;
  /** The refusal of the last request, as an error code. */
  readonly error: string | null;
} {
  const fetcher = useFetcher<AgentPlanActionResult>();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<PlanManagementDialog | null>(null);
  const [answered, setAnswered] = useState<AgentPlanActionResult | null>(null);
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  useEffect(() => {
    if (!result?.ok || !result.planId) return;
    if (result.intent !== "create-plan" && result.intent !== "clone-plan")
      return;
    setDialog(null);
    void navigate(`/agents/plans?planId=${encodeURIComponent(result.planId)}`);
  }, [result, navigate]);
  function submit(request: PlanManagementRequest, key: string): void {
    setAnswered(null);
    void fetcher.submit(
      { ...request, requestKey: key },
      { method: "post", action: "/agents/plans", flushSync: true },
    );
  }
  function open(next: PlanManagementDialog): void {
    setAnswered(result ?? null);
    setDialog(next);
  }
  const error =
    result && result !== answered && !result.ok ? result.error : null;
  return {
    dialog,
    open,
    close: () => setDialog(null),
    submit,
    isPending: fetcher.state !== "idle",
    error,
  };
}

/**
 * A key for one request of a dialog: the same content keeps its key.
 *
 * @remarks
 * A double click or a repeat after a lost answer sends the same key, which
 * the server answers with the first result. Changed content is another
 * request and gets a new key.
 */
export function useRequestKey(content: string): string {
  const [entry, setEntry] = useState(() => ({
    content,
    key: createRandomUuid(),
  }));
  if (entry.content !== content) {
    const next = { content, key: createRandomUuid() };
    setEntry(next);
    return next.key;
  }
  return entry.key;
}
