import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentWorkspaceInput,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";
import type {
  RemoteActionResult,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";

/** Where a workspace lies: on this server or on a machine behind a remote connection. */
export type WorkspaceLocation = "local" | "remote";

/** The registration being edited; local and remote profiles share name, project and path. */
export interface WorkspaceDraft extends AgentWorkspaceInput {
  readonly location: WorkspaceLocation;
  /** The remote connection; empty for a local workspace. */
  readonly connectionId: string;
}

/** The registration a dialog edits, or `null` for a new one. */
export type WorkspaceSubject =
  | { readonly location: "local"; readonly workspace: AgentWorkspaceView }
  | { readonly location: "remote"; readonly workspace: RemoteWorkspaceView }
  | null;

function initialDraft(
  subject: WorkspaceSubject,
  defaultLocation: WorkspaceLocation,
): WorkspaceDraft {
  if (!subject)
    return {
      location: defaultLocation,
      connectionId: "",
      name: "",
      path: "",
      projectId: "",
    };
  const { workspace } = subject;
  return {
    location: subject.location,
    connectionId:
      subject.location === "remote" ? subject.workspace.connectionId : "",
    name: workspace.name,
    path: workspace.path,
    projectId: workspace.projectId,
    revision: workspace.revision,
  };
}

/** Keeps registration input and dirty-state protection separate from form sections. */
export function useWorkspaceForm(
  subject: WorkspaceSubject,
  onSaved: () => void,
  defaultLocation: WorkspaceLocation = "local",
): {
  readonly input: WorkspaceDraft;
  readonly setInput: (input: WorkspaceDraft) => void;
  readonly fetcher: ReturnType<typeof useFetcher<AgentActionResult>>;
  readonly remoteFetcher: ReturnType<typeof useFetcher<RemoteActionResult>>;
  readonly isPending: boolean;
  readonly shouldConfirmClose: boolean;
  readonly setConfirmClose: (open: boolean) => void;
  readonly requestClose: () => void;
  readonly guardDismiss: (event: { preventDefault: () => void }) => void;
} {
  const fetcher = useFetcher<AgentActionResult>();
  const remoteFetcher = useFetcher<RemoteActionResult>();
  const [input, setInput] = useState<WorkspaceDraft>(() =>
    initialDraft(subject, defaultLocation),
  );
  const initial = useRef(JSON.stringify(input));
  const isDirty = initial.current !== JSON.stringify(input);
  const [shouldConfirmClose, setConfirmClose] = useState(false);
  const isPending = fetcher.state !== "idle" || remoteFetcher.state !== "idle";
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "save-workspace"
    )
      onSaved();
  }, [fetcher.state, fetcher.data, onSaved]);
  useEffect(() => {
    if (remoteFetcher.state === "idle" && remoteFetcher.data?.ok) onSaved();
  }, [remoteFetcher.state, remoteFetcher.data, onSaved]);
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
    remoteFetcher,
    isPending,
    shouldConfirmClose,
    setConfirmClose,
    requestClose,
    guardDismiss,
  };
}
