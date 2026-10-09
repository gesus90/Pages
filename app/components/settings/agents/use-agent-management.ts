import { useRef, useState } from "react";

import { useAgentActions } from "./use-agent-actions";

import type {
  AgentAccessKind,
  AgentConnectionSummary,
} from "@/definition/AgentConnection";
import type { AgentCommandHandler } from "./agent-row-menu";
import type { AgentConfirmationRequest } from "./agent-confirmation";
import type { AgentActions } from "./use-agent-actions";

interface AgentPanelSelection {
  readonly kind: AgentAccessKind;
  readonly id?: string;
}

/** Coordinates table triggers, confirmation and focus restoration for one open panel. */
export function useAgentManagement(): {
  readonly selection: AgentPanelSelection | null;
  readonly confirmation: AgentConfirmationRequest | null;
  readonly actions: AgentActions;
  readonly setSelection: (selection: AgentPanelSelection | null) => void;
  readonly select: (selection: AgentPanelSelection) => void;
  readonly edit: (connection: AgentConnectionSummary) => void;
  readonly command: AgentCommandHandler;
  readonly confirm: () => void;
  readonly closeConfirmation: () => void;
  readonly returnFocus: (event: Event) => void;
} {
  const opener = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<AgentPanelSelection | null>(null);
  const [confirmation, setConfirmation] =
    useState<AgentConfirmationRequest | null>(null);
  const actions = useAgentActions(() => setSelection(null));
  function select(next: AgentPanelSelection): void {
    if (!selection && document.activeElement instanceof HTMLElement) {
      const active = document.activeElement;
      const menuTrigger = active.closest('[role="menu"]')
        ? document.getElementById(`agent-menu-${next.id}`)
        : null;
      opener.current = menuTrigger ?? active;
    }
    setSelection(next);
  }
  function returnFocus(event: Event): void {
    event.preventDefault();
    opener.current?.focus();
  }
  function edit(connection: AgentConnectionSummary): void {
    select({ kind: connection.accessKind, id: connection.id });
  }
  const command: AgentCommandHandler = (connection, operation) => {
    if (
      operation === "model" ||
      operation === "delete" ||
      operation === "logout"
    ) {
      setConfirmation({ connection, command: operation });
      return;
    }
    edit(connection);
    if (operation === "login") actions.submit("start-login", connection.id);
    else actions.submit("run-check", connection.id, { kind: "auth" });
  };
  function confirm(): void {
    if (!confirmation) return;
    const { connection, command: operation } = confirmation;
    if (operation === "model")
      actions.submit("run-check", connection.id, { kind: "model" });
    else
      actions.submit(
        operation === "delete" ? "delete-connection" : "logout-cli",
        connection.id,
      );
    setConfirmation(null);
  }
  return {
    selection,
    confirmation,
    actions,
    setSelection,
    select,
    edit,
    command,
    confirm,
    closeConfirmation: () => setConfirmation(null),
    returnFocus,
  };
}
