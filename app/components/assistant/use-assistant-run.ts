import { useEffect, useRef, useState } from "react";

import {
  AssistantClientError,
  assistantApi,
  assistantErrorCode,
  readAssistantResult,
} from "@/app/lib/text-assistant-client";

import type {
  AssistantEditorTarget,
  BlockEditorHandle,
} from "@/app/components/editor/block-editor-types";
import type {
  TextAssistantContext,
  TextAssistantRequest,
  TextAssistantResult,
} from "@/definition/TextAssistant";

/** A complete suggestion keeps its original request and target until accepted or discarded. */
export interface AssistantProposal {
  readonly result: TextAssistantResult;
  readonly request: TextAssistantRequest;
  readonly target: AssistantEditorTarget;
}

export interface AssistantRunState {
  readonly isRunning: boolean;
  readonly proposal: AssistantProposal | null;
  readonly error: string;
  readonly isApplied: boolean;
  readonly send: (input: {
    readonly request: TextAssistantRequest;
    readonly target: AssistantEditorTarget;
    readonly autoApply: boolean;
  }) => Promise<void>;
  readonly apply: () => Promise<void>;
  readonly discard: () => void;
  readonly cancel: () => Promise<void>;
}

interface RunOptions {
  readonly context: TextAssistantContext;
  readonly handle: React.RefObject<BlockEditorHandle | null>;
  readonly maximumLength: number;
  readonly onComplete: (id: string) => Promise<void>;
}

interface PendingRequest {
  readonly id: string;
  readonly controller: AbortController;
}

function useRequestLifecycle(
  contextKey: string,
  reset: {
    readonly setProposal: (proposal: AssistantProposal | null) => void;
    readonly setError: (error: string) => void;
    readonly setIsApplied: (applied: boolean) => void;
    readonly setIsRunning: (running: boolean) => void;
  },
): {
  readonly pending: React.RefObject<PendingRequest | null>;
  readonly currentKey: React.RefObject<string>;
} {
  const pending = useRef<PendingRequest | null>(null);
  const currentKey = useRef(contextKey);
  currentKey.current = contextKey;
  const { setProposal, setError, setIsApplied, setIsRunning } = reset;
  useEffect(() => {
    setProposal(null);
    setError("");
    setIsApplied(false);
    setIsRunning(false);
    return () => {
      const request = pending.current;
      pending.current = null;
      if (request) {
        request.controller.abort();
        void assistantApi({ intent: "cancel", id: request.id }).catch(
          () => undefined,
        );
      }
    };
  }, [contextKey, setProposal, setError, setIsApplied, setIsRunning]);

  return { pending, currentKey };
}

function requireMatchingResult(
  result: TextAssistantResult,
  request: TextAssistantRequest,
): void {
  if (
    result.requestId !== request.requestId ||
    result.context.id !== request.context.id ||
    result.context.kind !== request.context.kind ||
    result.context.version !== request.context.version ||
    result.change !== request.change
  )
    throw new AssistantClientError("invalidOutput");
}

async function applyToEditor(
  next: AssistantProposal,
  options: {
    readonly currentKey: React.RefObject<string>;
    readonly handle: React.RefObject<BlockEditorHandle | null>;
    readonly maximumLength: number;
  },
): Promise<void> {
  const { currentKey, handle, maximumLength } = options;
  if (
    currentKey.current !==
      `${next.request.context.kind}:${next.request.context.id}` ||
    handle.current?.getMarkdown() !== next.target.documentMarkdown
  )
    throw new AssistantClientError("versionConflict");
  await assistantApi({ intent: "validate", request: next.request });
  if (
    currentKey.current !==
      `${next.request.context.kind}:${next.request.context.id}` ||
    next.result.change === "answer" ||
    !handle.current?.applyAssistantText?.({
      target: next.target,
      text: next.result.text,
      scope: next.request.scope,
      kind: next.result.change,
      maximumLength,
      lengthUnit:
        next.request.context.kind === "ticket" ? "codeUnit" : "codePoint",
    })
  )
    throw new AssistantClientError("versionConflict");
}

/** Guards asynchronous completion and local application against context/draft changes. */
export function useAssistantRun({
  context,
  handle,
  maximumLength,
  onComplete,
}: RunOptions): AssistantRunState {
  const [isRunning, setIsRunning] = useState(false);
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [error, setError] = useState("");
  const [isApplied, setIsApplied] = useState(false);
  const contextKey = `${context.kind}:${context.id}`;
  const { pending, currentKey } = useRequestLifecycle(contextKey, {
    setProposal,
    setError,
    setIsApplied,
    setIsRunning,
  });

  async function applyProposal(next: AssistantProposal): Promise<void> {
    await applyToEditor(next, { currentKey, handle, maximumLength });
    setIsApplied(true);
    setProposal(null);
  }

  async function send(input: {
    readonly request: TextAssistantRequest;
    readonly target: AssistantEditorTarget;
    readonly autoApply: boolean;
  }): Promise<void> {
    if (pending.current !== null) return;
    const controller = new AbortController();
    pending.current = { id: input.request.requestId, controller };
    setIsRunning(true);
    setError("");
    setProposal(null);
    setIsApplied(false);
    try {
      const response = await assistantApi(
        { intent: "run", request: input.request },
        controller.signal,
      );
      if (controller.signal.aborted || currentKey.current !== contextKey)
        return;
      const result = readAssistantResult(response.result);
      requireMatchingResult(result, input.request);
      const next = { request: input.request, target: input.target, result };
      setProposal(next);
      await onComplete(result.conversationId);
      if (
        input.autoApply &&
        result.change !== "answer" &&
        !controller.signal.aborted
      )
        await applyProposal(next);
    } catch (failure: unknown) {
      if (!controller.signal.aborted) setError(assistantErrorCode(failure));
    } finally {
      if (pending.current?.id === input.request.requestId) {
        pending.current = null;
        setIsRunning(false);
      }
    }
  }

  async function apply(): Promise<void> {
    if (!proposal) return;
    setError("");
    try {
      await applyProposal(proposal);
    } catch (failure: unknown) {
      if (currentKey.current === contextKey)
        setError(assistantErrorCode(failure));
    }
  }

  async function cancel(): Promise<void> {
    const request = pending.current;
    if (!request) return;
    request.controller.abort();
    pending.current = null;
    setIsRunning(false);
    setError("cancelled");
    try {
      await assistantApi({ intent: "cancel", id: request.id });
    } catch (failure: unknown) {
      if (currentKey.current === contextKey)
        setError(assistantErrorCode(failure));
    }
  }

  return {
    isRunning,
    proposal,
    error,
    isApplied,
    send,
    apply,
    discard: () => {
      setProposal(null);
      setError("");
    },
    cancel,
  };
}
