import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { showSuccessToast } from "@/app/components/ui/toast";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentAccessKind,
  AgentConnectionSummary,
  AgentProviderId,
} from "@/definition/AgentConnection";
import type { Dispatch, FormEvent, SetStateAction } from "react";

interface AgentFormFields {
  readonly name: string;
  readonly provider: AgentProviderId;
  readonly apiKey: string;
  readonly testModel: string;
  /** Empty keeps the provider or CLI default effort. */
  readonly reasoningEffort: string;
}

type ModelChoice = Pick<AgentFormFields, "testModel" | "reasoningEffort">;

function storedChoice(
  connection: AgentConnectionSummary | undefined,
): ModelChoice {
  return {
    testModel: connection?.testModel ?? "",
    reasoningEffort: connection?.reasoningEffort ?? "",
  };
}

function isSameChoice(left: ModelChoice, right: ModelChoice): boolean {
  return (
    left.testModel === right.testModel &&
    left.reasoningEffort === right.reasoningEffort
  );
}

/**
 * Holds the open and the last saved field values.
 *
 * @remarks
 * The server stores a default model after access (A7 §21.6). The form adopts
 * such a change unless the administrator has already changed the model here.
 */
function useFormFields(
  kind: AgentAccessKind,
  connection: AgentConnectionSummary | undefined,
): {
  readonly fields: AgentFormFields;
  readonly setFields: Dispatch<SetStateAction<AgentFormFields>>;
  readonly saved: AgentFormFields;
  readonly setSaved: Dispatch<SetStateAction<AgentFormFields>>;
} {
  const [fields, setFields] = useState<AgentFormFields>({
    name: connection?.name ?? "",
    provider:
      connection?.provider ?? (kind === "api_key" ? "openrouter" : "codex_cli"),
    apiKey: "",
    ...storedChoice(connection),
  });
  const [saved, setSaved] = useState(fields);
  const stored = storedChoice(connection);
  const [seen, setSeen] = useState(stored);
  if (!isSameChoice(seen, stored)) {
    setSeen(stored);
    setSaved({ ...saved, ...stored });
    if (isSameChoice(fields, saved)) setFields({ ...fields, ...stored });
  }
  return { fields, setFields, saved, setSaved };
}

/** Keeps secrets only in the open form and clears them after a successful save. */
export function useAgentForm(
  kind: AgentAccessKind,
  connection: AgentConnectionSummary | undefined,
  onSaved: (id: string) => void,
): {
  readonly fields: AgentFormFields;
  readonly setField: <Key extends keyof AgentFormFields>(
    key: Key,
    value: AgentFormFields[Key],
  ) => void;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  /** Counts successful saves so single-use inputs such as a replaced key can reset. */
  readonly savedCount: number;
  readonly error: Extract<AgentActionResult, { ok: false }>["error"] | null;
  readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
} {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const { fields, setFields, saved, setSaved } = useFormFields(
    kind,
    connection,
  );
  const [savedCount, setSavedCount] = useState(0);
  const handled = useRef<AgentActionResult | undefined>(undefined);
  useEffect(() => {
    if (
      fetcher.state !== "idle" ||
      !fetcher.data ||
      handled.current === fetcher.data
    )
      return;
    handled.current = fetcher.data;
    if (
      !fetcher.data.ok ||
      !fetcher.data.connectionId ||
      (fetcher.data.intent !== "create-connection" &&
        fetcher.data.intent !== "update-connection")
    )
      return;
    const clean = {
      ...fields,
      apiKey: "",
      name: fields.name.trim(),
      testModel: fields.testModel.trim(),
    };
    setFields(clean);
    setSaved(clean);
    setSavedCount((count) => count + 1);
    showSuccessToast(t("settings.agents.saved"));
    onSaved(fetcher.data.connectionId);
  }, [fetcher.data, fetcher.state, fields, onSaved, setFields, setSaved, t]);
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void fetcher.submit(
      {
        ...fields,
        intent: connection ? "update-connection" : "create-connection",
        connectionId: connection?.id ?? "",
      },
      { method: "post" },
    );
  }
  return {
    fields,
    setField: (key, value) =>
      setFields((current) => ({ ...current, [key]: value })),
    isDirty: JSON.stringify(fields) !== JSON.stringify(saved),
    isSaving: fetcher.state !== "idle",
    savedCount,
    error:
      fetcher.state === "idle" && fetcher.data?.ok === false
        ? fetcher.data.error
        : null,
    handleSubmit,
  };
}

export type AgentForm = ReturnType<typeof useAgentForm>;
