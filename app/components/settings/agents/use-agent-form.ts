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
  readonly codexPriceMappings?: string;
  readonly name: string;
  readonly claudePriceModels?: string;
  readonly provider: AgentProviderId;
  readonly zaiAccountType: string;
  readonly apiKey: string;
  readonly testModel: string;
  /** Empty keeps the provider or CLI default effort. */
  readonly reasoningEffort: string;
  readonly openRouterModelIds?: string;
  /** Who may use the models of the connection; sent as one JSON field. */
  readonly scope: AgentConnectionScope;
}

type StoredChoice = Pick<
  AgentFormFields,
  | "testModel"
  | "reasoningEffort"
  | "scope"
  | "zaiAccountType"
  | "codexPriceMappings"
  | "claudePriceModels"
  | "openRouterModelIds"
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

function formatCodexPriceMappings(
  connection: AgentConnectionSummary | undefined,
  kind: AgentAccessKind,
): Pick<AgentFormFields, "codexPriceMappings"> {
  const isCodexConnection =
    connection?.provider === "codex_cli" ||
    (!connection && kind === "cli_account");
  if (!isCodexConnection) return {};
  return {
    codexPriceMappings: Object.entries(connection?.codexPriceMappings ?? {})
      .map(([model, id]) => `${model} = ${id}`)
      .join("\n"),
  };
}

function storedChoice(
  connection: AgentConnectionSummary | undefined,
  kind: AgentAccessKind,
): StoredChoice {
  return {
    ...formatCodexPriceMappings(connection, kind),
    testModel: connection?.testModel ?? "",
    ...(connection?.provider === "claude_code"
      ? {
          claudePriceModels: JSON.stringify(connection.claudePriceModels ?? {}),
        }
      : {}),
    reasoningEffort: connection?.reasoningEffort ?? "",
    scope: connection?.scope ?? GLOBAL_CONNECTION_SCOPE,
    zaiAccountType: connection?.zaiAccountType ?? (connection ? "api" : ""),
    openRouterModelIds: JSON.stringify(
      connection?.openRouterModelIds ?? {},
      null,
      2,
    ),
  };
}

function isSameChoice(left: StoredChoice, right: StoredChoice): boolean {
  return (
    left.codexPriceMappings === right.codexPriceMappings &&
    left.testModel === right.testModel &&
    left.claudePriceModels === right.claudePriceModels &&
    left.reasoningEffort === right.reasoningEffort &&
    left.zaiAccountType === right.zaiAccountType &&
    left.openRouterModelIds === right.openRouterModelIds &&
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
 * The server stores a default model after access. The form adopts
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
    ...storedChoice(connection, kind),
  });
  const [saved, setSaved] = useState(fields);
  const stored = storedChoice(connection, kind);
  const [seen, setSeen] = useState(stored);
  if (!isSameChoice(seen, stored)) {
    setSeen(stored);
    setSaved({ ...saved, ...stored });
    if (isSameChoice(fields, saved)) setFields({ ...fields, ...stored });
  }
  return { fields, setFields, saved, setSaved };
}

type AgentFetcher = ReturnType<typeof useFetcher<AgentActionResult>>;

/**
 * Adopts a successful connection save.
 *
 * @remarks
 * Secrets only live in the open form and are cleared once the save went
 * through; the saved values adopt the trimmed ones and the counters of
 * single-use inputs reset.
 */
function useAgentFormSaved(input: {
  readonly fetcher: AgentFetcher;
  readonly fields: AgentFormFields;
  readonly setFields: Dispatch<SetStateAction<AgentFormFields>>;
  readonly setSaved: Dispatch<SetStateAction<AgentFormFields>>;
  readonly setSavedCount: Dispatch<SetStateAction<number>>;
  readonly t: ReturnType<typeof useTranslation>["t"];
  readonly onSaved: (id: string) => void;
}): void {
  const { fetcher, fields, setFields, setSaved, setSavedCount, t, onSaved } =
    input;
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
  }, [
    fetcher.data,
    fetcher.state,
    fields,
    onSaved,
    setFields,
    setSaved,
    setSavedCount,
    t,
  ]);
}

/** The provider maps the request carries; an unchanged one is not sent again. */
function changedProviderFields(
  fields: AgentFormFields,
  saved: AgentFormFields,
  connection: AgentConnectionSummary | undefined,
): Record<string, string> {
  return {
    ...(fields.provider === "codex_cli" &&
    (!connection || fields.codexPriceMappings !== saved.codexPriceMappings)
      ? { codexPriceMappings: fields.codexPriceMappings ?? "" }
      : {}),
    ...(fields.provider === "claude_code" &&
    fields.claudePriceModels !== saved.claudePriceModels
      ? { claudePriceModels: fields.claudePriceModels ?? "" }
      : {}),
    ...(fields.provider === "opencode"
      ? { openRouterModelIds: fields.openRouterModelIds ?? "" }
      : {}),
    ...(fields.provider === "zai" &&
    (!connection || fields.zaiAccountType !== saved.zaiAccountType)
      ? { zaiAccountType: fields.zaiAccountType }
      : {}),
  };
}

/**
 * The scope the request carries.
 *
 * @remarks
 * An unchanged scope is not sent, so a form opened earlier cannot overwrite a
 * scope that another administrator saved since.
 */
function changedScopeField(
  fields: AgentFormFields,
  saved: AgentFormFields,
  connection: AgentConnectionSummary | undefined,
): Record<string, string> {
  return !connection || !isSameScope(fields.scope, saved.scope)
    ? { scope: JSON.stringify(fields.scope) }
    : {};
}

/** The fields one save request carries for the action. */
function buildSubmitPayload(
  fields: AgentFormFields,
  saved: AgentFormFields,
  connection: AgentConnectionSummary | undefined,
): Record<string, string> {
  return {
    name: fields.name,
    provider: fields.provider,
    apiKey: fields.apiKey,
    testModel: fields.testModel,
    reasoningEffort: fields.reasoningEffort,
    ...changedProviderFields(fields, saved, connection),
    ...changedScopeField(fields, saved, connection),
    intent: connection ? "update-connection" : "create-connection",
    connectionId: connection?.id ?? "",
  };
}

/** Submits the open form to the settings action. */
function useAgentFormSubmit(
  fetcher: AgentFetcher,
  fields: AgentFormFields,
  saved: AgentFormFields,
  connection: AgentConnectionSummary | undefined,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    void fetcher.submit(buildSubmitPayload(fields, saved, connection), {
      method: "post",
    });
  };
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
  useAgentFormSaved({
    fetcher,
    fields,
    setFields,
    setSaved,
    setSavedCount,
    t,
    onSaved,
  });
  const handleSubmit = useAgentFormSubmit(fetcher, fields, saved, connection);
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
