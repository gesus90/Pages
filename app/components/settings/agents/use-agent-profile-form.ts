import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { agentParameterIssues } from "@/definition/AgentParameters";

import { useAgentAssignment } from "./use-agent-assignment";
import { useAgentProfileDraft } from "./use-agent-profile-draft";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentProfile,
  AgentProfileDirectory,
  AgentProfileInput,
} from "@/definition/AgentProfile";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";
import type { AssignmentChoices } from "./use-agent-assignment";

/** Inputs for the central agent editor. */
export interface AgentProfileFormProps {
  readonly workspaceChoices?: readonly AgentWorkspaceChoice[];
  readonly profile: AgentProfile | null;
  readonly connections: readonly AgentConnectionSummary[];
  readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
  readonly directory: AgentProfileDirectory;
  readonly projects?: readonly { readonly id: string; readonly name: string }[];
  /** Tickets that execution plans bind to an existing agent, listed read-only. */
  readonly taskAssignments?: readonly AgentTaskAssignment[];
  readonly onSaved: () => void;
}

/** Keeps validation, persistence and dirty-state protection outside the editor sections. */
export function useAgentProfileForm(props: AgentProfileFormProps): {
  readonly fetcher: ReturnType<typeof useFetcher<AgentActionResult>>;
  readonly draft: ReturnType<typeof useAgentProfileDraft>;
  readonly selection: AssignmentChoices;
  readonly input: AgentProfileInput;
  readonly isPending: boolean;
  readonly isInvalid: boolean;
  readonly dismissal: ReturnType<typeof useDraftDismissal>;
} {
  const fetcher = useFetcher<AgentActionResult>();
  const draft = useAgentProfileDraft(props.profile);
  const selection = useAgentAssignment({
    ...props,
    assignment: props.profile,
  });
  const input: AgentProfileInput = {
    name: draft.name,
    isActive: draft.isActive,
    purposes: draft.purposes,
    targets: draft.targets,
    connectionId: selection.connectionId,
    model: selection.modelId,
    reasoningEffort: selection.effort || null,
    configuration: draft.configuration,
    ...(props.profile?.revision ? { revision: props.profile.revision } : {}),
  };
  const isPending = fetcher.state !== "idle";
  const dismissal = useDraftDismissal(input, isPending, props.onSaved);
  const { onSaved } = props;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onSaved();
  }, [fetcher.state, fetcher.data, onSaved]);
  return {
    fetcher,
    draft,
    selection,
    input,
    isPending,
    dismissal,
    isInvalid: isInvalidDraft(input, props.profile === null, selection.error),
  };
}

function isInvalidDraft(
  input: AgentProfileInput,
  isNew: boolean,
  error: string | null,
): boolean {
  const configuration = input.configuration;
  const isIncomplete =
    !input.name.trim() ||
    input.purposes.length === 0 ||
    !input.connectionId ||
    !input.model;
  const hasInvalidParameters =
    input.isActive &&
    configuration !== undefined &&
    agentParameterIssues(configuration).length > 0;
  const hasNoAssignment =
    input.isActive &&
    configuration?.scope !== "system" &&
    input.targets.length === 0;
  return (
    isIncomplete ||
    (isNew && error !== null) ||
    hasInvalidParameters ||
    hasNoAssignment
  );
}

function useDraftDismissal(
  input: AgentProfileInput,
  isPending: boolean,
  onClose: () => void,
): {
  readonly shouldConfirmClose: boolean;
  readonly setConfirmClose: (value: boolean) => void;
  readonly requestClose: () => void;
  readonly guardDismiss: (event: { preventDefault: () => void }) => void;
} {
  const [shouldConfirmClose, setConfirmClose] = useState(false);
  const initial = useRef(JSON.stringify(input));
  const isDirty = initial.current !== JSON.stringify(input);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  function requestClose(): void {
    if (isPending) return;
    if (isDirty) setConfirmClose(true);
    else onClose();
  }
  function guardDismiss(event: { preventDefault: () => void }): void {
    event.preventDefault();
    requestClose();
  }
  return { shouldConfirmClose, setConfirmClose, requestClose, guardDismiss };
}
