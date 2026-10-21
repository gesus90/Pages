import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type {
  RemoteActionResult,
  RemoteAuthMethod,
  RemoteConnectionView,
  RemoteHostKey,
  RemoteTestResult,
} from "@/definition/RemoteConnection";

/** What the connection dialog holds; secrets stay in memory and are never prefilled. */
export interface RemoteConnectionDraft {
  readonly name: string;
  readonly host: string;
  readonly port: string;
  readonly username: string;
  readonly authMethod: RemoteAuthMethod;
  readonly departmentId: string;
  readonly password: string;
  readonly privateKey: string;
  readonly passphrase: string;
  /** One row per allowed directory; empty rows are dropped on save. */
  readonly allowedRoots: readonly string[];
}

/** The dialog's state and actions, kept apart from its sections. */
export interface RemoteConnectionForm {
  readonly draft: RemoteConnectionDraft;
  readonly setDraft: (draft: RemoteConnectionDraft) => void;
  /** The host key confirmed in this dialog; it replaces the pinned one on save. */
  readonly confirmedHostKey: RemoteHostKey | null;
  readonly test: RemoteTestResult | null;
  readonly testResult: RemoteActionResult | undefined;
  readonly saveResult: RemoteActionResult | undefined;
  readonly isTesting: boolean;
  readonly isSaving: boolean;
  readonly isComplete: boolean;
  readonly shouldConfirmClose: boolean;
  readonly setConfirmClose: (open: boolean) => void;
  readonly runTest: () => void;
  readonly confirmHostKey: (hostKey: RemoteHostKey) => void;
  readonly save: () => void;
  readonly requestClose: () => void;
  readonly guardDismiss: (event: DismissEvent) => void;
}

/** The part of Radix's escape and outside events the dialog guard reads. */
interface DismissEvent {
  readonly defaultPrevented: boolean;
  preventDefault: () => void;
}

const REMOTE_ACTION = "/agents/workspaces/remote";

function initialDraft(
  connection: RemoteConnectionView | null,
): RemoteConnectionDraft {
  return {
    name: connection?.name ?? "",
    host: connection?.host ?? "",
    port: String(connection?.port ?? 22),
    username: connection?.username ?? "",
    authMethod: connection?.authMethod ?? "key",
    departmentId: connection?.departmentId ?? "",
    password: "",
    privateKey: "",
    passphrase: "",
    allowedRoots: connection?.allowedRoots ?? [],
  };
}

function hostKeyLine(hostKey: RemoteHostKey | null): string | null {
  return hostKey ? `${hostKey.algorithm} ${hostKey.key}` : null;
}

/** A new connection needs the secrets of its method; an edited one may keep the stored ones. */
function isComplete(
  draft: RemoteConnectionDraft,
  connection: RemoteConnectionView | null,
): boolean {
  const stored = connection?.storedSecrets;
  const hasKey = draft.privateKey.trim() !== "" || stored?.privateKey === true;
  const secrets: Record<RemoteAuthMethod, boolean> = {
    password: draft.password !== "" || stored?.password === true,
    key: hasKey,
    key_passphrase:
      hasKey && (draft.passphrase !== "" || stored?.passphrase === true),
  };
  return (
    draft.name.trim() !== "" &&
    draft.host.trim() !== "" &&
    draft.username.trim() !== "" &&
    draft.departmentId !== "" &&
    Number.isInteger(Number(draft.port)) &&
    secrets[draft.authMethod]
  );
}

/**
 * Holds the connection dialog: draft, test, host key confirmation and save.
 *
 * @param connection - The connection being edited, or `null` for a new one.
 * @param onClose - Closes the dialog, also after a successful save.
 * @returns The form state and its actions.
 */
export function useRemoteConnectionForm(
  connection: RemoteConnectionView | null,
  onClose: () => void,
): RemoteConnectionForm {
  const saver = useFetcher<RemoteActionResult>();
  const tester = useFetcher<RemoteActionResult>();
  const [draft, setDraft] = useState(() => initialDraft(connection));
  const [confirmedHostKey, setConfirmedHostKey] =
    useState<RemoteHostKey | null>(null);
  const [shouldConfirmClose, setConfirmClose] = useState(false);
  const initial = useRef(JSON.stringify(draft));
  const isDirty =
    initial.current !== JSON.stringify(draft) || confirmedHostKey !== null;
  const isSaving = saver.state !== "idle";
  const isTesting = tester.state !== "idle";
  useEffect(() => {
    if (saver.state === "idle" && saver.data?.ok) onClose();
  }, [saver.state, saver.data, onClose]);
  function payload(hostKey: RemoteHostKey | null): Record<string, string> {
    return {
      connectionId: connection?.id ?? "",
      input: JSON.stringify({
        ...draft,
        port: Number(draft.port),
        hostKey: hostKeyLine(hostKey),
        revision: connection?.revision,
      }),
    };
  }
  function submitTest(hostKey: RemoteHostKey | null): void {
    void tester.submit(
      { intent: "test-connection", ...payload(hostKey) },
      { method: "post", action: REMOTE_ACTION },
    );
  }
  function requestClose(): void {
    if (isSaving) return;
    if (isDirty) setConfirmClose(true);
    else onClose();
  }
  const test =
    tester.data?.ok && tester.data.test !== undefined ? tester.data.test : null;
  return {
    draft,
    setDraft,
    confirmedHostKey,
    test: isTesting ? null : test,
    testResult: tester.data,
    saveResult: saver.data,
    isTesting,
    isSaving,
    isComplete: isComplete(draft, connection),
    shouldConfirmClose,
    setConfirmClose,
    runTest: () => submitTest(confirmedHostKey),
    confirmHostKey: (hostKey) => {
      setConfirmedHostKey(hostKey);
      submitTest(hostKey);
    },
    save: () => {
      void saver.submit(
        { intent: "save-connection", ...payload(confirmedHostKey) },
        { method: "post", action: REMOTE_ACTION },
      );
    },
    requestClose,
    guardDismiss: (event) => {
      // An open department list handles its own Escape and keeps the dialog open.
      if (event.defaultPrevented) return;
      event.preventDefault();
      requestClose();
    },
  };
}
