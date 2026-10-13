import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { showSuccessToast } from "@/app/components/ui/toast";

import type { ConnectionAction } from "./connection-action";

const CONNECTION_SUCCESS_MESSAGES = {
  "revoke-token": "settings.connections.revoke.success",
  "request-rotation": "settings.connections.rotate.success",
};

/** Shared state of the owner-scoped connection forms and confirmation modal. */
export interface ConnectionsActions {
  readonly selected: ConnectionAction | null;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly endedRef: React.RefObject<HTMLButtonElement | null>;
  readonly choose: (action: ConnectionAction) => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
  readonly validity: (days: string) => void;
}

/** Coordinates confirmed mutations, server errors and success feedback with fresh route data. */
export function useConnectionsActions(): ConnectionsActions {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    updated?: boolean;
    error?: string;
  }>();
  const [selected, setSelected] = useState<ConnectionAction | null>(null);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const lastAction = useRef<ConnectionAction | null>(null);
  const endedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (fetcher.state !== "idle") {
      saving.current = true;
      return;
    }
    if (!saving.current) return;
    saving.current = false;
    if (fetcher.data?.error) {
      setError(fetcher.data.error);
      return;
    }
    if (fetcher.data?.updated) {
      const intent = lastAction.current?.intent;
      showSuccessToast(
        t(intent ? CONNECTION_SUCCESS_MESSAGES[intent] : "settings.saved"),
      );
      setSelected(null);
      setError(undefined);
      if (intent === "revoke-token") endedRef.current?.focus();
    }
  }, [fetcher.state, fetcher.data, t]);
  function send(form: FormData, action: ConnectionAction | null = null): void {
    setError(undefined);
    saving.current = true;
    lastAction.current = action;
    void fetcher.submit(form, { method: "post" });
  }
  function choose(action: ConnectionAction): void {
    setError(undefined);
    setSelected(action);
  }
  function confirm(): void {
    if (!selected) return;
    const form = new FormData();
    form.set("intent", selected.intent);
    if (selected.id) form.set("id", selected.id);
    send(form, selected);
  }
  function validity(days: string): void {
    const form = new FormData();
    form.set("intent", "set-token-duration");
    form.set("days", days);
    send(form);
  }
  return {
    selected,
    error,
    endedRef,
    pending: fetcher.state !== "idle",
    choose,
    confirm,
    validity,
    cancel: () => setSelected(null),
  };
}
