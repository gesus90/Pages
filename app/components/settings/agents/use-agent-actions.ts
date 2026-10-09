import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { showSuccessToast } from "@/app/components/ui/toast";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";

/** Sends explicit operations; only deletion uses a toast instead of inline results. */
export function useAgentActions(onRemoved: () => void): {
  readonly isPending: boolean;
  readonly pendingIntent: string | null;
  readonly error: Extract<AgentActionResult, { ok: false }>["error"] | null;
  readonly result: AgentActionResult | undefined;
  readonly submit: (
    intent: string,
    id: string,
    fields?: Readonly<Record<string, string>>,
  ) => void;
} {
  const fetcher = useFetcher<AgentActionResult>();
  const handled = useRef<AgentActionResult | undefined>(undefined);
  const { t } = useTranslation();
  useEffect(() => {
    if (
      fetcher.state !== "idle" ||
      !fetcher.data ||
      fetcher.data === handled.current
    )
      return;
    handled.current = fetcher.data;
    if (fetcher.data.ok && fetcher.data.intent === "delete-connection") {
      showSuccessToast(t("settings.agents.removed"));
      onRemoved();
    }
  }, [fetcher.data, fetcher.state, onRemoved, t]);
  return {
    isPending: fetcher.state !== "idle",
    pendingIntent: fetcher.formData?.get("intent")?.toString() ?? null,
    error:
      fetcher.state === "idle" && fetcher.data?.ok === false
        ? fetcher.data.error
        : null,
    result: fetcher.state === "idle" ? fetcher.data : undefined,
    submit: (intent, id, fields = {}) => {
      void fetcher.submit(
        { intent, connectionId: id, ...fields },
        { method: "post" },
      );
    },
  };
}

export type AgentActions = ReturnType<typeof useAgentActions>;
