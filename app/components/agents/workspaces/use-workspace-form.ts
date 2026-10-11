import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentWorkspaceInput,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";

/** Keeps registration input and dirty-state protection separate from form sections. */
export function useWorkspaceForm(
  workspace: AgentWorkspaceView | null,
  onSaved: () => void,
): {
  readonly input: AgentWorkspaceInput;
  readonly setInput: (input: AgentWorkspaceInput) => void;
  readonly fetcher: ReturnType<typeof useFetcher<AgentActionResult>>;
  readonly isPending: boolean;
  readonly shouldConfirmClose: boolean;
  readonly setConfirmClose: (open: boolean) => void;
  readonly requestClose: () => void;
  readonly guardDismiss: (event: { preventDefault: () => void }) => void;
} {
  const fetcher = useFetcher<AgentActionResult>();
  const [input, setInput] = useState<AgentWorkspaceInput>(
    workspace
      ? {
          name: workspace.name,
          path: workspace.path,
          projectId: workspace.projectId,
          targets: workspace.targets,
          revision: workspace.revision,
        }
      : { name: "", path: "", projectId: "", targets: [] },
  );
  const initial = useRef(JSON.stringify(input));
  const isDirty = initial.current !== JSON.stringify(input);
  const [shouldConfirmClose, setConfirmClose] = useState(false);
  const isPending = fetcher.state !== "idle";
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "save-workspace"
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
