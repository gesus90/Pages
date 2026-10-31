import { useCallback, useEffect, useRef } from "react";

import { planDraftContents } from "./use-plan-draft";

import type { useFetcher } from "react-router";
import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanInput } from "@/definition/AgentPlan";

type PlanCommand = ReturnType<typeof useFetcher<AgentPlanActionResult>>;

/** Whether the command on its way is a save of the plan, not a run command. */
export function isSaveCommand(command: PlanCommand): boolean {
  return command.formData?.get("intent") === "save-plan";
}

/**
 * Sends the draft as the next revision, one request at a time.
 *
 * @remarks
 * A save asked for while another one is on its way is not dropped and not
 * sent beside it: the second request would carry the revision the first one
 * is about to replace and be refused as a conflict with the person's own
 * save. It waits instead and is sent with the newest draft and the revision
 * the first answer stored. A refused save drops the waiting one, so the
 * refusal is shown instead of being overtaken by another attempt.
 *
 * @returns The function that saves a draft or lets the save wait its turn.
 */
export function usePlanSubmission(input: {
  readonly command: PlanCommand;
  readonly planId: string;
  readonly currentDraft: () => AgentPlanInput;
  readonly submitted: React.RefObject<AgentPlanInput | null>;
}): (draft: AgentPlanInput) => void {
  const { command, planId, currentDraft, submitted } = input;
  const { submit, state, data: answer } = command;
  // A request counts as running from the call on, before React shows the fetcher as submitting.
  const isRunning = useRef(false);
  const isWaiting = useRef(false);
  const sent = useRef(0);
  const send = useCallback(
    (draft: AgentPlanInput): void => {
      const token = ++sent.current;
      isRunning.current = true;
      submitted.current = draft;
      void submit(
        { intent: "save-plan", planId, plan: JSON.stringify(draft) },
        { method: "post", action: "/agents/plans", flushSync: true },
      ).finally(() => {
        // A request that never reached the server must not keep later saves waiting.
        if (sent.current === token) isRunning.current = false;
      });
    },
    [submit, planId, submitted],
  );
  useEffect(() => {
    if (state === "submitting") return;
    isRunning.current = false;
    if (!isWaiting.current) return;
    isWaiting.current = false;
    if (answer?.intent !== "save-plan" || !answer.ok) return;
    const next = currentDraft();
    if (
      planDraftContents(next) !== planDraftContents(submitted.current ?? next)
    )
      send(next);
  }, [state, answer, currentDraft, submitted, send]);
  return useCallback(
    (draft: AgentPlanInput): void => {
      if (isRunning.current) isWaiting.current = true;
      else send(draft);
    },
    [send],
  );
}
