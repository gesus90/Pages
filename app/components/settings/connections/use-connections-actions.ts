import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { showSuccessToast } from "@/app/components/ui/toast";

import type { ConnectionAction } from "./connection-action";
import type { McpConnectionsView } from "@/definition/McpConnections";

const CONNECTION_SUCCESS_MESSAGES = {
  "revoke-token": "settings.connections.revoke.success",
  "request-rotation": "settings.connections.rotate.success",
  "revoke-oauth-grant": "settings.connections.oauth.revoke.success",
  "set-oauth-duration": "settings.saved",
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
  readonly duration: (duration: string) => void;
  readonly validity: (days: string) => void;
}

function endingGrants(
  oauth: McpConnectionsView["oauth"],
  duration: string,
): number {
  return oauth.grants.filter(
    (grant) =>
      grant.status === "active" &&
      duration !== "unlimited" &&
      grant.verifiedAt + Number(duration) * 1000 <= Date.now(),
  ).length;
}

/** Coordinates confirmed mutations, server errors and success feedback with fresh route data. */
export function useConnectionsActions(
  view: McpConnectionsView,
): ConnectionsActions {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    updated?: boolean;
    error?: string;
    count?: number;
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
      if (
        fetcher.data.error === "confirmation_required" &&
        lastAction.current?.intent === "set-oauth-duration"
      ) {
        setSelected({ ...lastAction.current, count: fetcher.data.count });
        setError(undefined);
        return;
      }
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
    if (selected.duration) {
      form.set("duration", selected.duration);
      form.set("confirmShorten", "on");
    }
    send(form, selected);
  }
  function duration(next: string): void {
    const ending = endingGrants(view.oauth, next);
    const action: ConnectionAction = {
      intent: "set-oauth-duration",
      duration: next,
      count: ending,
    };
    if (ending > 0) {
      choose(action);
      return;
    }
    const form = new FormData();
    form.set("intent", action.intent);
    form.set("duration", next);
    send(form, action);
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
    duration,
    validity,
    cancel: () => setSelected(null),
  };
}
