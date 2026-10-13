import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  PageAgent,
  PageAgentInput,
  PageAgentPage,
} from "@/definition/PageAgent";

function initialInput(
  agent: PageAgent | null,
  models: PageAgentPage["models"],
): PageAgentInput {
  if (agent)
    return {
      name: agent.name,
      modelProfileId: agent.modelProfileId,
      reasoningEffort: agent.reasoningEffort,
      configuration: agent.configuration,
      revision: agent.revision,
    };
  const [first] = models;
  return {
    name: "",
    modelProfileId: first?.id ?? "",
    reasoningEffort: first?.reasoningEffort ?? null,
    configuration: { ...emptyAgentConfiguration(), accessMode: "shared" },
  };
}

/** Keeps the definition under edit and its dirty-state protection apart from the form sections. */
export function usePageAgentForm(
  agent: PageAgent | null,
  models: PageAgentPage["models"],
  onSaved: () => void,
): {
  readonly input: PageAgentInput;
  readonly setInput: (input: PageAgentInput) => void;
  readonly fetcher: ReturnType<typeof useFetcher<AgentActionResult>>;
  readonly isPending: boolean;
  readonly shouldConfirmClose: boolean;
  readonly setConfirmClose: (open: boolean) => void;
  readonly requestClose: () => void;
  readonly guardDismiss: (event: { preventDefault: () => void }) => void;
} {
  const fetcher = useFetcher<AgentActionResult>();
  const [input, setInput] = useState<PageAgentInput>(() =>
    initialInput(agent, models),
  );
  const initial = useRef(JSON.stringify(input));
  const isDirty = initial.current !== JSON.stringify(input);
  const [shouldConfirmClose, setConfirmClose] = useState(false);
  const isPending = fetcher.state !== "idle";
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "save-agent"
    )
      onSaved();
  }, [fetcher.state, fetcher.data, onSaved]);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  function requestClose(): void {
    if (isPending) return;
    if (isDirty) setConfirmClose(true);
    else onSaved();
  }
  function guardDismiss(event: { preventDefault: () => void }): void {
    event.preventDefault();
    requestClose();
  }
  return {
    input,
    setInput,
    fetcher,
    isPending,
    shouldConfirmClose,
    setConfirmClose,
    requestClose,
    guardDismiss,
  };
}
