import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { showSuccessToast } from "@/app/components/ui/toast";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentAccessKind,
  AgentConnectionSummary,
  AgentProviderId,
} from "@/definition/AgentConnection";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";
import type { Dispatch, FormEvent, SetStateAction } from "react";

interface AgentFormFields {
  readonly name: string;
  readonly provider: AgentProviderId;
  readonly apiKey: string;
  readonly testModel: string;
  /** Empty keeps the provider or CLI default effort. */
  readonly reasoningEffort: string;
  /** Who may use the models of the connection; sent as one JSON field. */
  readonly scope: AgentConnectionScope;
}

type StoredChoice = Pick<
  AgentFormFields,
  "testModel" | "reasoningEffort" | "scope"
>;

/** The server lists targets by kind, the form in the order of the choices. */
function canonicalScope(scope: AgentConnectionScope): AgentConnectionScope {
  return {
    mode: scope.mode,
    targets: [...scope.targets].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.targetId.localeCompare(right.targetId),
    ),
  };
}

function isSameScope(
  left: AgentConnectionScope,
  right: AgentConnectionScope,
): boolean {
  return (
    JSON.stringify(canonicalScope(left)) ===
    JSON.stringify(canonicalScope(right))
  );
}

function storedChoice(
  connection: AgentConnectionSummary | undefined,
): StoredChoice {
  return {
    testModel: connection?.testModel ?? "",
    reasoningEffort: connection?.reasoningEffort ?? "",
    scope: connection?.scope ?? GLOBAL_CONNECTION_SCOPE,
  };
}

function isSameChoice(left: StoredChoice, right: StoredChoice): boolean {
  return (
    left.testModel === right.testModel &&
    left.reasoningEffort === right.reasoningEffort &&
    isSameScope(left.scope, right.scope)
  );
}

function isSameFields(left: AgentFormFields, right: AgentFormFields): boolean {
  return (
    left.name === right.name &&
    left.provider === right.provider &&
    left.apiKey === right.apiKey &&
    isSameChoice(left, right)
  );
}

/**
 * Holds the open and the last saved field values.
 *
 * @remarks
 * The server stores a default model after access (A7 §21.6). The form adopts
 * such a change unless the administrator has already changed the model here.
 * A scope that another administrator saved is adopted the same way.
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
    const { scope, ...text } = fields;
    void fetcher.submit(
      {
        ...text,
        // An unchanged scope is not sent, so a form opened earlier cannot
        // overwrite a scope that another administrator saved since.
        ...(!connection || !isSameScope(scope, saved.scope)
          ? { scope: JSON.stringify(scope) }
          : {}),
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
    isDirty: !isSameFields(fields, saved),
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
